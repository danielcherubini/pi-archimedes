import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthEntry } from "./oauth-types.js";

/**
 * Boundary mocks for the auth-flow module under test:
 *
 * - `./auth-storage.js` — in-memory AuthEntry per server name. Mirrors the
 *   real module's contract: `getAuthEntry` returns a clone, `saveAuthEntry`
 *   replaces the stored entry and mutates `entry.serverUrl` when the param
 *   is passed.
 * - `@modelcontextprotocol/sdk/client/auth.js` — the `auth()` orchestrator
 *   as a spy. The default implementation mirrors the SDK's behaviour at the
 *   provider boundary instead of hitting the network: code exchange →
 *   saveTokens, non-interactive flow (client_credentials) → saveTokens,
 *   stored token with a refresh token → refresh via saveTokens, otherwise
 *   → start a new authorization flow (redirectToAuthorization).
 * - `./callback-server.js` — no-op state reservation and port binding;
 *   `waitForCallback` returns a deferred the test resolves/rejects to drive
 *   the callback window, and `getCallbackPort`/`getCallbackPath` are pinned
 *   so the real (unmocked) `McpOAuthProvider` builds deterministic URLs.
 *
 * The real `McpOAuthProvider` runs against these mocks, so the tests verify
 * the auth-flow wiring end to end: flow → provider → SDK → callback →
 * exchange → storage.
 */

const storage = vi.hoisted(() => {
  type EntryMap = Map<string, AuthEntry>;
  const entries: EntryMap = new Map();
  const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value));

  const getAuthEntry = vi.fn((serverName: string): AuthEntry | undefined =>
    clone(entries.get(serverName)),
  );
  const saveAuthEntry = vi.fn(
    (serverName: string, entry: AuthEntry, serverUrl?: string): void => {
      if (serverUrl !== undefined) entry.serverUrl = serverUrl;
      entries.set(serverName, clone(entry));
    },
  );
  const deleteAuthEntry = vi.fn((serverName: string): void => {
    entries.delete(serverName);
  });

  return {
    entries,
    getAuthEntry,
    saveAuthEntry,
    deleteAuthEntry,
    seed(serverName: string, entry: AuthEntry): void {
      entries.set(serverName, clone(entry));
    },
    reset(): void {
      entries.clear();
      getAuthEntry.mockClear();
      saveAuthEntry.mockClear();
      deleteAuthEntry.mockClear();
    },
  };
});

const sdk = vi.hoisted(() => ({
  /** The SDK's auth() orchestrator, spied. See default impl below. */
  auth: vi.fn(),
}));

/**
 * Default SDK `auth()` mock implementation: mirrors the provider-boundary
 * behaviour of the real orchestrator so storage assertions are meaningful:
 * - `authorizationCode` → token exchange via saveTokens → "AUTHORIZED"
 * - non-interactive (redirectUrl undefined, e.g. client_credentials) →
 *   direct token fetch via saveTokens → "AUTHORIZED"
 * - stored token with refresh_token (the expired-tokens test case) →
 *   refresh via saveTokens → "AUTHORIZED"
 * - otherwise → new authorization flow: redirectToAuthorization → "REDIRECT"
 */
const sdkAuthDefaultImpl = vi.hoisted(
  () =>
    async (
      provider: {
        redirectUrl?: string | URL | undefined;
        tokens(): Promise<{ refresh_token?: string } | undefined>;
        saveTokens(tokens: {
          access_token: string;
          token_type: string;
          expires_in?: number;
          refresh_token?: string;
          scope?: string;
        }): Promise<void>;
        redirectToAuthorization(url: URL): Promise<void>;
      },
      options: { authorizationCode?: string },
    ): Promise<string> => {
    if (options.authorizationCode !== undefined) {
      await provider.saveTokens({
        access_token: `at-${options.authorizationCode}`,
        token_type: "Bearer",
        expires_in: 3600,
      });
      return "AUTHORIZED";
    }
    if (provider.redirectUrl === undefined) {
      await provider.saveTokens({ access_token: "cc-at", token_type: "Bearer", expires_in: 3600 });
      return "AUTHORIZED";
    }
    const tokens = await provider.tokens();
    if (tokens?.refresh_token) {
      await provider.saveTokens({
        access_token: "refreshed-at",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: tokens.refresh_token,
      });
      return "AUTHORIZED";
    }
    await provider.redirectToAuthorization(
      new URL("https://auth.example.com/authorize?state=demo"),
    );
    return "REDIRECT";
    },
);

