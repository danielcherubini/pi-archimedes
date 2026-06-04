/** Split and unified diff rendering. */

import type { BundledLanguage } from "shiki";
import * as Ansi from "./ansi.js";
import type { DiffColors } from "./ansi.js";
import { DEFAULT_DIFF_COLORS } from "./ansi.js";
import { hlBlock } from "./shiki.js";
import { wordDiffAnalysis, injectBg, plainWordDiff } from "./word-diff.js";
import type { DiffLine, ParsedDiff } from "./core/diff.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PREVIEW_LINES = 60;
const MAX_RENDER_LINES = 150;
const MAX_HL_CHARS = 80_000;
const WORD_DIFF_MIN_SIM = 0.15;
const SPLIT_MAX_WRAP_RATIO = 0.2;
const SPLIT_MAX_WRAP_LINES = 8;
const MAX_WRAP_ROWS_WIDE = 3;
const MAX_WRAP_ROWS_MED = 2;
const MAX_WRAP_ROWS_NARROW = 1;
const MAX_TERM_WIDTH = 210;
const DEFAULT_TERM_WIDTH = 200;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getConfig(): { diffSplitMinWidth: number; diffSplitMinCodeWidth: number } {
	return typeof _getConfig === "function" ? _getConfig() : DEFAULT_CONFIG;
}

const DEFAULT_CONFIG = { diffSplitMinWidth: 150, diffSplitMinCodeWidth: 60 };
let _getConfig: (() => { diffSplitMinWidth: number; diffSplitMinCodeWidth: number }) | undefined;
export function setConfigGetter(fn: () => { diffSplitMinWidth: number; diffSplitMinCodeWidth: number }): void {
	_getConfig = fn;
}

function termW(): number {
	const raw =
		process.stdout.columns ||
		(process.stderr as any).columns ||
		Number.parseInt(process.env.COLUMNS ?? "", 10) ||
		DEFAULT_TERM_WIDTH;
	return Math.max(80, Math.min(raw - 4, MAX_TERM_WIDTH));
}

function adaptiveWrapRows(tw?: number): number {
	const w = tw ?? termW();
	if (w >= 180) return MAX_WRAP_ROWS_WIDE;
	if (w >= 120) return MAX_WRAP_ROWS_MED;
	return MAX_WRAP_ROWS_NARROW;
}

/** Wrap ANSI-encoded string into rows of `w` visible chars. */
function wrapAnsi(s: string, w: number, maxRows = adaptiveWrapRows(), fillBg = ""): string[] {
	if (w <= 0) return [""];
	const plain = Ansi.strip(s);
	if (plain.length <= w) {
		const pad = w - plain.length;
		return pad > 0 ? [s + fillBg + " ".repeat(pad) + (fillBg ? Ansi.RST : "")] : [s];
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
				if (hasMore && w > 2) row += `${Ansi.RST}${Ansi.FG_DIM}›${Ansi.RST}`;
				else row += fillBg + " ".repeat(Math.max(0, w - vis)) + Ansi.RST;
				rows.push(row);
				return rows;
			}
			const state = Ansi.ansiState(row);
			rows.push(row + Ansi.RST);
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
		rows.push(row + fillBg + " ".repeat(Math.max(0, w - vis)) + Ansi.RST);
	}
	return rows;
}

