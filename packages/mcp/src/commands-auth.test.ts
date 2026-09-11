import { describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import open from "open";
import { isHttpDef } from "./config.js";
import { mcpLogoutServer, runMcpAuthCommand } from "./commands-auth.js";
import type { ServerManager } from "./server-manager.js";
import type { HttpServerDef, ServerDef } from "./types.js";

// ── mocks ────────────────────────────────────────────────────────────────────
vi.mock("@earendil-works/pi-coding-agent", () => ({
  // core/settings-io builds its settings path at module load
  getAgentDir: () => `${process.env.TMPDIR ?? "/tmp"}/pi-archimedes-mock-agent`,
}));
vi.mock("open", () => ({ default: vi.fn().mockResolvedValue({}) }));
vi.mock("./auth-storage.js", () => ({ deleteAuthEntry: vi.fn() }));

// ── fakes ────────────────────────────────────────────────────────────────────

function makeCtx(hasUI: boolean): { ctx: ExtensionCommandContext; notify: ReturnType<typeof vi.fn>; setStatus: ReturnType<typeof vi.fn>; confirm: ReturnType<typeof vi.fn>; input: ReturnType<typeof vi.fn> } {
  const notify = vi.fn();
  const setStatus = vi.fn();
  const confirm = vi.fn().mockResolvedValue(false);
  const input = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    hasUI,
    ui: { notify, setStatus, confirm, input },
  } as unknown as ExtensionCommandContext;
  return { ctx, notify, setStatus, confirm, input };
}

interface FakeClientOpts {
  outcome?: "success" | "wait" | "throw";
  error?: string;
  invokeAuthUrl?: boolean;
}

const AUTH_URL = "https://as.example/authorize?state=xyz";

function makeFakeClient(opts: FakeClientOpts = {}) {
  const client = {
    name: "srv",
    status: "needs-auth" as string,
    tools: [
      { name: "t1", serverName: "srv" },
      { name: "t2", serverName: "srv" },
    ],
    connect: vi.fn().mockImplementation(async () => { client.status = "connected"; }),
    close: vi.fn().mockResolvedValue(undefined),
    authenticate: null as unknown as ReturnType<typeof vi.fn>,
  };
  client.authenticate = vi.fn(
    (options?: { signal?: AbortSignal; onAuthorizationUrl?: (u: URL) => void | Promise<void> }) => {
      if (options?.signal?.aborted) return Promise.reject(new Error("OAuth cancelled"));
      if (opts.outcome === "wait") {
        return new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("OAuth cancelled")), { once: true });
        });
      }
      if (opts.outcome === "throw") return Promise.reject(new Error(opts.error ?? "boom"));
      if (opts.invokeAuthUrl) {
        return Promise.resolve(options?.onAuthorizationUrl?.(new URL(AUTH_URL))).then(() => undefined);
      }
      return Promise.resolve();
    },
  );
  return client;
}

function makeDeps(defs: Record<string, ServerDef>, client: unknown) {
  const manager = { getClient: vi.fn().mockReturnValue(client) } as unknown as ServerManager;
  const getServerDef = (name: string): HttpServerDef | undefined => {
    const def = defs[name];
    return def !== undefined && isHttpDef(def) ? def : undefined;
  };
  return { deps: { getServerDef, getManager: () => manager }, manager };
}

const oauthDef: HttpServerDef = { type: "http", url: "https://mcps.example/mcp", auth: "oauth" };

// ── runMcpAuthCommand ────────────────────────────────────────────────────────

