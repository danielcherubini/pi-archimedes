/** Word diff analysis and background injection. */

import * as Diff from "diff";
import * as Ansi from "./ansi/index.js";
import type { DiffBg } from "./ansi/index.js";

// ---------------------------------------------------------------------------
// Word diff analysis
// ---------------------------------------------------------------------------

/**
 * Combined word diff analysis — single Diff.diffWords() call returns both
 * similarity score and character ranges for emphasis highlighting.
 */
export function wordDiffAnalysis(
	a: string,
	b: string,
): {
	similarity: number;
	oldRanges: Array<[number, number]>;
	newRanges: Array<[number, number]>;
} {
	if (!a && !b) return { similarity: 1, oldRanges: [], newRanges: [] };
	const parts = Diff.diffWords(a, b);
	const oldRanges: Array<[number, number]> = [];
	const newRanges: Array<[number, number]> = [];
	let oPos = 0,
		nPos = 0,
		same = 0;
	for (const p of parts) {
		if (p.removed) {
			oldRanges.push([oPos, oPos + p.value.length]);
			oPos += p.value.length;
		} else if (p.added) {
			newRanges.push([nPos, nPos + p.value.length]);
			nPos += p.value.length;
		} else {
			const len = p.value.length;
			same += len;
			oPos += len;
			nPos += len;
		}
	}
	const maxLen = Math.max(a.length, b.length);
	return { similarity: maxLen > 0 ? same / maxLen : 1, oldRanges, newRanges };
}

// ---------------------------------------------------------------------------
// Background injection
// ---------------------------------------------------------------------------

/**
 * Inject diff background into Shiki ANSI output.
 * `baseBg` on unchanged spans, `hlBg` on changed character ranges.
 * Re-injects bg after any full reset (\x1b[0m).
 *
 * Handles unsorted and overlapping ranges by checking all ranges per position.
 */
export function injectBg(
	ansiLine: string,
	ranges: Array<[number, number]>,
	baseBg: string,
	hlBg: string,
): string {
	if (!ranges.length) return baseBg + ansiLine + Ansi.RST;

	// Sort ranges and merge overlaps for efficient lookup
	const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
	const merged: Array<[number, number]> = [];
	for (const [start, end] of sorted) {
		if (merged.length > 0 && start <= merged[merged.length - 1]![1]) {
			merged[merged.length - 1]![1] = Math.max(merged[merged.length - 1]![1], end);
		} else {
			merged.push([start, end]);
		}
	}

	let out = baseBg;
	let vis = 0;
	let inHL = false;
	let ri = 0;
	let i = 0;

	while (i < ansiLine.length) {
		if (ansiLine[i]! === "\x1b") {
			const m = ansiLine.indexOf("m", i);
			if (m !== -1) {
				const seq = ansiLine.slice(i, m + 1);
				out += seq;
				if (seq === "\x1b[0m") out += inHL ? hlBg : baseBg;
				i = m + 1;
				continue;
			}
		}
		// Advance range index past completed ranges
		while (ri < merged.length && vis >= merged[ri]![1]) ri++;
		// Check if current position falls within the next range
		const want = ri < merged.length && vis >= merged[ri]![0] && vis < merged[ri]![1];
		if (want !== inHL) {
			inHL = want;
			out += inHL ? hlBg : baseBg;
		}
		out += ansiLine[i]!;
		vis++;
		i++;
	}
	return out + Ansi.RST;
}

/** Simple word diff (no syntax hl) — fallback when Shiki isn't available. */
export function plainWordDiff(
	oldText: string,
	newText: string,
	dbg: DiffBg,
): { old: string; new: string } {
	const parts = Diff.diffWords(oldText, newText);
	let o = "",
		n = "";
	for (const p of parts) {
		if (p.removed) o += `${dbg.bgDelW}${p.value}${Ansi.RST}${dbg.bgDel}`;
		else if (p.added) n += `${dbg.bgAddW}${p.value}${Ansi.RST}${dbg.bgAdd}`;
		else {
			o += p.value;
			n += p.value;
		}
	}
	return { old: o, new: n };
}
