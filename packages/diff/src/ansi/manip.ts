/** ANSI string manipulation utilities. */

import { relative } from "node:path";
import * as C from "./codes.js";
import { tokenize } from "./width.js";

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

/** Pad/truncate `s` to exactly `w` visible columns. ANSI + grapheme-aware. */
export function fit(s: string, w: number): string {
	if (w <= 0) return "";
	const tokens = tokenize(s);
	const total = tokens.reduce((sum, t) => sum + t.width, 0);
	if (total <= w) return s + " ".repeat(w - total);
	const showW = w > 2 ? w - 1 : w;
	let vis = 0,
		out = "";
	for (const tok of tokens) {
		// A grapheme cluster is atomic — never split it mid-render. A cluster
		// wider than the entire budget (only possible when showW is 1 and the
		// grapheme is wide) is dropped rather than overflowing the target width.
		if (tok.width > showW) continue;
		if (vis + tok.width > showW) break;
		out += tok.ansi + tok.text;
		vis += tok.width;
	}
	return w > 2
		? `${out}${C.RST}${" ".repeat(Math.max(0, showW - vis))}${C.FG_DIM}›${C.RST}`
		: `${out}${C.RST}${" ".repeat(Math.max(0, w - vis))}`;
}

/** Extract last active fg + bg ANSI codes from a string. Used for wrapping continuations. */
export function ansiState(s: string): string {
	let fg = "",
		bg = "";
	for (const match of s.matchAll(C.ANSI_CAPTURE_RE)) {
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
	const [, , r, g, b] = parts as [number, number, number, number, number];
	const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	return luminance < 72;
}

/** Normalize Shiki ANSI output to boost low-contrast fg codes. */
export function normalizeShikiContrast(ansi: string): string {
	return ansi.replace(C.ANSI_PARAM_CAPTURE_RE, (seq, params: string) =>
		isLowContrastShikiFg(params) ? C.FG_SAFE_MUTED : seq,
	);
}

/** Generate a dense diagonal stripe fill for empty filler cells. */
export function stripes(dbg: C.DiffBg, w: number, _rowOffset: number): string {
	return dbg.bgBase + C.FG_STRIPE + "╱".repeat(w) + dbg.rst;
}

/** Format a line number, right-padded to width `w`. */
export function lnum(n: number | null, w: number, fg = C.FG_LNUM): string {
	if (n === null) return " ".repeat(w);
	const v = String(n);
	return `${fg}${" ".repeat(Math.max(0, w - v.length))}${v}${C.RST}`;
}

/** Horizontal rule line. */
export function rule(dbg: C.DiffBg, w: number): string {
	return `${dbg.bgBase}${C.FG_RULE}${"─".repeat(w)}${dbg.rst}`;
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
	if (a > 0) p.push(`${C.FG_ADD}+${a}${C.FG_RST}`);
	if (d > 0) p.push(`${C.FG_DEL}-${d}${C.FG_RST}`);
	return p.length ? p.join(" ") : `${C.FG_DIM}no changes${C.FG_RST}`;
}
