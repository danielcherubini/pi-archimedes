/** Split diff view rendering. */

import type { BundledLanguage } from "shiki";
import * as Ansi from "../ansi/index.js";
import type { DiffBg, DiffColors } from "../ansi/index.js";
import { DEFAULT_DIFF_COLORS, DEFAULT_DIFF_BG } from "../ansi/index.js";
import { hlBlock } from "../shiki.js";
import { wordDiffAnalysis, injectBg, plainWordDiff } from "../word-diff.js";
import type { DiffLine, ParsedDiff } from "../core/diff.js";
import {
	MAX_HL_CHARS,
	MAX_PREVIEW_LINES,
	MAX_RENDER_LINES,
	WORD_DIFF_MIN_SIM,
	DEFAULT_TERM_WIDTH,
	adaptiveWrapRows,
	wrapAnsi,
	shouldUseSplit,
} from "./shared.js";
import { renderUnifiedLines } from "./unified.js";

// ---------------------------------------------------------------------------
// Split view
// ---------------------------------------------------------------------------

/**
 * Backward-compatible wrapper — reads width from stdout, returns joined string.
 * Prefer `renderSplitLines` for Component-based rendering.
 */
export async function renderSplit(
	diff: ParsedDiff,
	language: BundledLanguage | undefined,
	max = MAX_PREVIEW_LINES,
	dc: DiffColors = DEFAULT_DIFF_COLORS,
): Promise<string> {
	const width = process.stdout.columns ?? DEFAULT_TERM_WIDTH;
	const lines = await renderSplitLines(diff, language, width, max, dc, DEFAULT_DIFF_BG);
	return lines.join("\n");
}

