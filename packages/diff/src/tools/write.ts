/** Write tool override with diff rendering. */

import { existsSync, readFileSync } from "node:fs";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { parseDiff } from "../core/diff.js";
import * as Ansi from "../ansi/index.js";
import { themeCacheKey } from "../ansi/index.js";
import { lang, hlBlock } from "../shiki.js";
import { DiffComponent } from "../diff-component.js";
import { MAX_RENDER_LINES } from "../render/index.js";

/** Register the write tool override. */
export function registerWriteTool(
  pi: ExtensionAPI,
  cwd: string,
  home: string,
  createWriteTool: (cwd: string) => any,
  TextComponent: new (text?: string, paddingX?: number, paddingY?: number) => Component,
): void {
  const sp = (p: string) => Ansi.shortPath(cwd, home, p);
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
  });
}
