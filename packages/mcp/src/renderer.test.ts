import { describe, it, expect, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  renderDirectCall,
  renderDirectResult,
  renderProxyCall,
  renderProxyResult,
  formatProxyCallTitle,
} from "./renderer.js";

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@earendil-works/pi-tui", () => {
  class MockText {
    private _content = "";

    constructor(initial: string = "") {
      this._content = initial;
    }

    setText(content: string): void {
      this._content = content;
    }

    getContent(): string {
      return this._content;
    }
  }
  return {
    Text: MockText,
  };
});

// Same class the renderer's `instanceof Text` check sees (the mock).
import { Text as MockText } from "@earendil-works/pi-tui";

/** The runtime mock exposes getContent(); the real Text type does not. */
type MockTextShim = { getContent(): string };

// Fake theme: wraps text in visible markers so assertions can verify which
// color token each fragment used.
const theme = {
  fg: (token: string, text?: string) =>
    text === undefined ? `[${token}]` : `[${token}:${text}]`,
  bold: (text: string) => `**${text}**`,
} as unknown as Theme;

// A theme whose fg() throws — renderers must never propagate errors.
const throwingTheme = {
  fg: () => {
    throw new Error("theme exploded");
  },
  bold: (text: string) => text,
} as unknown as Theme;

// ── Shared fixtures ─────────────────────────────────────────────────────────

const TOOL = "postgres_describe_table";
const ARGS = { schema: "public", table: "model_files" };
const RESULT = { content: [{ type: "text", text: "Hello\nWorld" }] };

// Expected fragments (fake-theme markers; the dim fragment is ": value",
// hence the doubled colon in `[dim:: …]`).
const HEADER = `[toolTitle:**mcp**] [accent:${TOOL}]`;
const SUMMARY_SUCCESS =
  "[muted:→ ][success:table][dim:: model_files][muted: (ctrl+o)]";
const SUMMARY_RUNNING = "[muted:→ ][muted:table][dim:: model_files]";

function ctx(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...extra };
}

// ── formatProxyCallTitle (unchanged behavior) ───────────────────────────────

describe("formatProxyCallTitle", () => {
  it("formats the gateway action words", () => {
    expect(formatProxyCallTitle({ tool: "t1", server: "s1" })).toBe(
      "call t1 @ s1",
    );
    expect(formatProxyCallTitle({ tool: "t1" })).toBe("call t1");
    expect(formatProxyCallTitle({ search: "jira", server: "s1" })).toBe(
      "search jira @ s1",
    );
    expect(formatProxyCallTitle({ describe: "t1" })).toBe("describe t1");
    expect(formatProxyCallTitle({ connect: "s1" })).toBe("connect s1");
    expect(formatProxyCallTitle({ server: "s1" })).toBe("list s1");
    expect(formatProxyCallTitle({})).toBe("status");
    expect(formatProxyCallTitle({ action: "weird" })).toBe("weird");
  });
});

// ── renderDirectCall ────────────────────────────────────────────────────────

describe("renderDirectCall", () => {
  const content = (c: unknown) => (c as unknown as MockTextShim).getContent();

  it("running with complete args: header + muted summary, no hint", () => {
    const out = renderDirectCall(
      TOOL,
      { ...ARGS },
      theme,
      ctx({ isPartial: true, argsComplete: true }),
    );
    expect(content(out)).toBe(`${HEADER}\n${SUMMARY_RUNNING}`);
  });

  it("settled (isPartial false): header only — result renderer owns line 2", () => {
    const out = renderDirectCall(
      TOOL,
      { ...ARGS },
      theme,
      ctx({ isPartial: false, argsComplete: true }),
    );
    expect(content(out)).toBe(HEADER);
  });

  it("args still streaming (argsComplete false): header only", () => {
    const out = renderDirectCall(
      TOOL,
      { ...ARGS },
      theme,
      ctx({ isPartial: true, argsComplete: false }),
    );
    expect(content(out)).toBe(HEADER);
  });

  it("missing context fields (older pi): treated as running, summary shown", () => {
    const out = renderDirectCall(TOOL, { ...ARGS }, theme, ctx());
    expect(content(out)).toBe(`${HEADER}\n${SUMMARY_RUNNING}`);
  });

  it("no key arg: header only, even while running", () => {
    const out = renderDirectCall(
      TOOL,
      {},
      theme,
      ctx({ isPartial: true, argsComplete: true }),
    );
    expect(content(out)).toBe(HEADER);
  });

  it("never throws — degrades to plain text when the theme throws", () => {
    const out = renderDirectCall(
      TOOL,
      { ...ARGS },
      throwingTheme,
      ctx({ isPartial: true, argsComplete: true }),
    );
    expect(content(out)).toBe(`mcp ${TOOL}`);
  });

  it("reuses the lastComponent instance", () => {
    const last = new MockText("stale");
    const out = renderDirectCall(
      TOOL,
      { ...ARGS },
      theme,
      ctx({ isPartial: true, argsComplete: true, lastComponent: last }),
    );
    expect(out).toBe(last);
    expect(content(out)).toBe(`${HEADER}\n${SUMMARY_RUNNING}`);
  });
});