const callback = vi.hoisted(() => {
  type OAuthCallbackResult = { code: string; iss?: string };
  interface Deferred {
    promise: Promise<OAuthCallbackResult>;
    resolve(value: OAuthCallbackResult): void;
    reject(error: Error): void;
  }

  const reserveAuthState = vi.fn();
  // NOT the default port (19876): a dynamic bind resolves an OS-assigned
  // port, and the provider must advertise THAT port, not getCallbackPort().
  const ensureCallbackServer = vi.fn(async () => 43217);
  const stopCallbackServer = vi.fn(async () => undefined);

  const waiters: Deferred[] = [];
  const waitForCallbackImpl = (
    _state: string,
    _signal?: AbortSignal,
  ): Promise<OAuthCallbackResult> => {
    let resolve: (value: OAuthCallbackResult) => void = () => {};
    let reject: (error: Error) => void = () => {};
    const promise = new Promise<OAuthCallbackResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    waiters.push({ promise, resolve, reject });
    return promise;
  };
  const waitForCallback = vi.fn(waitForCallbackImpl);

  return {
    reserveAuthState,
    ensureCallbackServer,
    stopCallbackServer,
    waitForCallback,
    waiters,
    reset(): void {
      waiters.length = 0;
      reserveAuthState.mockClear();
      ensureCallbackServer.mockReset();
      ensureCallbackServer.mockImplementation(async () => 43217);
      stopCallbackServer.mockClear();
      stopCallbackServer.mockImplementation(async () => undefined);
      waitForCallback.mockReset();
      waitForCallback.mockImplementation(waitForCallbackImpl);
    },
  };
});

vi.mock("./auth-storage.js", () => ({
  getAuthEntry: storage.getAuthEntry,
  saveAuthEntry: storage.saveAuthEntry,
  deleteAuthEntry: storage.deleteAuthEntry,
}));

vi.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  auth: sdk.auth,
}));

vi.mock("./callback-server.js", () => ({
  reserveAuthState: callback.reserveAuthState,
  ensureCallbackServer: callback.ensureCallbackServer,
  waitForCallback: callback.waitForCallback,
  stopCallbackServer: callback.stopCallbackServer,
  getCallbackPort: () => 19876,
  getCallbackPath: () => "/callback",
}));

// The module under test (fails to resolve until it exists — RED state).
import { authenticate, extractOAuthConfig, getValidToken } from "./auth-flow.js";

const SERVER_NAME = "flown";
const SERVER_URL = "https://mcp.example.com/mcp";

/** Fixed wall clock for deterministic expiresAt/expires_in math. */
const FAKE_NOW_MS = Date.parse("2026-03-01T12:00:00.000Z");
const FAKE_NOW_SECONDS = FAKE_NOW_MS / 1000;

/** Seeded stored token whose expiry lies `offset` seconds from the fake now. */
function storedToken(expiryOffsetSeconds: number | null) {
  return {
    accessToken: "expired-at",
    refreshToken: "rt-1",
    ...(expiryOffsetSeconds === null ? {} : { expiresAt: FAKE_NOW_SECONDS + expiryOffsetSeconds }),
  };
}

beforeEach(() => {
  storage.reset();
  callback.reset();
  sdk.auth.mockReset();
  sdk.auth.mockImplementation(sdkAuthDefaultImpl);
});

