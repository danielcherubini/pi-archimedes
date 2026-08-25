import type { Theme } from "@earendil-works/pi-coding-agent";
import { AssistantMessageComponent, VERSION } from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownOptions, type MarkdownTheme, Spacer, Text } from "@earendil-works/pi-tui";
import { buildMutedMarkdownTheme } from "./theme.js";

// The label we prepend to visible thinking content.
const THINKING_LABEL = "\x1b[1m\x1b[38;2;255;215;0mThinking...\x1b[39m\x1b[22m";

// Track which pi version we patched against to detect incompatibility
const PATCHED_KEY = Symbol.for("archimedes:thinkingPatched");
const PATCH_VERSION_KEY = Symbol.for("archimedes:thinkingPatchVersion");

/**
 * Patches `AssistantMessageComponent.prototype.updateContent` so thinking
 * blocks render with a muted `MarkdownTheme`. Called on every session_start
 * to capture a fresh `getTheme` closure (required for /resume).
 *
 * Re-patches when pi version changes to catch breaking upstream changes.
 */
export function patchThinkingRenderer(getTheme: () => Theme): void {
  if (!AssistantMessageComponent) return;

  const proto = AssistantMessageComponent.prototype;
  if (
    !proto ||
    typeof proto.updateContent !== "function" ||
    AssistantMessageComponent.name !== "AssistantMessageComponent"
  ) {
    return;
  }

  const src = proto.updateContent.toString();
  // NOTE: pi ships the interactive TUI in a minified bundle chunk at runtime, so
  // the source we see via .toString() can be `content.type==="thinking"` (no
  // spaces) even where dist is readable. The probe below must therefore be
  // minification-safe: a whitespace-tolerant regex rather than an exact
  // substring. A bare `space === "thinking"` (or any other field) still does
  // not match, as required.
  const hasThinkingCheck = /content\.type\s*===\s*["']thinking["']/.test(src);
  const hasMarkdownTheme = src.includes("this.markdownTheme");
  if (!hasThinkingCheck || !hasMarkdownTheme) {
    console.warn(
      `[archimedes] Skipping thinking renderer patch — signature mismatch
  hasThinkingCheck: ${hasThinkingCheck}, hasMarkdownTheme: ${hasMarkdownTheme}
  This likely means pi's AssistantMessageComponent changed. The muted theme
  for thinking blocks will not be applied.`,
    );
    return;
  }

  // Check if already patched against the current pi version
  const currentVersion = VERSION ?? "unknown";
  const patchVersion = (proto as any)[PATCH_VERSION_KEY] as string | undefined;
  if ((proto as any)[PATCHED_KEY] && patchVersion === currentVersion) {
    // Already patched for this version — just update the closure by re-patching
    // (needed for /resume to get fresh getTheme)
  } else {
    // First patch or version changed — warn if version mismatch
    if ((proto as any)[PATCHED_KEY] && patchVersion && patchVersion !== currentVersion) {
      console.warn(`[archimedes] Re-patching thinking renderer: pi version changed ${patchVersion} → ${currentVersion}`);
    }
  }

  // Re-patched every session_start — /resume needs a fresh getTheme closure.
  //
  // Shape: 0.84.3 pi native updateContent:
  //   updateContent(message, isStreaming = this.isStreaming) {
  //     this.lastMessage = message;
  //     this.isStreaming = isStreaming;
  //     this.contentContainer.clear();
  //     ...
  //     // batches consecutive "thinking" parts into thinkingBlocks
  //     //   (skipping empties), i-- after the inner loop,
  //     //   renders as ONE Markdown section of thinkingBlocks.join("\n\n")
  //     // or ONE static Text label when hidden.
  //     // stop-reason: const hasToolCalls = content.some(...);
  //     //   this.hasToolCalls = hasToolCalls; (render() uses for OSC-133 zones)
  //     //   stopReason === "length" → Spacer + "truncated" Text
  //     //   else if (!hasToolCalls) { aborted / error branches }
  (proto as any).updateContent = function (this: any, message: any, isStreaming?: boolean): void {
    this.lastMessage = message;
    if (isStreaming !== undefined) this.isStreaming = isStreaming;

    this.markdownTheme.codeBlockIndent = "";
    this.contentContainer.clear();

    const hasVisibleContent = message.content.some(
      (c: any) =>
        (c.type === "text" && c.text.trim()) ||
        (c.type === "thinking" && c.thinking.trim()),
    );

    if (hasVisibleContent) {
      this.contentContainer.addChild(new Spacer(1));
    }

    // Lazy muted theme: built once per updateContent call.
    let mutedTheme: ReturnType<typeof buildMutedMarkdownTheme> | undefined;
    let theme: Theme | undefined;
    let themeFailed = false;

    const ensureTheme = (): Theme | undefined => {
      if (themeFailed) return undefined;
      if (!theme) {
        try {
          theme = getTheme();
        } catch {
          themeFailed = true;
          return undefined;
        }
      }
      return theme;
    };

    const ensureMuted = (): MarkdownTheme | undefined => {
      if (!mutedTheme) {
        const t = ensureTheme();
        if (!t) return undefined;
        mutedTheme = buildMutedMarkdownTheme(t);
      }
      return mutedTheme;
    };

    // Pi's native updateContent passes a `transform` (createMarkdownTransform)
    // to Markdown so the markdown-transformer pipeline runs — that is what
    // renders Mermaid blocks to ASCII and applies any extension transformers.
    // We must preserve it here, otherwise those transformers are silently
    // dropped when this patch replaces updateContent.
    //
    // NOTE: `createMarkdownTransform` is not exported from pi-coding-agent, so
    // we inline an equivalent pipeline over `this.markdownTransformers`.
    //
    // The `transform` option was added to @earendil-works/pi-tui in 0.84.1.
    // At runtime older pi-tui ignores the field, 0.84.1+ honors it.
    type MarkdownOptionsWithTransform = MarkdownOptions & {
      transform?: (markdown: string, availableWidth: number) => string;
    };
    const transformFor =
      (messageType: "assistant" | "assistant-thinking") =>
      (markdown: string, availableWidth: number): string => {
        let out = markdown;
        for (const transformer of (this as any).markdownTransformers ?? []) {
          try {
            const transformed = transformer(out, {
              messageType,
              isStreaming: this.isStreaming,
              availableWidth,
            });
            if (typeof transformed === "string") out = transformed;
          } catch {
            // Keep the current markdown and continue with the next transformer.
          }
        }
        return out;
      };

    // Render content in order.
    for (let i = 0; i < message.content.length; i++) {
      const content = message.content[i];
      if (content.type === "text" && content.text.trim()) {
        this.contentContainer.addChild(
          new Markdown(
            content.text.trim(),
            this.outputPad ?? 1,
            0,
            this.markdownTheme,
            undefined,
            { transform: transformFor("assistant") } as MarkdownOptionsWithTransform,
          ),
        );
      } else if (content.type === "thinking") {
        // Batch a consecutive run of thinking parts into one section
        // (mirrors 0.84.3 pi native behaviour: thinkBlocks, i-- on the
        // inner loop, early continue on zero-length runs).
        const thinkBlocks: string[] = [];
        for (; i < message.content.length; i++) {
          const thinkingPart = message.content[i];
          if (thinkingPart.type !== "thinking") break;
          const trimmed = thinkingPart.thinking.trim();
          if (trimmed) thinkBlocks.push(trimmed);
        }
        i--;
        if (thinkBlocks.length === 0) continue;

        const hasVisibleContentAfter = message.content
          .slice(i + 1)
          .some(
            (c: any) =>
              (c.type === "text" && c.text.trim()) ||
              (c.type === "thinking" && c.thinking.trim()),
          );

        if (this.hideThinkingBlock) {
          // One static label for the whole run when hidden.
          const t = ensureTheme();
          if (!t) continue;
          this.contentContainer.addChild(
            new Text(t.italic(t.fg("thinkingText", this.hiddenThinkingLabel)), this.outputPad ?? 1, 0),
          );
          if (hasVisibleContentAfter) {
            this.contentContainer.addChild(new Spacer(1));
          }
        } else {
          let thinkingContent = thinkBlocks.join("\n\n");
          if (!thinkingContent.startsWith(THINKING_LABEL)) {
            thinkingContent = `${THINKING_LABEL}\n\n${thinkingContent}`;
          }
          const t = ensureTheme();
          if (!t) continue;
          const muted = ensureMuted();
          this.contentContainer.addChild(
            new Markdown(
              thinkingContent,
              this.outputPad ?? 1,
              0,
              muted ?? this.markdownTheme,
              {
                color: (text: string) => t.fg("thinkingText", text),
                italic: true,
              },
              { transform: transformFor("assistant-thinking") } as MarkdownOptionsWithTransform,
            ),
          );
          if (hasVisibleContentAfter) {
            this.contentContainer.addChild(new Spacer(1));
          }
        }
      }
    }

    // Stop-reason handling — 0.84.3 pi shape. `hasToolCalls` is required by
    // the component's render() for OSC-133 prompt zones, so it must be set.
    const hasToolCalls = message.content.some((c: any) => c.type === "toolCall");
    this.hasToolCalls = hasToolCalls;

    if (message.stopReason === "length") {
      this.contentContainer.addChild(new Spacer(1));
      const t = ensureTheme();
      if (t)
        this.contentContainer.addChild(
          new Text(t.fg("error", "Response was truncated before completion."), this.outputPad ?? 1, 0),
        );
    } else if (!hasToolCalls) {
      if (message.stopReason === "aborted") {
        const abortMessage =
          message.errorMessage && message.errorMessage !== "Request was aborted"
            ? message.errorMessage
            : "Operation aborted";
        this.contentContainer.addChild(new Spacer(1));
        const t = ensureTheme();
        if (t) this.contentContainer.addChild(new Text(t.fg("error", abortMessage), this.outputPad ?? 1, 0));
      } else if (message.stopReason === "error") {
        const errorMsg = message.errorMessage || "Unknown error";
        this.contentContainer.addChild(new Spacer(1));
        const t = ensureTheme();
        if (t) {
          this.contentContainer.addChild(
            new Text(t.fg("error", `Error: ${errorMsg}`), this.outputPad ?? 1, 0),
          );
        }
      }
    }
  };

  // Mark as patched with version for incompatibility detection
  (proto as any)[PATCHED_KEY] = true;
  (proto as any)[PATCH_VERSION_KEY] = currentVersion;
}
