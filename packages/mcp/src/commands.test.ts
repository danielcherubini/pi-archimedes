import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { parseMcpSubcommand, registerMcpCommand, type McpCommandDeps } from "./commands.js";
import { ServerManager } from "./server-manager.js";
import {
  getCachedPrompts,
  getCachedTools,
  loadMetadataCache,
  recordServerOutcome,
  saveServerCache,
  setCachePathForTest,
} from "./metadata-cache.js";
import type { ServerDef } from "./types.js";

// ── mocks ────────────────────────────────────────────────────────────────────
// The real BorderedLoader needs a live TUI; a stub with the same surface
// (constructor message + onAbort) is enough to drive the auth subcommand.
vi.mock("@earendil-works/pi-coding-agent", () => ({
  BorderedLoader: class {
    message: string;
    onAbort?: () => void;
    constructor(_tui: unknown, _theme: unknown, message: string) {
      this.message = message;
    }
    dispose() {}
  },
  CONFIG_DIR_NAME: ".pi",
  // core/settings-io builds its settings path at module load
  getAgentDir: () => `${process.env.TMPDIR ?? "/tmp"}/pi-archimedes-mock-agent`,
}));
vi.mock("open", () => ({ default: vi.fn().mockResolvedValue({}) }));
vi.mock("./auth-storage.js", () => ({ deleteAuthEntry: vi.fn(), getAuthEntry: vi.fn() }));

// ── fakes ────────────────────────────────────────────────────────────────────

interface CapturedCommand {
  description?: string;
  handler: (args: string, ctx: unknown) => Promise<void>;
}

function makeFakePi(): {
  pi: ExtensionAPI;
  commands: Record<string, CapturedCommand>;
} {
  const commands: Record<string, CapturedCommand> = {};
  const pi = {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: (name: string, def: CapturedCommand) => {
      commands[name] = def;
    },
  } as unknown as ExtensionAPI;
  return { pi, commands };
}

/** Fake SDK Client — the surface ServerClient touches. */
function makeFakeSdkClient(opts: {
  tools?: Array<{ name: string; description?: string; inputSchema: unknown }>;
  onConnect?: (transport: unknown) => Promise<void> | void;
} = {}) {
  const fake = {
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
    async callTool() {
      return { content: [{ type: "text", text: "ok" }] };
    },
    async close() {},
    closeFn: vi.fn().mockResolvedValue(undefined),
  };
  return fake;
}

interface CtxState {
  notify: ReturnType<typeof vi.fn>;
  custom: ReturnType<typeof vi.fn>;
  lastLoader: { message: string; onAbort?: () => void } | null;
  /** The overlay factory's return value (a BorderedLoader, or the mcp panel component). */
  lastCustom: unknown;
  /** The fake tui's requestRender — proves components trigger re-renders. */
  requestRender: ReturnType<typeof vi.fn>;
}

/** Fake ExtensionCommandContext: notify captured; ui.custom runs the factory
 *  synchronously and resolves when done() is first called. The factory gets a
 *  minimal working tui (requestRender) and an identity theme so real overlay
 *  components (BorderedLoader, the mcp panel) can run against it. `hasUI`
 *  defaults to true (the interactive TUI). */
function makeCtx(cwd: string, hasUI: boolean = true): { ctx: ExtensionCommandContext; state: CtxState } {
  const state: CtxState = {
    notify: vi.fn(),
    custom: vi.fn(),
    lastLoader: null,
    lastCustom: null,
    requestRender: vi.fn(),
  };
  const ui = {
    notify: (message: string, type?: "info" | "warning" | "error") =>
      state.notify(message, type),
    custom: (
      factory: (
        tui: unknown,
        theme: unknown,
        keybindings: unknown,
        done: (result: unknown) => void,
      ) => unknown,
    ) => {
      let resolve!: (result: unknown) => void;
      const pending = new Promise<unknown>((r) => (resolve = r));
      let settled = false;
      const done = (result: unknown) => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };
      const component = factory(
        { requestRender: state.requestRender },
        { fg: (_token: string, text: string) => text },
        {},
        done,
      );
      state.lastLoader = component as CtxState["lastLoader"];
      state.lastCustom = component;
      return pending;
    },
  };
  return {
    ctx: { hasUI, cwd, ui } as unknown as ExtensionCommandContext,
    state,
  };
}

