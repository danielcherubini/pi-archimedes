/**
 * MCP SDK OAuth client provider for the archimedes mcp package.
 *
 * Bridges the SDK's `auth()` driver (see
 * `@modelcontextprotocol/sdk/client/auth.js` — `OAuthClientProvider`) to
 * archimedes' keyring-based credential storage and local callback server:
 *
 * - tokens and client info persist in the OS credential store via
 *   {@link getAuthEntry}/{@link saveAuthEntry} (one `AuthEntry` per server);
 * - interactive browser flows arrive via `onAuthorizationUrl` so the host
 *   decides how the user is taken to the authorization page;
 * - `client_credentials` is a non-interactive grant: no redirect URL, no
 *   PKCE state (an empty `state()` is intentional — the flow never uses it).
 *
 * Storage shapes (`StoredTokens`/`StoredClientInfo`) are mapped to/from the
 * SDK's wire shapes (`OAuthTokens`/`OAuthClientInformationMixed`) at this
 * boundary only — the keyring never holds SDK wire shapes.
 */

import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { getAuthEntry, saveAuthEntry } from "./auth-storage.js";
import { getCallbackPath, getCallbackPort } from "./callback-server.js";
import type { McpOAuthConfig } from "./types.js";

/** Optional hooks so the host can observe or drive the interactive parts of the flow. */
export interface OAuthCallbacks {
  /** Called once when the SDK builds the authorization URL. */
  onAuthorizationUrl?: (url: URL) => void | Promise<void>;
}

/**
 * `OAuthClientProvider` backed by the per-server `AuthEntry` in the OS
 * credential store. Constructor arguments identify the server (`serverName`
 * is the storage key, `serverUrl` keeps `entry.serverUrl` in sync) and the
 * optional `csrfState` is the state the callback validation will expect.
 * `callbackPort` (interactive authorization_code flows only) is the actual
 * port the callback server bound to — it pins the advertised redirect URL to
 * the listening server when `config.redirectUri` is absent (dynamic clients
 * bind an OS-assigned port, not the `MCP_OAUTH_CALLBACK_PORT` default).
 */
export class McpOAuthProvider implements OAuthClientProvider {
  constructor(
    private serverName: string,
    private serverUrl: string,
    private config: McpOAuthConfig,
    private callbacks: OAuthCallbacks,
    private csrfState?: string,
    private callbackPort?: number,
  ) {}

  /** Current time in unix seconds (floored) — used for expires_in ↔ expiresAt math. */
  private get nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }

  private get usesClientCredentials(): boolean {
    return this.config.grantType === "client_credentials";
  }

  private get clientName(): string {
    return this.config.clientName ?? this.serverName;
  }

  /** Loopback callback URL for interactive flows; undefined for client_credentials. */
  get redirectUrl(): string | URL | undefined {
    if (this.usesClientCredentials) return undefined;
    return (
      this.config.redirectUri ??
      `http://localhost:${this.callbackPort ?? getCallbackPort()}${getCallbackPath()}`
    );
  }

  /** DCR / well-known metadata, per grant type. */
  get clientMetadata(): OAuthClientMetadata {
    const authMethod = this.config.clientSecret ? "client_secret_post" : "none";

    if (this.usesClientCredentials) {
      return {
        redirect_uris: [],
        client_name: this.clientName,
        grant_types: ["client_credentials"],
        token_endpoint_auth_method: authMethod,
      };
    }

    const redirectUrl = this.redirectUrl;
    if (redirectUrl === undefined) {
      throw new Error("redirectUrl is required for the authorization_code flow");
    }
    return {
      redirect_uris: [String(redirectUrl)],
      client_name: this.clientName,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: authMethod,
      ...(this.config.scope ? { scope: this.config.scope } : {}),
    };
  }

  /**
   * CSRF state for the authorization request. Empty when no state was
   * pre-generated: only the never-redirected client_credentials flow can
   * reach this, so the empty value is intentional (not an error).
   */
  state(): string {
    return this.csrfState ?? "";
  }

  /** Pre-registered client from config wins; otherwise the stored (DCR) client. */
  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    if (this.config.clientId) {
      return {
        client_id: this.config.clientId,
        ...(this.config.clientSecret ? { client_secret: this.config.clientSecret } : {}),
      };
    }

    const stored = getAuthEntry(this.serverName)?.clientInfo;
    if (stored === undefined) return undefined;
    return {
      client_id: stored.clientId,
      ...(stored.clientSecret ? { client_secret: stored.clientSecret } : {}),
      ...(stored.redirectUris ? { redirect_uris: stored.redirectUris } : {}),
    };
  }

  /** Persist DCR-registered client info into the entry, preserving tokens/verifier. */
  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    const existing = getAuthEntry(this.serverName) ?? {};
    const clientInfo: { clientId: string; clientSecret?: string; redirectUris?: string[] } = {
      clientId: info.client_id,
    };
    if (info.client_secret) clientInfo.clientSecret = info.client_secret;
    // `redirect_uris` only exists on the full-registration member of the union.
    if ("redirect_uris" in info) clientInfo.redirectUris = info.redirect_uris;

    saveAuthEntry(this.serverName, { ...existing, clientInfo }, this.serverUrl);
  }

  /** Map stored tokens to the SDK wire shape; undefined when none are stored. */
  async tokens(): Promise<OAuthTokens | undefined> {
    const stored = getAuthEntry(this.serverName)?.tokens;
    if (stored === undefined) return undefined;
    return {
      access_token: stored.accessToken,
      token_type: "Bearer",
      ...(stored.refreshToken ? { refresh_token: stored.refreshToken } : {}),
      // Expired tokens are still returned (expires_in 0) so the SDK's auth()
      // driver takes its refresh path — do not filter here.
      ...(stored.expiresAt !== undefined
        ? { expires_in: Math.max(0, stored.expiresAt - this.nowSeconds) }
        : {}),
      ...(stored.scope ? { scope: stored.scope } : {}),
    };
  }

  /** Map SDK wire tokens to the stored shape and persist into the entry. */
  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const existing = getAuthEntry(this.serverName) ?? {};
    const stored = {
      accessToken: tokens.access_token,
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      ...(tokens.expires_in != null
        ? { expiresAt: this.nowSeconds + tokens.expires_in }
        : {}),
      ...(tokens.scope ? { scope: tokens.scope } : {}),
    };

    saveAuthEntry(this.serverName, { ...existing, tokens: stored }, this.serverUrl);
  }

  /** Hand the authorization URL to the host (browser open / prompt). */
  async redirectToAuthorization(url: URL): Promise<void> {
    await this.callbacks.onAuthorizationUrl?.(url);
  }

  /** Persist the PKCE verifier before the authorization redirect. */
  async saveCodeVerifier(verifier: string): Promise<void> {
    const existing = getAuthEntry(this.serverName) ?? {};
    saveAuthEntry(this.serverName, { ...existing, codeVerifier: verifier }, this.serverUrl);
  }

  /** Read the PKCE verifier back for the token exchange. */
  async codeVerifier(): Promise<string> {
    const verifier = getAuthEntry(this.serverName)?.codeVerifier;
    if (verifier === undefined) {
      throw new Error("Missing OAuth code verifier");
    }
    return verifier;
  }
}
