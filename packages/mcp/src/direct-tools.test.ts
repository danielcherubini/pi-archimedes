import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  clearRegisteredForTest,
  filterDirectTools,
  getRegisteredNamesForTest,
  pruneRegisteredNames,
  registerDirectTools,
} from "./direct-tools.js";
import type { ServerClient } from "./server-client.js";
import type { CachedTool } from "./types.js";

// ── fakes ────────────────────────────────────────────────────────────────────

/** Minimal tool definition surface captured from pi.registerTool */
interface CapturedTool {
  name: string;
  label: string;
  description: string;
  execute?: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
  ) => Promise<unknown>;
}

function makeFakePi(): { pi: ExtensionAPI; defs: CapturedTool[] } {
  const defs: CapturedTool[] = [];
  const pi = {
    on: () => {},
    registerTool: (def: CapturedTool) => {
      defs.push(def);
    },
  } as unknown as ExtensionAPI;
  return { pi, defs };
}

/** Minimal ServerClient fake — only the surface the executor touches */
function makeFakeClient(
  name: string,
  calls: Array<{ tool: string; args: Record<string, unknown> }>,
): ServerClient {
  const fake = {
    name,
    tools: [] as Array<{ name: string }>,
    async connect(): Promise<void> {},
    async callTool(
      toolName: string,
      args: Record<string, unknown>,
    ): Promise<{ content: Array<{ type: string; text: string }>; isError: boolean }> {
      calls.push({ tool: toolName, args });
      return { content: [{ type: "text", text: `result:${toolName}` }], isError: false };
    },
  };
  return fake as unknown as ServerClient;
}

const TOOLS: CachedTool[] = [
  { name: "alpha", description: "Alpha tool", inputSchema: {} },
  { name: "beta", inputSchema: {} },
  { name: "gamma", description: "Gamma tool", inputSchema: {} },
];

const resolveClient = (client: ServerClient) => async (name: string): Promise<ServerClient> => {
  if (name !== client.name) throw new Error(`Unexpected server: ${name}`);
  return client;
};

// ── filterDirectTools ────────────────────────────────────────────────────────