// ── env ─────────────────────────────────────────────────────────────────────

const stdioDef: ServerDef = { type: "stdio", command: "true" };
const httpDef: ServerDef = { type: "http", url: "http://127.0.0.1:1/mcp" };
const httpOauthDef: ServerDef = { type: "http", url: "https://mcps.example/mcp", auth: "oauth" };

let workspace: string;
let cwd: string;
let cachePath: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "mcp-commands-test-"));
  cwd = join(workspace, "project");
  cachePath = join(workspace, "cache.json");
  mkdtempSync(cwd);
  setCachePathForTest(cachePath);
});

afterEach(() => {
  vi.restoreAllMocks();
  setCachePathForTest(null);
  rmSync(workspace, { recursive: true, force: true });
});

interface Env {
  run: (args: string) => Promise<void>;
  notify: CtxState["notify"];
  state: CtxState;
  manager: ServerManager;
  sdk: ReturnType<typeof makeFakeSdkClient>;
}

/** Wire a command handler over a real manager + real (tmp) metadata cache.
 *  `serverDefs` may include disabled servers, exactly like loadAllServerDefs. */
function setupEnv(
  serverDefs: Record<string, ServerDef>,
  opts: { sdk?: ReturnType<typeof makeFakeSdkClient>; sync?: boolean; hasUI?: boolean } = {},
): Env {
  const sdk = opts.sdk ?? makeFakeSdkClient({ tools: [{ name: "t1", description: "d1", inputSchema: {} }] });
  const manager = new ServerManager({
    clientFactory: () => ({ ...sdk, close: sdk.closeFn }) as unknown as Client,
  });
  if (opts.sync !== false) {
    // Mirror production: the manager only knows enabled, well-formed servers
    manager.sync(
      Object.fromEntries(
        Object.entries(serverDefs).filter(
          ([, d]) => d.disabled !== true && ("url" in d || "command" in d),
        ),
      ),
    );
  }
  const deps: McpCommandDeps = {
    getManager: () => manager,
    getServerDefs: () => serverDefs,
    getCachedTools: (name, def) => getCachedTools(name, def),
    getCachedPrompts: (name, def) => getCachedPrompts(name, def),
  };
  const { pi, commands } = makeFakePi();
  registerMcpCommand(pi, deps);
  const mcp = commands["mcp"];
  if (!mcp) throw new Error("/mcp command not registered");
  const { ctx, state } = makeCtx(cwd, opts.hasUI ?? true);
  return {
    run: (args) => mcp.handler(args, ctx),
    notify: state.notify,
    state,
    manager,
    sdk,
  };
}

// ── parseMcpSubcommand ──────────────────────────────────────────────────────

describe("parseMcpSubcommand", () => {
  it("parses a lone subcommand", () => {
    expect(parseMcpSubcommand("status")).toEqual({ subcommand: "status", rest: [] });
  });

  it("parses a subcommand with an argument", () => {
    expect(parseMcpSubcommand("reconnect foo")).toEqual({ subcommand: "reconnect", rest: ["foo"] });
  });

  it("defaults to status when empty", () => {
    expect(parseMcpSubcommand("")).toEqual({ subcommand: "status", rest: [] });
  });

  it("collapses extra whitespace between tokens", () => {
    expect(parseMcpSubcommand("  reconnect   foo bar  ")).toEqual({
      subcommand: "reconnect",
      rest: ["foo", "bar"],
    });
  });

  it("treats a whitespace-only string as no subcommand (status default)", () => {
    expect(parseMcpSubcommand("   ")).toEqual({ subcommand: "status", rest: [] });
  });

  it("passes unknown first tokens through unchanged", () => {
    expect(parseMcpSubcommand("frobnicate xyz")).toEqual({ subcommand: "frobnicate", rest: ["xyz"] });
  });
});

