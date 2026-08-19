import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { registerMcp, setIndexSeamsForTest } from "./index.js";
import { ServerManager } from "./server-manager.js";
import { ServerClient } from "./server-client.js";
import {
  clearRegisteredForTest,
  getRegisteredNamesForTest,
} from "./direct-tools.js";
import { setCachePathForTest, saveServerCache } from "./metadata-cache.js";
import { DEFAULT_MCP_CONFIG } from "./types.js";
import type { McpConfig, ServerDef } from "./types.js";

// ── fakes ────────────────────────────────────────────────────────────────────

interface CapturedTool {
  name: string;
  execute?: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown,
  ) => Promise<ExecuteResult>;
}

interface ExecuteResult {
  content: Array<{ type: string; text?: string }>;
  details?: Record<string, unknown>;
  isError?: boolean;
}

/** Fake ExtensionAPI capturing event handlers, registered tools, and commands */
function makeFakePi(): {
  pi: ExtensionAPI;
  handlers: Record<string, Array<(...args: unknown[]) => unknown>>;
  tools: CapturedTool[];
  commands: Record<string, { description?: string; handler: unknown }>;
} {
  const handlers: Record<string, Array<(...args: unknown[]) => unknown>> = {};
  const tools: CapturedTool[] = [];
  const commands: Record<string, { description?: string; handler: unknown }> = {};
  const pi = {
    on: (name: string, fn: (...args: unknown[]) => unknown) => {
      (handlers[name] ??= []).push(fn);
    },
    registerTool: (def: CapturedTool) => {
      tools.push(def);
    },
    registerCommand: (name: string, def: { description?: string; handler: unknown }) => {
      commands[name] = def;
    },
  } as unknown as ExtensionAPI;
  return { pi, handlers, tools, commands };
}

/**
 * Fake SDK Client. Only the surface ServerClient touches is implemented.
 * `callLog` records the RAW tool names passed to callTool so tests can assert
 * on the name-resolution behaviour of the proxy.
 */
function makeFakeSdkClient(opts: {
  tools?: Array<{ name: string; description?: string; inputSchema: unknown }>;
  onConnect?: (transport: unknown) => Promise<void> | void;
} = {}) {
  const fake = {
    callLog: [] as Array<{ name: string; args: Record<string, unknown> }>,
    async connect(transport: unknown) {
      await opts.onConnect?.(transport);
    },
    async listTools() {
      return { tools: opts.tools ?? [] };
    },
    async listResources() {
      return { resources: [] };
    },
    async listPrompts() {
      return { prompts: [] };
    },
    getServerCapabilities() {
      return undefined;
    },
    getInstructions() {
      return undefined;
    },
    async callTool(params: { name: string; arguments: Record<string, unknown> }) {
      fake.callLog.push({ name: params.name, args: params.arguments });
      return { content: [{ type: "text", text: `result:${params.name}` }] };
    },
    async close() {},
  };
  return fake;
}

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mcp-index-test-"));
  setCachePathForTest(join(tmp, "cache.json"));
});

afterEach(() => {
  setIndexSeamsForTest(null);
  setCachePathForTest(null);
});

/** Wire the index module to a fake manager + config loaders, return the proxy execute fn */
function setupProxy(
  defs: Record<string, ServerDef>,
  sdkClient: unknown,
  config: McpConfig = DEFAULT_MCP_CONFIG,
): (params: Record<string, unknown>) => Promise<ExecuteResult> {
  const manager = new ServerManager({
    clientFactory: () => sdkClient as unknown as Client,
  });
  setIndexSeamsForTest({
    manager,
    loadServerDefs: () => defs,
    loadMcpConfig: () => config,
  });
  const { pi, tools } = makeFakePi();
  registerMcp(pi);
  const mcpTool = tools.find((t) => t.name === "mcp");
  if (!mcpTool?.execute) throw new Error("mcp proxy tool not registered");
  const execute = mcpTool.execute;
  return (params) => execute!("call", params, undefined, undefined, undefined);
}

