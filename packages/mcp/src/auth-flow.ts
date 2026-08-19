/**
 * OAuth authentication flows: interactive authenticate (browser
 * authorization_code + non-interactive client_credentials), SDK-driven
 * refresh with the ADR 0001 config-stub guard, and auth-config extraction
 * from a server definition.
 *
 * Ties together the pieces from earlier plan-026 tasks:
 * - {@link McpOAuthProvider} — the SDK's OAuthClientProvider over keyring storage
 * - {@link ensureCallbackServer}/{@link waitForCallback} — the local callback receiver
 * - `auth()` from `@modelcontextprotocol/sdk/client/auth.js` — discovery,
 *   client registration, code exchange, and the refresh_token grant are all
 *   SDK-driven; this module only sequences the calls and surfaces state.
 *
 * Design decisions (see docs/decisions/0001-mcp-oauth-refresh-strategy.md):
 * - Refresh is SDK-driven: an expired token re-runs `auth()` and lets the
 *   provider's stored refresh_token do the work.
 * - Config-stub guard: a pre-registered public client (config `clientId`
 *   without `clientSecret`) hitting an expired token is NEVER auto-refreshed
 *   — the auth server would reject the refresh grant (invalid_client).
 *   `getValidToken` returns null so the caller can tell the user to re-run
 *   `/mcp-auth`.
 * - Cancellation: the callback window honors an `AbortSignal`; aborts are
 *   rethrown (error propagates) so the command layer can distinguish
 *   "cancelled" from "failed".
 *
 * The callback server is a shared singleton: a flow never stops it on exit
 * (stopping would kill concurrently-running flows). States reserved via
 * `reserveAuthState` are cleaned up by `waitForCallback` on settle; a state
 * reserved but never waited on (bind failure) lingers in the accepted set —
 * acceptable, since a later callback for it only gets a 200 hand-off page
 * and no stored data is leaked.
 */

import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

import { getAuthEntry } from "./auth-storage.js";
import { ensureCallbackServer, reserveAuthState, waitForCallback } from "./callback-server.js";
import { McpOAuthProvider, type OAuthCallbacks } from "./oauth-provider.js";
import { OAUTH_CONFIG_FIELDS, type McpOAuthConfig } from "./types.js";

/**
 * Outcome of an authenticate attempt, as a discriminated union on `status`.
 * - `{ status: "authenticated" }` — a token is stored and usable.
 * - `{ status: "needs-interaction" }` — the callback server cannot bind
 *   (e.g. its port is taken) and completing the flow would require manual
 *   action.
 * - `{ status: "failed"; error }` — the flow failed; `error` carries the
 *   underlying cause (token-endpoint rejection, network error, callback
 *   timeout, …) so callers can surface the real reason instead of a
 *   generic message.
 */
export type AuthStatus =
  | { status: "authenticated" }
  | { status: "needs-interaction" }
  | { status: "failed"; error: string };

export interface AuthenticateOptions {
  /** Called once when the SDK builds the authorization URL (e.g. to open a browser). */
  onAuthorizationUrl?: (url: URL) => void | Promise<void>;
  /** Cancels the callback wait; the flow rethrows the abort error. */
  signal?: AbortSignal;
}

/**
 * Classify a server's `auth` value as an OAuth config.
 *
 * - `"oauth"` → default authorization_code config
 * - a plain object whose known OAuth fields are preserved by validation →
 *   a validated config containing only the valid known fields
 * - a static bearer object (`{ token }`), an object where validation drops
 *   every known field (e.g. `{ grantType: "bogus" }`), or any other
 *   value/shape → null
 */
