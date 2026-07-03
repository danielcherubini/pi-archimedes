/** Unified diff view rendering. */

import type { BundledLanguage } from "shiki";
import * as Ansi from "../ansi/index.js";
import type { DiffBg, DiffColors } from "../ansi/index.js";
import { DEFAULT_DIFF_COLORS, DEFAULT_DIFF_BG } from "../ansi/index.js";
import { hlBlock } from "../shiki.js";
import { wordDiffAnalysis, injectBg, plainWordDiff } from "../word-diff.js";
import type { DiffLine, ParsedDiff } from "../core/diff.js";
import {
	MAX_HL_CHARS,
	MAX_RENDER_LINES,
	WORD_DIFF_MIN_SIM,
	DEFAULT_TERM_WIDTH,
	adaptiveWrapRows,
	wrapAnsi,
} from "./shared.js";

// ---------------------------------------------------------------------------
// Unified view
// ---------------------------------------------------------------------------

/**
 * Backward-compatible wrapper — reads width from stdout, returns joined string.
 * Prefer `renderUnifiedLines` for Component-based rendering.
 */
export async function renderUnified(
	diff: ParsedDiff,
	language: BundledLanguage | undefined,
	max = MAX_RENDER_LINES,
	dc: DiffColors = DEFAULT_DIFF_COLORS,
): Promise<string> {
	const width = process.stdout.columns ?? DEFAULT_TERM_WIDTH;
	const lines = await renderUnifiedLines(diff, language, width, max, dc, DEFAULT_DIFF_BG);
	return lines.join("\n");
}

export async function renderUnifiedLines(
	diff: ParsedDiff,
	language: BundledLanguage | undefined,
	width: number,
	max = MAX_RENDER_LINES,
	dc: DiffColors = DEFAULT_DIFF_COLORS,
	dbg: DiffBg = DEFAULT_DIFF_BG,
): Promise<string[]> {
	if (!diff.lines.length) return [];

	const vis = diff.lines.slice(0, max);
	const nw = Math.max(2, String(Math.max(...vis.map((l) => l.oldNum ?? l.newNum ?? 0), 0)).length);
	const gw = nw + 5;
	// Never let the content column exceed what's actually available — on very
	// narrow terminals the gutter alone can approach `width`.
	const cw = Math.max(1, width - gw);
	const canHL = diff.chars <= MAX_HL_CHARS && vis.length <= MAX_RENDER_LINES;
	const rst = dbg.rst;
	const bgBase = dbg.bgBase;

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
	out.push(Ansi.rule(dbg, width));

	function emitRow(
		num: number | null, sign: string, gutterBg: string, signFg: string, body: string, bodyBg = "",
	): void {
		const borderFg = sign === "-" ? dc.fgDel : sign === "+" ? dc.fgAdd : "";
		const border = borderFg ? `${borderFg}${Ansi.BORDER_BAR}${rst}` : `${bgBase} `;
		const numFg = borderFg || Ansi.FG_LNUM;
		const gutter = `${border}${gutterBg}${Ansi.lnum(num, nw, numFg)}${signFg}${sign}${rst} ${dbg.divider} `;
		const contGutter = `${border}${gutterBg}${" ".repeat(nw + 1)}${rst} ${dbg.divider} `;
		const rows = wrapAnsi(Ansi.tabs(body), cw, adaptiveWrapRows(cw), bodyBg, rst);
		out.push(`${gutter}${rows[0]}${rst}`);
		for (let r = 1; r < rows.length; r++) out.push(`${contGutter}${rows[r]}${rst}`);
	}

	while (idx < vis.length) {
		const l = vis[idx]!;

		if (l.type === "sep") {
			const gap = l.newNum;
			const label = gap && gap > 0 ? ` ${gap} unmodified lines ` : "···";
			const totalW = Math.min(width, 72);
			const pad = Math.max(0, totalW - label.length - 2);
			const half1 = Math.floor(pad / 2), half2 = pad - half1;
			out.push(`${bgBase}${Ansi.FG_DIM}${"─".repeat(half1)}${label}${"─".repeat(half2)}${rst}`);
			idx++;
			continue;
		}

		if (l.type === "ctx") {
			const hl = oldHL[oI] ?? l.content;
			emitRow(l.newNum, " ", bgBase, dc.fgCtx, `${bgBase}${Ansi.DIM}${hl}`, bgBase);
			oI++; nI++; idx++;
			continue;
		}

		const dels: Array<{ l: DiffLine; hl: string }> = [];
		while (idx < vis.length && vis[idx]!.type === "del") {
			dels.push({ l: vis[idx]!, hl: oldHL[oI] ?? vis[idx]!.content });
			oI++; idx++;
		}
		const adds: Array<{ l: DiffLine; hl: string }> = [];
		while (idx < vis.length && vis[idx]!.type === "add") {
			adds.push({ l: vis[idx]!, hl: newHL[nI] ?? vis[idx]!.content });
			nI++; idx++;
		}

		const isPaired = dels.length === 1 && adds.length === 1;
		const wd = isPaired ? wordDiffAnalysis(dels[0]!.l.content, adds[0]!.l.content) : null;

		if (isPaired && wd && wd.similarity >= WORD_DIFF_MIN_SIM && canHL) {
			const delBody = injectBg(dels[0]!.hl, wd.oldRanges, dbg.bgDel, dbg.bgDelW);
			const addBody = injectBg(adds[0]!.hl, wd.newRanges, dbg.bgAdd, dbg.bgAddW);
			emitRow(dels[0]!.l.oldNum, "-", dbg.bgGutterDel, `${dc.fgDel}${Ansi.BOLD}`, delBody, dbg.bgDel);
			emitRow(adds[0]!.l.newNum, "+", dbg.bgGutterAdd, `${dc.fgAdd}${Ansi.BOLD}`, addBody, dbg.bgAdd);
			continue;
		}
		if (isPaired && wd && wd.similarity >= WORD_DIFF_MIN_SIM && !canHL) {
			const pwd = plainWordDiff(dels[0]!.l.content, adds[0]!.l.content, dbg);
			emitRow(dels[0]!.l.oldNum, "-", dbg.bgGutterDel, `${dc.fgDel}${Ansi.BOLD}`, `${dbg.bgDel}${pwd.old}`, dbg.bgDel);
			emitRow(adds[0]!.l.newNum, "+", dbg.bgGutterAdd, `${dc.fgAdd}${Ansi.BOLD}`, `${dbg.bgAdd}${pwd.new}`, dbg.bgAdd);
			continue;
		}

		for (const d of dels) {
			const body = canHL ? `${dbg.bgDel}${d.hl}` : `${dbg.bgDel}${d.l.content}`;
			emitRow(d.l.oldNum, "-", dbg.bgGutterDel, `${dc.fgDel}${Ansi.BOLD}`, body, dbg.bgDel);
		}
		for (const a of adds) {
			const body = canHL ? `${dbg.bgAdd}${a.hl}` : `${dbg.bgAdd}${a.l.content}`;
			emitRow(a.l.newNum, "+", dbg.bgGutterAdd, `${dc.fgAdd}${Ansi.BOLD}`, body, dbg.bgAdd);
		}
	}

	out.push(Ansi.rule(dbg, width));
	if (diff.lines.length > vis.length) {
		out.push(`${bgBase}${Ansi.FG_DIM}  … ${diff.lines.length - vis.length} more lines${rst}`);
	}
	return out;
}