// ── call: raw tool-name resolution ───────────────────────────────────────────

describe("mcp proxy — call tool", () => {
  it("calls the RAW dotted tool name when given its sanitized prefixed name", async () => {
    const def: ServerDef = { type: "stdio", command: "true" };
    const sdk = makeFakeSdkClient({
      tools: [
        { name: "a.b", description: "dotted tool", inputSchema: {} },
        { name: "plain", inputSchema: {} },
      ],
    });
    // Seed the metadata cache so getToolsForServer has the raw names offline
    saveServerCache("srv", def, {
      tools: [
        { name: "a.b", description: "dotted tool", inputSchema: {} },
        { name: "plain", inputSchema: {} },
      ],
      resources: [],
    });
    const run = setupProxy({ srv: def }, sdk);

    // "srv_a_b" is the SANITIZED form of the raw tool "a.b" — the proxy must
    // call the server with "a.b", not "a_b".
    const result = await run({ tool: "srv_a_b" });
    expect(sdk.callLog).toEqual([{ name: "a.b", args: {} }]);
    expect(result.content).toEqual([{ type: "text", text: "result:a.b" }]);
    expect(result.details).toEqual({ server: "srv", tool: "a.b" });

    // Dot-free names keep working via the same path
    await run({ tool: "srv_plain" });
    expect(sdk.callLog[1]).toEqual({ name: "plain", args: {} });
  });

  it("still accepts the raw (unprefixed) tool name", async () => {
    const def: ServerDef = { type: "stdio", command: "true" };
    const sdk = makeFakeSdkClient({ tools: [{ name: "a.b", inputSchema: {} }] });
    saveServerCache("srv", def, {
      tools: [{ name: "a.b", inputSchema: {} }],
      resources: [],
    });
    const run = setupProxy({ srv: def }, sdk);

    await run({ tool: "a.b" });
    expect(sdk.callLog).toEqual([{ name: "a.b", args: {} }]);
  });

  it("resolves a prefixed tool name when an explicit server is also given", async () => {
    const def: ServerDef = { type: "stdio", command: "true" };
    const sdk = makeFakeSdkClient({
      tools: [
        { name: "a.b", description: "dotted tool", inputSchema: {} },
        { name: "plain", inputSchema: {} },
      ],
    });
    saveServerCache("srv", def, {
      tools: [
        { name: "a.b", description: "dotted tool", inputSchema: {} },
        { name: "plain", inputSchema: {} },
      ],
      resources: [],
    });
    const run = setupProxy({ srv: def }, sdk);

    // mcp({ tool: "srv_a_b", server: "srv" }) — the prefixed name must be
    // resolved to the raw dotted name, not passed through as-is.
    const result = await run({ server: "srv", tool: "srv_a_b" });
    expect(sdk.callLog).toEqual([{ name: "a.b", args: {} }]);
    expect(result.details).toEqual({ server: "srv", tool: "a.b" });

    // A dot-free prefixed name resolves too
    await run({ server: "srv", tool: "srv_plain" });
    expect(sdk.callLog[1]).toEqual({ name: "plain", args: {} });

    // A raw name with an explicit server still passes through unchanged
    await run({ server: "srv", tool: "a.b" });
    expect(sdk.callLog[2]).toEqual({ name: "a.b", args: {} });
  });

  it("passes string args through JSON parsing to the raw tool", async () => {
    const def: ServerDef = { type: "stdio", command: "true" };
    const sdk = makeFakeSdkClient({ tools: [{ name: "a.b", inputSchema: {} }] });
    saveServerCache("srv", def, {
      tools: [{ name: "a.b", inputSchema: {} }],
      resources: [],
    });
    const run = setupProxy({ srv: def }, sdk);

    await run({ tool: "srv_a_b", args: '{"q": 42}' });
    expect(sdk.callLog).toEqual([{ name: "a.b", args: { q: 42 } }]);
  });
});

