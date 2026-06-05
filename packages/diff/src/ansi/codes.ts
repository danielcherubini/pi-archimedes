/** ANSI escape codes, constants, and interfaces. */

// ---------------------------------------------------------------------------
// ANSI escape codes
// ---------------------------------------------------------------------------

export const RST = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";

// Diff foregrounds — hardcoded fallbacks
export const FG_ADD = "\x1b[38;2;100;180;120m"; // desaturated green
export const FG_DEL = "\x1b[38;2;200;100;100m"; // desaturated red
export const FG_DIM = "\x1b[38;2;80;80;80m";
export const FG_LNUM = "\x1b[38;2;100;100;100m";
export const FG_RULE = "\x1b[38;2;50;50;50m";
export const FG_SAFE_MUTED = "\x1b[38;2;139;148;158m";
export const FG_STRIPE = "\x1b[38;2;40;40;40m"; // gray diagonal stripes

export const BORDER_BAR = "▌";
const BG_DEFAULT = "\x1b[49m"; // reset to terminal default background

// ---------------------------------------------------------------------------
// DiffBg — instance-scoped background colors derived from a theme
// ---------------------------------------------------------------------------

/** All background colors needed for diff rendering, derived from a theme. */
export interface DiffBg {
	bgAdd: string;
	bgDel: string;
	bgAddW: string; // word-level emphasis
	bgDelW: string;
	bgGutterAdd: string;
	bgGutterDel: string;
	bgEmpty: string;
	bgBase: string; // tool box base bg
	rst: string; // reset + base bg
	divider: string;
}

/** Hardcoded fallback backgrounds. */
export const DEFAULT_DIFF_BG: DiffBg = {
	bgAdd: "\x1b[48;2;22;38;32m",
	bgDel: "\x1b[48;2;45;25;25m",
	bgAddW: "\x1b[48;2;35;75;50m",
	bgDelW: "\x1b[48;2;80;35;35m",
	bgGutterAdd: "\x1b[48;2;18;32;26m",
	bgGutterDel: "\x1b[48;2;38;22;22m",
	bgEmpty: "\x1b[48;2;18;18;18m",
	bgBase: BG_DEFAULT,
	rst: "\x1b[0m",
	divider: `${FG_RULE}│\x1b[0m`,
};

// Legacy aliases — used by word-diff.ts during transition. Will be removed.
// These MUST be mutable and live in the same module as the functions that mutate them.
export let BG_ADD = DEFAULT_DIFF_BG.bgAdd;
export let BG_DEL = DEFAULT_DIFF_BG.bgDel;
export let BG_ADD_W = DEFAULT_DIFF_BG.bgAddW;
export let BG_DEL_W = DEFAULT_DIFF_BG.bgDelW;
export let BG_GUTTER_ADD = DEFAULT_DIFF_BG.bgGutterAdd;
export let BG_GUTTER_DEL = DEFAULT_DIFF_BG.bgGutterDel;
export let BG_EMPTY = DEFAULT_DIFF_BG.bgEmpty;
export let BG_BASE = DEFAULT_DIFF_BG.bgBase;
export let DIVIDER = DEFAULT_DIFF_BG.divider;

// Theme cache key state — lives here since it's used by resolveDiffColors.
let _lastThemeKey: string | undefined;

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

const ESC_RE = "\u001b";
export const ANSI_RE = new RegExp(`${ESC_RE}\\[[0-9;]*m`, "g");
export const ANSI_CAPTURE_RE = new RegExp(`${ESC_RE}\\[([^m]*)m`, "g");
export const ANSI_PARAM_CAPTURE_RE = new RegExp(`${ESC_RE}\\[([0-9;]*)m`, "g");

// ---------------------------------------------------------------------------
// DiffColors — foreground colors for diff signs
// ---------------------------------------------------------------------------

export interface DiffColors {
	fgAdd: string;
	fgDel: string;
	fgCtx: string;
}

export const DEFAULT_DIFF_COLORS: DiffColors = { fgAdd: FG_ADD, fgDel: FG_DEL, fgCtx: FG_DIM };

// ---------------------------------------------------------------------------
// Theme-aware color resolution (mutates legacy aliases)
// ---------------------------------------------------------------------------

/** Reset auto-derived colors — call when theme changes. */
export function resetDiffColors(): void {
	_lastThemeKey = undefined;
	BG_ADD = DEFAULT_DIFF_BG.bgAdd;
	BG_DEL = DEFAULT_DIFF_BG.bgDel;
	BG_ADD_W = DEFAULT_DIFF_BG.bgAddW;
	BG_DEL_W = DEFAULT_DIFF_BG.bgDelW;
	BG_GUTTER_ADD = DEFAULT_DIFF_BG.bgGutterAdd;
	BG_GUTTER_DEL = DEFAULT_DIFF_BG.bgGutterDel;
	BG_EMPTY = DEFAULT_DIFF_BG.bgEmpty;
	BG_BASE = DEFAULT_DIFF_BG.bgBase;
	DIVIDER = DEFAULT_DIFF_BG.divider;
}

export function themeCacheKey(theme?: any): string {
	if (!theme?.fg) return "no-theme";
	const fgKeys = [
		"toolTitle", "accent", "muted", "success", "error",
		"toolDiffAdded", "toolDiffRemoved", "toolDiffContext",
	];
	const bgKeys = ["toolSuccessBg", "toolErrorBg"];
	const parts: string[] = [];
	for (const key of fgKeys) {
		try { parts.push(theme.fg(key, key)); } catch { parts.push(key); }
	}
	for (const key of bgKeys) {
		try { parts.push(theme.bg ? theme.bg(key, key) : key); } catch { parts.push(key); }
	}
	return parts.join("|");
}

import { deriveBgFromTheme } from "./colors.js";
export { deriveBgFromTheme };

export function resolveDiffColors(theme?: any): DiffColors {
	const themeKey = themeCacheKey(theme);

	// Re-derive when theme changes (different key) or first call
	if (themeKey !== _lastThemeKey && theme?.getFgAnsi) {
		const dbg = deriveBgFromTheme(theme);
		BG_ADD = dbg.bgAdd;
		BG_DEL = dbg.bgDel;
		BG_ADD_W = dbg.bgAddW;
		BG_DEL_W = dbg.bgDelW;
		BG_GUTTER_ADD = dbg.bgGutterAdd;
		BG_GUTTER_DEL = dbg.bgGutterDel;
		BG_EMPTY = dbg.bgEmpty;
		BG_BASE = dbg.bgBase;
		DIVIDER = dbg.divider;
		_lastThemeKey = themeKey;
	}
	if (!theme?.getFgAnsi) return DEFAULT_DIFF_COLORS;
	try {
		return {
			fgAdd: theme.getFgAnsi("toolDiffAdded") || FG_ADD,
			fgDel: theme.getFgAnsi("toolDiffRemoved") || FG_DEL,
			fgCtx: theme.getFgAnsi("toolDiffContext") || FG_DIM,
		};
	} catch {
		return DEFAULT_DIFF_COLORS;
	}
}
