import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import open from "open";
import { registerAuthCommands } from "./commands-auth.js";
import type { ServerManager } from "./server-manager.js";
import type { HttpServerDef, ServerDef } from "./types.js";

// ── mocks ────────────────────────────────────────────────────────────────────
// The real BorderedLoader needs a live TUI; a stub with the same surface
// (constructor message + onAbort) is enough to drive the command handlers.
vi.mock("@earendil-works/pi-coding-agent", () => ({
  BorderedLoader: class {
    message: string;
    onAbort?: () => void;
    constructor(_tui: unknown, _theme: unknown, message: string) {
      this.message = message;
    }
    dispose() {}
  },
}));
vi.mock("open", () => ({ default: vi.fn().mockResolvedValue({}) }));
vi.mock("./auth-storage.js", () => ({ deleteAuthEntry: vi.fn() }));

// ── fakes ────────────────────────────────────────────────────────────────────

interface CapturedCommand {
  description?: string;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
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
  return {
    deps: {
      getServerDef: (name: string) => {
        const def = defs[name];
        return def !== undefined && (def.type === "http" || def.type === "sse") ? def : undefined;
      },
      getManager: () => manager,
    },
    manager,
    register: (pi: ExtensionAPI) => registerAuthCommands(pi, {
      getServerDef: (name: string) => {
        const def = defs[name];
        return def !== undefined && (def.type === "http" || def.type === "sse") ? def : undefined;
      },
      getManager: () => manager,
    }),
  };
}

const oauthDef: HttpServerDef = { type: "http", url: "https://mcps.example/mcp", auth: "oauth" };

// ── registration ─────────────────────────────────────────────────────────────

describe("registerAuthCommands", () => {
  it("registers /mcp-auth and /mcp-logout", () => {
    const { pi, commands } = makeFakePi();
    makeDeps({ srv: oauthDef }, makeFakeClient()).register(pi);
    expect(Object.keys(commands).sort()).toEqual(["mcp-auth", "mcp-logout"]);
    expect(typeof commands["mcp-auth"]!.handler).toBe("function");
    expect(typeof commands["mcp-logout"]!.handler).toBe("function");
  });
});

// ── /mcp-auth ────────────────────────────────────────────────────────────────