// ── registration ────────────────────────────────────────────────────────────

describe("registerMcpCommand", () => {
  it("registers exactly the mcp command", () => {
    const { pi, commands } = makeFakePi();
    const deps: McpCommandDeps = setupDepsOnly();
    registerMcpCommand(pi, deps);
    expect(Object.keys(commands)).toEqual(["mcp"]);
    expect(typeof commands["mcp"]!.handler).toBe("function");
  });

  function setupDepsOnly(): McpCommandDeps {
    return {
      getManager: () => new ServerManager(),
      getServerDefs: () => ({}),
      getCachedTools: () => undefined,
      getCachedPrompts: () => undefined,
    };
  }
});

// ── status ──────────────────────────────────────────────────────────────────

describe("/mcp status", () => {
  it("points at /mcp setup when no servers are configured", async () => {
    const env = setupEnv({});
    await env.run("status");
    expect(env.notify).toHaveBeenCalledWith("No MCP servers configured — run /mcp setup", "info");
  });

  it("shows a live connected server with its tool count", async () => {
    const env = setupEnv({ srv: stdioDef });
    await env.manager.getClient("srv")!.connect();
    await env.run("status");
    expect(env.notify).toHaveBeenCalledWith("✓ srv: connected (1 tools)", "info");
  });

  it("shows a disabled server with the enable hint", async () => {
    const env = setupEnv({ srv: { ...stdioDef, disabled: true } });
    await env.run("status");
    expect(env.notify).toHaveBeenCalledWith(
      "○ srv: disabled (run /mcp enable srv, then /reload)",
      "info",
    );
  });

  it("shows a persisted needs-auth outcome across sessions (ADR 0004)", async () => {
    const env = setupEnv({ srv: httpOauthDef });
    recordServerOutcome("srv", "needs-auth");
    await env.run("status"); // explicit status stays the text list (even in a TUI)
    expect(env.notify).toHaveBeenCalledWith(
      "⚠ srv: needs auth — run /mcp auth srv",
      "info",
    );
  });

  it("timestamps a stale persisted outcome", async () => {
    const env = setupEnv({ srv: httpOauthDef });
    recordServerOutcome("srv", "needs-auth");
    // Age the outcome 2 days
    const cache = loadMetadataCache();
    if (cache.serverStatuses?.["srv"]) cache.serverStatuses["srv"].at = Date.now() - 2 * 86_400_000;
    const { writeFileSync } = await import("node:fs");
    writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8");
    await env.run("status");
    expect(env.notify).toHaveBeenCalledWith("⚠ srv: needs auth (2d ago) — run /mcp auth srv", "info");
  });

  it("shows a persisted error outcome with its message", async () => {
    const env = setupEnv({ srv: httpDef });
    recordServerOutcome("srv", "error", "ECONNREFUSED 127.0.0.1:1");
    await env.run("status");
    expect(env.notify).toHaveBeenCalledWith(
      "✗ srv: error — ECONNREFUSED 127.0.0.1:1",
      "info",
    );
  });

  it("shows an unconnected server with cached tool count", async () => {
    saveServerCache("srv", stdioDef, {
      tools: [{ name: "t1", description: "d1", inputSchema: {} }],
      resources: [],
    });
    const env = setupEnv({ srv: stdioDef });
    await env.run("status");
    expect(env.notify).toHaveBeenCalledWith("○ srv: not connected (1 tools cached)", "info");
  });

  it("shows an unconnected server without cache plain", async () => {
    const env = setupEnv({ srv: stdioDef });
    await env.run("status");
    expect(env.notify).toHaveBeenCalledWith("○ srv: not connected", "info");
  });

  it("lists one line per server", async () => {
    const env = setupEnv({
      alpha: { type: "stdio", command: "true", disabled: true },
      beta: stdioDef,
    });
    await env.run("status");
    expect(env.notify).toHaveBeenCalledWith(
      "○ alpha: disabled (run /mcp enable alpha, then /reload)\n○ beta: not connected",
      "info",
    );
  });
});