describe("filterDirectTools", () => {
  it("exposes all tools when directTools is true with no include/exclude", () => {
    const out = filterDirectTools(TOOLS, { directTools: true });
    expect(out.map((t) => t.name)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("exposes nothing when directTools is false", () => {
    const out = filterDirectTools(TOOLS, { directTools: false });
    expect(out).toEqual([]);
  });

  it("restricts to a subset when directTools is a string[]", () => {
    const out = filterDirectTools(TOOLS, { directTools: ["beta", "nope"] });
    expect(out.map((t) => t.name)).toEqual(["beta"]);
  });

  it("intersects with includeTools", () => {
    const out = filterDirectTools(TOOLS, {
      directTools: true,
      includeTools: ["alpha", "gamma", "nope"],
    });
    expect(out.map((t) => t.name)).toEqual(["alpha", "gamma"]);
  });

  it("subtracts excludeTools", () => {
    const out = filterDirectTools(TOOLS, {
      directTools: true,
      excludeTools: ["beta", "nope"],
    });
    expect(out.map((t) => t.name)).toEqual(["alpha", "gamma"]);
  });

  it("applies directTools subset, then includeTools, then excludeTools", () => {
    const out = filterDirectTools(TOOLS, {
      directTools: ["alpha", "beta", "gamma"],
      includeTools: ["alpha", "beta"],
      excludeTools: ["beta"],
    });
    expect(out.map((t) => t.name)).toEqual(["alpha"]);
  });
});

// ── registerDirectTools ──────────────────────────────────────────────────────

describe("registerDirectTools", () => {
  beforeEach(() => {
    clearRegisteredForTest();
  });

  it("registers each tool under its prefixed name with server-scoped description", () => {
    const { pi, defs } = makeFakePi();
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const registered = registerDirectTools(pi, {
      serverName: "myserver",
      prefix: "server",
      tools: TOOLS,
      getCollapsedLines: () => 3,
      resolveClient: resolveClient(makeFakeClient("myserver", calls)),
    });

    expect(registered).toEqual(["myserver_alpha", "myserver_beta", "myserver_gamma"]);
    expect(defs.map((d) => d.name)).toEqual(registered);
    const alpha = defs.find((d) => d.name === "myserver_alpha");
    expect(alpha?.label).toBe("MCP: alpha");
    expect(alpha?.description).toContain("[myserver]");
    expect(alpha?.description).toContain("Alpha tool");
  });

  it("skips tools whose prefixed name collides with a pi builtin and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { pi, defs } = makeFakePi();
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const registered = registerDirectTools(pi, {
      serverName: "srv",
      prefix: "none",
      tools: [
        { name: "read", description: "shadows builtin", inputSchema: {} },
        { name: "search", description: "fine", inputSchema: {} },
      ],
      getCollapsedLines: () => 3,
      resolveClient: resolveClient(makeFakeClient("srv", calls)),
    });

    expect(registered).toEqual(["search"]);
    expect(defs.map((d) => d.name)).toEqual(["search"]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('skipping tool "read"'),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("collides with a built-in tool name"),
    );
    warn.mockRestore();
  });

  it("does not double-register when the same server is registered twice", () => {
    const { pi, defs } = makeFakePi();
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const opts = {
      serverName: "srv",
      prefix: "server" as const,
      tools: TOOLS,
      getCollapsedLines: () => 3,
      resolveClient: resolveClient(makeFakeClient("srv", calls)),
    };
    const first = registerDirectTools(pi, opts);
    const second = registerDirectTools(pi, opts);
    expect(second).toEqual(first);
    // No duplicates in the pi registry despite two registration passes
    const names = defs.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(["srv_alpha", "srv_beta", "srv_gamma"]);
  });

  it("evicts stale names when a later pass registers a smaller tool list", () => {
    const { pi } = makeFakePi();
    const base = {
      serverName: "srv",
      prefix: "server" as const,
      getCollapsedLines: () => 3,
    };
    // Pass 1: full tool list
    registerDirectTools(pi, {
      ...base,
      tools: TOOLS,
      resolveClient: resolveClient(makeFakeClient("srv", [])),
    });
    expect([...getRegisteredNamesForTest().get("srv")!].sort()).toEqual([
      "srv_alpha",
      "srv_beta",
      "srv_gamma",
    ]);

    // Pass 2: the server's tool list shrank — the tracked set must reflect
    // ONLY this pass's names, so a later session_start can re-register the
    // evicted tools (pi itself cannot unregister them).
    registerDirectTools(pi, {
      ...base,
      tools: [TOOLS[0]!],
      resolveClient: resolveClient(makeFakeClient("srv", [])),
    });
    expect([...getRegisteredNamesForTest().get("srv")!].sort()).toEqual(["srv_alpha"]);
  });

  it("dedupes across servers: a name claimed by one server blocks another", () => {
    const { pi, defs } = makeFakePi();
    const tool = { name: "x", inputSchema: {} };
    registerDirectTools(pi, {
      serverName: "s1",
      prefix: "none",
      tools: [tool],
      getCollapsedLines: () => 3,
      resolveClient: resolveClient(makeFakeClient("s1", [])),
    });
    // Same raw tool name from a different server, prefix "none" → identical
    // final name; the second server must not double-register it (the name is
    // still reported, matching the repeated-pass contract)
    const registered = registerDirectTools(pi, {
      serverName: "s2",
      prefix: "none",
      tools: [tool],
      getCollapsedLines: () => 3,
      resolveClient: resolveClient(makeFakeClient("s2", [])),
    });
    expect(registered).toEqual(["x"]);
    expect(defs.filter((d) => d.name === "x")).toHaveLength(1);
  });

  it("pruneRegisteredNames evicts removed servers so their names are re-claimable", () => {
    const { pi, defs } = makeFakePi();
    const tool = { name: "foo", inputSchema: {} };
    // Server A (prefix "none") claims the bare final name "foo"
    registerDirectTools(pi, {
      serverName: "A",
      prefix: "none",
      tools: [tool],
      getCollapsedLines: () => 3,
      resolveClient: resolveClient(makeFakeClient("A", [])),
    });
    expect(defs.map((d) => d.name)).toEqual(["foo"]);
    expect(getRegisteredNamesForTest().has("A")).toBe(true);

    // A is removed; B is active. Without pruning, B's identical final name
    // would be silently dropped by isClaimed("foo").
    pruneRegisteredNames(new Set(["B"]));
    expect(getRegisteredNamesForTest().has("A")).toBe(false);

    const second = registerDirectTools(pi, {
      serverName: "B",
      prefix: "none",
      tools: [tool],
      getCollapsedLines: () => 3,
      resolveClient: resolveClient(makeFakeClient("B", [])),
    });
    expect(second).toEqual(["foo"]);
    expect(defs.filter((d) => d.name === "foo")).toHaveLength(2);
  });

  it("pruneRegisteredNames keeps active servers' entries", () => {
    registerDirectTools({ on: () => {}, registerTool: () => {} } as unknown as ExtensionAPI, {
      serverName: "A",
      prefix: "server",
      tools: [TOOLS[0]!],
      getCollapsedLines: () => 3,
      resolveClient: async () => makeFakeClient("A", []),
    });
    pruneRegisteredNames(new Set(["A", "B"]));
    expect([...getRegisteredNamesForTest().get("A")!]).toEqual(["A_alpha"]);
  });

  it("warns once per server when two raw tools format to the same final name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { pi } = makeFakePi();
    const tools = [
      { name: "a.b", inputSchema: {} },
      { name: "a_b", inputSchema: {} },
      { name: "plain", inputSchema: {} },
    ];
    const opts = {
      serverName: "srv",
      prefix: "server" as const,
      tools,
      getCollapsedLines: () => 3,
      resolveClient: resolveClient(makeFakeClient("srv", [])),
    };
    const collisionWarns = () =>
      warn.mock.calls
        .map((c) => String(c[0]))
        .filter((s) => s.includes("both format to"));

    registerDirectTools(pi, opts);
    expect(collisionWarns()).toHaveLength(1);
    expect(collisionWarns()[0]).toContain("a.b");
    expect(collisionWarns()[0]).toContain("a_b");
    expect(collisionWarns()[0]).toContain("srv_a_b");

    // A repeated registration pass must not re-warn for the same collision
    registerDirectTools(pi, opts);
    expect(collisionWarns()).toHaveLength(1);
    warn.mockRestore();
  });

  it("resolves the client lazily at call time, not at registration", async () => {
    const { pi, defs } = makeFakePi();
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const resolveSpy = vi.fn(resolveClient(makeFakeClient("srv", calls)));
    registerDirectTools(pi, {
      serverName: "srv",
      prefix: "server",
      tools: [TOOLS[0]!],
      getCollapsedLines: () => 3,
      resolveClient: resolveSpy,
    });

    // No connection attempt during registration
    expect(resolveSpy).not.toHaveBeenCalled();

    const result = (await defs[0]!.execute!("call-1", { q: 42 })) as {
      content: Array<{ type: string; text: string }>;
      details: { server: string; tool: string };
      isError: boolean;
    };

    // Exactly one lazy resolution, with the owning server name
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy).toHaveBeenCalledWith("srv");
    // The RAW tool name is forwarded to the server, args passed through
    expect(calls).toEqual([{ tool: "alpha", args: { q: 42 } }]);
    expect(result.content).toEqual([{ type: "text", text: "result:alpha" }]);
    expect(result.details).toEqual({ server: "srv", tool: "alpha" });
    expect(result.isError).toBe(false);
  });

  it("surfaces resolveClient failures as tool errors", async () => {
    const { pi, defs } = makeFakePi();
    registerDirectTools(pi, {
      serverName: "gone",
      prefix: "server",
      tools: [TOOLS[0]!],
      getCollapsedLines: () => 3,
      resolveClient: async () => {
        throw new Error('Server "gone" is no longer configured');
      },
    });
    await expect(defs[0]!.execute!("call-1", {})).rejects.toThrow(
      /no longer configured/,
    );
  });
});

