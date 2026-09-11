import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import open from "open";
import { openAuthUrl, reconnectAfterAuth, runAuthWithLoader } from "./auth-run.js";
import { loadMetadataCache, setCachePathForTest } from "./metadata-cache.js";
import type { ServerClient } from "./server-client.js";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => `${process.env.TMPDIR ?? "/tmp"}/pi-archimedes-mock-agent`,
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
const LABEL = "Authenticating srv…";

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

function makeCtx() {
  const notify = vi.fn();
  const setStatus = vi.fn();
  const confirm = vi.fn().mockResolvedValue(false);
  const input = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    hasUI: true,
    ui: { notify, setStatus, confirm, input },
  } as unknown as ExtensionContext;
  return { ctx, notify, setStatus, confirm, input };
}

// ── runAuthWithLoader ────────────────────────────────────────────────────────

describe("runAuthWithLoader", () => {
  it("notifies the URL first, opens the browser, reconnects, returns reconnected", async () => {
    const client = makeFakeClient({ outcome: "success", invokeAuthUrl: true, toolCount: 3 });
    const { ctx, notify, setStatus } = makeCtx();
    const outcome = await runAuthWithLoader(ctx, client as unknown as ServerClient, {
      loaderLabel: LABEL,
    });

    expect(outcome).toEqual({ kind: "reconnected", status: "connected", tools: 3 });
    // Status set during, cleared after
    expect(setStatus).toHaveBeenCalledWith("mcp-auth-srv", LABEL);
    expect(setStatus).toHaveBeenLastCalledWith("mcp-auth-srv", undefined);
    // Notification fired with URL (before open)
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining(AUTH_URL),
      "info",
    );
    // Browser opened
    expect(open).toHaveBeenCalledWith(AUTH_URL);
    // Reconnect to pick up the freshly stored token
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it("clears setStatus even when the flow fails", async () => {
    const client = makeFakeClient({ outcome: "throw", error: "boom" });
    const { ctx, setStatus } = makeCtx();
    await runAuthWithLoader(ctx, client as unknown as ServerClient, { loaderLabel: LABEL });
    expect(setStatus).toHaveBeenLastCalledWith("mcp-auth-srv", undefined);
  });

  it("treats 'OAuth cancelled' rejection as cancelled (no reconnect)", async () => {
    const client = makeFakeClient({ outcome: "throw", error: "OAuth cancelled" });
    const { ctx } = makeCtx();
    const outcome = await runAuthWithLoader(ctx, client as unknown as ServerClient, {
      loaderLabel: LABEL,
    });
    expect(outcome).toEqual({ kind: "cancelled" });
    expect(client.close).not.toHaveBeenCalled();
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("surfaces other flow failures as flow-error without reconnecting", async () => {
    const client = makeFakeClient({ outcome: "throw", error: "token endpoint refused" });
    const { ctx } = makeCtx();
    const outcome = await runAuthWithLoader(ctx, client as unknown as ServerClient, {
      loaderLabel: LABEL,
    });
    expect(outcome).toEqual({ kind: "flow-error", error: "token endpoint refused" });
    expect(client.close).not.toHaveBeenCalled();
  });

  it("reports a failed reconnect as reconnect-failed", async () => {
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

  it("passes onAuthorizationInput to authenticate", async () => {
    const client = makeFakeClient({ outcome: "success" });
    const { ctx } = makeCtx();
    await runAuthWithLoader(ctx, client as unknown as ServerClient, { loaderLabel: LABEL });
    const opts = client.authenticate.mock.calls[0]![0] as {
      onAuthorizationInput?: unknown;
    };
    expect(typeof opts.onAuthorizationInput).toBe("function");
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
    await reconnectAfterAuth(client as unknown as ServerClient);
    const rec = loadMetadataCache().serverStatuses?.["srv"];
    expect(rec?.status).toBe("connected");
    expect(rec?.at).toBeTypeOf("number");
    expect(rec?.error).toBeUndefined();
  });

  it("records 'error' with the failure message when the post-auth reconnect fails", async () => {
    const client = makeFakeClient({ reconnectError: "connection refused" });
    await reconnectAfterAuth(client as unknown as ServerClient);
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
