import type { Theme } from "@earendil-works/pi-coding-agent";
import { AssistantMessageComponent, VERSION } from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownOptions, type MarkdownTheme, MouseRegion, Spacer, Text, TruncatedText } from "@earendil-works/pi-tui";
import type { CompactThinking } from "../config.js";
import { buildMutedMarkdownTheme } from "./theme.js";

// Track which pi version we patched against to detect incompatibility
const PATCHED_KEY = Symbol.for("archimedes:thinkingPatched");
const PATCH_VERSION_KEY = Symbol.for("archimedes:thinkingPatchVersion");
// THINKING_STATES_KEY is authoritative in compact mode; thinkingVisibilityOverrides
// is mirrored to keep external state consumers consistent.
const THINKING_STATES_KEY = Symbol.for("archimedes:thinkingStateOverrides");

/**
 * Patches `AssistantMessageComponent.prototype.updateContent` so thinking
 * blocks render with a muted `MarkdownTheme`. Called on every session_start
 * to capture a fresh `getTheme` closure (required for /resume).
 *
 * Re-patches when pi version changes to catch breaking upstream changes.
 *
 * @param config Optional labelText/labelColor overrides for the thinking
 *   block header, and autoCollapseThinking flag. When omitted (or empty/invalid),
 *   the original defaults are used.
 */
