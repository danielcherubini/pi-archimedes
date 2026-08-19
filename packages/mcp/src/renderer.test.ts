import { describe, it, expect, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  renderDirectCall,
  renderDirectResult,
  renderProxyCall,
  renderProxyResult,
  extractServerName,
  formatProxyCallServer,
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
const SERVER = "postgres";
const ARGS = { schema: "public", table: "model_files" };
const RESULT = { content: [{ type: "text", text: "Hello\nWorld" }] };

// Line 1 header: blue bold "mcp" + orange server name.
const HEADER = `[toolTitle:**mcp**] [accent:${SERVER}]`;

function ctx(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...extra };
}

// ── extractServerName ────────────────────────────────────────────────────────

describe("extractServerName", () => {
  it("takes the first segment before the underscore", () => {
    expect(extractServerName("atlassian_searchJiraIssuesUsingJql")).toBe(
      "atlassian",
    );
    expect(extractServerName("postgres_describe_table")).toBe("postgres");
  });

  it("returns the whole name when there is no underscore", () => {
    expect(extractServerName("mcp")).toBe("mcp");
  });
});

// ── formatProxyCallServer ────────────────────────────────────────────────────

describe("formatProxyCallServer", () => {
  it("extracts the server from the tool name", () => {
    expect(formatProxyCallServer({ tool: "atlassian_search" })).toBe(
      "atlassian",
    );
  });

  it("prefers explicit args.server", () => {
    expect(formatProxyCallServer({ tool: "atlassian_search", server: "s1" })).toBe(
      "atlassian",
    );
    expect(formatProxyCallServer({ server: "s1" })).toBe("s1");
  });

  it("falls back to action words for non-tool calls", () => {
    expect(formatProxyCallServer({ search: "jira" })).toBe("search");
    expect(formatProxyCallServer({ describe: "t1" })).toBe("describe");
    expect(formatProxyCallServer({ connect: "s1" })).toBe("connect");
    expect(formatProxyCallServer({ action: "weird" })).toBe("weird");
    expect(formatProxyCallServer({})).toBe("status");
  });
});

// ── renderDirectCall ────────────────────────────────────────────────────────

describe("renderDirectCall", () => {
  const content = (c: unknown) => (c as unknown as MockTextShim).getContent();

  it("renders the header only: blue mcp + orange server name", () => {
    const out = renderDirectCall(TOOL, { ...ARGS }, theme, ctx());
    expect(content(out)).toBe(HEADER);
  });

  it("never throws — degrades to plain text when the theme throws", () => {
    const out = renderDirectCall(TOOL, { ...ARGS }, throwingTheme, ctx());
    expect(content(out)).toBe(`mcp ${TOOL}`);
  });

  it("reuses the lastComponent instance", () => {
    const last = new MockText("stale");
    const out = renderDirectCall(TOOL, { ...ARGS }, theme, ctx({ lastComponent: last }));
    expect(out).toBe(last);
    expect(content(out)).toBe(HEADER);
  });
});

// ── renderDirectResult ──────────────────────────────────────────────────────

describe("renderDirectResult", () => {
  const content = (c: unknown) => (c as unknown as MockTextShim).getContent();

  it("collapsed success: green tick + muted tool name, NO result text", () => {
    const out = renderDirectResult(
      TOOL,
      RESULT,
      { expanded: false },
      theme,
      ctx({ isError: false, args: { ...ARGS } }),
    );
    expect(content(out)).toBe(`[success:✓ ][muted:${TOOL}]`);
    expect(content(out)).not.toContain("Hello");
  });

  it("collapsed error: red cross + muted tool name", () => {
    const out = renderDirectResult(
      TOOL,
      RESULT,
      { expanded: false },
      theme,
      ctx({ isError: true, args: { ...ARGS } }),
    );
    expect(content(out)).toBe(`[error:✗ ][muted:${TOOL}]`);
  });

  it("isPartial: running glyph (muted) + muted tool name, no content", () => {
    const out = renderDirectResult(
      TOOL,
      RESULT,
      { isPartial: true },
      theme,
      ctx({ isError: false, args: { ...ARGS } }),
    );
    expect(content(out)).toBe(`[muted:▸ ][muted:${TOOL}]`);
  });

  it("expanded success: dim args JSON + blank line + full text", () => {
    const out = renderDirectResult(
      TOOL,
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
      TOOL,
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
      TOOL,
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

  it("expanded honours context.expanded when options.expanded is unset", () => {
    const out = renderDirectResult(
      TOOL,
      RESULT,
      {},
      theme,
      ctx({ isError: false, expanded: true, args: { ...ARGS } }),
    );
    expect(content(out)).toContain("[toolOutput:Hello]");
  });

  it("never throws — degrades to empty text when the theme throws", () => {
    const out = renderDirectResult(
      TOOL,
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
      TOOL,
      RESULT,
      { expanded: false },
      theme,
      ctx({ isError: false, args: { ...ARGS }, lastComponent: last }),
    );
    expect(out).toBe(last);
    expect(content(out)).toBe(`[success:✓ ][muted:${TOOL}]`);
  });
});

// ── renderProxyCall (gateway) ───────────────────────────────────────────────

describe("renderProxyCall", () => {
  const content = (c: unknown) => (c as unknown as MockTextShim).getContent();
  const PROXY_ARGS = {
    tool: "postgres_describe_table",
    args: { table: "model_files" },
  };

  it("renders the header: blue mcp + orange server (from tool name)", () => {
    const out = renderProxyCall({ ...PROXY_ARGS }, theme, ctx());
    expect(content(out)).toBe(HEADER);
  });

  it("search action: header shows the action word", () => {
    const out = renderProxyCall({ search: "jira" }, theme, ctx());
    expect(content(out)).toBe("[toolTitle:**mcp**] [accent:search]");
  });

  it("never throws — degrades to plain 'mcp' when the theme throws", () => {
    const out = renderProxyCall({ ...PROXY_ARGS }, throwingTheme, ctx());
    expect(content(out)).toBe("mcp");
  });
});

// ── renderProxyResult (gateway) ─────────────────────────────────────────────

describe("renderProxyResult", () => {
  const content = (c: unknown) => (c as unknown as MockTextShim).getContent();
  const PROXY_CONTEXT_ARGS = {
    tool: "postgres_describe_table",
    args: { sql: "SELECT 1" },
  };

  it("collapsed success: green tick + muted tool name", () => {
    const out = renderProxyResult(
      { content: [{ type: "text", text: "out" }] },
      { expanded: false },
      theme,
      ctx({ isError: false, args: { ...PROXY_CONTEXT_ARGS } }),
    );
    expect(content(out)).toBe(`[success:✓ ][muted:postgres_describe_table]`);
  });

  it("collapsed error: red cross + muted tool name", () => {
    const out = renderProxyResult(
      { content: [{ type: "text", text: "out" }] },
      { expanded: false },
      theme,
      ctx({ isError: true, args: { ...PROXY_CONTEXT_ARGS } }),
    );
    expect(content(out)).toBe(`[error:✗ ][muted:postgres_describe_table]`);
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
    expect(content(out)).not.toContain("describe_table\"");
  });

  it("no tool name (search action): falls back to 'mcp'", () => {
    const out = renderProxyResult(
      { content: [{ type: "text", text: "ok" }] },
      { expanded: false },
      theme,
      ctx({ isError: false, args: { search: "jira" } }),
    );
    expect(content(out)).toBe(`[success:✓ ][muted:mcp]`);
  });
});