function shouldUseSplit(diff: ParsedDiff, tw: number, maxRows = MAX_PREVIEW_LINES): boolean {
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

// ---------------------------------------------------------------------------
// Unified view
// ---------------------------------------------------------------------------

export async function renderUnified(
	diff: ParsedDiff,
	language: BundledLanguage | undefined,
	max = MAX_RENDER_LINES,
	dc: DiffColors = DEFAULT_DIFF_COLORS,
): Promise<string> {
	if (!diff.lines.length) return "";

	const vis = diff.lines.slice(0, max);
	const tw = termW();
	const nw = Math.max(2, String(Math.max(...vis.map((l) => l.oldNum ?? l.newNum ?? 0), 0)).length);
	const gw = nw + 5;
	const cw = Math.max(20, tw - gw);
	const canHL = diff.chars <= MAX_HL_CHARS && vis.length <= MAX_RENDER_LINES;

	const oldSrc: string[] = [], newSrc: string[] = [];
	for (const l of vis) {
		if (l.type === "ctx" || l.type === "del") oldSrc.push(l.content);
		if (l.type === "ctx" || l.type === "add") newSrc.push(l.content);
	}
	const [oldHL, newHL] = canHL
		? await Promise.all([hlBlock(oldSrc.join("\n"), language), hlBlock(newSrc.join("\n"), language)])
		: [oldSrc, newSrc];

	let oI = 0, nI = 0, idx = 0;
	const out: string[] = [];
	out.push(Ansi.rule(tw));

	function emitRow(
		num: number | null, sign: string, gutterBg: string, signFg: string, body: string, bodyBg = "",
	): void {
		const borderFg = sign === "-" ? dc.fgDel : sign === "+" ? dc.fgAdd : "";
		const border = borderFg ? `${borderFg}${Ansi.BORDER_BAR}${Ansi.RST}` : `${Ansi.BG_BASE} `;
		const numFg = borderFg || Ansi.FG_LNUM;
		const gutter = `${border}${gutterBg}${Ansi.lnum(num, nw, numFg)}${signFg}${sign}${Ansi.RST} ${Ansi.DIVIDER} `;
		const contGutter = `${border}${gutterBg}${" ".repeat(nw + 1)}${Ansi.RST} ${Ansi.DIVIDER} `;
		const rows = wrapAnsi(Ansi.tabs(body), cw, adaptiveWrapRows(), bodyBg);
		out.push(`${gutter}${rows[0]}${Ansi.RST}`);
		for (let r = 1; r < rows.length; r++) out.push(`${contGutter}${rows[r]}${Ansi.RST}`);
	}

	while (idx < vis.length) {
		const l = vis[idx];

		if (l.type === "sep") {
			const gap = l.newNum;
			const label = gap && gap > 0 ? ` ${gap} unmodified lines ` : "···";
			const totalW = Math.min(tw, 72);
			const pad = Math.max(0, totalW - label.length - 2);
			const half1 = Math.floor(pad / 2), half2 = pad - half1;
			out.push(`${Ansi.BG_BASE}${Ansi.FG_DIM}${"─".repeat(half1)}${label}${"─".repeat(half2)}${Ansi.RST}`);
			idx++;
			continue;
		}

		if (l.type === "ctx") {
			const hl = oldHL[oI] ?? l.content;
			emitRow(l.newNum, " ", Ansi.BG_BASE, dc.fgCtx, `${Ansi.BG_BASE}${Ansi.DIM}${hl}`, Ansi.BG_BASE);
			oI++; nI++; idx++;
			continue;
		}

		const dels: Array<{ l: DiffLine; hl: string }> = [];
		while (idx < vis.length && vis[idx].type === "del") {
			dels.push({ l: vis[idx], hl: oldHL[oI] ?? vis[idx].content });
			oI++; idx++;
		}
		const adds: Array<{ l: DiffLine; hl: string }> = [];
		while (idx < vis.length && vis[idx].type === "add") {
			adds.push({ l: vis[idx], hl: newHL[nI] ?? vis[idx].content });
			nI++; idx++;
		}

		const isPaired = dels.length === 1 && adds.length === 1;
		const wd = isPaired ? wordDiffAnalysis(dels[0].l.content, adds[0].l.content) : null;

		if (isPaired && wd && wd.similarity >= WORD_DIFF_MIN_SIM && canHL) {
			const delBody = injectBg(dels[0].hl, wd.oldRanges, Ansi.BG_DEL, Ansi.BG_DEL_W);
			const addBody = injectBg(adds[0].hl, wd.newRanges, Ansi.BG_ADD, Ansi.BG_ADD_W);
			emitRow(dels[0].l.oldNum, "-", Ansi.BG_GUTTER_DEL, `${dc.fgDel}${Ansi.BOLD}`, delBody, Ansi.BG_DEL);
			emitRow(adds[0].l.newNum, "+", Ansi.BG_GUTTER_ADD, `${dc.fgAdd}${Ansi.BOLD}`, addBody, Ansi.BG_ADD);
			continue;
		}
		if (isPaired && wd && wd.similarity >= WORD_DIFF_MIN_SIM && !canHL) {
			const pwd = plainWordDiff(dels[0].l.content, adds[0].l.content);
			emitRow(dels[0].l.oldNum, "-", Ansi.BG_GUTTER_DEL, `${dc.fgDel}${Ansi.BOLD}`, `${Ansi.BG_DEL}${pwd.old}`, Ansi.BG_DEL);
			emitRow(adds[0].l.newNum, "+", Ansi.BG_GUTTER_ADD, `${dc.fgAdd}${Ansi.BOLD}`, `${Ansi.BG_ADD}${pwd.new}`, Ansi.BG_ADD);
			continue;
		}

		for (const d of dels) {
			const body = canHL ? `${Ansi.BG_DEL}${d.hl}` : `${Ansi.BG_DEL}${d.l.content}`;
			emitRow(d.l.oldNum, "-", Ansi.BG_GUTTER_DEL, `${dc.fgDel}${Ansi.BOLD}`, body, Ansi.BG_DEL);
		}
		for (const a of adds) {
			const body = canHL ? `${Ansi.BG_ADD}${a.hl}` : `${Ansi.BG_ADD}${a.l.content}`;
			emitRow(a.l.newNum, "+", Ansi.BG_GUTTER_ADD, `${dc.fgAdd}${Ansi.BOLD}`, body, Ansi.BG_ADD);
		}
	}

	out.push(Ansi.rule(tw));
	if (diff.lines.length > vis.length) {
		out.push(`${Ansi.BG_BASE}${Ansi.FG_DIM}  … ${diff.lines.length - vis.length} more lines${Ansi.RST}`);
	}
	return out.join("\n");
}

// ---------------------------------------------------------------------------
// Split view
// ---------------------------------------------------------------------------

export async function renderSplit(
	diff: ParsedDiff,
	language: BundledLanguage | undefined,
	max = MAX_PREVIEW_LINES,
	dc: DiffColors = DEFAULT_DIFF_COLORS,
): Promise<string> {
	const tw = termW();
	if (!shouldUseSplit(diff, tw, max)) return renderUnified(diff, language, max, dc);
	if (!diff.lines.length) return "";

	type Row = { left: DiffLine | null; right: DiffLine | null };
	const rows: Row[] = [];
	let i = 0;
	while (i < diff.lines.length) {
		const l = diff.lines[i];
		if (l.type === "sep" || l.type === "ctx") { rows.push({ left: l, right: l }); i++; continue; }
		const dels: DiffLine[] = [], adds: DiffLine[] = [];
		while (i < diff.lines.length && diff.lines[i].type === "del") { dels.push(diff.lines[i]); i++; }
		while (i < diff.lines.length && diff.lines[i].type === "add") { adds.push(diff.lines[i]); i++; }
		const n = Math.max(dels.length, adds.length);
		for (let j = 0; j < n; j++) rows.push({ left: dels[j] ?? null, right: adds[j] ?? null });
	}

	const vis = rows.slice(0, max);
	const half = Math.floor((tw - 1) / 2);
	const nw = Math.max(2, String(Math.max(...diff.lines.map((l) => l.oldNum ?? l.newNum ?? 0), 0)).length);
	const gw = nw + 5;
	const cw = Math.max(12, half - gw);
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
			const gPat = Ansi.FG_STRIPE + "╱".repeat(gw2) + Ansi.RST;
			const g = ` ${gPat}${Ansi.FG_RULE}│${Ansi.RST} `;
			return { gutter: g, contGutter: g, bodyRows: [Ansi.stripes(cw, stripeRow)] };
		}
		if (line.type === "sep") {
			const gap = line.newNum;
			const label = gap && gap > 0 ? `··· ${gap} lines ···` : "···";
			const g = `${Ansi.BG_BASE} ${Ansi.FG_DIM}${Ansi.fit("", nw + 2)}${Ansi.RST}${Ansi.FG_RULE}│${Ansi.RST} `;
			return { gutter: g, contGutter: g, bodyRows: [`${Ansi.BG_BASE}${Ansi.FG_DIM}${Ansi.fit(label, cw)}${Ansi.RST}`] };
		}

		const isDel = line.type === "del", isAdd = line.type === "add";
		const gBg = isDel ? Ansi.BG_GUTTER_DEL : isAdd ? Ansi.BG_GUTTER_ADD : Ansi.BG_BASE;
		const cBg = isDel ? Ansi.BG_DEL : isAdd ? Ansi.BG_ADD : Ansi.BG_BASE;
		const sFg = isDel ? dc.fgDel : isAdd ? dc.fgAdd : dc.fgCtx;
		const sign = isDel ? "-" : isAdd ? "+" : " ";
		const num = isDel ? line.oldNum : isAdd ? line.newNum : side === "left" ? line.oldNum : line.newNum;

		const borderFg = isDel ? dc.fgDel : isAdd ? dc.fgAdd : "";
		const border = borderFg ? `${borderFg}${Ansi.BORDER_BAR}${Ansi.RST}` : ` ${Ansi.BG_BASE}`;
		const numFg = borderFg || Ansi.FG_LNUM;

		let body: string;
		if (ranges && ranges.length > 0) {
			body = injectBg(hl, ranges, cBg, isDel ? Ansi.BG_DEL_W : Ansi.BG_ADD_W);
		} else if (isDel || isAdd) {
			body = `${cBg}${hl}`;
		} else {
			body = `${Ansi.BG_BASE}${Ansi.DIM}${hl}`;
		}

		const gutter = `${border}${gBg}${Ansi.lnum(num, nw, numFg)}${sFg}${Ansi.BOLD}${sign}${Ansi.RST} ${Ansi.FG_RULE}│${Ansi.RST} `;
		const contGutter = `${border}${gBg}${" ".repeat(nw + 1)}${Ansi.RST} ${Ansi.FG_RULE}│${Ansi.RST} `;
		const bodyRows = wrapAnsi(Ansi.tabs(body), cw, adaptiveWrapRows(), cBg);
		return { gutter, contGutter, bodyRows };
	}

	const out: string[] = [];
	const hdrOld = `${Ansi.BG_BASE}${" ".repeat(Math.max(0, nw - 2))}${dc.fgDel}${Ansi.DIM}old${Ansi.RST}`;
	const hdrNew = `${Ansi.BG_BASE}${" ".repeat(Math.max(0, nw - 2))}${dc.fgAdd}${Ansi.DIM}new${Ansi.RST}`;
	out.push(`${Ansi.BG_BASE}${hdrOld}${" ".repeat(Math.max(0, half - nw - 1))}${Ansi.FG_RULE}┊${Ansi.RST}${hdrNew}`);
	out.push(`${Ansi.rule(half)}${Ansi.FG_RULE}┊${Ansi.RST}${Ansi.rule(half)}`);

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
			const pwd = plainWordDiff(leftLine.content, rightLine.content);
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
			const lb = lResult.bodyRows[row] ?? (leftIsEmpty ? Ansi.stripes(cw, stripeRow) : `${Ansi.BG_EMPTY}${" ".repeat(cw)}${Ansi.RST}`);
			const rb = rResult.bodyRows[row] ?? (rightIsEmpty ? Ansi.stripes(cw, stripeRow) : `${Ansi.BG_EMPTY}${" ".repeat(cw)}${Ansi.RST}`);
			out.push(`${lg}${lb}${Ansi.DIVIDER}${rg}${rb}`);
			stripeRow++;
		}
	}

	out.push(`${Ansi.rule(half)}${Ansi.FG_RULE}┊${Ansi.RST}${Ansi.rule(half)}`);
	if (rows.length > vis.length) {
		out.push(`${Ansi.BG_BASE}${Ansi.FG_DIM}  … ${rows.length - vis.length} more lines${Ansi.RST}`);
	}
	return out.join("\n");
}