describe("extractOAuthConfig", () => {
  it('"oauth" → default authorization_code config', () => {
    expect(extractOAuthConfig("oauth")).toEqual({ grantType: "authorization_code" });
  });

  it("other strings, nullish, and numbers → null", () => {
    expect(extractOAuthConfig("http")).toBeNull();
    expect(extractOAuthConfig("oauth2")).toBeNull();
    expect(extractOAuthConfig(undefined)).toBeNull();
    expect(extractOAuthConfig(null)).toBeNull();
    expect(extractOAuthConfig(42)).toBeNull();
    expect(extractOAuthConfig([])).toBeNull();
  });

  it("keeps only oauth fields from an oauth-ish object", () => {
    expect(
      extractOAuthConfig({ clientId: "x", scope: "s", token: "t", buzzer: 9 }),
    ).toEqual({ clientId: "x", scope: "s" });
  });

  it("keeps clientId and clientSecret together", () => {
    expect(
      extractOAuthConfig({ clientId: "cid", clientSecret: "shh" }),
    ).toEqual({ clientId: "cid", clientSecret: "shh" });
  });

  it("keeps grantType, redirectUri, clientName, and authorizationServerUrl", () => {
    expect(
      extractOAuthConfig({
        grantType: "client_credentials",
        clientId: "cid",
        scope: "mcp",
        redirectUri: "http://localhost:4567/callback",
        clientName: "My App",
        authorizationServerUrl: "https://auth.example.com",
      }),
    ).toEqual({
      grantType: "client_credentials",
      clientId: "cid",
      scope: "mcp",
      redirectUri: "http://localhost:4567/callback",
      clientName: "My App",
      authorizationServerUrl: "https://auth.example.com",
    });
  });

  it("defaults nothing: no known oauth fields → null (plain { token } or {} are not oauth)", () => {
    expect(extractOAuthConfig({ token: "t" })).toBeNull();
    expect(extractOAuthConfig({})).toBeNull();
    expect(extractOAuthConfig({ token: "t", unknown: 1 })).toBeNull();
  });

  it("returns null when every known field normalizes away (garbage object, invalid grantType alone)", () => {
    expect(extractOAuthConfig({ foo: 1 })).toBeNull();
    expect(extractOAuthConfig({ grantType: "bogus" })).toBeNull();
  });

  it("drops an invalid grantType while keeping the remaining valid known fields", () => {
    expect(extractOAuthConfig({ grantType: "bogus", clientId: "x" })).toEqual({ clientId: "x" });
  });

  it("drops unknown-typed/invalid values of known fields", () => {
    // non-string values are dropped, remaining known fields are kept
    expect(extractOAuthConfig({ clientId: 7, scope: "s" })).toEqual({ scope: "s" });
  });
});

