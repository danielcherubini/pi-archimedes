/**
 * Row tests for the Archimedes `write` presentation.
 *
 * The counterpart to `edit.test.ts`: what a `write` row looks like while its
 * arguments stream, and for each settled outcome the result renderer knows —
 * new file, replaced file, no change, failure. Written before the move from a
 * `registerTool()` take-over to `registerToolRenderer()`, so that migration can
 * be shown to change resolution only, not rendering.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { installWriteTool } from "./write.js";

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

/** Install the resolvers and hand back the renderers pi would use for `write`. */
function captureTool(cwd: string, home: string) {
  let resolved: any;
  installWriteTool(
    {
      registerToolRenderer: (r: any) => {
        resolved = r("write", () => ({ renderShell: "default" }));
      },
      on: () => () => {},
    } as unknown as ExtensionAPI,
    cwd,
    home,
    Text as any,
  );
  return resolved;
}

function makeWorkspace() {
  const dir = mkdtempSync(path.join(tmpdir(), "diff-rows-"));
  const existing = path.join(dir, "note.txt");
  writeFileSync(existing, "one\ntwo\n");
  return {
    dir,
    existing,
    fresh: path.join(dir, "fresh.txt"),
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const row = (component: any) => stripAnsi(component.render(80).join("\n"));

describe("write tool row", () => {
  it("labels the row `write` for an existing file and `create` for a new one", () => {
    const { dir, existing, fresh, done } = makeWorkspace();
    try {
      const def = captureTool(dir, dir);
      const written = row(
        def.renderCall({ path: existing, content: "x" }, theme, {
          state: {},
          argsComplete: true,
          outputPad: 1,
        }),
      );
      expect(written).toContain("**write**");
      expect(written).toContain("note.txt");

      const created = row(
        def.renderCall({ path: fresh, content: "x" }, theme, {
          state: {},
          argsComplete: true,
          outputPad: 1,
        }),
      );
      expect(created).toContain("**create**");
      expect(created).toContain("fresh.txt");
    } finally {
      done();
    }
  });

  it("counts the incoming lines while the content is still streaming", () => {
    const { dir, existing, done } = makeWorkspace();
    try {
      const def = captureTool(dir, dir);
      const out = row(
        def.renderCall({ path: existing, content: "a\nb\nc" }, theme, {
          state: {},
          argsComplete: false,
          outputPad: 1,
        }),
      );
      expect(out).toContain("(3 lines…)");
    } finally {
      done();
    }
  });

  it("reports a new file with its line count", () => {
    const { dir, fresh, done } = makeWorkspace();
    try {
      const def = captureTool(dir, dir);
      const out = row(
        def.renderResult(
          { content: [{ type: "text", text: "wrote" }], details: { _type: "new", lines: 4, content: "", filePath: fresh } },
          { expanded: false, isPartial: false },
          theme,
          { state: {}, isError: false, outputPad: 1 },
        ),
      );
      expect(out).toContain("[success:✓ new file (4 lines)]");
    } finally {
      done();
    }
  });

  it("says so when the write changed nothing", () => {
    const { dir, fresh, done } = makeWorkspace();
    try {
      const def = captureTool(dir, dir);
      const out = row(
        def.renderResult(
          { content: [{ type: "text", text: "wrote" }], details: { _type: "noChange" } },
          { expanded: false, isPartial: false },
          theme,
          { state: {}, isError: false, outputPad: 1 },
        ),
      );
      expect(out).toContain("✓ no changes");
    } finally {
      done();
    }
  });

  it("shows the failure text on an errored result", () => {
    const { dir, fresh, done } = makeWorkspace();
    try {
      const def = captureTool(dir, dir);
      const out = row(
        def.renderResult(
          { content: [{ type: "text", text: "EACCES: permission denied" }], details: undefined },
          { expanded: false, isPartial: false },
          theme,
          { state: {}, isError: true, outputPad: 1 },
        ),
      );
      expect(out).toContain("EACCES: permission denied");
    } finally {
      done();
    }
  });
});
