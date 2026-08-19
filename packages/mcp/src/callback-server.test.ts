import { createServer, get as httpGet } from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  CALLBACK_TIMEOUT_MS,
  DEFAULT_CALLBACK_PATH,
  DEFAULT_CALLBACK_PORT,
  ensureCallbackServer,
  getCallbackPath,
  getCallbackPort,
  reserveAuthState,
  stopCallbackServer,
  waitForCallback,
} from "./callback-server.js";

/**
 * GET helper returning status + body. `Connection: close` is sent so the
 * server-side socket does not linger in the keep-alive pool after the
 * response — otherwise `server.close()` (and thus `stopCallbackServer`)
 * would wait for idle sockets and tests would hang.
 */
function httpGetText(
  port: number,
  path: string,
): Promise<{ status: number; body: string; contentType?: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = httpGet(
      { host: "127.0.0.1", port, path, headers: { connection: "close" } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            contentType: res.headers["content-type"],
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** Connect probe: true when something accepts TCP on 127.0.0.1:<port>. */
async function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

const ENV_KEY = "MCP_OAUTH_CALLBACK_PORT";

/** The singleton persists across tests within this file — one start, stop at the end. */
let port: number;

beforeAll(async () => {
  port = await ensureCallbackServer({ port: 0 });
});

afterAll(async () => {
  await stopCallbackServer();
});

describe("callback-server config", () => {
  const originalEnv = process.env[ENV_KEY];

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
  });

  it("exposes the default port, path, and timeout constants", () => {
    expect(DEFAULT_CALLBACK_PORT).toBe(19876);
    expect(DEFAULT_CALLBACK_PATH).toBe("/callback");
    expect(CALLBACK_TIMEOUT_MS).toBe(5 * 60 * 1000);
    expect(getCallbackPath()).toBe("/callback");
  });

  it("returns the default port when the env override is unset", () => {
    delete process.env[ENV_KEY];
    expect(getCallbackPort()).toBe(DEFAULT_CALLBACK_PORT);
  });

  it("honors a valid MCP_OAUTH_CALLBACK_PORT override", () => {
    process.env[ENV_KEY] = "24567";
    expect(getCallbackPort()).toBe(24567);
  });

  it("falls back to the default port for invalid env values", () => {
    for (const value of ["not-a-number", "0", "-3", "70000", "12.5"]) {
      process.env[ENV_KEY] = value;
      expect(getCallbackPort(), `env=${value}`).toBe(DEFAULT_CALLBACK_PORT);
    }
  });
});

describe("callback server", () => {
  it("ensureCallbackServer returns a real port for port 0 and reuses the singleton", async () => {
    expect(port).toBeGreaterThan(0);
    expect(await ensureCallbackServer({ port: 0 })).toBe(port);
  });

  it("resolves the waiter with the code and serves a 200 HTML page", async () => {
    reserveAuthState("state-success");
    const promise = waitForCallback("state-success");

    const res = await httpGetText(port, "/callback?code=abc&state=state-success");

    expect(res.status).toBe(200);
    expect(res.contentType).toContain("text/html");
    expect(res.body.toLowerCase()).toContain("<html");
    expect(await promise).toEqual({ code: "abc" });
  });

  it("passes the iss parameter through to the resolved value", async () => {
    reserveAuthState("state-iss");
    const promise = waitForCallback("state-iss");
    const iss = "https://issuer.example.com/tenant-1";

    const res = await httpGetText(
      port,
      `/callback?code=xyz&iss=${encodeURIComponent(iss)}&state=state-iss`,
    );

    expect(res.status).toBe(200);
    expect(await promise).toEqual({ code: "xyz", iss });
  });

  it("supersedes a previously registered waiter for the same state", async () => {
    const first = waitForCallback("state-superseded");
    const firstOutcome = first.then(
      () => "resolved" as const,
      (error: Error) => `rejected: ${error.message}`,
    );

    const second = waitForCallback("state-superseded");
    await expect(firstOutcome).resolves.toMatch(/^rejected:/);

    const res = await httpGetText(port, "/callback?code=abc&state=state-superseded");

    expect(res.status).toBe(200);
    await expect(second).resolves.toEqual({ code: "abc" });
  });

  it("answers 404 for the wrong path", async () => {
    const res = await httpGetText(port, "/elsewhere?code=abc&state=state-404");
    expect(res.status).toBe(404);
  });

  it("answers 400 when the state parameter is missing", async () => {
    const res = await httpGetText(port, "/callback?code=abc");
    expect(res.status).toBe(400);
  });

  it("answers 400 for an unknown state and leaves the waiter pending until aborted", async () => {
    const ac = new AbortController();
    const promise = waitForCallback("state-live", ac.signal);

    const res = await httpGetText(port, "/callback?code=abc&state=state-unknown");

    expect(res.status).toBe(400);
    // The unknown-state request must not have settled the live waiter: it
    // still rejects with "OAuth cancelled" when aborted.
    ac.abort();
    await expect(promise).rejects.toThrow("OAuth cancelled");
  });

  it("answers 400 for an error callback with an unknown state", async () => {
    const res = await httpGetText(port, "/callback?error=access_denied&state=state-bogus");
    expect(res.status).toBe(400);
  });

  it("rejects the waiter with the error_description for error= callbacks", async () => {
    reserveAuthState("state-error");
    const promise = waitForCallback("state-error");
    // Attach the rejection handler BEFORE the server rejects, so the
    // rejection can never be unhandled (the server settles the waiter
    // while processing the request, before the response is delivered).
    const assertion = expect(promise).rejects.toThrow("User denied");

    const res = await httpGetText(
      port,
      "/callback?error=access_denied&error_description=User%20denied&state=state-error",
    );

    expect(res.status).toBe(200);
    expect(res.contentType).toContain("text/html");
    expect(res.body).toContain("User denied");
    await assertion;
  });

  it("rejects a waiter with exactly 'OAuth cancelled' when the signal aborts", async () => {
    const ac = new AbortController();
    reserveAuthState("state-abort");
    const promise = waitForCallback("state-abort", ac.signal);

    ac.abort();

    const error = await promise.then(
      () => {
        throw new Error("expected the waiter to reject");
      },
      (err: Error) => err,
    );
    expect(error.message).toBe("OAuth cancelled");
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();

    await expect(waitForCallback("state-preaborted", ac.signal)).rejects.toThrow("OAuth cancelled");
  });

  it("rejects the waiter after the 5-minute callback timeout", async () => {
    vi.useFakeTimers();
    try {
      const promise = waitForCallback("state-timeout");
      vi.advanceTimersByTime(CALLBACK_TIMEOUT_MS + 1);
      await expect(promise).rejects.toThrow("OAuth callback timed out");
    } finally {
      vi.useRealTimers();
    }
  });

  it("serves the 200 manual hand-off page for a reserved state with no code, no error, and no live waiter", async () => {
    reserveAuthState("state-no-code");

    const res = await httpGetText(port, "/callback?state=state-no-code");

    // The manual hand-off HTML page — not error HTML, not a text response.
    expect(res.status).toBe(200);
    expect(res.contentType).toContain("text/html");
    expect(res.body).toContain("manual hand-off");
    expect(res.body).toContain("Copy &amp; paste");
    expect(res.body).toContain("without an authorization code");

    // The reservation is consumed: a second hit on the same state is unknown.
    const repeat = await httpGetText(port, "/callback?state=state-no-code");
    expect(repeat.status).toBe(400);
  });

  it("rejects the live waiter with a clear no-code error and still serves the manual hand-off page", async () => {
    reserveAuthState("state-no-code-waiter");
    const promise = waitForCallback("state-no-code-waiter");
    // Attach the assertion before the server settles the waiter so the
    // rejection can never be unhandled (the server rejects the waiter
    // while processing the request, before the response is delivered).
    const assertion = expect(promise).rejects.toThrow("No authorization code received");

    const res = await httpGetText(port, "/callback?state=state-no-code-waiter");

    expect(res.status).toBe(200);
    expect(res.contentType).toContain("text/html");
    expect(res.body).toContain("manual hand-off");
    await assertion;
  });
});

describe("strict port binding", () => {
  // NOTE: ensureCallbackServer with a non-matching strictPort rebinds — it
  // stops the running server before attempting the fixed-port bind. Placed
  // after the functional tests on purpose; the stop-lifecycle block below
  // re-establishes a server for its own assertions.
  it("rejects with a clear error naming the port when the fixed port is already taken", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const blockerPort = (blocker.address() as AddressInfo).port;

    try {
      await expect(
        ensureCallbackServer({ strictPort: true, port: blockerPort }),
      ).rejects.toThrow(String(blockerPort));
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});

describe("stopCallbackServer", () => {
  it("rejects pending waiters, releases the server, and allows re-binding", async () => {
    const freshPort = await ensureCallbackServer({ port: 0 });
    expect(freshPort).toBeGreaterThan(0);

    const promise = waitForCallback("state-stop");
    // stopCallbackServer rejects waiters synchronously — attach first.
    const assertion = expect(promise).rejects.toThrow("OAuth callback server stopped");
    await stopCallbackServer();
    await assertion;

    // The module is back in the unbound state and can bind again.
    const reboundPort = await ensureCallbackServer({ port: 0 });
    expect(reboundPort).toBeGreaterThan(0);
  });
});

describe("concurrent bind races", () => {
  /**
   * Occupy a free port (the "in use" blocker) and hand back a releaser.
   * Each test below stops the singleton first and last, so the singleton
   * state does not leak between these tests and the groups above.
   */
  async function takeFreePort(): Promise<{ port: number; release: () => Promise<void> }> {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const busyPort = (blocker.address() as AddressInfo).port;
    return {
      port: busyPort,
      release: () => new Promise<void>((resolve) => blocker.close(() => resolve())),
    };
  }

  it("does not bleed a foreign strict bind's rejection into a different-target caller", async () => {
    const { port: busyPort, release } = await takeFreePort();

    try {
      await stopCallbackServer();

      const strict = ensureCallbackServer({ strictPort: true, port: busyPort });
      // Attach before the bind can settle so the rejection is observed.
      const strictAssertion = expect(strict).rejects.toThrow(
        new RegExp(`port ${busyPort} is already in use`),
      );

      // The dynamic caller joins the in-flight strict bind, but its target
      // differs — it must NOT inherit A's EADDRINUSE and must rebind.
      const dynamicPort = await ensureCallbackServer({ port: 0 });

      expect(dynamicPort).toBeGreaterThan(0);
      expect(dynamicPort).not.toBe(busyPort);

      // The original strict caller still sees the clear error naming the port.
      await strictAssertion;
    } finally {
      await release();
      await stopCallbackServer();
    }
  });

  it("lets a same-target joiner inherit the in-flight strict bind's rejection", async () => {
    const { port: busyPort, release } = await takeFreePort();

    try {
      await stopCallbackServer();

      const first = ensureCallbackServer({ strictPort: true, port: busyPort });
      const second = ensureCallbackServer({ strictPort: true, port: busyPort });

      // Same target (port + path) → the joiner must inherit the rejection,
      // not silently rebind (which would also fail with the same error).
      await expect(first).rejects.toThrow(`port ${busyPort} is already in use`);
      await expect(second).rejects.toThrow(`port ${busyPort} is already in use`);
    } finally {
      await release();
      await stopCallbackServer();
    }
  });

  it("lets an in-flight same-target (dynamic) joiner get the first caller's resolved port", async () => {
    await stopCallbackServer();

    try {
      const first = ensureCallbackServer({ port: 0 });
      const second = ensureCallbackServer({ port: 0 });

      const firstPort = await first;
      const secondPort = await second;

      expect(firstPort).toBeGreaterThan(0);
      // Same-target join inherits success: B returns A's OS-assigned port.
      expect(secondPort).toBe(firstPort);
    } finally {
      await stopCallbackServer();
    }
  });

  it("both dynamic callers survive a swallowed foreign strict failure (no spurious double bind)", async () => {
    const { port: busyPort, release } = await takeFreePort();

    try {
      await stopCallbackServer();

      // All three start in the SAME tick (no awaits between them): A's
      // in-flight bind promise is already registered before B and C run, so
      // B and C are guaranteed to capture A's in-flight promise — the
      // stale-capture window of this regression. A's EADDRINUSE cannot have
      // been delivered yet (it arrives on a later IO tick), so A is freshly
      // failing when B and C wake up.
      const strict = ensureCallbackServer({ strictPort: true, port: busyPort });
      const dynamicB = ensureCallbackServer({ port: 0 });
      const dynamicC = ensureCallbackServer({ port: 0 });

      const [strictRes, bRes, cRes] = await Promise.allSettled([
        strict,
        dynamicB,
        dynamicC,
      ]);

      // The strict caller still sees the clear EADDRINUSE error naming the port.
      expect(strictRes.status).toBe("rejected");
      if (strictRes.status === "rejected") {
        expect(String(strictRes.reason)).toContain(
          `port ${busyPort} is already in use`,
        );
      }

      // Both dynamic callers must resolve — regressed when C kept a stale
      // in-flight promise and rebound anyway, bumping the generation counter
      // and invalidating B's still-in-flight bind (B spuriously rejected
      // with "OAuth callback server stopped" though no stop() happened).
      expect(bRes.status, `dynamic B (got: ${describeSettled(bRes)})`).toBe("fulfilled");
      expect(cRes.status, `dynamic C (got: ${describeSettled(cRes)})`).toBe("fulfilled");
      if (bRes.status !== "fulfilled" || cRes.status !== "fulfilled") return;

      // C re-joined B's in-flight bind rather than starting a second one.
      expect(cRes.value).toBe(bRes.value);
      expect(bRes.value).toBeGreaterThan(0);
      expect(bRes.value).not.toBe(busyPort);
      // Both returned ports are actually accepting connections.
      expect(await isPortListening(bRes.value)).toBe(true);
    } finally {
      await release();
      await stopCallbackServer();
    }
  });
});

function describeSettled(res: PromiseSettledResult<number>): string {
  return res.status === "fulfilled"
    ? `fulfilled: ${res.value}`
    : `rejected: ${String(res.reason)}`;
}