// ── status action ────────────────────────────────────────────────────────────────────

describe("mcp proxy — status action", () => {
  it("treats action:'status' the same as a no-parameter call", async () => {
    const run = setupProxy({}, makeFakeSdkClient());
    const result = await run({ action: "status" });
    expect(result.content[0]?.text).toBe("No MCP servers configured.");
  });

  it("lists server statuses for action:'status' with configured servers", async () => {
    const def: ServerDef = { type: "stdio", command: "true" };
    const run = setupProxy({ srv: def }, makeFakeSdkClient());
    const result = await run({ action: "status" });
    expect(result.content[0]?.text).toContain("srv: disconnected");
  });

  it("still reports unknown actions as unknown", async () => {
    const run = setupProxy({}, makeFakeSdkClient());
    const result = await run({ action: "bogus" });
    expect(result.content[0]?.text).toBe("Unknown action");
  });
});

// ── search / describe / list accept prefixed names ──────────────────────────────

describe("mcp proxy — prefixed-name support in discovery actions", () => {
  const def: ServerDef = { type: "stdio", command: "true" };
  const seedCache = (): unknown => {
    const sdk = makeFakeSdkClient({
      tools: [{ name: "a.b", description: "dotted tool", inputSchema: {} }],
    });
    saveServerCache("srv", def, {
      tools: [{ name: "a.b", description: "dotted tool", inputSchema: {} }],
      resources: [],
    });
    return sdk;
  };

  it("describe resolves a sanitized prefixed name to the raw tool", async () => {
    const sdk = seedCache();
    const run = setupProxy({ srv: def }, sdk);
    const result = await run({ describe: "srv_a_b" });
    expect(result.content[0]?.text).toContain("a.b (srv)");
    expect(result.content[0]?.text).toContain("dotted tool");
    expect(result.content[0]?.text).toContain("Schema:");
  });

  it("describe still resolves the raw name", async () => {
    const sdk = seedCache();
    const run = setupProxy({ srv: def }, sdk);
    const result = await run({ describe: "a.b" });
    expect(result.content[0]?.text).toContain("a.b (srv)");
  });

  it("search retries with the raw name when the query is a prefixed name", async () => {
    const sdk = seedCache();
    const run = setupProxy({ srv: def }, sdk);
    const result = await run({ search: "srv_a_b" });
    expect(result.content[0]?.text).toContain("a.b (srv)");
  });

  it("search by plain keyword is unchanged", async () => {
    const sdk = seedCache();
    const run = setupProxy({ srv: def }, sdk);
    const result = await run({ search: "dotted" });
    expect(result.content[0]?.text).toContain("a.b (srv)");
  });

  it("list accepts a bare server prefix (short mode) as the server reference", async () => {
    const shortDef: ServerDef = { type: "stdio", command: "true", toolPrefix: "short" };
    const sdk = makeFakeSdkClient({
      tools: [{ name: "search", description: "find things", inputSchema: {} }],
    });
    saveServerCache("github-mcp", shortDef, {
      tools: [{ name: "search", description: "find things", inputSchema: {} }],
      resources: [],
    });
    const run = setupProxy({ "github-mcp": shortDef }, sdk);
    // "github" is the SHORT prefix of server "github-mcp" — not a server name
    const result = await run({ server: "github" });
    expect(result.content[0]?.text).toContain("search");
    expect(result.details).toEqual({ server: "github-mcp", toolCount: 1 });
  });

  it("list still rejects unknown server references", async () => {
    const sdk = seedCache();
    const run = setupProxy({ srv: def }, sdk);
    const result = await run({ server: "nope" });
    expect(result.content[0]?.text).toBe("Unknown server: nope");
  });
});

// ── connect action: needs-auth must not be reported as success ────────────

