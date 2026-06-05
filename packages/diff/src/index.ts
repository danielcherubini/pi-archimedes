/**
 * @pi-archimedes/diff — Shiki-powered terminal diff rendering.
 *
 * Adapted from pi-ui-hephaestus diff renderer.
 */

import { existsSync, readFileSync } from "node:fs";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";

import { type DiffLine, type ParsedDiff, parseDiff } from "./core/diff.js";
import * as Ansi from "./ansi.js";
import { resolveDiffColors, themeCacheKey, DEFAULT_DIFF_COLORS } from "./ansi.js";
import { setConfigGetter as setShikiConfig } from "./shiki.js";
import { hlBlock, lang } from "./shiki.js";
import { renderSplit } from "./render.js";
import { setConfigGetter as setRenderConfig } from "./render.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface DiffConfig {
	diffTheme: string;
	diffSplitMinWidth: number;
	diffSplitMinCodeWidth: number;
}

const DEFAULT_DIFF_CONFIG: DiffConfig = {
	diffTheme: "github-dark",
	diffSplitMinWidth: 150,
	diffSplitMinCodeWidth: 60,
};

let _readConfig: () => DiffConfig = () => DEFAULT_DIFF_CONFIG;
function getConfig(): DiffConfig { return _readConfig(); }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PREVIEW_LINES = 60;
const MAX_RENDER_LINES = 150;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function getDiffSettingsItems(): SettingItem[] {
	const config = getConfig();
	return [
		{
			id: "diffTheme",
			label: "Diff Theme",
			description: "Shiki theme for diff syntax highlighting",
			currentValue: config.diffTheme,
		},
		{
			id: "diffSplitMinWidth",
			label: "Split Min Width",
			description: "Minimum terminal width for split diff view",
			currentValue: String(config.diffSplitMinWidth),
		},
		{
			id: "diffSplitMinCodeWidth",
			label: "Split Min Code Width",
			description: "Minimum code column width for split diff view",
			currentValue: String(config.diffSplitMinCodeWidth),
		},
	];
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export function registerDiffTools(
	pi: ExtensionAPI,
	_getTheme: () => Theme,
	readConfig: () => DiffConfig,
): void {
	_readConfig = readConfig;

	// Wire config getters into submodules
	setShikiConfig(() => getConfig());
	setRenderConfig(() => getConfig());

	(async () => {
		let createWriteTool: any, createEditTool: any, TextComponent: any;
		try {
			const sdk = await import("@earendil-works/pi-coding-agent");
			const tui = await import("@earendil-works/pi-tui");
			createWriteTool = sdk.createWriteTool;
			createEditTool = sdk.createEditTool;
			TextComponent = tui.Text;
		} catch (error) {
			console.error(
				`[diff] failed to load Pi SDK: ${error instanceof Error ? error.message : String(error)}`,
			);
			return;
		}
		if (!createWriteTool || !createEditTool || !TextComponent) return;

		const cwd = process.cwd();
		const home = process.env.HOME ?? "";
		const sp = (p: string) => Ansi.shortPath(cwd, home, p);

		// ===================================================================
		// write tool
		// ===================================================================

		const origWrite = createWriteTool(cwd);

		pi.registerTool({
			...origWrite,
			name: "write",

			async execute(tid: string, params: any, sig: any, upd: any, ctx: any) {
				const fp = params.path ?? params.file_path ?? "";
				let old: string | null = null;
				try {
					if (fp && existsSync(fp)) old = readFileSync(fp, "utf-8");
				} catch {
					old = null;
				}

				const result = await origWrite.execute(tid, params, sig, upd, ctx);
				const content = params.content ?? "";

				if (old !== null && old !== content) {
					const diff = parseDiff(old, content);
					const lg = lang(fp);
					(result as any).details = {
						_type: "diff",
						summary: Ansi.summarize(diff.added, diff.removed),
						diff,
						language: lg,
					};
				} else if (old === null) {
					const lineCount = content ? content.split("\n").length : 0;
					(result as any).details = { _type: "new", lines: lineCount, content, filePath: fp };
				} else if (old === content) {
					(result as any).details = { _type: "noChange" };
				}
				return result;
			},

			renderCall(args: any, theme: any, ctx: any) {
				const fp = args?.path ?? args?.file_path ?? "";
				const isNew = !fp || !existsSync(fp);
				const label = isNew ? "create" : "write";
				const text = ctx.lastComponent ?? new TextComponent("", 0, 0);
				const hdr = `${theme.fg("toolTitle", theme.bold(label))} ${theme.fg("accent", sp(fp))}`;

				if (args?.content && !ctx.argsComplete) {
					const n = String(args.content).split("\n").length;
					text.setText(`${hdr}  ${theme.fg("muted", `(${n} lines…)`)}`);
					return text;
				}

				if (args?.content && ctx.argsComplete && isNew) {
					const previewKey = `create:${themeCacheKey(theme)}:${fp}:${String(args.content).length}`;
					if (ctx.state._previewKey !== previewKey) {
						ctx.state._previewKey = previewKey;
						ctx.state._previewText = hdr;
						const lg = lang(fp);
						hlBlock(args.content, lg)
							.then((lines: string[]) => {
								if (ctx.state._previewKey !== previewKey) return;
								const maxShow = ctx.expanded ? lines.length : 16;
								const preview = lines.slice(0, maxShow).join("\n");
								const rem = lines.length - maxShow;
								let out = `${hdr}\n\n${preview}`;
								if (rem > 0) out += `\n${theme.fg("muted", `… (${rem} more lines, ${lines.length} total)`)}`;
								ctx.state._previewText = out;
								ctx.invalidate();
							})
							.catch(() => {});
					}
					text.setText(ctx.state._previewText ?? hdr);
					return text;
				}

				text.setText(hdr);
				return text;
			},

			renderResult(result: any, _opt: any, theme: any, ctx: any) {
				const text = ctx.lastComponent ?? new TextComponent("", 0, 0);
				if (ctx.isError) {
					const e = result.content
						?.filter((c: any) => c.type === "text")
						.map((c: any) => c.text || "")
						.join("\n") ?? "Error";
					text.setText(`\n${theme.fg("error", e)}`);
					return text;
				}
				const d = result.details;
				if (d?._type === "diff") {
					const w = process.stdout.columns ?? 200;
					const key = `wd:${themeCacheKey(theme)}:${w}:${d.summary}:${d.diff?.lines?.length ?? 0}:${d.language ?? ""}`;
					if (ctx.state._wdk !== key) {
						ctx.state._wdk = key;
						ctx.state._wdt = `${Ansi.BG_BASE}  ${d.summary}${Ansi.RST}\n${theme.fg("muted", "  rendering diff…")}`;
						const dc = resolveDiffColors(theme);
						renderSplit(d.diff, d.language, MAX_RENDER_LINES, dc)
							.then((rendered: string) => {
								if (ctx.state._wdk !== key) return;
								ctx.state._wdt = `${Ansi.BG_BASE}  ${d.summary}${Ansi.RST}\n${rendered}`;
								ctx.invalidate();
							})
							.catch(() => {
								if (ctx.state._wdk !== key) return;
								ctx.state._wdt = `  ${d.summary}`;
								ctx.invalidate();
							});
					}
					text.setText(ctx.state._wdt ?? `  ${d.summary}`);
					return text;
				}
				if (d?._type === "noChange") {
					text.setText(`  ${theme.fg("muted", "✓ no changes")}`);
					return text;
				}
				if (d?._type === "new") {
					const { lines: lineCount, content: rawContent, filePath: fp } = d;
					const pk = `nf:${themeCacheKey(theme)}:${fp}:${lineCount}`;
					if (ctx.state._nfk !== pk) {
						ctx.state._nfk = pk;
						ctx.state._nft = `  ${theme.fg("success", `✓ new file (${lineCount} lines)`)}`;
						const lg = lang(fp);
						if (rawContent) {
							hlBlock(rawContent, lg)
								.then((hlLines: string[]) => {
									if (ctx.state._nfk !== pk) return;
									const maxShow = ctx.expanded ? hlLines.length : 12;
									const preview = hlLines.slice(0, maxShow).join("\n");
									const rem = hlLines.length - maxShow;
									let out = `  ${theme.fg("success", `✓ new file (${lineCount} lines)`)}\n${preview}`;
									if (rem > 0) out += `\n${theme.fg("muted", `  … ${rem} more lines`)}`;
									ctx.state._nft = out;
									ctx.invalidate();
								})
								.catch(() => {});
						}
					}
					text.setText(ctx.state._nft ?? `  ${theme.fg("success", `✓ new file (${lineCount} lines)`)}`);
					return text;
				}
				text.setText(`  ${theme.fg("dim", String(result?.content?.[0]?.text ?? "written").slice(0, 120))}`);
				return text;
			},
		});

		// ===================================================================
		// edit tool
		// ===================================================================

		const origEdit = createEditTool(cwd);

		function getEditOperations(input: any): Array<{ oldText: string; newText: string }> {
			if (Array.isArray(input?.edits)) {
				return input.edits
					.map((edit: any) => ({
						oldText: typeof edit?.oldText === "string" ? edit.oldText : typeof edit?.old_text === "string" ? edit.old_text : "",
						newText: typeof edit?.newText === "string" ? edit.newText : typeof edit?.new_text === "string" ? edit.new_text : "",
					}))
					.filter((edit: { oldText: string; newText: string }) => edit.oldText && edit.oldText !== edit.newText);
			}
			const oldText = typeof input?.oldText === "string" ? input.oldText : typeof input?.old_text === "string" ? input.old_text : "";
			const newText = typeof input?.newText === "string" ? input.newText : typeof input?.new_text === "string" ? input.new_text : "";
			return oldText && oldText !== newText ? [{ oldText, newText }] : [];
		}

		function summarizeEditOperations(operations: Array<{ oldText: string; newText: string }>) {
			const diffs = operations.map((edit) => parseDiff(edit.oldText, edit.newText));
			const totalAdded = diffs.reduce((sum, diff) => sum + diff.added, 0);
			const totalRemoved = diffs.reduce((sum, diff) => sum + diff.removed, 0);
			return { diffs, totalAdded, totalRemoved, summary: Ansi.summarize(totalAdded, totalRemoved) };
		}

		pi.registerTool({
			...origEdit,
			name: "edit",

			async execute(tid: string, params: any, sig: any, upd: any, ctx: any) {
				const fp = params.path ?? params.file_path ?? "";
				const operations = getEditOperations(params);
				const result = await origEdit.execute(tid, params, sig, upd, ctx);

				if (operations.length === 0) return result;

				const { diffs, summary } = summarizeEditOperations(operations);
				if (operations.length === 1) {
					let editLine = 0;
					try {
						if (fp && existsSync(fp)) {
							const f = readFileSync(fp, "utf-8");
							const idx = f.indexOf(operations[0].newText);
							if (idx >= 0) editLine = f.slice(0, idx).split("\n").length;
						}
					} catch { editLine = 0; }
					(result as any).details = { _type: "editInfo", summary, editLine };
					return result;
				}

				(result as any).details = {
					_type: "multiEditInfo",
					summary,
					editCount: operations.length,
					diffLineCount: diffs.reduce((sum, diff) => sum + diff.lines.length, 0),
				};
				return result;
			},

			renderCall(args: any, theme: any, ctx: any) {
				const fp = args?.path ?? args?.file_path ?? "";
				const operations = getEditOperations(args);
				const text = ctx.lastComponent ?? new TextComponent("", 0, 0);
				const hdr = `${theme.fg("toolTitle", theme.bold("edit"))} ${theme.fg("accent", sp(fp))}`;

				if (!(ctx.argsComplete && operations.length > 0)) {
					text.setText(hdr);
					return text;
				}

				const pk = JSON.stringify({ fp, operations, theme: themeCacheKey(theme), w: process.stdout.columns ?? 200 });
				if (ctx.state._pk !== pk) {
					ctx.state._pk = pk;
					ctx.state._pt = `${hdr}  ${theme.fg("muted", "(rendering…)")}`;
					const lg = lang(fp);
					const dc = resolveDiffColors(theme);

					if (operations.length === 1) {
						const diff = parseDiff(operations[0].oldText, operations[0].newText);
						renderSplit(diff, lg, MAX_PREVIEW_LINES, dc)
							.then((rendered) => {
								if (ctx.state._pk !== pk) return;
								ctx.state._pt = `${Ansi.BG_BASE}${hdr}${Ansi.RST}\n${Ansi.BG_BASE}${Ansi.summarize(diff.added, diff.removed)}${Ansi.RST}\n${rendered}`;
								ctx.invalidate();
							})
							.catch(() => {
								if (ctx.state._pk !== pk) return;
								ctx.state._pt = `${Ansi.BG_BASE}${hdr}  ${Ansi.summarize(diff.added, diff.removed)}${Ansi.RST}`;
								ctx.invalidate();
							});
					} else {
						const { diffs, summary } = summarizeEditOperations(operations);
						const maxShown = Math.min(operations.length, 3);
						const previewLines = Math.max(8, Math.floor(MAX_PREVIEW_LINES / maxShown));
						Promise.all(
							diffs.slice(0, maxShown).map((diff, index) =>
								renderSplit(diff, lg, previewLines, dc)
									.then((rendered) => `Edit ${index + 1}/${operations.length}\n${rendered}`)
									.catch(() => `Edit ${index + 1}/${operations.length}  ${Ansi.summarize(diff.added, diff.removed)}`),
							),
						)
							.then((sections) => {
								if (ctx.state._pk !== pk) return;
								const remainder = operations.length - maxShown;
								const suffix = remainder > 0 ? `\n${theme.fg("muted", `… ${remainder} more edit blocks`)}` : "";
								ctx.state._pt = `${Ansi.BG_BASE}${hdr}${Ansi.RST}\n${Ansi.BG_BASE}${operations.length} edits ${summary}${Ansi.RST}\n\n${sections.join("\n\n")}${suffix}`;
								ctx.invalidate();
							})
							.catch(() => {
								if (ctx.state._pk !== pk) return;
								ctx.state._pt = `${Ansi.BG_BASE}${hdr}  ${operations.length} edits ${summary}${Ansi.RST}`;
								ctx.invalidate();
							});
					}
				}

				text.setText(ctx.state._pt ?? hdr);
				return text;
			},

			renderResult(result: any, _opt: any, theme: any, ctx: any) {
				const text = ctx.lastComponent ?? new TextComponent("", 0, 0);
				if (ctx.isError) {
					const e = result.content
						?.filter((c: any) => c.type === "text")
						.map((c: any) => c.text || "")
						.join("\n") ?? "Error";
					text.setText(`\n${theme.fg("error", e)}`);
					return text;
				}
				if (result.details?._type === "editInfo") {
					const { summary: s, editLine } = result.details;
					const loc = editLine > 0 ? ` ${theme.fg("muted", `at line ${editLine}`)}` : "";
					const content = `${Ansi.BG_BASE}  ${s}${loc}${Ansi.RST}`;
					const vis = content.replace(Ansi.ANSI_RE, "").length;
					const pad = Math.max(0, (process.stdout.columns ?? 200) - vis);
					text.setText(`${content}${" ".repeat(pad)}`);
					return text;
				}
				if (result.details?._type === "multiEditInfo") {
					const { summary: s, editCount, diffLineCount } = result.details;
					const content = `${Ansi.BG_BASE}  ${editCount} edits ${s}${typeof diffLineCount === "number" ? ` ${theme.fg("muted", `(${diffLineCount} diff lines)`)}` : ""}${Ansi.RST}`;
					const vis = content.replace(Ansi.ANSI_RE, "").length;
					const pad = Math.max(0, (process.stdout.columns ?? 200) - vis);
					text.setText(`${content}${" ".repeat(pad)}`);
					return text;
				}
				text.setText(`  ${theme.fg("dim", String(result?.content?.[0]?.text ?? "edited").slice(0, 120))}`);
				return text;
			},
		});
	})().catch(console.error);
}
