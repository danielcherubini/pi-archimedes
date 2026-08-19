import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthEntry } from "./oauth-types.js";
import type { McpOAuthConfig } from "./types.js";

/**
 * Mocks for the storage and callback-server boundaries so the provider is
 * exercised in isolation:
 * - `auth-storage.js` — in-memory AuthEntry per server name. The mock
 *   mirrors the real module's contract: `getAuthEntry` returns a clone,
 *   `saveAuthEntry` replaces the stored entry and mutates `entry.serverUrl`
 *   when the param is passed.
 * - `callback-server.js` — pinned constants so redirect URL assertions are
 *   independent of the MCP_OAUTH_CALLBACK_PORT env var.
 */
const storage = vi.hoisted(() => {
  const entries = new Map<string, AuthEntry>();
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

vi.mock("./auth-storage.js", () => ({
  getAuthEntry: storage.getAuthEntry,
  saveAuthEntry: storage.saveAuthEntry,
  deleteAuthEntry: storage.deleteAuthEntry,
}));

vi.mock("./callback-server.js", () => ({
  getCallbackPort: () => 19876,
  getCallbackPath: () => "/callback",
}));

import { McpOAuthProvider, type OAuthCallbacks } from "./oauth-provider.js";

const SERVER_NAME = "test-server";
const SERVER_URL = "https://mcp.example.com";

/** Fixed wall clock for deterministic expiresAt/expires_in math. */
const FAKE_NOW_MS = Date.parse("2026-02-03T12:00:00.000Z");
const FAKE_NOW_SECONDS = FAKE_NOW_MS / 1000;

const DEFAULT_REDIRECT = "http://localhost:19876/callback";

function makeProvider(
  config: McpOAuthConfig = {},
  callbacks: OAuthCallbacks = {},
  csrfState?: string,
  callbackPort?: number,
): McpOAuthProvider {
  return new McpOAuthProvider(SERVER_NAME, SERVER_URL, config, callbacks, csrfState, callbackPort);
}

beforeEach(() => {
  storage.reset();
  vi.useFakeTimers({ now: FAKE_NOW_MS });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("McpOAuthProvider", () => {
  describe("clientMetadata", () => {
    it("authorization_code: localhost redirect, grants, response types, no scope", () => {
      const metadata = makeProvider({ grantType: "authorization_code" }).clientMetadata;
      expect(metadata.redirect_uris).toEqual([DEFAULT_REDIRECT]);
      expect(metadata.grant_types).toEqual(["authorization_code", "refresh_token"]);
      expect(metadata.response_types).toEqual(["code"]);
      expect(metadata.client_name).toBe(SERVER_NAME);
      expect(Object.keys(metadata)).not.toContain("scope");
    });

    it("authorization_code: scope present only when configured", () => {
      const withScope = makeProvider({ grantType: "authorization_code", scope: "mcp tools" });
      expect(withScope.clientMetadata.scope).toBe("mcp tools");

      const withoutScope = makeProvider({ grantType: "authorization_code" });
      expect(Object.keys(withoutScope.clientMetadata)).not.toContain("scope");
    });

    it("authorization_code: client_secret_post only with a client secret", () => {
      expect(makeProvider({ grantType: "authorization_code" }).clientMetadata.token_endpoint_auth_method).toBe(
        "none",
      );
      expect(
        makeProvider({ grantType: "authorization_code", clientSecret: "shh" })
          .clientMetadata
          .token_endpoint_auth_method,
      ).toBe("client_secret_post");
    });

    it("authorization_code: config.redirectUri wins over the default", () => {
      const metadata = makeProvider({
        grantType: "authorization_code",
        redirectUri: "https://app.example.com/oauth/callback",
      }).clientMetadata;
      expect(metadata.redirect_uris).toEqual(["https://app.example.com/oauth/callback"]);
    });

    it("authorization_code: redirect_uris advertise the actual bound callback port", () => {
      const metadata = makeProvider({ grantType: "authorization_code" }, {}, undefined, 43217)
        .clientMetadata;
      expect(metadata.redirect_uris).toEqual(["http://localhost:43217/callback"]);
    });

    it("authorization_code: client_name honors config, defaults to server name", () => {
      expect(makeProvider({ grantType: "authorization_code" }).clientMetadata.client_name).toBe(
        SERVER_NAME,
      );
      expect(
        makeProvider({ grantType: "authorization_code", clientName: "My App" }).clientMetadata
          .client_name,
      ).toBe("My App");
    });

    it("client_credentials: empty redirect_uris and correct grants", () => {
      const metadata = makeProvider({ grantType: "client_credentials" }).clientMetadata;
      expect(metadata.redirect_uris).toEqual([]);
      expect(metadata.grant_types).toEqual(["client_credentials"]);
      expect(metadata.token_endpoint_auth_method).toBe("none");
      expect(metadata.client_name).toBe(SERVER_NAME);
    });

    it("client_credentials: client_secret_post with a secret", () => {
      expect(
        makeProvider({ grantType: "client_credentials", clientSecret: "shh" }).clientMetadata
          .token_endpoint_auth_method,
      ).toBe("client_secret_post");
    });
  });

  describe("redirectUrl", () => {
    it("is undefined for client_credentials", () => {
      expect(makeProvider({ grantType: "client_credentials" }).redirectUrl).toBeUndefined();
    });

    it("defaults to localhost for authorization_code (explicit and default grant type)", () => {
      expect(makeProvider({ grantType: "authorization_code" }).redirectUrl).toBe(DEFAULT_REDIRECT);
      expect(makeProvider({}).redirectUrl).toBe(DEFAULT_REDIRECT);
    });

    it("config.redirectUri wins when set", () => {
      expect(
        makeProvider({ grantType: "authorization_code", redirectUri: "https://app.example.com/cb" })
          .redirectUrl,
      ).toBe("https://app.example.com/cb");
    });

    it("uses the actual bound callback port (not the default) when provided", () => {
      expect(makeProvider({ grantType: "authorization_code" }, {}, undefined, 43217).redirectUrl).toBe(
        "http://localhost:43217/callback",
      );
    });

    it("config.redirectUri wins over callbackPort", () => {
      expect(
        makeProvider(
          { grantType: "authorization_code", redirectUri: "https://app.example.com/cb" },
          {},
          undefined,
          43217,
        ).redirectUrl,
      ).toBe("https://app.example.com/cb");
    });
  });

  describe("tokens round-trip", () => {
    it("saveTokens maps expires_in to expiresAt and preserves seeded clientInfo", async () => {
      storage.seed(SERVER_NAME, {
        clientInfo: { clientId: "seed-client", clientSecret: "seed-secret" },
      });
      const provider = makeProvider({ grantType: "authorization_code" });

      await provider.saveTokens({
        access_token: "at-1",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "rt-1",
        scope: "mcp",
      });

      const saved = storage.entries.get(SERVER_NAME);
      expect(saved?.tokens).toEqual({
        accessToken: "at-1",
        refreshToken: "rt-1",
        expiresAt: FAKE_NOW_SECONDS + 3600,
        scope: "mcp",
      });
      expect(saved?.clientInfo).toEqual({ clientId: "seed-client", clientSecret: "seed-secret" });
      expect(storage.saveAuthEntry).toHaveBeenCalledWith(
        SERVER_NAME,
        expect.objectContaining({
          clientInfo: { clientId: "seed-client", clientSecret: "seed-secret" },
        }),
        SERVER_URL,
      );
    });

    it("saveTokens omits optional fields that were not provided", async () => {
      const provider = makeProvider({ grantType: "authorization_code" });
      await provider.saveTokens({ access_token: "at-2", token_type: "Bearer" });

      const saved = storage.entries.get(SERVER_NAME);
      expect(Object.keys(saved?.tokens ?? {})).toEqual(["accessToken"]);
    });

    it("tokens maps back with token_type Bearer and remaining expires_in", async () => {
      storage.seed(SERVER_NAME, {
        tokens: {
          accessToken: "at-9",
          refreshToken: "rt-9",
          expiresAt: FAKE_NOW_SECONDS + 3600,
          scope: "mcp",
        },
      });
      const provider = makeProvider({ grantType: "authorization_code" });

      expect(await provider.tokens()).toEqual({
        access_token: "at-9",
        token_type: "Bearer",
        refresh_token: "rt-9",
        expires_in: 3600,
        scope: "mcp",
      });
    });

    it("tokens returns undefined when nothing is stored", async () => {
      expect(await makeProvider({}).tokens()).toBeUndefined();
    });

    it("tokens returns expired tokens with expires_in 0 (SDK drives the refresh)", async () => {
      storage.seed(SERVER_NAME, {
        tokens: { accessToken: "at-exp", expiresAt: FAKE_NOW_SECONDS - 500 },
      });
      expect(await makeProvider({}).tokens()).toEqual({
        access_token: "at-exp",
        token_type: "Bearer",
        expires_in: 0,
      });
    });
  });

  describe("clientInformation", () => {
    it("uses config.clientId without reading storage", async () => {
      const provider = makeProvider({ grantType: "authorization_code", clientId: "cfg-client" });
      const readsBefore = storage.getAuthEntry.mock.calls.length;

      expect(await provider.clientInformation()).toEqual({ client_id: "cfg-client" });
      expect(storage.getAuthEntry.mock.calls.length).toBe(readsBefore);
    });

    it("includes config.clientSecret when set", async () => {
      const provider = makeProvider({
        grantType: "authorization_code",
        clientId: "cfg-client",
        clientSecret: "cfg-secret",
      });
      expect(await provider.clientInformation()).toEqual({
        client_id: "cfg-client",
        client_secret: "cfg-secret",
      });
    });

    it("falls back to stored clientInfo when config has no clientId", async () => {
      storage.seed(SERVER_NAME, {
        clientInfo: { clientId: "stored-client", redirectUris: ["https://app.example.com/cb"] },
      });
      const provider = makeProvider({ grantType: "authorization_code" });

      expect(await provider.clientInformation()).toEqual({
        client_id: "stored-client",
        redirect_uris: ["https://app.example.com/cb"],
      });
    });

    it("returns undefined when there is no stored client info", async () => {
      expect(await makeProvider({ grantType: "authorization_code" }).clientInformation()).toBeUndefined();
    });
  });

  describe("saveClientInformation", () => {
    it("persists registered client info and preserves existing tokens", async () => {
      storage.seed(SERVER_NAME, { tokens: { accessToken: "keep-me" } });
      const provider = makeProvider({ grantType: "authorization_code" });

      await provider.saveClientInformation({
        client_id: "dyn-client",
        redirect_uris: [DEFAULT_REDIRECT],
        client_name: "pi-archimedes mcp client",
      });

      const saved = storage.entries.get(SERVER_NAME);
      expect(saved?.clientInfo).toEqual({
        clientId: "dyn-client",
        redirectUris: [DEFAULT_REDIRECT],
      });
      expect(saved?.tokens).toEqual({ accessToken: "keep-me" });
      expect(storage.saveAuthEntry).toHaveBeenCalledWith(
        SERVER_NAME,
        expect.objectContaining({
          clientInfo: { clientId: "dyn-client", redirectUris: [DEFAULT_REDIRECT] },
        }),
        SERVER_URL,
      );
    });

    it("stores the client secret when the registration response includes one", async () => {
      const provider = makeProvider({ grantType: "authorization_code" });

      await provider.saveClientInformation({
        client_id: "dyn-client",
        client_secret: "dyn-secret",
        redirect_uris: [DEFAULT_REDIRECT],
      });

      expect(storage.entries.get(SERVER_NAME)?.clientInfo).toEqual({
        clientId: "dyn-client",
        clientSecret: "dyn-secret",
        redirectUris: [DEFAULT_REDIRECT],
      });
    });
  });

  describe("codeVerifier", () => {
    it("round-trips through storage", async () => {
      const provider = makeProvider({ grantType: "authorization_code" });
      await provider.saveCodeVerifier("verifier-123");

      expect(storage.entries.get(SERVER_NAME)?.codeVerifier).toBe("verifier-123");
      expect(await provider.codeVerifier()).toBe("verifier-123");
    });

    it("preserves tokens when saving the verifier", async () => {
      storage.seed(SERVER_NAME, { tokens: { accessToken: "keep-me" } });
      const provider = makeProvider({ grantType: "authorization_code" });

      await provider.saveCodeVerifier("verifier-xyz");
      expect(storage.entries.get(SERVER_NAME)?.tokens).toEqual({ accessToken: "keep-me" });
    });

    it("throws when no verifier has been saved", async () => {
      const provider = makeProvider({ grantType: "authorization_code" });
      await expect(provider.codeVerifier()).rejects.toThrow("Missing OAuth code verifier");
    });
  });

  describe("state", () => {
    it("returns the CSRF state when constructed with one", () => {
      expect(makeProvider({}, {}, "csrf-42").state()).toBe("csrf-42");
    });

    it("returns an empty string without state (intentional for client_credentials)", () => {
      expect(makeProvider({ grantType: "client_credentials" }).state()).toBe("");
    });
  });

  describe("redirectToAuthorization", () => {
    it("forwards the URL to onAuthorizationUrl", async () => {
      const onAuthorizationUrl = vi.fn();
      const provider = makeProvider({}, { onAuthorizationUrl });
      const url = new URL("https://auth.example.com/authorize?state=abc");

      await provider.redirectToAuthorization(url);

      expect(onAuthorizationUrl).toHaveBeenCalledTimes(1);
      expect(onAuthorizationUrl).toHaveBeenCalledWith(url);
    });

    it("resolves without callbacks", async () => {
      const provider = makeProvider({});
      await expect(
        provider.redirectToAuthorization(new URL("https://auth.example.com/authorize")),
      ).resolves.toBeUndefined();
    });
  });
});