// ── tools ───────────────────────────────────────────────────────────────────

describe("/mcp tools", () => {
  function seedTools(name: string, def: ServerDef, tools: Array<{ name: string; description?: string }>): void {
    saveServerCache(name, def, {
      tools: tools.map((t) => ({ ...t, inputSchema: {} })),
      resources: [],
    });
  }

  it("lists tools per server across all servers", async () => {
    seedTools("srv1", stdioDef, [{ name: "a", description: "first" }, { name: "b" }]);
    seedTools("srv2", httpDef, [{ name: "c", description: "third" }]);
    const env = setupEnv({ srv1: stdioDef, srv2: httpDef });
    await env.run("tools");
    expect(env.notify).toHaveBeenCalledWith(
      "srv1:\n  a — first\n  b\n\nsrv2:\n  c — third",
      "info",
    );
  });

  it("lists tools for a single server", async () => {
    seedTools("srv", stdioDef, [{ name: "a", description: "first" }]);
    const env = setupEnv({ srv: stdioDef });
    await env.run("tools srv");
    expect(env.notify).toHaveBeenCalledWith("a — first", "info");
  });

  it("marks disabled servers in the all-servers listing", async () => {
    seedTools("srv", stdioDef, [{ name: "a" }]);
    const env = setupEnv({ srv: { ...stdioDef, disabled: true } });
    await env.run("tools");
    expect(env.notify).toHaveBeenCalledWith("srv (disabled):\n  a", "info");
  });

  it("reports a clear error for an unknown server", async () => {
    const env = setupEnv({ srv: stdioDef });
    await env.run("tools ghost");
    expect(env.notify).toHaveBeenCalledWith("Unknown server: ghost", "error");
  });

  it("notes missing cache rather than listing", async () => {
    const env = setupEnv({ srv: stdioDef });
    await env.run("tools srv");
    expect(env.notify).toHaveBeenCalledWith("(no cached tool metadata)", "info");
  });

  it("points at /mcp setup when no servers are configured", async () => {
    const env = setupEnv({});
    await env.run("tools");
    expect(env.notify).toHaveBeenCalledWith("No MCP servers configured — run /mcp setup", "info");
  });
});

// ── prompts ─────────────────────────────────────────────────────────────────

describe("/mcp prompts", () => {
  function seedPrompts(name: string, def: ServerDef, prompts: Array<{ name: string; description?: string }>): void {
    saveServerCache(name, def, {
      tools: [],
      resources: [],
      prompts,
    });
  }

  it("lists prompts with descriptions", async () => {
    seedPrompts("srv", stdioDef, [{ name: "daily", description: "daily report" }]);
    const env = setupEnv({ srv: stdioDef });
    await env.run("prompts srv");
    expect(env.notify).toHaveBeenCalledWith("daily — daily report", "info");
  });

  it("lists prompts per server across all servers", async () => {
    seedPrompts("srv1", stdioDef, [{ name: "p1", description: "one" }]);
    const env = setupEnv({ srv1: stdioDef });
    await env.run("prompts");
    expect(env.notify).toHaveBeenCalledWith("srv1:\n  p1 — one", "info");
  });

  it("notes missing cached prompts", async () => {
    const env = setupEnv({ srv: stdioDef });
    await env.run("prompts srv");
    expect(env.notify).toHaveBeenCalledWith("(no cached prompt metadata)", "info");
  });

  it("reports a clear error for an unknown server", async () => {
    const env = setupEnv({ srv: stdioDef });
    await env.run("prompts ghost");
    expect(env.notify).toHaveBeenCalledWith("Unknown server: ghost", "error");
  });
});

// ── reconnect ───────────────────────────────────────────────────────────────