export async function renderSplitLines(
	diff: ParsedDiff,
	language: BundledLanguage | undefined,
	width: number,
	max = MAX_PREVIEW_LINES,
	dc: DiffColors = DEFAULT_DIFF_COLORS,
	dbg: DiffBg = DEFAULT_DIFF_BG,
): Promise<string[]> {
	const rst = dbg.rst;
	const bgBase = dbg.bgBase;

	if (!shouldUseSplit(diff, width, max)) return renderUnifiedLines(diff, language, width, max, dc, dbg);
	if (!diff.lines.length) return [];

	type Row = { left: DiffLine | null; right: DiffLine | null };
	const rows: Row[] = [];
	let i = 0;
	while (i < diff.lines.length) {
		const l = diff.lines[i]!;
		if (l.type === "sep" || l.type === "ctx") { rows.push({ left: l, right: l }); i++; continue; }
		const dels: DiffLine[] = [], adds: DiffLine[] = [];
		while (i < diff.lines.length && diff.lines[i]!.type === "del") { dels.push(diff.lines[i]!); i++; }
		while (i < diff.lines.length && diff.lines[i]!.type === "add") { adds.push(diff.lines[i]!); i++; }
		const n = Math.max(dels.length, adds.length);
		for (let j = 0; j < n; j++) rows.push({ left: dels[j] ?? null, right: adds[j] ?? null });
	}

	const vis = rows.slice(0, max);
	const half = Math.floor((width - 1) / 2);
	const nw = Math.max(2, String(Math.max(...diff.lines.map((l) => l.oldNum ?? l.newNum ?? 0), 0)).length);
	const gw = nw + 5;
	// Never let the content column exceed what's actually available — on very
	// narrow terminals the gutter alone can approach `half`.
	const cw = Math.max(1, half - gw);
	const canHL = diff.chars <= MAX_HL_CHARS && vis.length * 2 <= MAX_RENDER_LINES * 2;

	const leftSrc: string[] = [], rightSrc: string[] = [];
	for (const r of vis) {
		if (r.left && r.left.type !== "sep") leftSrc.push(r.left.content);
		if (r.right && r.right.type !== "sep") rightSrc.push(r.right.content);
	}
	const [leftHL, rightHL] = canHL
		? await Promise.all([hlBlock(leftSrc.join("\n"), language), hlBlock(rightSrc.join("\n"), language)])
		: [leftSrc, rightSrc];

	let lI = 0, rI = 0;
	let stripeRow = 0;

	type HalfResult = { gutter: string; contGutter: string; bodyRows: string[] };

	function half_build(
		line: DiffLine | null, hl: string, ranges: Array<[number, number]> | null, side: "left" | "right",
	): HalfResult {
		if (!line) {
			const gw2 = nw + 2;
			const gPat = Ansi.FG_STRIPE + "╱".repeat(gw2) + rst;
			const g = ` ${gPat}${Ansi.FG_RULE}│${rst} `;
			return { gutter: g, contGutter: g, bodyRows: [Ansi.stripes(dbg, cw, stripeRow)] };
		}
		if (line.type === "sep") {
			const gap = line.newNum;
			const label = gap && gap > 0 ? `··· ${gap} lines ···` : "···";
			const g = `${bgBase} ${Ansi.FG_DIM}${Ansi.fit("", nw + 2)}${rst}${Ansi.FG_RULE}│${rst} `;
			return { gutter: g, contGutter: g, bodyRows: [`${bgBase}${Ansi.FG_DIM}${Ansi.fit(label, cw)}${rst}`] };
		}

		const isDel = line.type === "del", isAdd = line.type === "add";
		const gBg = isDel ? dbg.bgGutterDel : isAdd ? dbg.bgGutterAdd : bgBase;
		const cBg = isDel ? dbg.bgDel : isAdd ? dbg.bgAdd : bgBase;
		const sFg = isDel ? dc.fgDel : isAdd ? dc.fgAdd : dc.fgCtx;
		const sign = isDel ? "-" : isAdd ? "+" : " ";
		const num = isDel ? line.oldNum : isAdd ? line.newNum : side === "left" ? line.oldNum : line.newNum;

		const borderFg = isDel ? dc.fgDel : isAdd ? dc.fgAdd : "";
		const border = borderFg ? `${borderFg}${Ansi.BORDER_BAR}${rst}` : ` ${bgBase}`;
		const numFg = borderFg || Ansi.FG_LNUM;

		let body: string;
		if (ranges && ranges.length > 0) {
			body = injectBg(hl, ranges, cBg, isDel ? dbg.bgDelW : dbg.bgAddW);
		} else if (isDel || isAdd) {
			body = `${cBg}${hl}`;
		} else {
			body = `${bgBase}${Ansi.DIM}${hl}`;
		}

		const gutter = `${border}${gBg}${Ansi.lnum(num, nw, numFg)}${sFg}${Ansi.BOLD}${sign}${rst} ${Ansi.FG_RULE}│${rst} `;
		const contGutter = `${border}${gBg}${" ".repeat(nw + 1)}${rst} ${Ansi.FG_RULE}│${rst} `;
		const bodyRows = wrapAnsi(Ansi.tabs(body), cw, adaptiveWrapRows(cw), cBg, rst);
		return { gutter, contGutter, bodyRows };
	}

	const out: string[] = [];
	const hdrOld = `${bgBase}${" ".repeat(Math.max(0, nw - 2))}${dc.fgDel}${Ansi.DIM}old${rst}`;
	const hdrNew = `${bgBase}${" ".repeat(Math.max(0, nw - 2))}${dc.fgAdd}${Ansi.DIM}new${rst}`;
	out.push(`${bgBase}${hdrOld}${" ".repeat(Math.max(0, half - nw - 1))}${Ansi.FG_RULE}┊${rst}${hdrNew}`);
	out.push(`${Ansi.rule(dbg, half)}${Ansi.FG_RULE}┊${rst}${Ansi.rule(dbg, half)}`);

	for (const r of vis) {
		const leftLine = r.left, rightLine = r.right;
		const paired = leftLine && rightLine && leftLine.type === "del" && rightLine.type === "add";
		const wd = paired ? wordDiffAnalysis(leftLine.content, rightLine.content) : null;

		let lResult: HalfResult, rResult: HalfResult;

		if (paired && wd && wd.similarity >= WORD_DIFF_MIN_SIM && canHL) {
			const lhl = leftHL[lI++] ?? leftLine.content;
			const rhl = rightHL[rI++] ?? rightLine.content;
			lResult = half_build(leftLine, lhl, wd.oldRanges, "left");
			rResult = half_build(rightLine, rhl, wd.newRanges, "right");
		} else if (paired && wd && wd.similarity >= WORD_DIFF_MIN_SIM && !canHL) {
			const pwd = plainWordDiff(leftLine.content, rightLine.content, dbg);
			lI++; rI++;
			lResult = half_build(leftLine, pwd.old, null, "left");
			rResult = half_build(rightLine, pwd.new, null, "right");
		} else {
			const lhl = leftLine && leftLine.type !== "sep" ? (leftHL[lI++] ?? leftLine?.content ?? "") : "";
			const rhl = rightLine && rightLine.type !== "sep" ? (rightHL[rI++] ?? rightLine?.content ?? "") : "";
			lResult = half_build(leftLine, lhl, null, "left");
			rResult = half_build(rightLine, rhl, null, "right");
		}

		const maxRows = Math.max(lResult.bodyRows.length, rResult.bodyRows.length);
		const leftIsEmpty = !r.left;
		const rightIsEmpty = !r.right;
		for (let row = 0; row < maxRows; row++) {
			const lg = row === 0 ? lResult.gutter : lResult.contGutter;
			const rg = row === 0 ? rResult.gutter : rResult.contGutter;
			const lb = lResult.bodyRows[row] ?? (leftIsEmpty ? Ansi.stripes(dbg, cw, stripeRow) : `${dbg.bgEmpty}${" ".repeat(cw)}${rst}`);
			const rb = rResult.bodyRows[row] ?? (rightIsEmpty ? Ansi.stripes(dbg, cw, stripeRow) : `${dbg.bgEmpty}${" ".repeat(cw)}${rst}`);
			out.push(`${lg}${lb}${dbg.divider}${rg}${rb}`);
			stripeRow++;
		}
	}

	out.push(`${Ansi.rule(dbg, half)}${Ansi.FG_RULE}┊${rst}${Ansi.rule(dbg, half)}`);
	if (rows.length > vis.length) {
		out.push(`${bgBase}${Ansi.FG_DIM}  … ${rows.length - vis.length} more lines${rst}`);
	}
	return out;
}