describe("/mcp-auth", () => {
  it("shows usage when no server name is given", async () => {
    const { pi, commands } = makeFakePi();
    makeDeps({ srv: oauthDef }, makeFakeClient()).register(pi);
    const { ctx, state } = makeCtx(true);
    await commands["mcp-auth"]!.handler("", ctx);
    expect(state.notify).toHaveBeenCalledWith("Usage: /mcp-auth <server>", "info");
    expect(state.custom).not.toHaveBeenCalled();
  });

  it("rejects without an interactive TUI", async () => {
    const { pi, commands } = makeFakePi();
    makeDeps({ srv: oauthDef }, makeFakeClient()).register(pi);
    const { ctx, state } = makeCtx(false);
    await commands["mcp-auth"]!.handler("srv", ctx);
    expect(state.notify).toHaveBeenCalledWith(
      expect.stringContaining("interactive TUI"),
      "error",
    );
    expect(state.custom).not.toHaveBeenCalled();
  });

  it("notifies unknown servers", async () => {
    const { pi, commands } = makeFakePi();
    makeDeps({ srv: oauthDef }, makeFakeClient()).register(pi);
    const { ctx, state } = makeCtx(true);
    await commands["mcp-auth"]!.handler("ghost", ctx);
    expect(state.notify).toHaveBeenCalledWith("Unknown server: ghost", "error");
    expect(state.custom).not.toHaveBeenCalled();
  });

  it("treats stdio servers as unknown (OAuth is http/sse only)", async () => {
    const { pi, commands } = makeFakePi();
    makeDeps(
      { srv: oauthDef, cli: { type: "stdio", command: "true" } },
      makeFakeClient(),
    ).register(pi);
    const { ctx, state } = makeCtx(true);
    await commands["mcp-auth"]!.handler("cli", ctx);
    expect(state.notify).toHaveBeenCalledWith("Unknown server: cli", "error");
    expect(state.custom).not.toHaveBeenCalled();
  });

  it("notifies machines configured for a static bearer token as not-OAuth", async () => {
    const { pi, commands } = makeFakePi();
    makeDeps(
      { svc: { type: "http", url: "http://127.0.0.1:1/mcp", auth: { token: "t" } } },
      makeFakeClient(),
    ).register(pi);
    const { ctx, state } = makeCtx(true);
    await commands["mcp-auth"]!.handler("svc", ctx);
    expect(state.notify).toHaveBeenCalledWith("Server svc is not configured for OAuth", "error");
    expect(state.custom).not.toHaveBeenCalled();
  });

  it("notifies when the manager holds no client for the server", async () => {
    const { pi, commands } = makeFakePi();
    makeDeps({ srv: oauthDef }, undefined).register(pi);
    const { ctx, state } = makeCtx(true);
    await commands["mcp-auth"]!.handler("srv", ctx);
    expect(state.notify).toHaveBeenCalledWith(
      expect.stringContaining("srv"),
      "error",
    );
    expect(state.custom).not.toHaveBeenCalled();
  });

  it("runs authenticate on the client, opens the URL, reconnects, and reports tools", async () => {
    const client = makeFakeClient({ outcome: "success", invokeAuthUrl: true });
    const { pi, commands } = makeFakePi();
    makeDeps({ srv: oauthDef }, client).register(pi);
    const { ctx, state } = makeCtx(true);
    await commands["mcp-auth"]!.handler("srv", ctx);

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
    const { pi, commands } = makeFakePi();
    makeDeps({ srv: oauthDef }, client).register(pi);
    const { ctx, state } = makeCtx(true);

    const running = commands["mcp-auth"]!.handler("srv", ctx);
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
    const { pi, commands } = makeFakePi();
    makeDeps({ srv: oauthDef }, client).register(pi);
    const { ctx, state } = makeCtx(true);
    await commands["mcp-auth"]!.handler("srv", ctx);
    expect(state.notify).toHaveBeenCalledWith(
      expect.stringContaining("token endpoint refused"),
      "error",
    );
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("reports a failed reconnect after successful authentication", async () => {
    const client = makeFakeClient({ outcome: "success" });
    client.connect.mockRejectedValue(new Error("connection refused"));
    const { pi, commands } = makeFakePi();
    makeDeps({ srv: oauthDef }, client).register(pi);
    const { ctx, state } = makeCtx(true);
    await commands["mcp-auth"]!.handler("srv", ctx);
    expect(state.notify).toHaveBeenCalledWith(
      expect.stringContaining("connection refused"),
      "error",
    );
  });
});

// ── /mcp-logout ──────────────────────────────────────────────────────────────

describe("/mcp-logout", () => {
  it("shows usage when no server name is given", async () => {
    const { pi, commands } = makeFakePi();
    const { deleteAuthEntry } = vi.mocked(await import("./auth-storage.js"));
    makeDeps({}, makeFakeClient()).register(pi);
    const { ctx, state } = makeCtx(true);
    await commands["mcp-logout"]!.handler("", ctx);
    expect(state.notify).toHaveBeenCalledWith("Usage: /mcp-logout <server>", "info");
    expect(deleteAuthEntry).not.toHaveBeenCalled();
  });

  it("deletes the keyring entry, closes the connected client, and notifies", async () => {
    const { deleteAuthEntry } = vi.mocked(await import("./auth-storage.js"));
    const client = makeFakeClient();
    const { pi, commands } = makeFakePi();
    makeDeps({ srv: oauthDef }, client).register(pi);
    const { ctx, state } = makeCtx(true);
    await commands["mcp-logout"]!.handler("srv", ctx);
    expect(deleteAuthEntry).toHaveBeenCalledWith("srv");
    expect(client.close).toHaveBeenCalled();
    expect(state.notify).toHaveBeenCalledWith("Logged out of srv", "info");
  });

  it("still deletes and notifies for a server the manager does not hold", async () => {
    const { deleteAuthEntry } = vi.mocked(await import("./auth-storage.js"));
    const { pi, commands } = makeFakePi();
    makeDeps({}, undefined).register(pi);
    const { ctx, state } = makeCtx(true);
    await commands["mcp-logout"]!.handler("ghost", ctx);
    expect(deleteAuthEntry).toHaveBeenCalledWith("ghost");
    expect(state.notify).toHaveBeenCalledWith("Logged out of ghost", "info");
  });

  it("reports a fail-closed keyring as an error instead of throwing", async () => {
    const { deleteAuthEntry } = vi.mocked(await import("./auth-storage.js"));
    deleteAuthEntry.mockImplementationOnce(() => {
      throw new Error("OS credential store unavailable — cannot store OAuth tokens securely");
    });
    const { pi, commands } = makeFakePi();
    makeDeps({}, makeFakeClient()).register(pi);
    const { ctx, state } = makeCtx(true);
    await commands["mcp-logout"]!.handler("srv", ctx);
    expect(state.notify).toHaveBeenCalledWith(
      expect.stringContaining("OS credential store unavailable"),
      "error",
    );
    expect(state.notify).not.toHaveBeenCalledWith("Logged out of srv", undefined);
  });
});
