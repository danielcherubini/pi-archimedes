import type { Theme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { RESET, resolvePalette, setThemeBg } from "../chrome.js";

type UserMsgCtor = typeof UserMessageComponent & { [PATCHED]?: boolean; [PATCH_VERSION]?: string };

// ── Constants ──────────────────────────────────────────────

const PATCHED = Symbol.for("splashscreen:userMsgPatched");
const PATCH_VERSION = Symbol.for("splashscreen:userMsgPatchVersion");
// Match OSC133 B (zone end) or C (zone final). v0.67 moved these from line
// tail to line head — we strip from wherever they sit and re-emit at the end.
const OSC133_RE = /\x1b\]133;[BC]\x07/g;
const MSG_PADDING_X = 3;
const TIME_COL = 9;

// ── Instance tracking ──────────────────────────────────────

const instanceIndex = new WeakMap<object, number>();
let instanceCount = 0;

export function resetInstanceCount(): void {
  instanceCount = 0;
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

// ── Patch ──────────────────────────────────────────────────

export function patchUserMessage(
  getTheme: () => Theme,
  responseTimes: number[],
): void {
  try {
    let lastBg = "";
    const theme = getTheme();
    const p = resolvePalette(theme);
    lastBg = p.panelBg;
    setThemeBg(theme, "userMessageBg", lastBg);

    import("@earendil-works/pi-coding-agent").then(
      ({ UserMessageComponent }: { UserMessageComponent: UserMsgCtor }) => {
        const currentVersion = VERSION ?? "unknown";
        const patchVersion = UserMessageComponent[PATCH_VERSION];
        // Skip if already patched for this version
        if (UserMessageComponent[PATCHED] && patchVersion === currentVersion) return;
        if (UserMessageComponent[PATCHED] && patchVersion && patchVersion !== currentVersion) {
          console.warn(`[archimedes] Re-patching user message: pi version changed ${patchVersion} → ${currentVersion}`);
        }

        if (
          typeof UserMessageComponent.prototype.addChild !== "function" ||
          typeof UserMessageComponent.prototype.render !== "function"
        ) {
          console.warn("[splashscreen] UserMessageComponent shape changed — skipping patch");
          return;
        }

        UserMessageComponent[PATCHED] = true;
        UserMessageComponent[PATCH_VERSION] = currentVersion;

        const origAddChild = UserMessageComponent.prototype.addChild;
        UserMessageComponent.prototype.addChild = function (child: any) {
          if (child.paddingX !== undefined && !child._hephaestusPatched) {
            child.paddingX = MSG_PADDING_X;
            child._hephaestusPatched = true;
          }
          if (!instanceIndex.has(this)) {
            instanceIndex.set(this, instanceCount++);
          }
          return origAddChild.call(this, child);
        };

        const origRender = UserMessageComponent.prototype.render;
        UserMessageComponent.prototype.render = function (
          width: number,
        ): string[] {
          try {
            const currentTheme = getTheme();
            const p = resolvePalette(currentTheme);
            const bg = p.panelBg;
            if (bg !== lastBg) { setThemeBg(currentTheme, "userMessageBg", bg); lastBg = bg; }

            const idx = instanceIndex.get(this);
            const elapsed = idx !== undefined ? (responseTimes[idx] ?? 0) : 0;
            const hasTime = idx !== undefined;

            const contentWidth = width - TIME_COL;
            const lines: string[] = origRender.call(this, contentWidth);
            if (lines.length < 3) return lines;

            const timeStr = elapsed > 0 ? formatTime(elapsed) : "";
            const timeRight = 2;
            const timeLabel = timeStr.length > 0 ? p.time(timeStr) : "";
            // Column that shows "42ms" right-aligned with bg — spaces for visual
            // alignment remain, but they're wrapped in panelBg so the copy buffer
            // only contains the label text.
            const timeContent =
              p.panelBg +
              " ".repeat(Math.max(0, TIME_COL - timeStr.length - timeRight)) +
              timeLabel +
              " ".repeat(timeRight);
            // Use \x1b[K (erase-to-end-of-line) instead of literal spaces for the
            // gap between content and time column. Visually fills with panelBg but
            // leaves nothing in the copy buffer.
            const gapFill = p.panelBg + "\x1b[K";
            // Empty column: just bg fill to the end — no spaces in copy buffer
            const emptyTimeCol = p.panelBg + "\x1b[K";

            const firstContent = 0;

            for (let i = 0; i < lines.length; i++) {
              let line = lines[i]!;

              // Extract any OSC133 B/C markers (shell zone end/final). v0.67 placed
              // these at the head of the last line; older versions at the tail.
              // Strip them from the content line; re-emit after the time column.
              const oscMatches = line.match(OSC133_RE);
              const oscSuffix = oscMatches ? oscMatches.join("") : "";
              if (oscSuffix) line = line.replace(OSC133_RE, "");

              // Strip trailing spaces from the content portion (PI pads to contentWidth
              // with plain spaces) and replace with \x1b[K for visual fill without spaces
              // in the copy buffer.
              const strippedLine = line.replace(/((?:\x1b\[[\d;]*m)*)\s+$/, "$1");
              const col = i === firstContent && hasTime ? timeContent : emptyTimeCol;
              lines[i] = strippedLine + gapFill + col + oscSuffix;
            }

            return lines;
          } catch {
            // During /resume, getTheme() may throw — fall back to default render
            return origRender.call(this, width);
          }
        };
      },
    );
  } catch {
    /* skip if theme not ready */
  }
}
