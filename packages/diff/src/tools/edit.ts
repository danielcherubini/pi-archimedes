/** Edit tool override with diff rendering. */

import { existsSync, readFileSync } from "node:fs";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Box, Spacer, Text } from "@earendil-works/pi-tui";
import { parseDiff } from "../core/diff.js";
import * as Ansi from "../ansi/index.js";
import { themeCacheKey } from "../ansi/index.js";
import { lang } from "../shiki.js";
import { MAX_PREVIEW_LINES } from "../render/index.js";
import { DiffComponent } from "../diff-component.js";

/** Register the edit tool override. */
export function registerEditTool(
  pi: ExtensionAPI,
  cwd: string,
  home: string,
  createEditTool: (cwd: string) => any,
): void {
  const sp = (p: string) => Ansi.shortPath(cwd, home, p);
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
    renderShell: "self",

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
            const idx = f.indexOf(operations[0]!.newText);
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

      // Box with padding + background — matches built-in edit tool pattern
      const box = ctx.state.callBox as Box | undefined;
      if (box) {
        box.setBgFn((s: string) => theme.bg("toolPendingBg", s));
      }
      const shell = box ?? new Box(1, 1, (s: string) => theme.bg("toolPendingBg", s));
      if (!box) ctx.state.callBox = shell;

      const hdr = `${theme.fg("toolTitle", theme.bold("edit"))} ${theme.fg("accent", sp(fp))}`;

      if (!(ctx.argsComplete && operations.length > 0)) {
        shell.clear();
        shell.addChild(new Text(hdr, 0, 0));
        return shell;
      }

      const pk = JSON.stringify({ fp, operations, theme: themeCacheKey(theme) });
      if (ctx.state._pk === pk && shell.children.length > 1) {
        return shell;
      }
      ctx.state._pk = pk;

      shell.clear();
      shell.addChild(new Text(hdr, 0, 0));

      const lg = lang(fp);
      const { diffs } = summarizeEditOperations(operations);

      if (operations.length === 1) {
        const diff = diffs[0];
        if (diff) {
          shell.addChild(new Spacer(1));
          shell.addChild(new DiffComponent(diff, lg, theme, MAX_PREVIEW_LINES));
        }
      } else {
        const maxShown = Math.min(operations.length, 3);
        const previewLines = Math.max(8, Math.floor(MAX_PREVIEW_LINES / maxShown));
        for (let i = 0; i < maxShown && i < diffs.length; i++) {
          const diff = diffs[i];
          if (!diff) continue;
          if (i > 0) shell.addChild(new Spacer(1));
          shell.addChild(new Text(
            theme.fg("muted", `Edit ${i + 1}/${operations.length}`),
            0, 0,
          ));
          shell.addChild(new DiffComponent(diff, lg, theme, previewLines));
        }
        const remainder = operations.length - maxShown;
        if (remainder > 0) {
          shell.addChild(new Spacer(1));
          shell.addChild(new Text(
            `  ${theme.fg("dim", `… ${remainder} more edit blocks`)}`,
            0, 0,
          ));
        }
      }

      return shell;
    },

    renderResult(result: any, _opt: any, theme: any, ctx: any) {
      // Update the call Box background to reflect final state.
      const box = ctx.state.callBox as Box | undefined;
      if (box) {
        const bgKey = ctx.isError ? "toolErrorBg" : "toolSuccessBg";
        box.setBgFn((s: string) => theme.bg(bgKey, s));
      }
      // Show summary below the diff
      if (ctx.isError) {
        const e = result.content
          ?.filter((c: any) => c.type === "text")
          .map((c: any) => c.text || "")
          .join("\n") ?? "Error";
        return new Text(`\n${theme.fg("error", e)}`, 1, 0);
      }
      if (result.details?._type === "editInfo") {
        const { summary: s, editLine } = result.details;
        const loc = editLine > 0 ? ` ${theme.fg("muted", `at line ${editLine}`)}` : "";
        return new Text(`  ${s}${loc}`, 1, 0);
      }
      if (result.details?._type === "multiEditInfo") {
        const { summary: s, editCount, diffLineCount } = result.details;
        return new Text(`  ${editCount} edits ${s}${typeof diffLineCount === "number" ? ` ${theme.fg("muted", `(${diffLineCount} diff lines)`)}` : ""}`, 1, 0);
      }
      return new Text("", 0, 0);
    },
  });
}