describe("getValidToken", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: FAKE_NOW_MS });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when there is no stored entry (no SDK call)", async () => {
    expect(await getValidToken(SERVER_NAME, SERVER_URL, {})).toBeNull();
    expect(sdk.auth).not.toHaveBeenCalled();
  });

  it("returns null when the stored entry has no tokens (no SDK call)", async () => {
    storage.seed(SERVER_NAME, { clientInfo: { clientId: "dc-client" } });
    expect(await getValidToken(SERVER_NAME, SERVER_URL, {})).toBeNull();
    expect(sdk.auth).not.toHaveBeenCalled();
  });

  it("returns the access token when not expired (no SDK call)", async () => {
    storage.seed(SERVER_NAME, { tokens: storedToken(3600) });
    expect(await getValidToken(SERVER_NAME, SERVER_URL, {})).toBe("expired-at");
    expect(sdk.auth).not.toHaveBeenCalled();
  });

  it("treats a token without expiresAt as never expiring", async () => {
    storage.seed(SERVER_NAME, { tokens: { accessToken: "at-noleak" } });
    expect(await getValidToken(SERVER_NAME, SERVER_URL, {})).toBe("at-noleak");
    expect(sdk.auth).not.toHaveBeenCalled();
  });

  it("treats expiresAt === now as expired", async () => {
    storage.seed(SERVER_NAME, { tokens: storedToken(0) });
    await getValidToken(SERVER_NAME, SERVER_URL, { clientSecret: "shh" });
    expect(sdk.auth).toHaveBeenCalledTimes(1);
  });

  it("config-stub guard: expired + clientId without clientSecret → null, no refresh attempt (ADR 0001)", async () => {
    storage.seed(SERVER_NAME, { tokens: storedToken(-100) });
    expect(
      await getValidToken(SERVER_NAME, SERVER_URL, { clientId: "public-client" }),
    ).toBeNull();
    expect(sdk.auth).not.toHaveBeenCalled();
  });

  it("expired + clientSecret → SDK-driven refresh, storage updated, fresh token returned", async () => {
    storage.seed(SERVER_NAME, { tokens: storedToken(-100) });

    const token = await getValidToken(SERVER_NAME, SERVER_URL, {
      clientId: "cfg-client",
      clientSecret: "shh",
    });

    expect(token).toBe("refreshed-at");
    expect(sdk.auth).toHaveBeenCalledTimes(1);
    expect(sdk.auth.mock.calls[0]?.[1]).toEqual({ serverUrl: SERVER_URL });
    // The refresh was persisted through the provider's saveTokens
    const saved = storage.entries.get(SERVER_NAME)?.tokens;
    expect(saved?.accessToken).toBe("refreshed-at");
    expect(saved?.expiresAt).toBe(FAKE_NOW_SECONDS + 3600);
  });

  it("expired + DCR-registered client (no config clientId) → SDK refresh attempted", async () => {
    storage.seed(SERVER_NAME, {
      clientInfo: { clientId: "dc-client", redirectUris: ["http://localhost:19876/callback"] },
      tokens: storedToken(-100),
    });

    const token = await getValidToken(SERVER_NAME, SERVER_URL, {});

    expect(token).toBe("refreshed-at");
    expect(sdk.auth).toHaveBeenCalledTimes(1);
  });

  it("expired + refresh fails (SDK error) → null", async () => {
    storage.seed(SERVER_NAME, { tokens: storedToken(-100) });
    sdk.auth.mockRejectedValueOnce(new Error("invalid_grant"));
    expect(
      await getValidToken(SERVER_NAME, SERVER_URL, { clientSecret: "shh" }),
    ).toBeNull();
    expect(sdk.auth).toHaveBeenCalledTimes(1);
  });

  it("expired + SDK auth resolved but storage still expired/stale → null", async () => {
    storage.seed(SERVER_NAME, { tokens: storedToken(-100) });
    // SDK "succeeds" without persisting anything (e.g. refresh returned no token)
    sdk.auth.mockImplementationOnce(async () => "AUTHORIZED");
    expect(
      await getValidToken(SERVER_NAME, SERVER_URL, { clientSecret: "shh" }),
    ).toBeNull();
  });

  it("storage read failure (unavailable keyring) → null, never throws", async () => {
    storage.getAuthEntry.mockImplementationOnce(() => {
      throw new Error("OS credential store unavailable — cannot store OAuth tokens securely");
    });
    expect(await getValidToken(SERVER_NAME, SERVER_URL, {})).toBeNull();
  });
});