describe("mcp proxy — connect action with needs-auth", () => {
  const httpDef: ServerDef = { type: "http", url: "http://127.0.0.1:1/mcp" };

  it("reports the needs-auth error instead of 'Connected to X'", async () => {
    const sdk = makeFakeSdkClient({
      onConnect: () => {
        throw new StreamableHTTPError(401, "Unauthorized");
      },
    });
    const run = setupProxy({ "auth-srv": httpDef }, sdk);
    const result = await run({ connect: "auth-srv" });
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("requires authentication");
    expect(text).toContain("OAuth");
    expect(text).not.toContain("tools available");
    expect(result.details).toEqual({ server: "auth-srv", status: "needs-auth" });
  });

  it("still reports a successful connect with the tool count", async () => {
    const def: ServerDef = { type: "stdio", command: "true" };
    const sdk = makeFakeSdkClient({ tools: [{ name: "t1", inputSchema: {} }] });
    const run = setupProxy({ srv: def }, sdk);
    const result = await run({ connect: "srv" });
    expect(result.content[0]?.text).toBe("Connected to srv. 1 tools available.");
  });
});

// ── call action: needs-auth at call time (autoAuth) ──────────────────────

describe("mcp proxy — call with needs-auth server", () => {
  const httpDef: ServerDef = { type: "http", url: "http://127.0.0.1:1/mcp", auth: "oauth" };

  /** SDK fake that 401s on connect until `approved` flips (post-auth reconnect succeeds). */
  function makeOauthSdk(approved: { value: boolean }) {
    return makeFakeSdkClient({
      tools: [{ name: "t1", inputSchema: {} }],
      onConnect: () => {
        if (!approved.value) throw new StreamableHTTPError(401, "Unauthorized");
      },
    });
  }

  it("returns /mcp-auth guidance (isError false) and never authenticates when autoAuth is off (default)", async () => {
    const approved = { value: false };
    const sdk = makeOauthSdk(approved);
    saveServerCache("auth-srv", httpDef, { tools: [{ name: "t1", inputSchema: {} }], resources: [] });
    const run = setupProxy({ "auth-srv": httpDef }, sdk);
    const authSpy = vi.spyOn(ServerClient.prototype, "authenticate");
    try {
      const result = await run({ tool: "t1", server: "auth-srv" });
      const text = result.content[0]?.text ?? "";
      expect(text).toContain("requires authentication");
      expect(text).toContain("/mcp-auth auth-srv");
      expect(result.isError).toBeFalsy();
      expect(authSpy).not.toHaveBeenCalled();
      // The tool was never dispatched to the server
      expect(sdk.callLog).toEqual([]);
    } finally {
      authSpy.mockRestore();
    }
  });

  it("auto-authenticates and retries the call once when autoAuth is on and the flow succeeds", async () => {
    const approved = { value: false };
    const sdk = makeOauthSdk(approved);
    saveServerCache("auth-srv", httpDef, { tools: [{ name: "t1", inputSchema: {} }], resources: [] });
    const run = setupProxy(
      { "auth-srv": httpDef },
      sdk,
      { ...DEFAULT_MCP_CONFIG, autoAuth: true },
    );
    const authSpy = vi.spyOn(ServerClient.prototype, "authenticate").mockImplementation(
      async function (this: ServerClient) {
        // Simulate a completed browser flow (fresh tokens stored)
        approved.value = true;
      },
    );
    try {
      const result = await run({ tool: "t1", server: "auth-srv" });
      expect(authSpy).toHaveBeenCalledTimes(1);
      // The single retry reached the server with the raw tool name
      expect(sdk.callLog).toEqual([{ name: "t1", args: {} }]);
      expect(result.content).toEqual([{ type: "text", text: "result:t1" }]);
      expect(result.isError).toBe(false);
    } finally {
      authSpy.mockRestore();
    }
  });

  it("returns guidance with the error when autoAuth is on but the flow is cancelled", async () => {
    const approved = { value: false };
    const sdk = makeOauthSdk(approved);
    saveServerCache("auth-srv", httpDef, { tools: [{ name: "t1", inputSchema: {} }], resources: [] });
    const run = setupProxy(
      { "auth-srv": httpDef },
      sdk,
      { ...DEFAULT_MCP_CONFIG, autoAuth: true },
    );
    const authSpy = vi.spyOn(ServerClient.prototype, "authenticate").mockRejectedValue(
      new Error("OAuth cancelled"),
    );
    try {
      const result = await run({ tool: "t1", server: "auth-srv" });
      const text = result.content[0]?.text ?? "";
      expect(text).toContain("OAuth cancelled");
      expect(text).toContain("/mcp-auth auth-srv");
      expect(result.isError).toBeFalsy();
      expect(approved.value).toBe(false);
      // No retry was attempted
      expect(sdk.callLog).toEqual([]);
    } finally {
      authSpy.mockRestore();
    }
  });
});