describe("/mcp reconnect", () => {
  it("closes and reconnects a single server, records the outcome (ADR 0004)", async () => {
    const env = setupEnv({ srv: stdioDef });
    const client = env.manager.getClient("srv")!;
    const closeSpy = vi.spyOn(client, "close");
    await env.run("reconnect srv");
    expect(closeSpy).toHaveBeenCalled();
    expect(env.notify).toHaveBeenCalledWith("✓ srv: connected (1 tools)", "info");
    expect(loadMetadataCache().serverStatuses?.["srv"]?.status).toBe("connected");
  });

  it("surfaces needs-auth and points at /mcp auth after a 401", async () => {
    const sdk = makeFakeSdkClient({
      onConnect: () => {
        throw new StreamableHTTPError(401, "Unauthorized");
      },
    });
    const env = setupEnv({ "auth-srv": httpOauthDef }, { sdk });
    await env.run("reconnect auth-srv");
    expect(env.notify).toHaveBeenCalledWith(
      "⚠ auth-srv: needs auth — run /mcp auth auth-srv",
      "info",
    );
    expect(loadMetadataCache().serverStatuses?.["auth-srv"]?.status).toBe("needs-auth");
  });

  it("surfaces connect failures with the error text", async () => {
    const sdk = makeFakeSdkClient({
      onConnect: () => {
        throw new Error("connection refused");
      },
    });
    const env = setupEnv({ srv: httpDef }, { sdk });
    await env.run("reconnect srv");
    expect(env.notify).toHaveBeenCalledWith("✗ srv: error — connection refused", "info");
    expect(loadMetadataCache().serverStatuses?.["srv"]?.status).toBe("error");
    expect(loadMetadataCache().serverStatuses?.["srv"]?.error).toBe("connection refused");
  });

  it("reconnects all enabled servers when no arg is given", async () => {
    const env = setupEnv({
      a: { type: "stdio", command: "true" },
      b: { type: "stdio", command: "true" },
      c: { type: "stdio", command: "true", disabled: true },
    });
    await env.run("reconnect");
    expect(env.notify).toHaveBeenCalledWith(
      "✓ a: connected (1 tools)\n✓ b: connected (1 tools)",
      "info",
    );
  });

  it("rejects a disabled server", async () => {
    const env = setupEnv({ srv: { ...stdioDef, disabled: true } });
    await env.run("reconnect srv");
    expect(env.notify).toHaveBeenCalledWith(
      "Server srv is disabled (run /mcp enable srv, then /reload)",
      "error",
    );
  });

  it("reports a clear error for an unknown server", async () => {
    const env = setupEnv({ srv: stdioDef });
    await env.run("reconnect ghost");
    expect(env.notify).toHaveBeenCalledWith("Unknown server: ghost", "error");
  });
});

// ── enable / disable ────────────────────────────────────────────────────────