describe("authenticate — authorization_code", () => {
  it("full happy path: state, dynamic bind, redirect, wait, exchange", async () => {
    const onAuthorizationUrl = vi.fn();
    const pending = authenticate(
      SERVER_NAME,
      SERVER_URL,
      { grantType: "authorization_code" },
      { onAuthorizationUrl },
    );

    // The flow registers a callback waiter for its CSRF state
    await vi.waitFor(() => expect(callback.waiters).toHaveLength(1));

    // The browser completes the redirect
    callback.waiters[0]?.resolve({ code: "c1" });
    await expect(pending).resolves.toEqual({ status: "authenticated" });

    // CSRF state: 32 random bytes as hex (64 chars)
    expect(callback.reserveAuthState).toHaveBeenCalledTimes(1);
    const state = callback.reserveAuthState.mock.calls[0]?.[0];
    expect(state).toMatch(/^[0-9a-f]{64}$/);

    // No fixed redirect URI → default dynamic bind (no strictPort)
    expect(callback.ensureCallbackServer).toHaveBeenCalledTimes(1);
    expect(callback.ensureCallbackServer).toHaveBeenCalledWith();

    // The provider advertised the ACTUAL bound port (OS-assigned by the
    // mock), not the static default — the authorization redirect must land
    // on the listening server (DCR redirect_uris + redirect_uri).
    const provider = sdk.auth.mock.calls[0]?.[0];
    expect(provider.redirectUrl).toBe("http://localhost:43217/callback");
    expect(provider.clientMetadata.redirect_uris).toEqual(["http://localhost:43217/callback"]);

    // The waited-on state is the reserved one
    expect(callback.waitForCallback).toHaveBeenCalledTimes(1);
    expect(callback.waitForCallback.mock.calls[0]?.[0]).toBe(state);

    // The SDK is driven twice with the SAME provider: first the
    // authorization-request phase (no code), then the code exchange
    expect(sdk.auth).toHaveBeenCalledTimes(2);
    const first = sdk.auth.mock.calls[0];
    const second = sdk.auth.mock.calls[1];
    expect(second?.[0]).toBe(first?.[0]);
    expect(first?.[1]).toEqual({ serverUrl: SERVER_URL });
    expect(second?.[1]).toEqual({ serverUrl: SERVER_URL, authorizationCode: "c1" });

    // The authorization URL was handed to the host's callback
    expect(onAuthorizationUrl).toHaveBeenCalledTimes(1);
    expect(onAuthorizationUrl.mock.calls[0]?.[0]).toBeInstanceOf(URL);

    // The code exchange persisted a token through provider.saveTokens
    expect(storage.entries.get(SERVER_NAME)?.tokens?.accessToken).toBe("at-c1");

    // The callback server is a shared singleton — the flow must not stop it
    expect(callback.stopCallbackServer).not.toHaveBeenCalled();
  });

  it("pre-registered localhost redirectUri → exact-port (strictPort) bind", async () => {
    const pending = authenticate(
      SERVER_NAME,
      SERVER_URL,
      { grantType: "authorization_code", redirectUri: "http://localhost:4567/callback" },
    );
    await vi.waitFor(() => expect(callback.waiters).toHaveLength(1));
    callback.waiters[0]?.resolve({ code: "c2" });
    await expect(pending).resolves.toEqual({ status: "authenticated" });
    expect(callback.ensureCallbackServer).toHaveBeenCalledWith({ strictPort: true, port: 4567 });
  });

  it("pre-registered 127.0.0.1 redirectUri → exact-port bind", async () => {
    const pending = authenticate(
      SERVER_NAME,
      SERVER_URL,
      {
        grantType: "authorization_code",
        redirectUri: "http://127.0.0.1:5000/oauth",
      },
    );
    await vi.waitFor(() => expect(callback.waiters).toHaveLength(1));
    callback.waiters[0]?.resolve({ code: "c3" });
    await expect(pending).resolves.toEqual({ status: "authenticated" });
    expect(callback.ensureCallbackServer).toHaveBeenCalledWith({ strictPort: true, port: 5000 });
  });

  it("remote (non-localhost) redirectUri → default dynamic bind", async () => {
    const pending = authenticate(
      SERVER_NAME,
      SERVER_URL,
      {
        grantType: "authorization_code",
        redirectUri: "https://app.example.com/oauth/callback",
      },
    );
    await vi.waitFor(() => expect(callback.waiters).toHaveLength(1));
    callback.waiters[0]?.resolve({ code: "c4" });
    await expect(pending).resolves.toEqual({ status: "authenticated" });
    expect(callback.ensureCallbackServer).toHaveBeenCalledWith();
  });

  it("callback server bind failure → needs-interaction (SDK never called)", async () => {
    callback.ensureCallbackServer.mockRejectedValueOnce(
      new Error(
        "Cannot bind OAuth callback server: port 4567 is already in use — stop the other process or change the callback port",
      ),
    );
    await expect(
      authenticate(
        SERVER_NAME,
        SERVER_URL,
        { grantType: "authorization_code", redirectUri: "http://localhost:4567/callback" },
      ),
    ).resolves.toEqual({ status: "needs-interaction" });
    expect(callback.reserveAuthState).toHaveBeenCalledTimes(1);
    expect(sdk.auth).not.toHaveBeenCalled();
    expect(callback.waitForCallback).not.toHaveBeenCalled();
  });

  it("callback window timeout → failed (no code exchange)", async () => {
    const pending = authenticate(SERVER_NAME, SERVER_URL, { grantType: "authorization_code" });
    await vi.waitFor(() => expect(callback.waiters).toHaveLength(1));
    callback.waiters[0]?.reject(new Error("OAuth callback timed out"));
    // The failed result carries the underlying cause, not just a generic status
    await expect(pending).resolves.toEqual({
      status: "failed",
      error: "OAuth callback timed out",
    });
    expect(sdk.auth).toHaveBeenCalledTimes(1); // only the authorization-request phase
  });

  it("aborted cancel → rethrows the abort error (not 'failed')", async () => {
    const ac = new AbortController();
    const pending = authenticate(SERVER_NAME, SERVER_URL, {}, { signal: ac.signal });
    await vi.waitFor(() => expect(callback.waiters).toHaveLength(1));
    ac.abort();
    callback.waiters[0]?.reject(new Error("OAuth cancelled"));
    await expect(pending).rejects.toThrow("OAuth cancelled");
  });

  it("SDK error during the authorization-request phase → failed", async () => {
    sdk.auth.mockRejectedValueOnce(new Error("network unreachable"));
    // The failed result carries the SDK error message for the caller to surface
    await expect(
      authenticate(SERVER_NAME, SERVER_URL, { grantType: "authorization_code" }),
    ).resolves.toEqual({ status: "failed", error: "network unreachable" });
    expect(callback.waitForCallback).not.toHaveBeenCalled();
  });

  it("SDK error during the code exchange → failed", async () => {
    // First phase (authorization request) succeeds, the exchange fails
    sdk.auth
      .mockImplementationOnce(sdkAuthDefaultImpl)
      .mockRejectedValueOnce(new Error("invalid_grant"));
    const pending = authenticate(SERVER_NAME, SERVER_URL, { grantType: "authorization_code" });
    await vi.waitFor(() => expect(callback.waiters).toHaveLength(1));
    callback.waiters[0]?.resolve({ code: "c5" });
    // The failed result carries the SDK error message for the caller to surface
    await expect(pending).resolves.toEqual({ status: "failed", error: "invalid_grant" });
    expect(sdk.auth).toHaveBeenCalledTimes(2);
  });
});