export function patchThinkingRenderer(
  getTheme: () => Theme,
  config?: {
    labelText?: string;
    labelColor?: string;
    autoCollapseThinking?: boolean;
    compactThinking?: CompactThinking;
  },
): void {
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

    this.thinkingVisibilityOverrides = this.thinkingVisibilityOverrides ?? new Map<number, boolean>();
    (this as any)[THINKING_STATES_KEY] =
      (this as any)[THINKING_STATES_KEY] ?? new Map<number, "hidden" | "compact" | "full">();
    const compactLines =
      config?.compactThinking === "1 line"
        ? 1
        : config?.compactThinking === "3 lines"
          ? 3
          : config?.compactThinking === "5 lines"
            ? 5
            : 0;
    this.markdownTheme.codeBlockIndent = "";
    this.contentContainer.clear();

    // Build the thinking-block header from the closure config once per render.
    // Defaults preserve the original byte-identical output ("Thinking..." in
    // bold truecolor 255,215,0).
    const buildThinkingLabel = (): string => {
      const label = config?.labelText?.trim() ? config.labelText.trim() : "Thinking...";
      const color = config?.labelColor?.trim() ? config.labelColor.trim() : "255,215,0";
      const parts = color.split(",").map((p) => p.trim());
      // Valid iff exactly three 0..255 components (an "R,G,B" triple).
      const valid =
        parts.length === 3 &&
        parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
      const [r, g, b] = valid ? parts : ["255", "215", "0"];
      return `\x1b[1m\x1b[38;2;${r};${g};${b}m${label}\x1b[39m\x1b[22m`;
    };

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

    let thinkingRunIndex = 0;

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

        const runIndex = thinkingRunIndex++;

        const hasVisibleContentAfter = message.content
          .slice(i + 1)
          .some(
            (c: any) =>
              (c.type === "text" && c.text.trim()) ||
              (c.type === "thinking" && c.thinking.trim()) ||
              c.type === "toolCall",
          );

        if (compactLines === 0) {
          const userOverride = this.thinkingVisibilityOverrides.get(runIndex);
          let hidden: boolean;
          if (userOverride !== undefined) {
            hidden = userOverride;
          } else if (config?.autoCollapseThinking) {
            // When auto-collapse is enabled, show thinking while it is actively streaming.
            // Once thinking finishes (subsequent content arrives or streaming ends), collapse it.
            const isThinkingActive = Boolean(this.isStreaming) && !hasVisibleContentAfter;
            hidden = !isThinkingActive;
          } else {
            hidden = this.hideThinkingBlock;
          }

          let thinkingComponent: Text | Markdown;
          if (hidden) {
            // One static label for the whole run when hidden.
            const t = ensureTheme();
            if (!t) continue;
            thinkingComponent = new Text(
              t.italic(t.fg("thinkingText", this.hiddenThinkingLabel)),
              this.outputPad ?? 1,
              0,
            );
          } else {
            let thinkingContent = thinkBlocks.join("\n\n");
            const label = buildThinkingLabel();
            if (!thinkingContent.startsWith(label)) {
              thinkingContent = `${label}\n\n${thinkingContent}`;
            }
            const t = ensureTheme();
            if (!t) continue;
            const muted = ensureMuted();
            thinkingComponent = new Markdown(
              thinkingContent,
              this.outputPad ?? 1,
              0,
              muted ?? this.markdownTheme,
              {
                color: (text: string) => t.fg("thinkingText", text),
                italic: true,
              },
              { transform: transformFor("assistant-thinking") } as MarkdownOptionsWithTransform,
            );
          }

          this.contentContainer.addChild(
            new MouseRegion(thinkingComponent, (event) => {
              if (event.type !== "click" || event.button !== "left") return undefined;
              this.thinkingVisibilityOverrides.set(runIndex, !hidden);
              if (this.lastMessage) this.updateContent(this.lastMessage);
              return { handled: true };
            }),
          );
        } else {
          // THINKING_STATES_KEY is authoritative in compact mode; thinkingVisibilityOverrides
          // is mirrored to keep external state consumers consistent.
          const userState = (this as any)[THINKING_STATES_KEY].get(runIndex);
          let state: "hidden" | "compact" | "full";
          if (userState !== undefined) {
            state = userState;
          } else if (config?.autoCollapseThinking && (!Boolean(this.isStreaming) || hasVisibleContentAfter)) {
            state = "hidden";
          } else {
            state = "compact";
          }

          let thinkingComponent: Text | Markdown | TruncatedText;
          if (state === "hidden") {
            const t = ensureTheme();
            if (!t) continue;
            thinkingComponent = new Text(
              t.italic(t.fg("thinkingText", this.hiddenThinkingLabel)),
              this.outputPad ?? 1,
              0,
            );
          } else if (state === "compact") {
            const t = ensureTheme();
            if (!t) continue;
            const combined = thinkBlocks.join("\n\n").trimEnd();
            const allLines = combined.split("\n");
            const tailLines = allLines.slice(-compactLines);
            const label = buildThinkingLabel();
            let textContent: string;
            if (compactLines === 1) {
              const line = tailLines[0] ?? "";
              textContent = `${label} ${t.italic(t.fg("thinkingText", line))}`;
              thinkingComponent = new TruncatedText(textContent, this.outputPad ?? 1, 0);
            } else {
              const formattedLines = tailLines.map((l) => t.italic(t.fg("thinkingText", l))).join("\n");
              textContent = `${label}\n${formattedLines}`;
              thinkingComponent = new Text(textContent, this.outputPad ?? 1, 0);
            }
          } else {
            let thinkingContent = thinkBlocks.join("\n\n");
            const label = buildThinkingLabel();
            if (!thinkingContent.startsWith(label)) {
              thinkingContent = `${label}\n\n${thinkingContent}`;
            }
            const t = ensureTheme();
            if (!t) continue;
            const muted = ensureMuted();
            thinkingComponent = new Markdown(
              thinkingContent,
              this.outputPad ?? 1,
              0,
              muted ?? this.markdownTheme,
              {
                color: (text: string) => t.fg("thinkingText", text),
                italic: true,
              },
              { transform: transformFor("assistant-thinking") } as MarkdownOptionsWithTransform,
            );
          }

          this.contentContainer.addChild(
            new MouseRegion(thinkingComponent, (event) => {
              if (event.type !== "click" || event.button !== "left") return undefined;
              let nextState: "hidden" | "compact" | "full";
              if (state === "compact") {
                nextState = "full";
              } else if (state === "full") {
                nextState = "compact";
              } else {
                // From hidden -> expand to full
                nextState = "full";
              }
              (this as any)[THINKING_STATES_KEY].set(runIndex, nextState);
              this.thinkingVisibilityOverrides.set(runIndex, (nextState as string) === "hidden");
              if (this.lastMessage) this.updateContent(this.lastMessage);
              return { handled: true };
            }),
          );
        }
        if (hasVisibleContentAfter) {
          this.contentContainer.addChild(new Spacer(1));
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
