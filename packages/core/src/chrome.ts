import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

// ── ANSI constants ───────────────────────────────────────────────────────────

export const RESET = "\x1b[0m";

// ── Editor chrome ────────────────────────────────────────────────────────────

export const PI_STR = "> ";
export const PI_WIDTH = PI_STR.length;
export const PI_SYMBOL_COL = 2;

export const AUTOCOMPLETE_CURSOR = "›";
export const HINT_MARGIN_RIGHT = 3;
export const PAD_X = 1;

// ── Fallback ANSI codes (neutral near-black) ─────────────────────────────────

const FALLBACK_PANEL_BG = "\x1b[48;2;16;16;16m";
const FALLBACK_PANEL_EDGE = "\x1b[38;2;16;16;16m";
const FALLBACK_FG = "\x1b[38;2;74;74;74m"; // #4a4a4a structural gray

// ── Palette ──────────────────────────────────────────────────────────────────

export type ThemeBg = "selectedBg" | "userMessageBg" | "customMessageBg" | "toolPendingBg" | "toolSuccessBg" | "toolErrorBg";

export interface PanePalette {
  panelBg: string;
  panelEdge: string;
  frame(text: string): string;
  prefix(text: string): string;
  time(text: string): string;
  hint(text: string): string;
}

function tryGetBgAnsi(theme: Theme, key: ThemeBg): string | undefined {
  try {
    return (theme as any).getBgAnsi(key);
  } catch {
    return undefined;
  }
}

function tryFg(theme: Theme, key: ThemeColor, text: string): string | undefined {
  try {
    return theme.fg(key, text);
  } catch {
    return undefined;
  }
}

function safeThemeColor(theme: Theme, keys: ThemeColor[], text: string): string {
  for (const k of keys) {
    const res = tryFg(theme, k, text);
    if (res !== undefined) return res;
  }
  return fgWrap(FALLBACK_FG, text);
}

/** Convert a 48;2 or 48;5 bg ANSI code to its fg equivalent (38;…). */
function bgToFgAnsi(bg: string): string {
  if (bg.startsWith("\x1b[48;2;") || bg.startsWith("\x1b[48;5;")) {
    return bg.replace("\x1b[48;", "\x1b[38;");
  }
  return FALLBACK_PANEL_EDGE;
}

function fgWrap(ansi: string, text: string): string {
  return `${ansi}${text}${RESET}`;
}

export function resolvePalette(theme: Theme): PanePalette {
  const panelBg =
    tryGetBgAnsi(theme, "userMessageBg") ??
    tryGetBgAnsi(theme, "customMessageBg") ??
    FALLBACK_PANEL_BG;

  return {
    panelBg,
    panelEdge: bgToFgAnsi(panelBg),
    frame: (t) => safeThemeColor(theme, ["borderMuted", "border"], t),
    prefix: (t) => safeThemeColor(theme, ["borderMuted", "border"], t),
    time: (t) => safeThemeColor(theme, ["muted", "accent"], t),
    hint: (t) => safeThemeColor(theme, ["dim", "muted"], t),
  };
}

/** Set a bg color on the theme's internal bgColors map. */
export function setThemeBg(theme: Theme, key: ThemeBg, ansi: string): void {
  (theme as any)?.bgColors?.set(key, ansi);
}