// ── needs-auth at call time (autoAuth) ──────────────────────────────────────

interface NeedsAuthClientFake {
  name: string;
  status: string;
  error: string | null;
  tools: never[];
  close: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  authenticate: ReturnType<typeof vi.fn>;
  callTool: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<{ content: Array<{ type: string; text: string }>; isError: boolean }>;
}

/** Minimal needs-auth ServerClient fake — authenticate/close/connect are scripted. */
function makeNeedsAuthClient(
  calls: Array<{ tool: string; args: Record<string, unknown> }>,
  opts: { outcome?: "success" | "throw"; error?: string } = {},
): NeedsAuthClientFake {
  const fake = {
    name: "srv",
    status: "needs-auth",
    error: "authentication required or token rejected",
    tools: [] as never[],
    close: vi.fn(async () => {}),
    connect: vi.fn(async function (this: { status: string }) {
      this.status = "connected";
    }),
    authenticate: vi.fn(
      opts.outcome === "throw"
        ? async () => {
            throw new Error(opts.error ?? "boom");
          }
        : async () => {},
    ),
    callTool: (async (toolName: string, args: Record<string, unknown>) => {
      calls.push({ tool: toolName, args });
      return { content: [{ type: "text", text: `result:${toolName}` }], isError: false };
    }) as NeedsAuthClientFake["callTool"],
  };
  return fake as unknown as NeedsAuthClientFake;
}