// ── renderDirectResult ──────────────────────────────────────────────────────

describe("renderDirectResult", () => {
  const content = (c: unknown) => (c as unknown as MockTextShim).getContent();

  it("collapsed success: green summary + hint, NO result text", () => {
    const out = renderDirectResult(
      RESULT,
      { expanded: false },
      theme,
      ctx({ isError: false, args: { ...ARGS } }),
    );
    expect(content(out)).toBe(SUMMARY_SUCCESS);
    expect(content(out)).not.toContain("Hello");
    expect(content(out)).not.toContain("World");
  });

  it("collapsed error (isError): red summary, same shape", () => {
    const out = renderDirectResult(
      RESULT,
      { expanded: false },
      theme,
      ctx({ isError: true, args: { ...ARGS } }),
    );
    expect(content(out)).toBe(
      "[muted:→ ][error:table][dim:: model_files][muted: (ctrl+o)]",
    );
  });

  it("no key arg (empty args): empty collapsed result", () => {
    const out = renderDirectResult(
      RESULT,
      { expanded: false },
      theme,
      ctx({ isError: false, args: {} }),
    );
    expect(content(out)).toBe("");
  });

  it("isPartial guard: running-state summary (muted, no hint), no content", () => {
    const out = renderDirectResult(
      RESULT,
      { isPartial: true },
      theme,
      ctx({ isError: false, args: { ...ARGS } }),
    );
    expect(content(out)).toBe(SUMMARY_RUNNING);
  });

  it("expanded success: dim args JSON + blank line + full text", () => {
    const out = renderDirectResult(
      RESULT,
      { expanded: true },
      theme,
      ctx({ isError: false, args: { ...ARGS } }),
    );
    expect(content(out)).toBe(
      `[dim:{\n  "schema": "public",\n  "table": "model_files"\n}]\n\n` +
        `[toolOutput:Hello]\n[toolOutput:World]`,
    );
  });

  it("expanded error: full text in error colour", () => {
    const out = renderDirectResult(
      { content: [{ type: "text", text: "boom" }] },
      { expanded: true },
      theme,
      ctx({ isError: true, args: { ...ARGS } }),
    );
    expect(content(out)).toBe(
      `[dim:{\n  "schema": "public",\n  "table": "model_files"\n}]\n\n[error:boom]`,
    );
  });

  it("expanded empty content: (empty result) after the args block", () => {
    const out = renderDirectResult(
      { content: [] },
      { expanded: true },
      theme,
      ctx({ isError: false, args: { ...ARGS } }),
    );
    expect(content(out)).toBe(
      `[dim:{\n  "schema": "public",\n  "table": "model_files"\n}]\n\n` +
        `[muted:(empty result)]`,
    );
  });

  it("expanded with empty args: text only, no args block", () => {
    const out = renderDirectResult(
      RESULT,
      { expanded: true },
      theme,
      ctx({ isError: false, args: {} }),
    );
    expect(content(out)).toBe("[toolOutput:Hello]\n[toolOutput:World]");
  });

  it("expanded honours context.expanded when options.expanded is unset", () => {
    const out = renderDirectResult(
      RESULT,
      {},
      theme,
      ctx({ isError: false, expanded: true, args: { ...ARGS } }),
    );
    expect(content(out)).toContain("[toolOutput:Hello]");
  });

  it("never throws — degrades to empty text when the theme throws", () => {
    const out = renderDirectResult(
      RESULT,
      { expanded: false },
      throwingTheme,
      ctx({ isError: false, args: { ...ARGS } }),
    );
    expect(content(out)).toBe("");
  });

  it("reuses the lastComponent instance", () => {
    const last = new MockText("stale");
    const out = renderDirectResult(
      RESULT,
      { expanded: false },
      theme,
      ctx({ isError: false, args: { ...ARGS }, lastComponent: last }),
    );
    expect(out).toBe(last);
    expect(content(out)).toBe(SUMMARY_SUCCESS);
  });
});

