import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import open from "open";
import { openAuthUrl, reconnectAfterAuth, runAuthWithLoader } from "./auth-run.js";
import { loadMetadataCache, setCachePathForTest } from "./metadata-cache.js";
import type { ServerClient } from "./server-client.js";

// The real BorderedLoader needs a live TUI; a stub with the same surface
// (constructor message + onAbort) is enough to drive the auth runner.
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

// The post-auth reconnect settles the ADR 0004 ledger (recordClientOutcome),
// which writes the cache file — point it at a temp dir so the real
// ~/.pi/agent/mcp-cache.json is never touched.
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "mcp-authrun-test-"));
  setCachePathForTest(join(tempDir, "cache.json"));
});

afterEach(() => {
  setCachePathForTest(null);
  rmSync(tempDir, { recursive: true, force: true });
});

const AUTH_URL = "https://as.example/authorize?state=xyz";
const LABEL = "Authenticating srv… (esc to cancel)";

// ── fakes ────────────────────────────────────────────────────────────────────

interface FakeClientOpts {
  /** success: resolves (optionally after onAuthorizationUrl settles);
   *  wait: hangs until the signal aborts (rejecting "OAuth cancelled");
   *  throw: rejects with `error`. */
  outcome?: "success" | "wait" | "throw";
  error?: string;
  invokeAuthUrl?: boolean;
  /** Status reported after close()+connect() (default: "connected"). */
  statusAfterReconnect?: string;
  toolCount?: number;
  /** Make connect() reject (reconnect-failed case). */
  reconnectError?: string;
}

function makeFakeClient(opts: FakeClientOpts = {}) {
  const client = {
    name: "srv",
    status: "needs-auth" as string,
    error: undefined as string | undefined,
    tools: Array.from({ length: opts.toolCount ?? 0 }, (_, i) => ({
      name: `t${i + 1}`,
      serverName: "srv",
    })),
    close: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockImplementation(async () => {
      if (opts.reconnectError) {
        // Mirror the real client: a thrown connect settles into "error".
        client.status = "error";
        client.error = opts.reconnectError;
        throw new Error(opts.reconnectError);
      }
      client.status = opts.statusAfterReconnect ?? "connected";
      client.error = undefined;
    }),
    authenticate: null as unknown as ReturnType<typeof vi.fn>,
  };
  client.authenticate = vi.fn(
    (options?: { signal?: AbortSignal; onAuthorizationUrl?: (u: URL) => void | Promise<void> }) => {
      if (options?.signal?.aborted) {
        return Promise.reject(new Error("OAuth cancelled"));
      }
      switch (opts.outcome ?? "success") {
        case "wait":
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
          if (opts.invokeAuthUrl) {
            // Resolve only after the URL hook settles, so `open()` and the
            // notification are guaranteed to have run before success.
            return Promise.resolve(options?.onAuthorizationUrl?.(new URL(AUTH_URL))).then(
              () => undefined,
            );
          }
          return Promise.resolve();
      }
    },
  );
  return client;
}

interface FakeLoader {
  message: string;
  onAbort?: () => void;
}

interface CtxState {
  notify: ReturnType<typeof vi.fn>;
  custom: ReturnType<typeof vi.fn>;
  lastLoader: () => FakeLoader | null;
}

/** Fake ExtensionContext: custom() runs the factory synchronously and
 *  resolves when done() is first called; the loader is captured. */
function makeCtx(): { ctx: ExtensionContext; state: CtxState } {
  const state: Omit<CtxState, "lastLoader"> = { notify: vi.fn(), custom: vi.fn() };
  let lastLoader: FakeLoader | null = null;
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
      lastLoader = factory({}, {}, {}, done) as FakeLoader | null;
      return pending;
    },
  );
  const ctx = {
    hasUI: true,
    ui: { notify: state.notify, custom: state.custom },
  } as unknown as ExtensionContext;
  return { ctx, state: { ...state, lastLoader: () => lastLoader } };
}

// ── runAuthWithLoader ────────────────────────────────────────────────────────

