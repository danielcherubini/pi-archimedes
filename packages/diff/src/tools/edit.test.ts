/**
 * Row tests for the Archimedes `edit` presentation.
 *
 * These pin what an `edit` row looks like — the call row while arguments
 * stream in, the same row with the pending diff, and the settled result line —
 * so the move from a `registerTool()` take-over to `registerToolRenderer()` can
 * be checked as *unchanged rendering* rather than re-derived from the code.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createEditTool } from "@earendil-works/pi-coding-agent";
import { installEditTool, createEditRenderers } from "./edit.js";

// `diff` is standalone and must not import `@pi-archimedes/core` (see
// `src/pi-support.ts`), so the tests strip escape sequences themselves.
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

const theme = {
  fg: (token: string, text?: string) =>
    text === undefined ? `[${token}]` : `[${token}:${text}]`,
  bold: (text: string) => `**${text}**`,
  bg: (_token: string, text: string) => text,
  italic: (text: string) => text,
} as any;

/** Install the resolvers and hand back the renderers pi would use for `edit`. */
function captureTool(cwd: string, home: string) {
  let resolved: any;
  installEditTool(
    {
      registerToolRenderer: (r: any) => {
        resolved = r("edit", () => ({ renderShell: "self" }));
      },
      on: () => () => {},
    } as unknown as ExtensionAPI,
    cwd,
    home,
  );
  return resolved;
}

function makeWorkspace() {
  const dir = mkdtempSync(path.join(tmpdir(), "diff-rows-"));
  const file = path.join(dir, "note.txt");
  writeFileSync(file, "one\ntwo\nthree\n");
  return { dir, file, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const rows = (component: any) => stripAnsi(component.render(80).join("\n"));

/** A render context, plus a promise that resolves when the row asks to redraw. */
function makeCtx(extra: Record<string, unknown> = {}) {
  let wake: () => void = () => {};
  const painted = new Promise<void>((resolve) => {
    wake = resolve;
  });
  const ctx: any = {
    state: {},
    argsComplete: true,
    outputPad: 1,
    isError: false,
    invalidate: () => wake(),
    ...extra,
  };
  return { ctx, painted };
}

describe("edit tool row", () => {
  it("shows the tool name and the home-relative path while arguments stream in", () => {
    const { dir, file, done } = makeWorkspace();
    try {
      const def = captureTool(dir, dir);
      const { ctx } = makeCtx({ argsComplete: false });
      const out = rows(def.renderCall({ path: file, edits: [{ oldText: "two", newText: "2" }] }, theme, ctx));
      expect(out).toContain("**edit**");
      expect(out).toContain("note.txt");
      // Nothing of a diff yet — the arguments are still arriving.
      expect(out).not.toContain("two");
    } finally {
      done();
    }
  });

  it("holds a diff preview under the header once the arguments are complete", () => {
    const { dir, file, done } = makeWorkspace();
    try {
      const def = captureTool(dir, dir);
      const { ctx } = makeCtx();
      const call = def.renderCall({ path: file, edits: [{ oldText: "two", newText: "2" }] }, theme, ctx);
      const out = rows(call);
      expect(out).toContain("**edit**");
      expect(out).toContain("note.txt");
      // The preview is a slot of its own: Shiki colours it asynchronously and
      // the row invalidates when the coloured lines land, so the first paint
      // holds the placeholder (the coloured body is `shiki.test.ts`'s job).
      expect(out).toContain("rendering diff…");
    } finally {
      done();
    }
  });

  it("summarises a single edit on the result line, with the changed line number", () => {
    const { dir, file, done } = makeWorkspace();
    try {
      const def = captureTool(dir, dir);
      const { ctx } = makeCtx();
      def.renderCall({ path: file, edits: [{ oldText: "two", newText: "2" }] }, theme, ctx);
      def.renderResult(
        { content: [{ type: "text", text: "ok" }], details: { _type: "editInfo", summary: "[+1:-1]", editLine: 2 } },
        { expanded: false, isPartial: false },
        theme,
        ctx,
      );
      const out = rows(ctx.state.callBox);
      expect(out).toContain("[+1:-1]");
      expect(out).toContain("at line 2");
    } finally {
      done();
    }
  });

  it("counts the edits on a multi-edit result line", () => {
    const { dir, file, done } = makeWorkspace();
    try {
      const def = captureTool(dir, dir);
      const { ctx } = makeCtx();
      def.renderCall(
        {
          path: file,
          edits: [
            { oldText: "one", newText: "1" },
            { oldText: "two", newText: "2" },
          ],
        },
        theme,
        ctx,
      );
      def.renderResult(
        {
          content: [{ type: "text", text: "ok" }],
          details: { _type: "multiEditInfo", summary: "[+2:-2]", editCount: 2, diffLineCount: 4 },
        },
        { expanded: false, isPartial: false },
        theme,
        ctx,
      );
      const out = rows(ctx.state.callBox);
      expect(out).toContain("2 edits");
      expect(out).toContain("(4 diff lines)");
    } finally {
      done();
    }
  });

  it("shows the failure text on an errored result", () => {
    const { dir, file, done } = makeWorkspace();
    try {
      const def = captureTool(dir, dir);
      const ctx = { state: {}, isError: true, outputPad: 1 } as any;
      def.renderCall({ path: file, edits: [{ oldText: "two", newText: "2" }] }, theme, {
        state: ctx.state,
        argsComplete: false,
        outputPad: 1,
        isError: true,
        invalidate: () => {},
      });
      def.renderResult(
        { content: [{ type: "text", text: "oldText not found" }], details: undefined },
        { expanded: false, isPartial: false },
        theme,
        ctx,
      );
      expect(rows(ctx.state.callBox)).toContain("oldText not found");
    } finally {
      done();
    }
  });
});
