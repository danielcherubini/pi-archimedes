/** Shared constants, config, and helpers for diff rendering. */

import * as Ansi from "../ansi/index.js";
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

/** Wrap ANSI-encoded string into rows of `w` visible chars. */
export function wrapAnsi(s: string, w: number, maxRows = adaptiveWrapRows(w), fillBg = "", rst = Ansi.RST): string[] {
	if (w <= 0) return [""];
	const plain = Ansi.strip(s);
	if (plain.length <= w) {
		const pad = w - plain.length;
		return pad > 0 ? [s + fillBg + " ".repeat(pad) + (fillBg ? rst : "")] : [s];
	}

	const rows: string[] = [];
	let row = "", vis = 0, i = 0;
	let onLastRow = false;
	let effW = w;

	while (i < s.length) {
		if (!onLastRow && rows.length >= maxRows - 1) {
			onLastRow = true;
			effW = w > 2 ? w - 1 : w;
		}
		if (s[i] === "\x1b") {
			const end = s.indexOf("m", i);
			if (end !== -1) {
				row += s.slice(i, end + 1);
				i = end + 1;
				continue;
			}
		}
		if (vis >= effW) {
			if (onLastRow) {
				let hasMore = false;
				for (let j = i; j < s.length; j++) {
					if (s[j] === "\x1b") {
						const e2 = s.indexOf("m", j);
						if (e2 !== -1) { j = e2; continue; }
					}
					hasMore = true;
					break;
				}
				if (hasMore && w > 2) row += `${rst}${Ansi.FG_DIM}›${rst}`;
				else row += fillBg + " ".repeat(Math.max(0, w - vis)) + rst;
				rows.push(row);
				return rows;
			}
			const state = Ansi.ansiState(row);
			rows.push(row + rst);
			row = state + fillBg;
			vis = 0;
			if (rows.length >= maxRows - 1) {
				onLastRow = true;
				effW = w > 2 ? w - 1 : w;
			}
		}
		row += s[i];
		vis++;
		i++;
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
	const cw = Math.max(12, half - gw);
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
