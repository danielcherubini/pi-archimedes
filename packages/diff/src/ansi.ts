/** ANSI constants and text manipulation utilities. */

import { relative } from "node:path";

// ---------------------------------------------------------------------------
// ANSI escape codes
// ---------------------------------------------------------------------------

export let RST = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";

// Diff foregrounds
export const FG_ADD = "\x1b[38;2;100;180;120m"; // desaturated green
export const FG_DEL = "\x1b[38;2;200;100;100m"; // desaturated red
export const FG_DIM = "\x1b[38;2;80;80;80m";
export const FG_LNUM = "\x1b[38;2;100;100;100m";
export const FG_RULE = "\x1b[38;2;50;50;50m";
export const FG_SAFE_MUTED = "\x1b[38;2;139;148;158m";
export const FG_STRIPE = "\x1b[38;2;40;40;40m"; // gray diagonal stripes

// Diff backgrounds — muted tones to let syntax fg shine through
export let BG_ADD = "\x1b[48;2;22;38;32m"; // muted teal-green
export let BG_DEL = "\x1b[48;2;45;25;25m"; // muted brown-red
export let BG_ADD_W = "\x1b[48;2;35;75;50m"; // word-level emphasis
export let BG_DEL_W = "\x1b[48;2;80;35;35m";
export let BG_GUTTER_ADD = "\x1b[48;2;18;32;26m";
export let BG_GUTTER_DEL = "\x1b[48;2;38;22;22m";
export const BG_GUTTER_CTX = ""; // use terminal default bg for context gutters
export let BG_EMPTY = "\x1b[48;2;18;18;18m"; // filler rows

export const BORDER_BAR = "▌";

export let DIVIDER = `${FG_RULE}│${RST}`;
const ESC_RE = "\u001b";
export const ANSI_RE = new RegExp(`${ESC_RE}\\[[0-9;]*m`, "g");
const ANSI_CAPTURE_RE = new RegExp(`${ESC_RE}\\[([^m]*)m`, "g");
const ANSI_PARAM_CAPTURE_RE = new RegExp(`${ESC_RE}\\[([0-9;]*)m`, "g");
const BG_DEFAULT = "\x1b[49m"; // reset to terminal default background
export let BG_BASE = BG_DEFAULT; // tool box base bg — updated from theme's toolSuccessBg

// ---------------------------------------------------------------------------
// ANSI manipulation
// ---------------------------------------------------------------------------

const stripSgr = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

/** Strip all ANSI escape codes from a string. */
export const strip = stripSgr;

/** Replace tabs with 2 spaces. */
export function tabs(s: string): string {
	return s.replace(/\t/g, "  ");
}

/** Pad/truncate `s` to exactly `w` visible chars. ANSI-aware. */
export function fit(s: string, w: number): string {
	if (w <= 0) return "";
	const plain = strip(s);
	if (plain.length <= w) return s + " ".repeat(w - plain.length);
	const showW = w > 2 ? w - 1 : w;
	let vis = 0,
		i = 0;
	while (i < s.length && vis < showW) {
		if (s[i] === "\x1b") {
			const e = s.indexOf("m", i);
			if (e !== -1) {
				i = e + 1;
				continue;
			}
		}
		vis++;
		i++;
	}
	return w > 2 ? `${s.slice(0, i)}${RST}${FG_DIM}›${RST}` : `${s.slice(0, i)}${RST}`;
}

/** Extract last active fg + bg ANSI codes from a string. Used for wrapping continuations. */
export function ansiState(s: string): string {
	let fg = "",
		bg = "";
	for (const match of s.matchAll(ANSI_CAPTURE_RE)) {
		const p = match[1] ?? "";
		const seq = match[0] ?? "";
		if (p === "0") {
			fg = "";
			bg = "";
		} else if (p === "39") {
			fg = "";
		} else if (p.startsWith("38;")) {
			fg = seq;
		} else if (p.startsWith("48;")) {
			bg = seq;
		}
	}
	return bg + fg;
}

/** Check if a Shiki fg code is too dark to read. */
export function isLowContrastShikiFg(params: string): boolean {
	if (params === "30" || params === "90") return true;
	if (params === "38;5;0" || params === "38;5;8") return true;
	if (!params.startsWith("38;2;")) return false;
	const parts = params.split(";").map(Number);
	if (parts.length !== 5 || parts.some((n) => !Number.isFinite(n))) return false;
	const [, , r, g, b] = parts;
	const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	return luminance < 72;
}

/** Normalize Shiki ANSI output to boost low-contrast fg codes. */
export function normalizeShikiContrast(ansi: string): string {
	return ansi.replace(ANSI_PARAM_CAPTURE_RE, (seq, params: string) =>
		isLowContrastShikiFg(params) ? FG_SAFE_MUTED : seq,
	);
}