export function extractOAuthConfig(auth: unknown): McpOAuthConfig | null {
  if (auth === "oauth") return { grantType: "authorization_code" };
  if (typeof auth !== "object" || auth === null || Array.isArray(auth)) return null;

  const record = auth as Record<string, unknown>;
  if (!OAUTH_CONFIG_FIELDS.some((field) => record[field] !== undefined)) return null;

  const config: McpOAuthConfig = {};
  for (const field of OAUTH_CONFIG_FIELDS) {
    const value = record[field];
    if (value === undefined) continue;
    if (field === "grantType") {
      if (value === "authorization_code" || value === "client_credentials") {
        config.grantType = value;
      }
    } else if (typeof value === "string" && value !== "") {
      config[field] = value;
    }
  }
  return Object.keys(config).length > 0 ? config : null;
}

/** 32 random bytes as a 64-char hex string — the CSRF state. */
function randomState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Callback server bind options derived from a pre-registered `redirectUri`:
 * when the redirect URI targets loopback (localhost/127.0.0.1) the server
 * must bind that exact port so the arriving redirect lands here; a remote
 * (non-loopback) URI falls back to the default dynamic bind, since the
 * browser flow for remote redirect URIs is out of scope.
 */
function callbackBindFromRedirectUri(
  redirectUri: string | undefined,
): { strictPort: true; port: number } | undefined {
  if (redirectUri === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return undefined;
  }
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") return undefined;
  const port =
    parsed.port !== ""
      ? Number(parsed.port)
      : parsed.protocol === "https:"
        ? 443
        : 80;
  if (!Number.isInteger(port) || port < 0 || port > 65535) return undefined;
  return { strictPort: true, port };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Build the host callbacks for the provider. exactOptionalPropertyTypes:
 * `OAuthCallbacks.onAuthorizationUrl` is an optional property whose type
 * does not include `undefined`, so an absent callback must OMIT the key
 * rather than assign undefined.
 */
function hostCallbacks(
  onAuthorizationUrl?: (url: URL) => void | Promise<void>,
): OAuthCallbacks {
  return onAuthorizationUrl ? { onAuthorizationUrl } : {};
}

/**
 * Run the interactive OAuth flow for a server.
 *
 * - `authorization_code` (default): CSRF state → reserve + bind the callback
 *   server → SDK starts the authorization request (host's
 *   `onAuthorizationUrl` callback opens the browser) → wait for the redirect
 *   → SDK exchanges the code for tokens.
 * - `client_credentials`: single non-interactive SDK call, no callback.
 *
 * Errors: an aborted signal rethrows the abort error so callers can tell
 * cancellation apart; any other failure returns `{ status: "failed"; error }`
 * (still `console.warn`ed for observability) — the error detail travels with
 * the result so the caller can surface it. Returns
 * `{ status: "needs-interaction" }` when the callback server cannot be bound.
 */
export async function authenticate(
  serverName: string,
  serverUrl: string,
  config: McpOAuthConfig,
  options: AuthenticateOptions = {},
): Promise<AuthStatus> {
  if (options.signal?.aborted) {
    throw new Error("OAuth cancelled");
  }

  if (config.grantType === "client_credentials") {
    const provider = new McpOAuthProvider(
      serverName,
      serverUrl,
      config,
      hostCallbacks(options.onAuthorizationUrl),
    );
    try {
      await auth(provider, { serverUrl });
      return { status: "authenticated" };
    } catch (error) {
      if (options.signal?.aborted) throw error;
      console.warn(
        `[archimedes/mcp] OAuth authentication for ${serverName} failed: ${describeError(error)}`,
      );
      return { status: "failed", error: describeError(error) };
    }
  }

  // authorization_code (default): interactive browser flow
  const state = randomState();
  reserveAuthState(state);

  // The port the callback server actually bound to — passed to the provider
  // so the advertised redirect URL (redirect_uri + DCR redirect_uris) lands
  // on the live listener rather than a dead default/different port.
  let boundPort: number;
  try {
    const bind = callbackBindFromRedirectUri(config.redirectUri);
    if (bind === undefined) {
      boundPort = await ensureCallbackServer();
    } else {
      boundPort = await ensureCallbackServer(bind);
    }
  } catch (error) {
    if (options.signal?.aborted) throw error;
    console.warn(
      `[archimedes/mcp] Cannot bind the OAuth callback server for ${serverName}: ` +
        `${describeError(error)}`,
    );
    return { status: "needs-interaction" };
  }

  const provider = new McpOAuthProvider(
    serverName,
    serverUrl,
    config,
    hostCallbacks(options.onAuthorizationUrl),
    state,
    boundPort,
  );
  try {
    // SDK: discovery + (dynamic) client registration, then the
    // authorization request — delivered to the host via
    // redirectToAuthorization → onAuthorizationUrl (opens the browser).
    await auth(provider, { serverUrl });

    const resPromise = waitForCallback(state, options.signal);
    // Eager no-op rejection sink: `waitForCallback` can reject before we
    // reach the await (already-aborted signal), and an unhandled rejection
    // during that window would crash the process. The awaited promise below
    // still observes the same rejection.
    resPromise.catch(() => undefined);
    const { code } = await resPromise;

    // SDK: exchange the code for tokens (persists via provider.saveTokens).
    await auth(provider, { serverUrl, authorizationCode: code });
    return { status: "authenticated" };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    console.warn(
      `[archimedes/mcp] OAuth authentication for ${serverName} failed: ${describeError(error)}`,
    );
    return { status: "failed", error: describeError(error) };
  }
}

/**
 * Return a currently-valid access token for the server, refreshing via the
 * SDK when the stored token is expired.
 *
 * - no stored tokens → null
 * - not expired (expiresAt absent or in the future) → accessToken
 * - expired + config-stub guard (config `clientId` set without
 *   `clientSecret`) → null, no refresh attempt (ADR 0001)
 * - otherwise → SDK-driven refresh, then re-read storage: fresh token, or
 *   null when the refresh produced no valid token
 *
 * Best-effort for connect-time bearer attachment: any error (storage
 * failure, network, invalid grant) degrades to null rather than breaking
 * the connection — a missing token surfaces as 401 → needs-auth.
 */
export async function getValidToken(
  serverName: string,
  serverUrl: string,
  config: McpOAuthConfig,
): Promise<string | null> {
  try {
    const tokens = getAuthEntry(serverName)?.tokens;
    if (!tokens) return null;

    const nowSeconds = Math.floor(Date.now() / 1000);
    const notExpired = tokens.expiresAt === undefined || tokens.expiresAt > nowSeconds;
    if (notExpired) return tokens.accessToken;

    // ADR 0001 config-stub guard: a pre-registered public client (clientId
    // without secret) gets rejected at the token endpoint for a refresh
    // (invalid_client). Do not attempt the refresh — tell the user to
    // re-authenticate via /mcp-auth instead.
    if (config.clientId && !config.clientSecret) return null;

    // SDK-driven refresh: tokens() surfaces the expired stored token
    // (expires_in 0), the orchestrator runs the refresh_token grant, and
    // saveTokens persists the replacement.
    // Refresh never redirects, so the callback server is never bound and no
    // callbackPort is passed — the default-port fallback is moot here.
    const provider = new McpOAuthProvider(serverName, serverUrl, config, {});
    await auth(provider, { serverUrl });

    const refreshed = getAuthEntry(serverName)?.tokens;
    const refreshedNow = Math.floor(Date.now() / 1000);
    const stillBad =
      refreshed === undefined ||
      (refreshed.expiresAt !== undefined && refreshed.expiresAt <= refreshedNow);
    if (stillBad) {
      console.warn(
        `[archimedes/mcp] OAuth token refresh for ${serverName} did not produce a valid token ` +
          `— run /mcp-auth to re-authenticate`,
      );
      return null;
    }
    return refreshed.accessToken;
  } catch (error) {
    console.warn(
      `[archimedes/mcp] OAuth token check for ${serverName} failed: ${describeError(error)}`,
    );
    return null;
  }
}