describe("runAuthWithLoader", () => {
  it("opens the URL, notifies, reconnects, and returns the reconnected status", async () => {
    const client = makeFakeClient({ outcome: "success", invokeAuthUrl: true, toolCount: 3 });
    const { ctx, state } = makeCtx();
    const outcome = await runAuthWithLoader(ctx, client as unknown as ServerClient, {
      loaderLabel: LABEL,
    });

    expect(outcome).toEqual({ kind: "reconnected", status: "connected", tools: 3 });
    // Loader shown with the caller-supplied label
    expect(state.custom).toHaveBeenCalledTimes(1);
    expect(state.lastLoader()!.message).toBe(LABEL);
    // authenticate called once with an (unaborted) abort signal + URL hook
    expect(client.authenticate).toHaveBeenCalledTimes(1);
    const opts = client.authenticate.mock.calls[0]![0] as {
      signal: AbortSignal;
      onAuthorizationUrl: (u: URL) => Promise<void>;
    };
    expect(opts.signal.aborted).toBe(false);
    // Browser opened for the auth URL, user notified of it
    expect(open).toHaveBeenCalledWith(AUTH_URL);
    expect(state.notify).toHaveBeenCalledWith(
      `Opening browser… if it didn't open, visit: ${AUTH_URL}`,
      "info",
    );
    // Reconnect to pick up the freshly stored token
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it("reports cancelled (no reconnect) when the loader is esc-closed", async () => {
    const client = makeFakeClient({ outcome: "wait" });
    const { ctx, state } = makeCtx();
    const running = runAuthWithLoader(ctx, client as unknown as ServerClient, {
      loaderLabel: LABEL,
    });
    await vi.waitFor(() => expect(client.authenticate).toHaveBeenCalledTimes(1));
    const opts = client.authenticate.mock.calls[0]![0] as { signal: AbortSignal };
    expect(opts.signal.aborted).toBe(false);

    // Simulate Esc in the loader
    state.lastLoader()!.onAbort!();
    const outcome = await running;

    expect(outcome).toEqual({ kind: "cancelled" });
    expect(opts.signal.aborted).toBe(true);
    expect(client.close).not.toHaveBeenCalled();
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("treats a flow rejection of exactly 'OAuth cancelled' as cancelled", async () => {
    // Externally aborted flow rejects "OAuth cancelled" without the loader
    // ever settling via onAbort.
    const client = makeFakeClient({ outcome: "throw", error: "OAuth cancelled" });
    const { ctx, state: s } = makeCtx();
    const running = runAuthWithLoader(ctx, client as unknown as ServerClient, {
      loaderLabel: LABEL,
    });
    // Esc is NOT pressed — only the flow rejection decides.
    const outcome = await running;
    expect(outcome).toEqual({ kind: "cancelled" });
    expect(client.close).not.toHaveBeenCalled();
    expect(s.notify).not.toHaveBeenCalled();
  });

  it("surfaces other flow failures as flow-error without reconnecting", async () => {
    const client = makeFakeClient({ outcome: "throw", error: "token endpoint refused" });
    const { ctx } = makeCtx();
    const outcome = await runAuthWithLoader(ctx, client as unknown as ServerClient, {
      loaderLabel: LABEL,
    });
    expect(outcome).toEqual({ kind: "flow-error", error: "token endpoint refused" });
    expect(client.close).not.toHaveBeenCalled();
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("reports a failed reconnect as reconnect-failed with the error message", async () => {
    const client = makeFakeClient({ reconnectError: "connection refused" });
    const { ctx } = makeCtx();
    const outcome = await runAuthWithLoader(ctx, client as unknown as ServerClient, {
      loaderLabel: LABEL,
    });
    expect(outcome).toEqual({ kind: "reconnect-failed", error: "connection refused" });
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it("carries the post-reconnect status (needs-auth recheck for ADR 0001)", async () => {
    const client = makeFakeClient({ statusAfterReconnect: "needs-auth" });
    const { ctx } = makeCtx();
    const outcome = await runAuthWithLoader(ctx, client as unknown as ServerClient, {
      loaderLabel: LABEL,
    });
    expect(outcome).toEqual({ kind: "reconnected", status: "needs-auth", tools: 0 });
  });
});

// ── reconnectAfterAuth ───────────────────────────────────────────────────────

describe("reconnectAfterAuth", () => {
  it("closes, reconnects, and snapshots status + tool count", async () => {
    const client = makeFakeClient({ toolCount: 2 });
    const outcome = await reconnectAfterAuth(client as unknown as ServerClient);
    expect(outcome).toEqual({ kind: "reconnected", status: "connected", tools: 2 });
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it("returns the close error as reconnect-failed", async () => {
    const client = makeFakeClient();
    client.close.mockRejectedValue(new Error("socket hang up"));
    const outcome = await reconnectAfterAuth(client as unknown as ServerClient);
    expect(outcome).toEqual({ kind: "reconnect-failed", error: "socket hang up" });
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("records 'connected' in the ADR 0004 ledger after a successful reconnect", async () => {
    const client = makeFakeClient({ statusAfterReconnect: "connected", toolCount: 2 });
    const outcome = await reconnectAfterAuth(client as unknown as ServerClient);
    expect(outcome).toEqual({ kind: "reconnected", status: "connected", tools: 2 });
    // The persisted outcome ledger (ADR 0004) must reflect the settled
    // connection — a stale "needs-auth" here would stick across sessions.
    const rec = loadMetadataCache().serverStatuses?.["srv"];
    expect(rec?.status).toBe("connected");
    expect(rec?.at).toBeTypeOf("number");
    expect(rec?.error).toBeUndefined();
  });

  it("records 'error' with the failure message when the post-auth reconnect fails", async () => {
    const client = makeFakeClient({ reconnectError: "connection refused" });
    const outcome = await reconnectAfterAuth(client as unknown as ServerClient);
    expect(outcome).toEqual({ kind: "reconnect-failed", error: "connection refused" });
    // The fake settles into "error" like the real client does for a thrown
    // connect — recordClientOutcome maps that to a recorded failure.
    const rec = loadMetadataCache().serverStatuses?.["srv"];
    expect(rec?.status).toBe("error");
    expect(rec?.error).toBe("connection refused");
    expect(rec?.at).toBeTypeOf("number");
  });
});

// ── openAuthUrl ──────────────────────────────────────────────────────────────

describe("openAuthUrl", () => {
  it("opens the URL in the browser", async () => {
    await expect(openAuthUrl(AUTH_URL)).resolves.toBeUndefined();
    expect(open).toHaveBeenCalledWith(AUTH_URL);
  });

  it("swallows browser-open failures", async () => {
    vi.mocked(open).mockRejectedValueOnce(new Error("no browser"));
    await expect(openAuthUrl(AUTH_URL)).resolves.toBeUndefined();
  });
});