describe("/mcp enable", () => {
  it("writes disabled:false to the project override and hints /reload", async () => {
    const defs = { srv: { ...stdioDef, disabled: true } };
    const env = setupEnv(defs);
    await env.run("enable srv");
    expect(env.notify).toHaveBeenCalledWith("✓ srv enabled — run /reload to apply", "info");
    const doc = JSON.parse(readFileSync(join(cwd, ".pi", "mcp.json"), "utf-8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    expect(doc.mcpServers.srv).toEqual({ disabled: false });
  });

  it("rejects a server that is not disabled", async () => {
    const env = setupEnv({ srv: stdioDef });
    await env.run("enable srv");
    expect(env.notify).toHaveBeenCalledWith("Server srv is already enabled", "error");
  });

  it("rejects an unknown server", async () => {
    const env = setupEnv({ srv: stdioDef });
    await env.run("enable ghost");
    expect(env.notify).toHaveBeenCalledWith("Unknown server: ghost", "error");
  });

  it("asks for a server name when none is given", async () => {
    const env = setupEnv({ srv: stdioDef });
    await env.run("enable");
    expect(env.notify).toHaveBeenCalledWith("Usage: /mcp enable <server>", "info");
  });
});

describe("/mcp disable", () => {
  it("writes disabled:true, closes the managed client, and hints /reload", async () => {
    const env = setupEnv({ srv: stdioDef });
    const client = env.manager.getClient("srv")!;
    await client.connect();
    const closeSpy = vi.spyOn(client, "close");
    await env.run("disable srv");
    expect(env.notify).toHaveBeenCalledWith("✓ srv disabled — run /reload to apply", "info");
    const doc = JSON.parse(readFileSync(join(cwd, ".pi", "mcp.json"), "utf-8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    expect(doc.mcpServers.srv).toEqual({ disabled: true });
    expect(closeSpy).toHaveBeenCalled();
  });

  it("rejects a server that is already disabled", async () => {
    const env = setupEnv({ srv: { ...stdioDef, disabled: true } });
    await env.run("disable srv");
    expect(env.notify).toHaveBeenCalledWith("Server srv is already disabled", "error");
  });

  it("rejects an unknown server", async () => {
    const env = setupEnv({ srv: stdioDef });
    await env.run("disable ghost");
    expect(env.notify).toHaveBeenCalledWith("Unknown server: ghost", "error");
  });

  it("asks for a server name when none is given", async () => {
    const env = setupEnv({ srv: stdioDef });
    await env.run("disable");
    expect(env.notify).toHaveBeenCalledWith("Usage: /mcp disable <server>", "info");
  });

  it("surfaces write-back failures as error notifications", async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "mcp.json"), "{not json", "utf-8");
    const env = setupEnv({ srv: { ...stdioDef, disabled: true } });
    await env.run("enable srv");
    expect(env.notify).toHaveBeenCalledWith(expect.stringContaining("Refusing to overwrite"), "error");
  });
});

// ── logout (shared mcpLogoutServer) ─────────────────────────────────────────

describe("/mcp logout", () => {
  it("deletes the keyring entry and notifies", async () => {
    const { deleteAuthEntry } = vi.mocked(await import("./auth-storage.js"));
    const env = setupEnv({ srv: stdioDef });
    await env.run("logout srv");
    expect(deleteAuthEntry).toHaveBeenCalledWith("srv");
    expect(env.notify).toHaveBeenCalledWith("Logged out of srv", "info");
  });

  it("closes the managed client when one exists", async () => {
    const env = setupEnv({ srv: httpOauthDef });
    const closeSpy = vi.spyOn(env.manager.getClient("srv")!, "close");
    await env.run("logout srv");
    expect(closeSpy).toHaveBeenCalled();
  });

  it("asks for a server name when none is given", async () => {
    const env = setupEnv({ srv: stdioDef });
    await env.run("logout");
    expect(env.notify).toHaveBeenCalledWith("Usage: /mcp logout <server>", "info");
  });

  it("reports keyring failures instead of throwing", async () => {
    const { deleteAuthEntry } = vi.mocked(await import("./auth-storage.js"));
    deleteAuthEntry.mockImplementationOnce(() => {
      throw new Error("OS credential store unavailable — cannot store OAuth tokens securely");
    });
    const env = setupEnv({ srv: stdioDef });
    await env.run("logout srv");
    expect(env.notify).toHaveBeenCalledWith(
      expect.stringContaining("OS credential store unavailable"),
      "error",
    );
  });
});

// ── auth (delegates to runMcpAuthCommand) ───────────────────────────────────

describe("/mcp auth", () => {
  it("asks for a server name when none is given", async () => {
    const env = setupEnv({ srv: httpOauthDef });
    await env.run("auth");
    expect(env.notify).toHaveBeenCalledWith("Usage: /mcp auth <server>", "info");
  });

  it("rejects an unknown server", async () => {
    const env = setupEnv({ srv: httpOauthDef });
    await env.run("auth ghost");
    expect(env.notify).toHaveBeenCalledWith("Unknown server: ghost", "error");
  });

  it("treats stdio servers as unknown (OAuth is http-only)", async () => {
    const env = setupEnv({ srv: stdioDef });
    await env.run("auth srv");
    expect(env.notify).toHaveBeenCalledWith("Unknown server: srv", "error");
  });

  it("runs the full OAuth loader flow for an http server (same UX as the former /mcp-auth)", async () => {
    const env = setupEnv({ srv: httpOauthDef });
    // The auth entry point is scripted (the real flow needs a live browser/
    // callback server — exercised separately in the auth-flow tests); the
    // loader, reconnect, and notification machinery under test is real.
    const client = env.manager.getClient("srv")!;
    vi.spyOn(client, "authenticate").mockResolvedValue(undefined);
    await env.run("auth srv");
    // The BorderedLoader stub surfaced its label
    expect(env.state.lastLoader?.message).toContain("Authenticating srv");
    expect(env.state.lastLoader?.message).toContain("esc to cancel");
    // Success path: client reconnected, tool count reported
    expect(env.notify).toHaveBeenCalledWith("✓ srv authenticated — 1 tools available", "info");
    // ADR 0004: the post-auth reconnect is a settle point the panel task wires;
    // the text command itself does not record outcomes in this task.
  });
});

// ── panel / setup ─────────────────────────────────────────────────────

describe("/mcp panel", () => {
  it("opens the shared-chrome management panel overlay; esc closes it", async () => {
    const env = setupEnv({ srv: stdioDef });
    const runPromise = env.run("panel");
    // cmdPanel lazy-imports panel.js — wait for the overlay factory to run.
    await vi.waitFor(() => expect(env.state.lastCustom).toBeTruthy());
    const panel = env.state.lastCustom as {
      render(width: number): string[];
      handleInput(data: string): void;
      invalidate(): void;
      dispose(): void;
    };
    // Shared overlay chrome (ADR 0003): bordered, header shows the server
    // count, server row is listed, and the footer hints pre-split into two
    // lines at the standard 84-char width (116 > 80 content width).
    const lines = panel.render(84);
    expect(lines[0]).toContain("┌");
    expect(lines[lines.length - 1]).toContain("└");
    expect(lines[1]).toContain("MCP Servers [1]");
    const joined = lines.join("\n");
    expect(joined).toContain("srv");
    expect(joined).toContain("(0/0 tools)");
    expect(joined).toContain("[↑/↓] move");
    expect(joined).toContain("[ctrl+s] save");
    expect(joined).toContain("[esc] close");
    expect(joined).not.toContain("later task");
    // Esc outside authing closes the overlay (done() → run resolves) with no
    // confirmation and no notifications.
    panel.handleInput("\x1b");
    await runPromise;
    expect(env.notify).not.toHaveBeenCalled();
  });

  it("redirects to the setup overlay (not the management panel) when zero servers are configured", async () => {
    const env = setupEnv({});
    const runPromise = env.run("panel");
    // Zero configured servers: cmdPanel must not open the management panel —
    // the setup overlay factory runs instead, plus the announce notification.
    await vi.waitFor(() => expect(env.state.lastCustom).toBeTruthy());
    const panel = env.state.lastCustom as {
      render(width: number): string[];
      handleInput(data: string): void;
    };
    const lines = panel.render(84);
    expect(lines[1]).toContain("MCP Setup");
    expect(lines.join("\n")).not.toContain("MCP Servers");
    // esc in the menu closes the overlay (done() → run resolves).
    panel.handleInput("\x1b");
    await runPromise;
    expect(env.notify).toHaveBeenCalledTimes(1);
    expect(env.notify).toHaveBeenCalledWith("No MCP servers configured — opening setup", "info");
  });
});

describe("/mcp setup", () => {
  it("opens the shared-chrome setup overlay; menu lists the actions; esc closes it", async () => {
    const env = setupEnv({ srv: stdioDef });
    const runPromise = env.run("setup");
    // cmdSetup lazy-imports setup-panel.js — wait for the overlay factory to run.
    await vi.waitFor(() => expect(env.state.lastCustom).toBeTruthy());
    const panel = env.state.lastCustom as {
      render(width: number): string[];
      handleInput(data: string): void;
      invalidate(): void;
      dispose(): void;
    };
    // Shared overlay chrome (ADR 0003): bordered, "MCP Setup" header, the
    // four menu actions, and bracket footer hints.
    const lines = panel.render(84);
    expect(lines[0]).toContain("┌");
    expect(lines[lines.length - 1]).toContain("└");
    expect(lines[1]).toContain("MCP Setup");
    const joined = lines.join("\n");
    expect(joined).toContain("Scaffold minimal .mcp.json");
    expect(joined).toContain("Add a known server");
    expect(joined).toContain("Import from another tool");
    expect(joined).toContain("Cancel");
    expect(joined).toContain("[enter] select");
    expect(joined).not.toContain("later task");
    // esc in the menu closes the overlay (done() → run resolves) without
    // notifications.
    panel.handleInput("\x1b");
    await runPromise;
    expect(env.notify).not.toHaveBeenCalled();
  });
});

// ── bare /mcp (no subcommand) ───────────────────────────────────────────

describe("bare /mcp (no subcommand)", () => {
  it("opens the management panel when a TUI is available", async () => {
    const env = setupEnv({ srv: stdioDef }); // hasUI defaults to true
    const runPromise = env.run("");
    // The dispatcher special-cases the bare call (the parser still maps
    // "" → status) — with hasUI the panel overlay factory must run.
    await vi.waitFor(() => expect(env.state.lastCustom).toBeTruthy());
    const panel = env.state.lastCustom as {
      render(width: number): string[];
      handleInput(data: string): void;
    };
    const lines = panel.render(84);
    expect(lines[0]).toContain("┌");
    expect(lines[1]).toContain("MCP Servers [1]");
    expect(lines.join("\n")).toContain("srv");
    // esc closes the overlay (done() → run resolves) with no notifications.
    panel.handleInput("\x1b");
    await runPromise;
    expect(env.notify).not.toHaveBeenCalled();
  });

  it("falls back to the text status list when there is no TUI", async () => {
    const env = setupEnv({ srv: stdioDef }, { hasUI: false });
    await env.run("");
    expect(env.notify).toHaveBeenCalledWith("○ srv: not connected", "info");
    expect(env.state.lastCustom).toBeFalsy();
  });

  it("keeps an explicit /mcp status as text even in a TUI (regression guard)", async () => {
    const env = setupEnv({ srv: stdioDef }); // hasUI: true
    await env.run("status");
    expect(env.notify).toHaveBeenCalledWith("○ srv: not connected", "info");
    expect(env.state.lastCustom).toBeFalsy();
  });

  it("redirects to the setup panel when zero servers are configured (TUI)", async () => {
    const env = setupEnv({}); // hasUI: true
    const runPromise = env.run("");
    await vi.waitFor(() => expect(env.state.lastCustom).toBeTruthy());
    const panel = env.state.lastCustom as {
      render(width: number): string[];
      handleInput(data: string): void;
    };
    const lines = panel.render(84);
    expect(lines[1]).toContain("MCP Setup");
    panel.handleInput("\x1b");
    await runPromise;
    expect(env.notify).toHaveBeenCalledTimes(1);
    expect(env.notify).toHaveBeenCalledWith("No MCP servers configured — opening setup", "info");
  });
});

// ── unknown subcommand usage ────────────────────────────────────────────────

describe("/mcp unknown subcommand", () => {
  it("shows a usage line listing the subcommands", async () => {
    const env = setupEnv({ srv: stdioDef });
    await env.run("frobnicate");
    const [message] = env.notify.mock.calls[0] ?? [];
    expect(message).toContain("Usage: /mcp");
    for (const sub of ["status", "tools", "prompts", "reconnect", "enable", "disable", "logout", "auth", "panel", "setup"]) {
      expect(message).toContain(sub);
    }
  });
});
