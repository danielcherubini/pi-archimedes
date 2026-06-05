/** DiffComponent — proper pi-tui Component for diff rendering. */

import type { BundledLanguage } from "shiki";
import { Box, type Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import * as Ansi from "./ansi/index.js";
import type { DiffBg, DiffColors } from "./ansi/index.js";
import { DEFAULT_DIFF_COLORS, DEFAULT_DIFF_BG, deriveBgFromTheme } from "./ansi/index.js";
import { renderSplitLines, MAX_RENDER_LINES } from "./render/index.js";
import type { ParsedDiff } from "./core/diff.js";

// ---------------------------------------------------------------------------
// DiffComponent
// ---------------------------------------------------------------------------

/**
 * A pi-tui Component that renders a diff with Shiki syntax highlighting.
 *
 * Rendering is lazy: `render(width)` returns an array of lines computed from
 * the diff data. Shiki highlighting is cached (LRU), so repeated renders at
 * different widths are cheap after the first call.
 *
 * The component wraps its output in a `Box` with the theme-derived base
 * background, so it is visually self-contained regardless of the tool shell.
 *
 * The first render may show a placeholder if Shiki hasn't warmed up yet.
 * Subsequent renders (triggered by `invalidate()` + TUI re-render cycle)
 * show the full diff.
 *
 * Usage in a tool renderResult:
 *
 * ```ts
 * renderResult(result, options, theme, context) {
 *   const d = result.details;
 *   if (d?._type === "diff") {
 *     const comp = context.lastComponent ?? new DiffComponent(d.diff, d.language, theme);
 *     return comp;
 *   }
 * }
 * ```
 */
export class DiffComponent implements Component {
	private diff: ParsedDiff;
	private language: BundledLanguage | undefined;
	private dc: DiffColors;
	private dbg: DiffBg;
	private maxLines: number;

	/** Box wrapper with base background — makes the diff self-contained. */
	private shell: Box;

	/** Pending render promise — reused across width changes. */
	private _renderPromise: Promise<string[]> | null = null;
	/** Resolved raw diff lines (without box wrapping). */
	private _rawLines: string[] | null = null;
	/** Width at which output was last computed. */
	private _cachedWidth: number | undefined;
	/** Final cached output (box-wrapped). */
	private _cachedLines: string[] | undefined;

	constructor(
		diff: ParsedDiff,
		language: BundledLanguage | undefined,
		theme: Theme,
		maxLines: number = MAX_RENDER_LINES,
	) {
		this.diff = diff;
		this.language = language;
		this.dc = Ansi.resolveDiffColors(theme);
		this.dbg = deriveBgFromTheme(theme);
		this.maxLines = maxLines;

		// Box provides base background so the diff is self-contained.
		this.shell = new Box(0, 0, (s: string) => this.dbg.bgBase + s + this.dbg.rst);
	}

	render(width: number): string[] {
		// Use cached output if width unchanged
		if (this._cachedLines && this._cachedWidth === width) {
			return this._cachedLines;
		}

		// If we have resolved raw lines, wrap them in the box
		if (this._rawLines) {
			this._updateShell(this._rawLines);
			const lines = this.shell.render(width);
			this._cachedWidth = width;
			this._cachedLines = lines;
			return lines;
		}

		// If we have a pending promise, we haven't resolved yet — show placeholder
		if (this._renderPromise) {
			this._updateShell([Ansi.FG_DIM + "  rendering diff…" + Ansi.RST]);
			return this.shell.render(width);
		}

		// Start async render for this width
		const promise = renderSplitLines(
			this.diff,
			this.language,
			width,
			this.maxLines,
			this.dc,
			this.dbg,
		);
		this._renderPromise = promise;

		// Store resolved lines
		promise.then((lines) => {
			this._rawLines = lines;
			this._renderPromise = null;
			this.invalidate();
		}).catch(() => {
			this._rawLines = [Ansi.FG_DIM + "  diff render failed" + Ansi.RST];
			this._renderPromise = null;
			this.invalidate();
		});

		// Show placeholder while waiting
		this._updateShell([Ansi.FG_DIM + "  rendering diff…" + Ansi.RST]);
		return this.shell.render(width);
	}

	private _updateShell(lines: string[]): void {
		this.shell.clear();
		// Join lines into a single text block; each line is a row.
		const textComponent = new (class implements Component {
			render(_w: number): string[] { return lines; }
			invalidate(): void {}
		})();
		this.shell.addChild(textComponent);
	}

	invalidate(): void {
		this._cachedWidth = undefined;
		this._cachedLines = undefined;
	}
}
