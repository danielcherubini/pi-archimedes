import type { Theme } from "@earendil-works/pi-coding-agent";
import { AssistantMessageComponent, VERSION } from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownTheme, Spacer, Text } from "@earendil-works/pi-tui";
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
  const hasThinkingCheck = src.includes('content.type === "thinking"');
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

  // Re-patch every time — /resume needs a fresh getTheme closure
  (proto as any).updateContent = function (this: any, message: any): void {
    this.lastMessage = message;

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

    // Render content in order.
    for (let i = 0; i < message.content.length; i++) {
      const content = message.content[i];
      if (content.type === "text" && content.text.trim()) {
        this.contentContainer.addChild(
          new Markdown(content.text.trim(), 1, 0, this.markdownTheme),
        );
      } else if (content.type === "thinking" && content.thinking.trim()) {
        const hasVisibleContentAfter = message.content
          .slice(i + 1)
          .some(
            (c: any) =>
              (c.type === "text" && c.text.trim()) ||
              (c.type === "thinking" && c.thinking.trim()),
          );

        if (this.hideThinkingBlock) {
          const t = ensureTheme();
          if (!t) continue;
          this.contentContainer.addChild(
            new Text(t.italic(t.fg("thinkingText", this.hiddenThinkingLabel)), 1, 0),
          );
          if (hasVisibleContentAfter) {
            this.contentContainer.addChild(new Spacer(1));
          }
        } else {
          let thinkingContent = content.thinking.trim();
          if (!thinkingContent.startsWith(THINKING_LABEL)) {
            thinkingContent = `${THINKING_LABEL}\n\n${thinkingContent}`;
          }
          const t = ensureTheme();
          if (!t) continue;
          const muted = ensureMuted();
          this.contentContainer.addChild(
            new Markdown(thinkingContent, 1, 0, muted ?? this.markdownTheme, {
              color: (text: string) => t.fg("thinkingText", text),
              italic: true,
            }),
          );
          if (hasVisibleContentAfter) {
            this.contentContainer.addChild(new Spacer(1));
          }
        }
      }
    }

    // Aborted/error rendering.
    const hasToolCalls = message.content.some((c: any) => c.type === "toolCall");
    if (!hasToolCalls) {
      if (message.stopReason === "aborted") {
        const abortMessage =
          message.errorMessage && message.errorMessage !== "Request was aborted"
            ? message.errorMessage
            : "Operation aborted";
        this.contentContainer.addChild(new Spacer(1));
        const t = ensureTheme();
        if (t) this.contentContainer.addChild(new Text(t.fg("error", abortMessage), 1, 0));
      } else if (message.stopReason === "error") {
        const errorMsg = message.errorMessage || "Unknown error";
        this.contentContainer.addChild(new Spacer(1));
        const t = ensureTheme();
        if (t) {
          this.contentContainer.addChild(
            new Text(t.fg("error", `Error: ${errorMsg}`), 1, 0),
          );
        }
      }
    }

    // Bottom padding so next message has breathing room
    this.contentContainer.addChild(new Spacer(1));
  };

  // Mark as patched with version for incompatibility detection
  (proto as any)[PATCHED_KEY] = true;
  (proto as any)[PATCH_VERSION_KEY] = currentVersion;
}
