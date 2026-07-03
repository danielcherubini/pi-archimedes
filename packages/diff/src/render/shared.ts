/** Shared constants, config, and helpers for diff rendering. */

import * as Ansi from "../ansi/index.js";
import { tokenize } from "../ansi/width.js";
import type { ParsedDiff } from "../core/diff.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_PREVIEW_LINES = 60;
export const MAX_RENDER_LINES = 150;
export const MAX_HL_CHARS = 80_000;
export const WORD_DIFF_MIN_SIM = 0.15;
const SPLIT_MAX_WRAP_RATIO = 0.2;
const SPLIT_MAX_WRAP_LINES = 8;
const MAX_WRAP_ROWS_WIDE = 3;
const MAX_WRAP_ROWS_MED = 2;
const MAX_WRAP_ROWS_NARROW = 1;
export const DEFAULT_TERM_WIDTH = 200;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function getConfig(): { diffSplitMinWidth: number; diffSplitMinCodeWidth: number } {
	return typeof _getConfig === "function" ? _getConfig() : DEFAULT_CONFIG;
}

const DEFAULT_CONFIG = { diffSplitMinWidth: 150, diffSplitMinCodeWidth: 60 };
let _getConfig: (() => { diffSplitMinWidth: number; diffSplitMinCodeWidth: number }) | undefined;
export function setConfigGetter(fn: () => { diffSplitMinWidth: number; diffSplitMinCodeWidth: number }): void {
	_getConfig = fn;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function adaptiveWrapRows(w: number): number {
	if (w >= 180) return MAX_WRAP_ROWS_WIDE;
	if (w >= 120) return MAX_WRAP_ROWS_MED;
	return MAX_WRAP_ROWS_NARROW;
}

/** Wrap ANSI-encoded string into rows of `w` visible columns. Grapheme + east-asian-width aware. */
export function wrapAnsi(s: string, w: number, maxRows = adaptiveWrapRows(w), fillBg = "", rst = Ansi.RST): string[] {
	if (w <= 0) return [""];
	const tokens = tokenize(s);
	const total = tokens.reduce((sum, t) => sum + t.width, 0);
	if (total <= w) {
		const pad = w - total;
		return pad > 0 ? [s + fillBg + " ".repeat(pad) + (fillBg ? rst : "")] : [s];
	}

	const rows: string[] = [];
	let row = "", vis = 0, ti = 0;
	let onLastRow = false;
	let effW = w;

	while (ti < tokens.length) {
		if (!onLastRow && rows.length >= maxRows - 1) {
			onLastRow = true;
			effW = w > 2 ? w - 1 : w;
		}
		const tok = tokens[ti]!;
		// A grapheme cluster is atomic — never split it mid-render. If it's wider
		// than the row even on its own (only possible when effW < its width,
		// e.g. a wide emoji in a 1-column row), drop it rather than overflow.
		if (tok.width > effW) {
			ti++;
			continue;
		}
		if (vis + tok.width > effW) {
			if (onLastRow) {
				const hasMore = ti < tokens.length;
				if (hasMore && w > 2) row += `${rst}${Ansi.FG_DIM}›${rst}`;
				else row += fillBg + " ".repeat(Math.max(0, w - vis)) + rst;
				rows.push(row);
				return rows;
			}
			const state = Ansi.ansiState(row);
			rows.push(row + fillBg + " ".repeat(Math.max(0, w - vis)) + rst);
			row = state + fillBg;
			vis = 0;
			if (rows.length >= maxRows - 1) {
				onLastRow = true;
				effW = w > 2 ? w - 1 : w;
			}
			continue;
		}
		row += tok.ansi + tok.text;
		vis += tok.width;
		ti++;
	}
	if (row.length > 0 || rows.length === 0) {
		rows.push(row + fillBg + " ".repeat(Math.max(0, w - vis)) + rst);
	}
	return rows;
}

export function shouldUseSplit(diff: ParsedDiff, tw: number, maxRows = MAX_PREVIEW_LINES): boolean {
	if (!diff.lines.length) return false;
	const cfg = getConfig();
	if (tw < cfg.diffSplitMinWidth) return false;

	const nw = Math.max(2, String(Math.max(...diff.lines.map((l) => l.oldNum ?? l.newNum ?? 0), 0)).length);
	const half = Math.floor((tw - 1) / 2);
	const gw = nw + 5;
	// Keep in sync with renderSplitLines' cw formula so this heuristic agrees
	// with what the renderer will actually use.
	const cw = Math.max(1, half - gw);
	if (cw < cfg.diffSplitMinCodeWidth) return false;

	const vis = diff.lines.slice(0, maxRows);
	let contentLines = 0, wrapCandidates = 0;
	for (const l of vis) {
		if (l.type === "sep") continue;
		contentLines++;
		if (Ansi.tabs(l.content).length > cw) wrapCandidates++;
	}
	if (contentLines === 0) return true;
	const wrapRatio = wrapCandidates / contentLines;
	if (wrapCandidates >= SPLIT_MAX_WRAP_LINES) return false;
	if (wrapRatio >= SPLIT_MAX_WRAP_RATIO) return false;
	return true;
}