// ── auth command wiring: index registers /mcp-auth + /mcp-logout ─────────────

describe("mcp proxy — auth command wiring", () => {
  it("registers /mcp-auth and /mcp-logout bound to the seam loaders", async () => {
    const def: ServerDef = { type: "stdio", command: "true" };
    const manager = new ServerManager({
      clientFactory: () => makeFakeSdkClient() as unknown as Client,
    });
    setIndexSeamsForTest({
      manager,
      loadServerDefs: () => ({ srv: def }),
      loadMcpConfig: () => DEFAULT_MCP_CONFIG,
    });
    const { pi, commands } = makeFakePi();
    registerMcp(pi);
    expect(Object.keys(commands).sort()).toEqual(["mcp-auth", "mcp-logout"]);

    // A stdio server is not OAuth-capable: the /mcp-auth wiring must surface
    // it as an unknown (non-http) server, not attempt auth.
    const notify = vi.fn();
    const ctx = { hasUI: true, ui: { notify, custom: vi.fn() } } as never;
    const handler = commands["mcp-auth"]!.handler as (
      args: string,
      ctx: unknown,
    ) => Promise<void>;
    await handler("srv", ctx);
    expect(notify).toHaveBeenCalledWith("Unknown server: srv", "error");
  });
});

// ── test seam reset ───────────────────────────────────────────────────────────

describe("mcp proxy — test seam reset", () => {
  it("setIndexSeamsForTest(null) discards the swapped-in manager", async () => {
    const def: ServerDef = { type: "stdio", command: "true" };
    const sdk = makeFakeSdkClient({ tools: [{ name: "t1", inputSchema: {} }] });
    const manager = new ServerManager({
      clientFactory: () => sdk as unknown as Client,
    });
    manager.sync({ srv: def });
    await manager.getClient("srv")!.connect();
    expect(manager.getClient("srv")!.status).toBe("connected");

    setIndexSeamsForTest({
      manager,
      loadServerDefs: () => ({ srv: def }),
      loadMcpConfig: () => DEFAULT_MCP_CONFIG,
    });

    // Reset the seam — the swapped-in (fake, connected) manager must be
    // discarded, not left in place.
    setIndexSeamsForTest(null);

    // Re-arm only the config loaders: the module-level manager should now be
    // a FRESH one, so the same server must be reported as a brand-new
    // (disconnected) client rather than the stale fake (connected).
    setIndexSeamsForTest({
      loadServerDefs: () => ({ srv: def }),
      loadMcpConfig: () => DEFAULT_MCP_CONFIG,
    });
    const { pi, tools } = makeFakePi();
    registerMcp(pi);
    const mcpTool = tools.find((t) => t.name === "mcp");
    if (!mcpTool?.execute) throw new Error("mcp proxy tool not registered");
    const result = await mcpTool.execute!("call", {}, undefined, undefined, undefined);
    expect(result.content[0]?.text).toBe("srv: disconnected");
  });
});

// ── session_start probe: superseded client must not evict registered names ──

