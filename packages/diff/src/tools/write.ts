/** Write tool presentation: a diff-drawing row plus the result details it reads. */

import { existsSync, readFileSync } from "node:fs";
import type { ExtensionAPI, ToolRenderers } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { parseDiff } from "../core/diff.js";
import * as Ansi from "../ansi/index.js";
import { themeCacheKey } from "../ansi/index.js";
import { lang, hlBlock } from "../shiki.js";
import { DiffComponent } from "../diff-component.js";
import { MAX_RENDER_LINES } from "../render/index.js";

/**
 * The content a `write` call displaces, read while the call is still about to
 * run. `null` means there was no file — which is what separates "new file" from
 * "replaced file" on the row.
 */
export function readDisplacedContent(input: Record<string, unknown>): string | null {
	const fp = String((input as any).path ?? (input as any).file_path ?? "");
	try {
		return fp && existsSync(fp) ? readFileSync(fp, "utf-8") : null;
	} catch {
		return null;
	}
}

/**
 * What the `write` row needs from a settled result. The content being written
 * is in the call's arguments; the content it replaced had to be read before the
 * write happened, so it comes from {@link readDisplacedContent}. Returned as
 * `{ details }` for pi's `tool_result` event — the same values the row read
 * when this package re-registered the tool and wrapped its `execute`.
 */
export function writeResultDetails(
	old: string | null,
	input: Record<string, unknown>,
): { details: unknown } {
	const fp = String((input as any).path ?? (input as any).file_path ?? "");
	const content = typeof (input as any).content === "string" ? ((input as any).content as string) : "";

	if (old !== null && old !== content) {
		const diff = parseDiff(old, content);
		return {
			details: {
				_type: "diff",
				summary: Ansi.summarize(diff.added, diff.removed),
				diff,
				language: lang(fp),
			},
		};
	}
	if (old === null) {
		return {
			details: {
				_type: "new",
				lines: content ? content.split("\n").length : 0,
				content,
				filePath: fp,
			},
		};
	}
	return { details: { _type: "noChange" } };
}

/** The Archimedes `write` renderers, closed over the paths they shorten against. */
export function createWriteRenderers(
	cwd: string,
	home: string,
	TextComponent: new (text?: string, paddingX?: number, paddingY?: number) => Component,
): ToolRenderers {
	const sp = (p: string) => Ansi.shortPath(cwd, home, p);

	return {
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
				const comp = ctx.lastComponent instanceof DiffComponent
					? ctx.lastComponent
					: new DiffComponent(d.diff, d.language, theme, MAX_RENDER_LINES);
				return comp;
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
								let out = `  ${theme.fg("success", `✓ new file (${lineCount} lines)`)}` + `\n${preview}`;
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
	};
}

/**
 * Draw `write` through pi's renderer resolution and attach the result details
 * its row reads (ADR 0029).
 *
 * The content a write replaces exists only until it runs, so it is read on
 * `tool_call` — which fires before execution and hands the same `toolCallId`
 * `tool_result` does — and paired up when the result lands. A call that never
 * settles (blocked, or aborted before execution) leaves its entry behind, so
 * the map is bounded rather than trusted to drain.
 */
export function installWriteTool(
	pi: ExtensionAPI,
	cwd: string,
	home: string,
	TextComponent: new (text?: string, paddingX?: number, paddingY?: number) => Component,
): void {
	const renderers = createWriteRenderers(cwd, home, TextComponent);
	pi.registerToolRenderer((toolName, next) =>
		toolName === "write" ? { ...next(), ...renderers } : next(),
	);

	const displaced = new Map<string, string | null>();
	pi.on("tool_call", (event) => {
		if (event.toolName !== "write") return undefined;
		if (displaced.size > 64) displaced.clear();
		displaced.set(event.toolCallId, readDisplacedContent(event.input));
		return undefined;
	});

	pi.on("tool_result", (event) => {
		if (event.toolName !== "write") return undefined;
		if (event.isError) {
			displaced.delete(event.toolCallId);
			return undefined;
		}
		const old = displaced.get(event.toolCallId) ?? null;
		displaced.delete(event.toolCallId);
		return writeResultDetails(old, event.input);
	});
}
