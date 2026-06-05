import type { Theme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { resolvePalette, setThemeBg } from "../chrome.js";

type UserMsgCtor = typeof UserMessageComponent & { [PATCHED]?: boolean; [PATCH_VERSION]?: string };

// ── Constants ──────────────────────────────────────────────

const PATCHED = Symbol.for("splashscreen:userMsgPatched");
const PATCH_VERSION = Symbol.for("splashscreen:userMsgPatchVersion");
// Match OSC133 B (zone end) or C (zone final). v0.67 moved these from line
// tail to line head — we strip from wherever they sit and re-emit at the end.
const OSC133_RE = /\x1b\]133;[BC]\x07/g;
const MSG_PADDING_X = 3;
const TIME_COL = 9;
const TIME_RIGHT_PAD = 2;
const EOL_FILL = "\x1b[K"; // erase-to-end-of-line

// ── Instance tracking ──────────────────────────────────────

const instanceIndex = new WeakMap<object, number>();
let instanceCount = 0;

export function resetInstanceCount(): void {
  instanceCount = 0;
}

// ── Helpers ────────────────────────────────────────────────

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

/**
 * Ensure the theme has a userMessageBg key set to the current panelBg.
 * Returns true if the bg was updated (first call or theme changed).
 */
function ensureUserMessageBg(theme: Theme, lastBgRef: { value: string }): void {
  const p = resolvePalette(theme);
  if (p.panelBg !== lastBgRef.value) {
    setThemeBg(theme, "userMessageBg", p.panelBg);
    lastBgRef.value = p.panelBg;
  }
}

/**
 * Build the time column string for the first line of a user message.
 * Shows the response time right-aligned within TIME_COL width.
 * All output is wrapped in panelBg so the copy buffer only contains the label.
 */
function buildTimeColumn(timeStr: string, panelBg: string, timeFn: (s: string) => string): string {
  const timeLabel = timeStr ? timeFn(timeStr) : "";
  const leftPad = Math.max(0, TIME_COL - timeStr.length - TIME_RIGHT_PAD);
  return panelBg + " ".repeat(leftPad) + timeLabel + " ".repeat(TIME_RIGHT_PAD);
}

/**
 * Build the empty time column filler (just bg + EOL erase).
 */
function buildEmptyColumn(panelBg: string): string {
  return panelBg + EOL_FILL;
}

/**
 * Build the gap filler between content and time column.
 */
function buildGapFill(panelBg: string): string {
  return panelBg + EOL_FILL;
}

/**
 * Strip trailing spaces from a line (keeping ANSI codes), so the copy
 * buffer doesn't contain trailing whitespace. The gap fill + time column
 * will visually fill the rest of the line.
 */
function stripTrailingSpaces(line: string): string {
  return line.replace(/((?:\x1b\[[\d;]*m)*)\s+$/, "$1");
}

/**
 * Extract OSC133 B/C markers from a line and return them as a suffix string.
 * Returns { line: string, oscSuffix: string }.
 */
function extractOsc133(line: string): { line: string; oscSuffix: string } {
  const matches = line.match(OSC133_RE);
  const oscSuffix = matches ? matches.join("") : "";
  return oscSuffix
    ? { line: line.replace(OSC133_RE, ""), oscSuffix }
    : { line, oscSuffix };
}

// ── Patch ──────────────────────────────────────────────────

export function patchUserMessage(
  getTheme: () => Theme,
  responseTimes: number[],
): void {
  try {
    const lastBgRef = { value: "" };
    const theme = getTheme();
    ensureUserMessageBg(theme, lastBgRef);

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
            ensureUserMessageBg(currentTheme, lastBgRef);
            const p = resolvePalette(currentTheme);

            const idx = instanceIndex.get(this);
            const elapsed = idx !== undefined ? (responseTimes[idx] ?? 0) : 0;
            const hasTime = idx !== undefined;

            const contentWidth = width - TIME_COL;
            const lines: string[] = origRender.call(this, contentWidth);
            if (lines.length < 3) return lines;

            const timeStr = elapsed > 0 ? formatTime(elapsed) : "";
            const timeContent = timeStr
              ? buildTimeColumn(timeStr, p.panelBg, p.time)
              : buildEmptyColumn(p.panelBg);
            const gapFill = buildGapFill(p.panelBg);
            const emptyCol = buildEmptyColumn(p.panelBg);

            for (let i = 0; i < lines.length; i++) {
              let line = lines[i]!;

              const { line: cleanLine, oscSuffix } = extractOsc133(line);
              const stripped = stripTrailingSpaces(cleanLine);
              const col = i === 0 && hasTime ? timeContent : emptyCol;
              lines[i] = stripped + gapFill + col + oscSuffix;
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