describe("mcp proxy — session_start probe fenced by a superseded client", () => {
  it("does not re-register when the probe's client is replaced mid-connect", async () => {
    clearRegisteredForTest();
    const def1: ServerDef = { type: "stdio", command: "cmd-v1" };
    const def2: ServerDef = { type: "stdio", command: "cmd-v2" };
    let defs: Record<string, ServerDef> = { srv: def1 };

    // sdk1 backs the FIRST (stale) client. Its connect holds the probe at the
    // gate after a concurrent session_start (a /reload with an updated def)
    // has already sync()'d — closing (generation-fencing) and replacing the
    // stale client. Releasing the gate lets the fenced connect resolve with
    // EMPTY tools, exactly like the real fence path.
    let releaseStale!: () => void;
    const staleGate = new Promise<void>((r) => (releaseStale = r));
    const sdk1 = makeFakeSdkClient({
      tools: [{ name: "t1", inputSchema: {} }],
      onConnect: async () => {
        defs = { srv: def2 };
        manager.sync(defs);
        await staleGate;
      },
    });
    const sdk2 = makeFakeSdkClient({
      tools: [{ name: "t1", inputSchema: {} }],
    });
    let created = 0;
    const manager = new ServerManager({
      clientFactory: () => (created++ === 0 ? sdk1 : sdk2) as unknown as Client,
    });
    setIndexSeamsForTest({
      manager,
      loadServerDefs: () => defs,
      loadMcpConfig: () => DEFAULT_MCP_CONFIG,
    });
    const { pi, handlers, tools } = makeFakePi();
    registerMcp(pi);
    const start = handlers["session_start"]?.[0];
    if (!start) throw new Error("session_start handler not registered");

    // 1st session_start: no valid cache → background probe starts connecting
    // the stale client (blocked at the gate after the sync above).
    await start();

    // 2nd session_start (the /reload): the client has been replaced, its
    // probe connects the fresh client and registers "srv_t1".
    await start();
    await vi.waitFor(() => {
      expect(getRegisteredNamesForTest().get("srv")?.has("srv_t1")).toBe(true);
    });

    // The stale connect now completes. Its probe must detect that it was
    // superseded and NOT run a zero-tool registration pass — that would
    // replace the server's tracked set with an empty one, evicting the
    // names the current session just registered.
    releaseStale();
    await new Promise((r) => setTimeout(r, 10)); // drain the probe's microtasks

    expect(getRegisteredNamesForTest().get("srv")?.has("srv_t1")).toBe(true);

    // A later session_start must therefore NOT call pi.registerTool again
    // for a name pi already holds (duplicate registration).
    await start();
    expect(tools.filter((t) => t.name === "srv_t1")).toHaveLength(1);
  });
});

// ── session_start probe: needs-auth servers warn instead of registering 0 tools ──

describe("mcp proxy — session_start background probe with needs-auth", () => {
  const httpDef: ServerDef = { type: "http", url: "http://127.0.0.1:1/mcp" };

  it("warns and skips registration when a server 401s during the probe", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sdk = makeFakeSdkClient({
      onConnect: () => {
        throw new StreamableHTTPError(401, "Unauthorized");
      },
    });
    const manager = new ServerManager({
      clientFactory: () => sdk as unknown as Client,
    });
    setIndexSeamsForTest({
      manager,
      loadServerDefs: () => ({ "auth-srv": httpDef }),
      loadMcpConfig: () => DEFAULT_MCP_CONFIG,
    });
    const { pi, handlers, tools } = makeFakePi();
    registerMcp(pi);
    const start = handlers["session_start"]?.[0];
    if (!start) throw new Error("session_start handler not registered");

    await start();
    // The probe is fire-and-forget — wait for it to settle
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('server "auth-srv" requires authentication'),
      ),
    );
    // No direct tools registered for the needs-auth server (proxy only)
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("mcp");
    warn.mockRestore();
  });
});