// ── renderProxyCall (gateway) ───────────────────────────────────────────────

describe("renderProxyCall", () => {
  const content = (c: unknown) => (c as unknown as MockTextShim).getContent();
  const PROXY_ARGS = {
    tool: "describe_table",
    server: "postgres",
    args: { table: "model_files" },
  };
  const PROXY_HEADER = "[toolTitle:**mcp**] [accent:call describe_table @ postgres]";

  it("running: action header + summary from the nested args.args", () => {
    const out = renderProxyCall(
      { ...PROXY_ARGS },
      theme,
      ctx({ isPartial: true, argsComplete: true }),
    );
    expect(content(out)).toBe(`${PROXY_HEADER}\n${SUMMARY_RUNNING}`);
  });

  it("settled: header only", () => {
    const out = renderProxyCall(
      { ...PROXY_ARGS },
      theme,
      ctx({ isPartial: false, argsComplete: true }),
    );
    expect(content(out)).toBe(PROXY_HEADER);
  });

  it("no nested args.args (search action): header only", () => {
    const out = renderProxyCall(
      { search: "jira" },
      theme,
      ctx({ isPartial: true, argsComplete: true }),
    );
    expect(content(out)).toBe("[toolTitle:**mcp**] [accent:search jira]");
  });

  it("args.args as a JSON string: no summary (not a plain object)", () => {
    const out = renderProxyCall(
      { tool: "t1", args: '{"table":"x"}' },
      theme,
      ctx({ isPartial: true, argsComplete: true }),
    );
    expect(content(out)).toBe("[toolTitle:**mcp**] [accent:call t1]");
  });

  it("never throws — degrades to plain 'mcp' when the theme throws", () => {
    const out = renderProxyCall(
      { ...PROXY_ARGS },
      throwingTheme,
      ctx({ isPartial: true, argsComplete: true }),
    );
    expect(content(out)).toBe("mcp");
  });
});

// ── renderProxyResult (gateway) ─────────────────────────────────────────────

describe("renderProxyResult", () => {
  const content = (c: unknown) => (c as unknown as MockTextShim).getContent();
  const PROXY_CONTEXT_ARGS = {
    tool: "describe_table",
    server: "postgres",
    args: { sql: "SELECT 1" },
  };

  it("collapsed success: summary from the nested args.args, with hint", () => {
    const out = renderProxyResult(
      { content: [{ type: "text", text: "out" }] },
      { expanded: false },
      theme,
      ctx({ isError: false, args: { ...PROXY_CONTEXT_ARGS } }),
    );
    expect(content(out)).toBe(
      "[muted:→ ][success:sql][dim:: SELECT 1][muted: (ctrl+o)]",
    );
  });

  it("expanded: formats ONLY the nested args.args (not the gateway args)", () => {
    const out = renderProxyResult(
      { content: [{ type: "text", text: "out" }] },
      { expanded: true },
      theme,
      ctx({ isError: false, args: { ...PROXY_CONTEXT_ARGS } }),
    );
    expect(content(out)).toBe(
      `[dim:{\n  "sql": "SELECT 1"\n}]\n\n[toolOutput:out]`,
    );
    expect(content(out)).not.toContain("describe_table");
  });

  it("no nested args.args: empty collapsed result", () => {
    const out = renderProxyResult(
      { content: [{ type: "text", text: "ok" }] },
      { expanded: false },
      theme,
      ctx({ isError: false, args: { search: "jira" } }),
    );
    expect(content(out)).toBe("");
  });
});
