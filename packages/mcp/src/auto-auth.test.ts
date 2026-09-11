import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import open from "open";
import { autoAuthenticate, needsAuthToolResult } from "./auto-auth.js";
import type { ServerClient } from "./server-client.js";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => `${process.env.TMPDIR ?? "/tmp"}/pi-archimedes-mock-agent`,
}));
vi.mock("open", () => ({ default: vi.fn().mockResolvedValue({}) }));

const AUTH_URL = "https://as.example/authorize?state=xyz";

// ── fakes ────────────────────────────────────────────────────────────────────

interface FakeClientOpts {
  outcome?: "success" | "wait" | "throw";
  error?: string;
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

function makeCtx(hasUI: boolean) {
  const notify = vi.fn();
  const setStatus = vi.fn();
  const confirm = vi.fn().mockResolvedValue(false);
  const input = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    hasUI,
    signal: new AbortController().signal,
    ui: { notify, setStatus, confirm, input },
  } as unknown as ExtensionContext;
  return { ctx, notify, setStatus };
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
  it("with UI: runs authenticate, shows status, opens browser, reconnects on success", async () => {
    const client = makeFakeClient();
    const { ctx, notify, setStatus } = makeCtx(true);
    const outcome = await autoAuthenticate(ctx, client as unknown as ServerClient);

    expect(outcome.proceed).toBe(true);
    expect(outcome.error).toBeUndefined();
    expect(client.authenticate).toHaveBeenCalledTimes(1);
    const opts = client.authenticate.mock.calls[0]![0] as {
      onAuthorizationUrl: (u: URL) => Promise<void>;
      onAuthorizationInput: unknown;
    };
    expect(typeof opts.onAuthorizationInput).toBe("function");
    // Authorization URL: notify first, then open browser
    await opts.onAuthorizationUrl(new URL(AUTH_URL));
    expect(notify).toHaveBeenCalledWith(expect.stringContaining(AUTH_URL), "info");
    expect(open).toHaveBeenCalledWith(AUTH_URL);
    // Status set + cleared
    expect(setStatus).toHaveBeenCalledWith(expect.stringContaining("srv"), expect.any(String));
    expect(setStatus).toHaveBeenLastCalledWith(expect.stringContaining("srv"), undefined);
    // Reconnect to pick up the freshly stored token
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it("with UI: surfaces flow failures without throwing and without reconnecting", async () => {
    const client = makeFakeClient({ outcome: "throw", error: "token endpoint refused" });
    const { ctx } = makeCtx(true);
    const outcome = await autoAuthenticate(ctx, client as unknown as ServerClient);
    expect(outcome.proceed).toBe(false);
    expect(outcome.error).toBe("token endpoint refused");
    expect(client.close).not.toHaveBeenCalled();
  });

  it("headless: runs plainly (no setStatus) when the context has no UI", async () => {
    const client = makeFakeClient();
    const { ctx, setStatus } = makeCtx(false);
    const outcome = await autoAuthenticate(ctx, client as unknown as ServerClient);
    expect(outcome.proceed).toBe(true);
    expect(setStatus).not.toHaveBeenCalled();
    expect(client.authenticate).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it("headless: returns the error when the flow fails", async () => {
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
