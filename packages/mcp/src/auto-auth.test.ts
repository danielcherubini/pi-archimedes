import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import open from "open";
import { autoAuthenticate, needsAuthToolResult } from "./auto-auth.js";
import type { ServerClient } from "./server-client.js";

// The real BorderedLoader needs a live TUI; a stub with the same surface
// (constructor message + onAbort) is enough to drive the auto-auth flow.
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

const AUTH_URL = "https://as.example/authorize?state=xyz";

// ── fakes ────────────────────────────────────────────────────────────────────

interface FakeClientOpts {
  /** success: resolves; wait: hangs until the signal aborts; throw: rejects with `error`. */
  outcome?: "success" | "wait" | "throw";
  error?: string;
  /** Status the client reports after close()+connect() (default: "connected"). */
  statusAfterReconnect?: string;
}

interface FakeClient {
  name: string;
  status: string;
  error: string | null;
  tools: never[];
  close: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  authenticate: ReturnType<typeof vi.fn>;
}

/** Minimal needs-auth ServerClient fake — authenticate/close/connect are scripted. */
function makeFakeClient(opts: FakeClientOpts = {}): FakeClient {
  const client: FakeClient = {
    name: "srv",
    status: "needs-auth",
    error: "authentication required or token rejected",
    tools: [],
    close: vi.fn(async () => {}),
    connect: vi.fn(async () => {
      client.status = opts.statusAfterReconnect ?? "connected";
    }),
    authenticate: vi.fn(),
  };
  client.authenticate.mockImplementation(
    (options?: { signal?: AbortSignal; onAuthorizationUrl?: (u: URL) => void | Promise<void> }) => {
      if (options?.signal?.aborted) return Promise.reject(new Error("OAuth cancelled"));
      switch (opts.outcome ?? "success") {
        case "wait":
          // Hangs until the signal aborts — like a browser flow awaiting a callback.
          return new Promise<void>((_resolve, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => reject(new Error("OAuth cancelled")),
              { once: true },
            );
          });
        case "throw":
          return Promise.reject(new Error(opts.error ?? "boom"));
        default:
          return Promise.resolve();
      }
    },
  );
  return client;
}

interface CtxState {
  notify: ReturnType<typeof vi.fn>;
  custom: ReturnType<typeof vi.fn>;
  lastLoader: () => { message: string; onAbort?: () => void } | null;
}

/** Fake ExtensionContext: custom() runs the factory synchronously and
 *  resolves when done() is first called; the loader is captured. */
function makeCtx(hasUI: boolean): { ctx: ExtensionContext; state: CtxState } {
  const state: Omit<CtxState, "lastLoader"> = { notify: vi.fn(), custom: vi.fn() };
  let lastLoader: { message: string; onAbort?: () => void } | null = null;
  state.custom.mockImplementation(
    (factory: (
      tui: unknown,
      theme: unknown,
      keybindings: unknown,
      done: (result: unknown) => void,
    ) => unknown) => {
      let resolve!: (result: unknown) => void;
      const pending = new Promise<unknown>((r) => (resolve = r));
      let settled = false;
      const done = (result: unknown) => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };
      lastLoader = factory({}, {}, {}, done) as { message: string; onAbort?: () => void } | null;
      return pending;
    },
  );
  const ctx = {
    hasUI,
    signal: new AbortController().signal,
    ui: { notify: state.notify, custom: state.custom },
  } as unknown as ExtensionContext;
  return { ctx, state: { ...state, lastLoader: () => lastLoader } };
}

// ── needsAuthToolResult ──────────────────────────────────────────────────────

describe("needsAuthToolResult", () => {
  it("is guidance (isError false) pointing at /mcp auth <server>", () => {
    const r = needsAuthToolResult("auth-srv");
    expect(r.isError).toBe(false);
    expect(r.details).toEqual({ server: "auth-srv", status: "needs-auth" });
    const text = r.content[0]!.text;
    expect(text).toContain("requires authentication");
    expect(text).toContain("/mcp auth auth-srv");
    expect(text).not.toContain("Auto-auth failed");
  });

  it("includes the auto-auth error when provided", () => {
    const r = needsAuthToolResult("auth-srv", "OAuth cancelled");
    const text = r.content[0]!.text;
    expect(text).toContain("OAuth cancelled");
    expect(text).toContain("/mcp auth auth-srv");
    expect(r.isError).toBe(false);
  });
});

