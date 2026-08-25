/**
 * Tests for the management panel's pure helpers (plan-027, Task 3).
 *
 * Only the pure, unrendered logic is unit-tested here — the overlay
 * component itself is exercised by the deferred live-TUI manual test.
 *
 *   - buildVisibleRows: flat list of visible rows (collapsed → servers only;
 *     expanded → server rows interleaved with their tool rows, in order)
 *   - filterRows: substring narrowing over name + tool name/description
 *     (case-insensitive; empty query passes the array through unchanged)
 *   - toggleTool: flips isDirect without touching wasDirect
 *   - computeSelection: the per-server save value (true / false / subset)
 *   - openMcpPanel (defensive): opens the panel with an UNVALIDATED
 *     (JSON-shaped) non-boolean non-array directTools — no throw, boolean
 *     row results (the panel is the config's trust boundary)
 */
import { describe, expect, it } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { openMcpPanel } from "./panel.js";
import {
  buildVisibleRows,
  computeSelection,
  filterRows,
  toggleTool,
  type ServerRow,
  type ToolRow,
  type VisibleRow,
} from "./panel-rows.js";
import type { ServerManager } from "./server-manager.js";
import type { ServerDef } from "./types.js";

// ── fixtures ─────────────────────────────────────────────────────────────────

function tool(
  name: string,
  description: string = "",
  isDirect: boolean = true,
  wasDirect: boolean | undefined = undefined,
): ToolRow {
  return { name, description, isDirect, wasDirect: wasDirect ?? isDirect };
}

function server(name: string, opts?: { expanded?: boolean; tools?: ToolRow[] }): ServerRow {
  return {
    name,
    expanded: opts?.expanded ?? false,
    status: "cached",
    tools: opts?.tools ?? [],
    hasCachedData: false,
  };
}

function kinds(rows: VisibleRow[]): string[] {
  return rows.map((r) => r.kind);
}

// ── buildVisibleRows ─────────────────────────────────────────────────────────

