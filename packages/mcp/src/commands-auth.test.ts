import { describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import open from "open";
import { isHttpDef } from "./config.js";
import { mcpLogoutServer, runMcpAuthCommand } from "./commands-auth.js";
import type { ServerManager } from "./server-manager.js";
import type { HttpServerDef, ServerDef } from "./types.js";

// ── mocks ────────────────────────────────────────────────────────────────────
// The real BorderedLoader needs a live TUI; a stub with the same surface
// (constructor message + onAbort) is enough to drive runMcpAuthCommand.
vi.mock("@earendil-works/pi-coding-agent", () => ({
  BorderedLoader: class {
    message: string;
    onAbort?: () => void;
    constructor(_tui: unknown, _theme: unknown, message: string) {
      this.message = message;
    }
    dispose() {}
  },
  // core/settings-io builds its settings path at module load
  getAgentDir: () => `${process.env.TMPDIR ?? "/tmp"}/pi-archimedes-mock-agent`,
}));
vi.mock("open", () => ({ default: vi.fn().mockResolvedValue({}) }));
vi.mock("./auth-storage.js", () => ({ deleteAuthEntry: vi.fn() }));

// ── fakes ────────────────────────────────────────────────────────────────────

/** The loader shape `ui.custom`'s factory returns (BorderedLoader surface). */
interface FakeLoader {
  message: string;
  onAbort?: () => void;
}

interface CtxState {
  notify: ReturnType<typeof vi.fn>;
  custom: ReturnType<typeof vi.fn>;
  lastLoader: FakeLoader | null;
}

/** Fake ExtensionCommandContext: notify is captured; ui.custom runs the
 *  factory synchronously and resolves when done() is first called. */
function makeCtx(hasUI: boolean): { ctx: ExtensionCommandContext; state: CtxState } {
  const state: CtxState = { notify: vi.fn(), custom: vi.fn(), lastLoader: null };
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
      state.lastLoader = factory({}, {}, {}, done) as FakeLoader;
      return pending;
    },
  };
  return {
    ctx: { hasUI, ui } as unknown as ExtensionCommandContext,
    state,
  };
}

interface FakeClientOpts {
  /** success: resolves (optionally after onAuthorizationUrl settles);
   *  wait: neither settles nor rejects until the signal aborts;
   *  throw: rejects with `error`. */
  outcome?: "success" | "wait" | "throw";
  error?: string;
  invokeAuthUrl?: boolean;
}

const AUTH_URL = "https://as.example/authorize?state=xyz";

/** Fake ServerClient: authenticate/close/connect are individually scripted. */
function makeFakeClient(opts: FakeClientOpts = {}) {
  const client = {
    status: "needs-auth" as string,
    tools: [
      { name: "t1", serverName: "srv" },
      { name: "t2", serverName: "srv" },
    ],
    connect: vi.fn().mockImplementation(async () => {
      client.status = "connected";
    }),
    close: vi.fn().mockResolvedValue(undefined),
    authenticate: null as unknown as ReturnType<typeof vi.fn>,
  };
  client.authenticate = vi.fn(
    (options?: { signal?: AbortSignal; onAuthorizationUrl?: (u: URL) => void | Promise<void> }) => {
      const { outcome = "success", error, invokeAuthUrl } = opts;
      if (options?.signal?.aborted) {
        return Promise.reject(new Error("OAuth cancelled"));
      }
      if (outcome === "wait") {
        // Hangs until the signal aborts — like a browser flow awaiting a callback.
        return new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new Error("OAuth cancelled")),
            { once: true },
          );
        });
      }
      if (outcome === "throw") {
        return Promise.reject(new Error(error ?? "boom"));
      }
      if (invokeAuthUrl) {
        // Resolve only after the URL hook settles, so `open()` and the
        // notification are guaranteed to have run before success.
        return Promise.resolve(options?.onAuthorizationUrl?.(new URL(AUTH_URL))).then(
          () => undefined,
        );
      }
      return Promise.resolve();
    },
  );
  return client;
}

/** Deps mirroring the index.ts wiring: fresh config read, http/sse defs only. */
function makeDeps(defs: Record<string, ServerDef>, client: unknown) {
  const manager = { getClient: vi.fn().mockReturnValue(client) } as unknown as ServerManager;
  // Mirrors the production index.ts wiring: shape-based (url) classification
  const getServerDef = (name: string): HttpServerDef | undefined => {
    const def = defs[name];
    return def !== undefined && isHttpDef(def) ? def : undefined;
  };
  return {
    deps: { getServerDef, getManager: () => manager },
    manager,
  };
}

const oauthDef: HttpServerDef = { type: "http", url: "https://mcps.example/mcp", auth: "oauth" };

// ── runMcpAuthCommand (former /mcp-auth handler body) ──────────────────────

