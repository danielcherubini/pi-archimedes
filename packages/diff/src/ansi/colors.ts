/** Diff background color derivation from theme. */

import type { DiffBg } from "./codes.js";
import { DEFAULT_DIFF_BG, FG_RULE } from "./codes.js";

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

/** Parse 24-bit ANSI color code → RGB. Works for both fg and bg escapes. */
function parseAnsiRgb(ansi: string): { r: number; g: number; b: number } | null {
	const esc = "\x1b";
	const m = ansi.match(new RegExp(`${esc}\\[(?:38|48);2;(\\d+);(\\d+);(\\d+)m`));
	return m ? { r: +m[1]!, g: +m[2]!, b: +m[3]! } : null;
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

// ---------------------------------------------------------------------------
// Theme-aware diff colors
// ---------------------------------------------------------------------------

/** Auto-derive diff background colors from the pi theme's fg diff colors. */
export function deriveBgFromTheme(theme: any): DiffBg {
	if (!theme?.getFgAnsi) return { ...DEFAULT_DIFF_BG };
	try {
		const fgAdd = theme.getFgAnsi("toolDiffAdded");
		const fgDel = theme.getFgAnsi("toolDiffRemoved");
		const addRgb = parseAnsiRgb(fgAdd);
		const delRgb = parseAnsiRgb(fgDel);
		if (!addRgb || !delRgb) return { ...DEFAULT_DIFF_BG };

		let addBase = { r: 0, g: 0, b: 0 };
		let delBase = addBase;
		let bgBase = "\x1b[49m"; // BG_DEFAULT

		if (theme.getBgAnsi) {
			try {
				const successBgAnsi = theme.getBgAnsi("toolSuccessBg");
				const successParsed = parseAnsiRgb(successBgAnsi);
				if (successParsed) {
					addBase = successParsed;
					delBase = successParsed;
					bgBase = successBgAnsi;
				}
			} catch { /* no toolSuccessBg */ }

			try {
				const errorParsed = parseAnsiRgb(theme.getBgAnsi("toolErrorBg"));
				if (errorParsed) delBase = errorParsed;
			} catch { /* no toolErrorBg */ }
		}

		const rst = bgBase === "\x1b[49m" ? "\x1b[0m" : `\x1b[0m${bgBase}`;
		return {
			bgAdd: mixBg(addBase, addRgb, 0.08),
			bgDel: mixBg(delBase, delRgb, 0.1),
			bgAddW: mixBg(addBase, addRgb, 0.2),
			bgDelW: mixBg(delBase, delRgb, 0.22),
			bgGutterAdd: mixBg(addBase, addRgb, 0.05),
			bgGutterDel: mixBg(delBase, delRgb, 0.06),
			bgEmpty: bgBase,
			bgBase,
			rst,
			divider: `${FG_RULE}│${rst}`,
		};
	} catch {
		return { ...DEFAULT_DIFF_BG };
	}
}