describe("buildVisibleRows", () => {
  it("shows only server rows (in order) when everything is collapsed", () => {
    const rows = buildVisibleRows([
      server("alpha", { tools: [tool("a1"), tool("a2")] }),
      server("beta", { tools: [tool("b1")] }),
    ]);
    expect(rows.map((r) => (r.kind === "server" ? r.server.name : "tool"))).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("returns an empty list for no servers", () => {
    expect(buildVisibleRows([])).toEqual([]);
  });

  it("interleaves tool rows after the expanded server's row, in order", () => {
    const a1 = tool("a1");
    const a2 = tool("a2");
    const rows = buildVisibleRows([
      server("alpha", { expanded: true, tools: [a1, a2] }),
      server("beta"),
    ]);
    expect(kinds(rows)).toEqual(["server", "tool", "tool", "server"]);
    const byServer = (r: VisibleRow) => r.server.name;
    const names = rows.map((r) => (r.kind === "tool" ? r.tool.name : r.server.name));
    expect(names).toEqual(["alpha", "a1", "a2", "beta"]);
    // Tool rows reference the right parent server
    expect(byServer(rows[1]!)).toBe("alpha");
    const third = rows[2];
    expect(third?.kind).toBe("tool");
    if (third?.kind === "tool") expect(third.tool).toBe(a2);
  });

  it("interleaves only for expanded servers, crossing server boundaries", () => {
    const rows = buildVisibleRows([
      server("first"),
      server("mid", { expanded: true, tools: [tool("m1")] }),
      server("last", { expanded: true, tools: [tool("l1"), tool("l2")] }),
    ]);
    expect(rows.map((r) => (r.kind === "tool" ? r.tool.name : r.server.name))).toEqual([
      "first",
      "mid",
      "m1",
      "last",
      "l1",
      "l2",
    ]);
  });

  it("collapsed server with tools hides all its tool rows", () => {
    const rows = buildVisibleRows([server("solo", { tools: [tool("s1"), tool("s2")] })]);
    expect(rows).toHaveLength(1);
    expect(kinds(rows)).toEqual(["server"]);
  });
});

// ── filterRows ───────────────────────────────────────────────────────────────

describe("filterRows", () => {
  const servers = [
    server("filesystem", {
      tools: [tool("fs_read", "Read a file"), tool("fs_write", "Write a file")],
    }),
    server("postgres", {
      tools: [tool("query", "Run a SQL query"), tool("explain", "")],
    }),
    server("github", { tools: [tool("search_issues", "Find issues")] }),
  ];

  it("passes the same array through for an empty query", () => {
    expect(filterRows(servers, "")).toBe(servers);
  });

  it("narrows by server name, case-insensitively", () => {
    const filtered = filterRows(servers, "FILE");
    expect(filtered.map((s) => s.name)).toEqual(["filesystem"]);
  });

  it("keeps a server when a tool NAME matches, even if the server name doesn't", () => {
    const filtered = filterRows(servers, "issues");
    expect(filtered.map((s) => s.name)).toEqual(["github"]);
  });

  it("keeps a server when a tool DESCRIPTION matches", () => {
    const filtered = filterRows(servers, "sql query");
    expect(filtered.map((s) => s.name)).toEqual(["postgres"]);
  });

  it("is case-insensitive over descriptions too", () => {
    const filtered = filterRows(servers, "WRITE");
    expect(filtered.map((s) => s.name)).toEqual(["filesystem"]);
  });

  it("returns [] when nothing matches", () => {
    expect(filterRows(servers, "no-such-thing")).toEqual([]);
  });

  it("matches multiple servers", () => {
    const filtered = filterRows(servers, "fs_");
    expect(filtered.map((s) => s.name)).toEqual(["filesystem"]);
    const both = filterRows(servers, "e"); // present in many names/descriptions
    expect(both.length).toBeGreaterThanOrEqual(2);
  });

  it("never mutates the input servers (statuses keep reporting the full tree)", () => {
    const copy = servers.map((s) => ({ ...s }));
    filterRows(copy, "query");
    // Input still has all instances intact
    expect(copy).toHaveLength(3);
  });
});

// ── toggleTool ───────────────────────────────────────────────────────────────

describe("toggleTool", () => {
  it("flips isDirect from true to false", () => {
    const t = tool("x", "desc", true, false);
    toggleTool(t);
    expect(t.isDirect).toBe(false);
  });

  it("flips isDirect from false to true", () => {
    const t = tool("x", "desc", false, true);
    toggleTool(t);
    expect(t.isDirect).toBe(true);
  });

  it("does not touch wasDirect (dirty tracking baseline)", () => {
    const t = tool("x", "desc", true, false);
    toggleTool(t);
    toggleTool(t);
    expect(t.wasDirect).toBe(false);
  });

  it("does not touch name or description", () => {
    const t = tool("x", "the desc", true);
    toggleTool(t);
    expect(t.name).toBe("x");
    expect(t.description).toBe("the desc");
  });
});

// ── computeSelection ─────────────────────────────────────────────────────────

describe("computeSelection", () => {
  it("returns true when all tools are direct", () => {
    expect(computeSelection([tool("a", "", true), tool("b", "", true)])).toBe(true);
  });

  it("returns false when no tools are direct", () => {
    expect(computeSelection([tool("a", "", false), tool("b", "", false)])).toBe(false);
  });

  it("returns the exact direct-name subset (in row order) when mixed", () => {
    expect(computeSelection([
      tool("a", "", true),
      tool("b", "", false),
      tool("c", "", true),
      tool("d", "", false),
    ])).toEqual(["a", "c"]);
  });

  it("returns the subset with a single direct tool", () => {
    expect(computeSelection([tool("a", "", false), tool("b", "", true)])).toEqual(["b"]);
  });

  it("treats the empty tool list as 'all direct' (true)", () => {
    expect(computeSelection([])).toBe(true);
  });
});

// ── openMcpPanel: defensive config guard ──────────────────────────────

interface PanelLike {
  render(width: number): string[];
  handleInput(data: string): void;
}

/**
 * Minimal ctx stub for openMcpPanel: `custom` synchronously drives the
 * overlay create-callback with no-op tui/theme doubles and captures the
 * component. No module mocking — the panel's injected deps carry the
 * scenario.
 */
function fakePanelCtx(capture: (panel: PanelLike) => void): ExtensionCommandContext {
  const ctx = {
    hasUI: true,
    cwd: process.cwd(),
    ui: {
      notify: () => {},
      custom: async (
        create: (tui: unknown, theme: unknown, kb: unknown, done: () => void) => unknown,
      ) => {
        const panel = create(
          { requestRender: () => {} },
          { fg: (_color: string, text: string) => text },
          null,
          () => {},
        );
        capture(panel as PanelLike);
      },
    },
  };
  return ctx as unknown as ExtensionCommandContext;
}

describe("openMcpPanel (malformed directTools)", () => {
  it("survives a non-boolean non-array directTools (unvalidated JSON) and resolves boolean rows", async () => {
    // Simulates a hand-edited mcp.json: directTools parses to a number —
    // neither boolean nor string[]. Old code threw (n.includes is not
    // a function) inside panel-open; the guard keeps it alive.
    const defs: Record<string, ServerDef> = {
      "mangled-direct-tools-srv": {
        command: "cmd",
        args: [],
        directTools: 42 as unknown as boolean | string[],
      },
    };
    const panels: PanelLike[] = [];
    const ctx = fakePanelCtx((p) => panels.push(p));

    await openMcpPanel({} as unknown as ExtensionAPI, ctx, {
      getServerDefs: () => defs,
      getCachedTools: () => [{ name: "t1", description: "d", inputSchema: {} }],
      getManager: () => ({ getClient: () => undefined } as unknown as ServerManager),
    });

    const panel = panels[0];
    if (!panel) throw new Error("panel component was not created");

    // Expand (raw enter), then inspect rendered rows: isDirect must have
    // resolved to a boolean. A non-boolean non-array is "not false" → all
    // direct → "1/1".
    panel.handleInput("\r");
    const lines = panel.render(84);
    expect(lines.some((l) => l.includes("(1/1 tools)"))).toBe(true);
    expect(lines.some((l) => l.includes("● t1"))).toBe(true);
  });
});