describe("runMcpAuthCommand", () => {
  it("rejects without an interactive TUI", async () => {
    const { deps } = makeDeps({ srv: oauthDef }, makeFakeClient());
    const { ctx, state } = makeCtx(false);
    await runMcpAuthCommand("srv", ctx, deps);
    expect(state.notify).toHaveBeenCalledWith(
      expect.stringContaining("interactive TUI"),
      "error",
    );
    expect(state.custom).not.toHaveBeenCalled();
  });

  it("notifies unknown servers", async () => {
    const { deps } = makeDeps({ srv: oauthDef }, makeFakeClient());
    const { ctx, state } = makeCtx(true);
    await runMcpAuthCommand("ghost", ctx, deps);
    expect(state.notify).toHaveBeenCalledWith("Unknown server: ghost", "error");
    expect(state.custom).not.toHaveBeenCalled();
  });

  it("treats stdio servers as unknown (OAuth is http/sse only)", async () => {
    const { deps } = makeDeps(
      { cli: { type: "stdio", command: "true" } },
      makeFakeClient(),
    );
    const { ctx, state } = makeCtx(true);
    await runMcpAuthCommand("cli", ctx, deps);
    expect(state.notify).toHaveBeenCalledWith("Unknown server: cli", "error");
    expect(state.custom).not.toHaveBeenCalled();
  });

  it("finds a URL server without a type field (shape-based classification)", async () => {
    const client = makeFakeClient({ outcome: "success" });
    const { deps } = makeDeps(
      { srv: { url: "https://mcps.example/mcp", auth: "oauth" } },
      client,
    );
    const { ctx, state } = makeCtx(true);
    await runMcpAuthCommand("srv", ctx, deps);
    expect(state.notify).not.toHaveBeenCalledWith("Unknown server: srv", "error");
    expect(state.notify).toHaveBeenCalledWith("✓ srv authenticated — 2 tools available", "info");
  });

  it("notifies machines configured for a static bearer token as not-OAuth", async () => {
    const { deps } = makeDeps(
      { svc: { type: "http", url: "http://127.0.0.1:1/mcp", auth: { token: "t" } } },
      makeFakeClient(),
    );
    const { ctx, state } = makeCtx(true);
    await runMcpAuthCommand("svc", ctx, deps);
    expect(state.notify).toHaveBeenCalledWith("Server svc is not configured for OAuth", "error");
    expect(state.custom).not.toHaveBeenCalled();
  });

  it("notifies when the manager holds no client for the server", async () => {
    const { deps } = makeDeps({ srv: oauthDef }, undefined);
    const { ctx, state } = makeCtx(true);
    await runMcpAuthCommand("srv", ctx, deps);
    expect(state.notify).toHaveBeenCalledWith(
      expect.stringContaining("srv"),
      "error",
    );
    expect(state.custom).not.toHaveBeenCalled();
  });

  it("runs authenticate on the client, opens the URL, reconnects, and reports tools", async () => {
    const client = makeFakeClient({ outcome: "success", invokeAuthUrl: true });
    const { deps } = makeDeps({ srv: oauthDef }, client);
    const { ctx, state } = makeCtx(true);
    await runMcpAuthCommand("srv", ctx, deps);

    // Single entry point: authenticate with an abort signal + URL hook
    expect(client.authenticate).toHaveBeenCalledTimes(1);
    expect(client.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        onAuthorizationUrl: expect.any(Function),
      }),
    );
    // Browser opened with the canonical URL + user notified of it
    expect(open).toHaveBeenCalledWith(AUTH_URL);
    expect(state.notify).toHaveBeenCalledWith(
      `Opening browser… if it didn't open, visit: ${AUTH_URL}`,
      "info",
    );
    // Loader label mentions the server
    expect(state.lastLoader?.message).toContain("srv");
    // Reconnect to pick up the new token, success with tool count
    expect(client.close).toHaveBeenCalled();
    expect(client.connect).toHaveBeenCalled();
    expect(state.notify).toHaveBeenCalledWith("✓ srv authenticated — 2 tools available", "info");
  });

  it("Esc aborts the controller, cancels cleanly, and closes without reconnect", async () => {
    const client = makeFakeClient({ outcome: "wait" });
    const { deps } = makeDeps({ srv: oauthDef }, client);
    const { ctx, state } = makeCtx(true);

    const running = runMcpAuthCommand("srv", ctx, deps);
    await vi.waitFor(() => expect(client.authenticate).toHaveBeenCalledTimes(1));
    const signal = (client.authenticate.mock.calls[0]?.[0] as { signal: AbortSignal }).signal;
    expect(signal.aborted).toBe(false);

    // Simulate Esc in the loader
    state.lastLoader!.onAbort!();
    await running;

    expect(signal.aborted).toBe(true);
    expect(state.notify).toHaveBeenCalledWith("Authentication cancelled", "info");
    expect(state.notify).not.toHaveBeenCalledWith(expect.anything(), "error");
    expect(client.close).not.toHaveBeenCalled();
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("surfaces flow failures as error notifications", async () => {
    const client = makeFakeClient({ outcome: "throw", error: "token endpoint refused" });
    const { deps } = makeDeps({ srv: oauthDef }, client);
    const { ctx, state } = makeCtx(true);
    await runMcpAuthCommand("srv", ctx, deps);
    expect(state.notify).toHaveBeenCalledWith(
      expect.stringContaining("token endpoint refused"),
      "error",
    );
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("reports a failed reconnect after successful authentication", async () => {
    const client = makeFakeClient({ outcome: "success" });
    client.connect.mockRejectedValue(new Error("connection refused"));
    const { deps } = makeDeps({ srv: oauthDef }, client);
    const { ctx, state } = makeCtx(true);
    await runMcpAuthCommand("srv", ctx, deps);
    expect(state.notify).toHaveBeenCalledWith(
      expect.stringContaining("connection refused"),
      "error",
    );
  });
});

// ── mcpLogoutServer (former /mcp-logout handler body) ──────────────────────

describe("mcpLogoutServer", () => {
  it("deletes the keyring entry and closes the connected client", async () => {
    const { deleteAuthEntry } = vi.mocked(await import("./auth-storage.js"));
    const client = makeFakeClient();
    const { deps, manager } = makeDeps({ srv: oauthDef }, client);
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

  it("reports a fail-closed keyring instead of throwing", async () => {
    const { deleteAuthEntry } = vi.mocked(await import("./auth-storage.js"));
    deleteAuthEntry.mockImplementationOnce(() => {
      throw new Error("OS credential store unavailable — cannot store OAuth tokens securely");
    });
    const { deps } = makeDeps({}, makeFakeClient());
    const result = mcpLogoutServer("srv", deps.getManager);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("OS credential store unavailable");
  });
});