describe("runMcpAuthCommand", () => {
  it("rejects without an interactive TUI", async () => {
    const { deps } = makeDeps({ srv: oauthDef }, makeFakeClient());
    const { ctx, notify } = makeCtx(false);
    await runMcpAuthCommand("srv", ctx, deps);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("interactive TUI"), "error");
  });

  it("notifies unknown servers", async () => {
    const { deps } = makeDeps({ srv: oauthDef }, makeFakeClient());
    const { ctx, notify } = makeCtx(true);
    await runMcpAuthCommand("ghost", ctx, deps);
    expect(notify).toHaveBeenCalledWith("Unknown server: ghost", "error");
  });

  it("treats stdio servers as unknown (OAuth is http/sse only)", async () => {
    const { deps } = makeDeps({ cli: { type: "stdio", command: "true" } }, makeFakeClient());
    const { ctx, notify } = makeCtx(true);
    await runMcpAuthCommand("cli", ctx, deps);
    expect(notify).toHaveBeenCalledWith("Unknown server: cli", "error");
  });

  it("finds a URL server without a type field (shape-based classification)", async () => {
    const client = makeFakeClient({ outcome: "success" });
    const { deps } = makeDeps({ srv: { url: "https://mcps.example/mcp", auth: "oauth" } }, client);
    const { ctx, notify } = makeCtx(true);
    await runMcpAuthCommand("srv", ctx, deps);
    expect(notify).not.toHaveBeenCalledWith("Unknown server: srv", "error");
    expect(notify).toHaveBeenCalledWith("✓ srv authenticated — 2 tools available", "info");
  });

  it("notifies servers configured for a static bearer token as not-OAuth", async () => {
    const { deps } = makeDeps(
      { svc: { type: "http", url: "http://127.0.0.1:1/mcp", auth: { token: "t" } } },
      makeFakeClient(),
    );
    const { ctx, notify } = makeCtx(true);
    await runMcpAuthCommand("svc", ctx, deps);
    expect(notify).toHaveBeenCalledWith("Server svc is not configured for OAuth", "error");
  });

  it("notifies when the manager holds no client for the server", async () => {
    const { deps } = makeDeps({ srv: oauthDef }, undefined);
    const { ctx, notify } = makeCtx(true);
    await runMcpAuthCommand("srv", ctx, deps);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("srv"), "error");
  });

  it("runs authenticate, opens the URL visibly, reconnects, and reports tools", async () => {
    const client = makeFakeClient({ outcome: "success", invokeAuthUrl: true });
    const { deps } = makeDeps({ srv: oauthDef }, client);
    const { ctx, notify, setStatus } = makeCtx(true);
    await runMcpAuthCommand("srv", ctx, deps);

    expect(client.authenticate).toHaveBeenCalledTimes(1);
    expect(client.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ onAuthorizationUrl: expect.any(Function) }),
    );
    // Browser opened + URL notified
    expect(open).toHaveBeenCalledWith(AUTH_URL);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining(AUTH_URL), "info");
    // Status set then cleared
    expect(setStatus).toHaveBeenCalledWith(expect.stringContaining("srv"), expect.stringContaining("srv"));
    expect(setStatus).toHaveBeenLastCalledWith(expect.stringContaining("srv"), undefined);
    // Reconnect + success notification
    expect(client.close).toHaveBeenCalled();
    expect(client.connect).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("✓ srv authenticated — 2 tools available", "info");
  });

  it("surfaces flow failures as error notifications", async () => {
    const client = makeFakeClient({ outcome: "throw", error: "token endpoint refused" });
    const { deps } = makeDeps({ srv: oauthDef }, client);
    const { ctx, notify } = makeCtx(true);
    await runMcpAuthCommand("srv", ctx, deps);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("token endpoint refused"), "error");
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("reports a failed reconnect after successful authentication", async () => {
    const client = makeFakeClient({ outcome: "success" });
    client.connect.mockRejectedValue(new Error("connection refused"));
    const { deps } = makeDeps({ srv: oauthDef }, client);
    const { ctx, notify } = makeCtx(true);
    await runMcpAuthCommand("srv", ctx, deps);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("connection refused"), "error");
  });
});

// ── mcpLogoutServer ──────────────────────────────────────────────────────────

describe("mcpLogoutServer", () => {
  it("deletes the keyring entry and closes the connected client", async () => {
    const { deleteAuthEntry } = vi.mocked(await import("./auth-storage.js"));
    const client = makeFakeClient();
    const { deps } = makeDeps({ srv: oauthDef }, client);
    const result = mcpLogoutServer("srv", deps.getManager);
    expect(deleteAuthEntry).toHaveBeenCalledWith("srv");
    expect(client.close).toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it("still deletes for a server the manager does not hold", async () => {
    const { deleteAuthEntry } = vi.mocked(await import("./auth-storage.js"));
    const { deps } = makeDeps({}, undefined);
    const result = mcpLogoutServer("ghost", deps.getManager);
    expect(deleteAuthEntry).toHaveBeenCalledWith("ghost");
    expect(result).toEqual({ ok: true });
  });

  it("reports a fail-closed keyring error instead of throwing", async () => {
    const { deleteAuthEntry } = vi.mocked(await import("./auth-storage.js"));
    deleteAuthEntry.mockImplementationOnce(() => {
      throw new Error("OS credential store unavailable");
    });
    const { deps } = makeDeps({}, makeFakeClient());
    const result = mcpLogoutServer("srv", deps.getManager);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("OS credential store unavailable");
  });
});