describe("registerDirectTools — needs-auth at call time", () => {
  beforeEach(() => {
    // The module-level claim map persists across tests; clear it so these
    // tests register fresh (same pattern as the registration describe).
    clearRegisteredForTest();
  });

  it("returns /mcp-auth guidance (isError false) and never authenticates when autoAuth is off", async () => {
    const { pi, defs } = makeFakePi();
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const client = makeNeedsAuthClient(calls);
    registerDirectTools(pi, {
      serverName: "srv",
      prefix: "server",
      tools: [TOOLS[0]!],
      getCollapsedLines: () => 3,
      autoAuth: () => false,
      resolveClient: resolveClient(client as unknown as ServerClient),
    });
    const result = (await defs[0]!.execute!("call-1", { q: 1 })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("requires authentication");
    expect(text).toContain("/mcp-auth srv");
    expect(result.isError).toBeFalsy();
    // The tool was never dispatched to the server; no auth attempted
    expect(calls).toEqual([]);
    expect(client.authenticate).not.toHaveBeenCalled();
  });

  it("auto-authenticates, reconnects, and retries the call once when autoAuth is on", async () => {
    const { pi, defs } = makeFakePi();
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const client = makeNeedsAuthClient(calls);
    registerDirectTools(pi, {
      serverName: "srv",
      prefix: "server",
      tools: [TOOLS[0]!],
      getCollapsedLines: () => 3,
      autoAuth: () => true,
      resolveClient: resolveClient(client as unknown as ServerClient),
    });
    const result = (await defs[0]!.execute!("call-1", { q: 1 })) as {
      content: Array<{ type: string; text: string }>;
      details?: { server: string; tool: string };
      isError?: boolean;
    };
    expect(client.authenticate).toHaveBeenCalledTimes(1);
    // Reconnect to pick up the freshly stored token (mirrors /mcp-auth)
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
    // The single retry reached the server with the raw tool name
    expect(calls).toEqual([{ tool: "alpha", args: { q: 1 } }]);
    expect(result.content).toEqual([{ type: "text", text: "result:alpha" }]);
    expect(result.details).toEqual({ server: "srv", tool: "alpha" });
    expect(result.isError).toBe(false);
  });

  it("returns guidance with the error when the auto-auth flow fails (no throw leaks)", async () => {
    const { pi, defs } = makeFakePi();
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const client = makeNeedsAuthClient(calls, { outcome: "throw", error: "OAuth cancelled" });
    registerDirectTools(pi, {
      serverName: "srv",
      prefix: "server",
      tools: [TOOLS[0]!],
      getCollapsedLines: () => 3,
      autoAuth: () => true,
      resolveClient: resolveClient(client as unknown as ServerClient),
    });
    const result = (await defs[0]!.execute!("call-1", {})) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("OAuth cancelled");
    expect(text).toContain("/mcp-auth srv");
    expect(result.isError).toBeFalsy();
    expect(calls).toEqual([]);
    expect(client.close).not.toHaveBeenCalled();
  });
});