describe("authenticate — client_credentials", () => {
  it("single non-interactive SDK call, no callback server, authenticated", async () => {
    const result = await authenticate(SERVER_NAME, SERVER_URL, {
      grantType: "client_credentials",
      clientId: "m2m-client",
      clientSecret: "m2m-secret",
    });

    expect(result).toEqual({ status: "authenticated" });
    expect(sdk.auth).toHaveBeenCalledTimes(1);
    expect(sdk.auth.mock.calls[0]?.[1]).toEqual({ serverUrl: SERVER_URL });
    expect(callback.waitForCallback).not.toHaveBeenCalled();
    expect(callback.ensureCallbackServer).not.toHaveBeenCalled();
    expect(callback.reserveAuthState).not.toHaveBeenCalled();
    // The SDK fetched the token directly (saveTokens through the provider)
    expect(storage.entries.get(SERVER_NAME)?.tokens?.accessToken).toBe("cc-at");
  });

  it("SDK error → failed", async () => {
    sdk.auth.mockRejectedValueOnce(new Error("invalid_client"));
    // The failed result carries the SDK error message for the caller to surface
    await expect(
      authenticate(SERVER_NAME, SERVER_URL, { grantType: "client_credentials" }),
    ).resolves.toEqual({ status: "failed", error: "invalid_client" });
  });

  it("already-aborted signal → rethrows without any SDK call", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      authenticate(SERVER_NAME, SERVER_URL, { grantType: "client_credentials" }, {
        signal: ac.signal,
      }),
    ).rejects.toThrow("OAuth cancelled");
    expect(sdk.auth).not.toHaveBeenCalled();
  });
});