// ── autoAuthenticate ─────────────────────────────────────────────────────────

describe("autoAuthenticate", () => {
  it("runs the flow through a BorderedLoader, opens the URL, and reconnects on success", async () => {
    const client = makeFakeClient();
    const { ctx, state } = makeCtx(true);
    const outcome = await autoAuthenticate(ctx, client as unknown as ServerClient);

    expect(outcome.proceed).toBe(true);
    expect(outcome.error).toBeUndefined();
    expect(state.custom).toHaveBeenCalledTimes(1);
    expect(state.lastLoader()!.message).toContain("srv");
    expect(client.authenticate).toHaveBeenCalledTimes(1);
    const opts = client.authenticate.mock.calls[0]![0] as {
      signal: AbortSignal;
      onAuthorizationUrl: (u: URL) => Promise<void>;
    };
    expect(opts.signal.aborted).toBe(false);
    // Authorization URL: open the browser and notify the user of it
    await opts.onAuthorizationUrl(new URL(AUTH_URL));
    expect(open).toHaveBeenCalledWith(AUTH_URL);
    expect(state.notify).toHaveBeenCalledWith(expect.stringContaining(AUTH_URL), "info");
    // Reconnect to pick up the freshly stored token (mirrors /mcp auth)
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it("esc aborts the flow, reports cancellation, and does not reconnect", async () => {
    const client = makeFakeClient({ outcome: "wait" });
    const { ctx, state } = makeCtx(true);
    const running = autoAuthenticate(ctx, client as unknown as ServerClient);
    await vi.waitFor(() => expect(client.authenticate).toHaveBeenCalledTimes(1));
    const opts = client.authenticate.mock.calls[0]![0] as { signal: AbortSignal };
    expect(opts.signal.aborted).toBe(false);

    // Simulate Esc in the loader
    state.lastLoader()!.onAbort!();
    const outcome = await running;

    expect(opts.signal.aborted).toBe(true);
    expect(outcome.proceed).toBe(false);
    expect(outcome.error).toBe("OAuth cancelled");
    expect(client.close).not.toHaveBeenCalled();
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("surfaces flow failures without throwing and without reconnecting", async () => {
    const client = makeFakeClient({ outcome: "throw", error: "token endpoint refused" });
    const { ctx } = makeCtx(true);
    const outcome = await autoAuthenticate(ctx, client as unknown as ServerClient);
    expect(outcome.proceed).toBe(false);
    expect(outcome.error).toBe("token endpoint refused");
    expect(client.close).not.toHaveBeenCalled();
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("runs headless (no loader) when the context has no UI", async () => {
    const client = makeFakeClient();
    const { ctx, state } = makeCtx(false);
    const outcome = await autoAuthenticate(ctx, client as unknown as ServerClient);
    expect(outcome.proceed).toBe(true);
    expect(state.custom).not.toHaveBeenCalled();
    expect(client.authenticate).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it("returns the error headless when the flow fails", async () => {
    const client = makeFakeClient({ outcome: "throw", error: "keyring unavailable" });
    const { ctx } = makeCtx(false);
    const outcome = await autoAuthenticate(ctx, client as unknown as ServerClient);
    expect(outcome).toEqual({ proceed: false, error: "keyring unavailable" });
    expect(client.close).not.toHaveBeenCalled();
  });

  it("reports when the reconnected server still needs auth (ADR 0001 re-auth loop)", async () => {
    const client = makeFakeClient({ statusAfterReconnect: "needs-auth" });
    const { ctx } = makeCtx(false);
    const outcome = await autoAuthenticate(ctx, client as unknown as ServerClient);
    expect(outcome.proceed).toBe(false);
    expect(outcome.error).toMatch(/still/i);
  });

  it("reports a failed reconnect after successful authentication", async () => {
    const client = makeFakeClient();
    client.connect.mockRejectedValue(new Error("connection refused"));
    const { ctx } = makeCtx(false);
    const outcome = await autoAuthenticate(ctx, client as unknown as ServerClient);
    expect(outcome.proceed).toBe(false);
    expect(outcome.error).toContain("connection refused");
  });
});