/** Generate a dense diagonal stripe fill for empty filler cells. */
export function stripes(w: number, _rowOffset: number): string {
	return BG_BASE + FG_STRIPE + "╱".repeat(w) + RST;
}

/** Format a line number, right-padded to width `w`. */
export function lnum(n: number | null, w: number, fg = FG_LNUM): string {
	if (n === null) return " ".repeat(w);
	const v = String(n);
	return `${fg}${" ".repeat(Math.max(0, w - v.length))}${v}${RST}`;
}

/** Horizontal rule line. */
export function rule(w: number): string {
	return `${BG_BASE}${FG_RULE}${"─".repeat(w)}${RST}`;
}

/** Shorten a file path relative to cwd or home. */
export function shortPath(cwd: string, home: string, p: string): string {
	if (!p) return "";
	const r = relative(cwd, p);
	if (!r.startsWith("..") && !r.startsWith("/")) return r;
	return p.replace(home, "~");
}

/** Summarize added/removed counts as colored `+N -M` string. */
export function summarize(a: number, d: number): string {
	const p: string[] = [];
	if (a > 0) p.push(`${FG_ADD}+${a}${RST}`);
	if (d > 0) p.push(`${FG_DEL}-${d}${RST}`);
	return p.length ? p.join(" ") : `${FG_DIM}no changes${RST}`;
}

// ---------------------------------------------------------------------------
// Diff color system — auto-derive from theme, hardcoded fallback
// ---------------------------------------------------------------------------

/** Parse 24-bit ANSI color code → RGB. Works for both fg and bg escapes. */
function parseAnsiRgb(ansi: string): { r: number; g: number; b: number } | null {
	const esc = "\u001b";
	const m = ansi.match(new RegExp(`${esc}\\[(?:38|48);2;(\\d+);(\\d+);(\\d+)m`));
	return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
}

/** Mix an accent color into a base color at the given intensity (0.0–1.0). */
function mixBg(
	base: { r: number; g: number; b: number },
	accent: { r: number; g: number; b: number },
	intensity: number,
): string {
	const r = Math.round(base.r + (accent.r - base.r) * intensity);
	const g = Math.round(base.g + (accent.g - base.g) * intensity);
	const b = Math.round(base.b + (accent.b - base.b) * intensity);
	return `\x1b[48;2;${r};${g};${b}m`;
}

/** Auto-derive all diff background colors from the pi theme's fg diff colors. */
export function autoDeriveBgFromTheme(theme: any): void {
	if (!theme?.getFgAnsi) return;
	try {
		const fgAdd = theme.getFgAnsi("toolDiffAdded");
		const fgDel = theme.getFgAnsi("toolDiffRemoved");
		const addRgb = parseAnsiRgb(fgAdd);
		const delRgb = parseAnsiRgb(fgDel);
		if (!addRgb || !delRgb) return;

		let addBase = { r: 0, g: 0, b: 0 };
		let delBase = addBase;
		if (theme.getBgAnsi) {
			try {
				const successBgAnsi = theme.getBgAnsi("toolSuccessBg");
				const successParsed = parseAnsiRgb(successBgAnsi);
				if (successParsed) {
					addBase = successParsed;
					delBase = successParsed;
					BG_BASE = successBgAnsi;
				}
			} catch { /* no toolSuccessBg */ }

			try {
				const errorParsed = parseAnsiRgb(theme.getBgAnsi("toolErrorBg"));
				if (errorParsed) delBase = errorParsed;
			} catch { /* no toolErrorBg */ }
		}

		BG_ADD = mixBg(addBase, addRgb, 0.08);
		BG_DEL = mixBg(delBase, delRgb, 0.1);
		BG_ADD_W = mixBg(addBase, addRgb, 0.2);
		BG_DEL_W = mixBg(delBase, delRgb, 0.22);
		BG_GUTTER_ADD = mixBg(addBase, addRgb, 0.05);
		BG_GUTTER_DEL = mixBg(delBase, delRgb, 0.06);
		BG_EMPTY = BG_BASE;
		RST = `\x1b[0m${BG_BASE}`;
		DIVIDER = `${FG_RULE}│${RST}`;
	} catch {
		// Fall back to defaults silently
	}
}

// ---------------------------------------------------------------------------
// Theme-aware diff colors
// ---------------------------------------------------------------------------

export interface DiffColors {
	fgAdd: string;
	fgDel: string;
	fgCtx: string;
}

export const DEFAULT_DIFF_COLORS: DiffColors = { fgAdd: FG_ADD, fgDel: FG_DEL, fgCtx: FG_DIM };

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

let _didAutoDerive = false;
export function resolveDiffColors(theme?: any): DiffColors {
	if (!_didAutoDerive && theme?.getFgAnsi) {
		autoDeriveBgFromTheme(theme);
		_didAutoDerive = true;
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
