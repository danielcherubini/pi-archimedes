/**
 * OAuth token & client storage types (persisted in the OS credential store).
 *
 * These are the on-disk shapes under the keyring — independent of the
 * MCP SDK's wire shapes (@modelcontextprotocol/sdk's OAuthTokens, etc.),
 * which are mapped to/from these at the provider boundary.
 */

/** Stored OAuth tokens for one server (keyring value, chunked if large) */
export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  /** Unix seconds; absent when the token does not expire */
  expiresAt?: number;
  scope?: string;
  /** Authorization server issuer for multi-tenant providers */
  issuer?: string;
}

/**
 * Stored OAuth client information — either the provider-registered
 * (dynamic registration) client or a pre-registered client from config.
 * `configPreRegistered` marks the latter so refresh honors ADR 0001
 * (client-stub guard: no auto-refresh for a public client with no secret).
 */
export interface StoredClientInfo {
  clientId: string;
  clientSecret?: string;
  redirectUris?: string[];
  issuer?: string;
  /** True when the client id/secret came from mcp.json `auth` config;
   * reserved: the ADR 0001 guard keys off config.clientId/clientSecret
   * (see auth-flow.ts); kept for port-compat with the reference adapter */
  configPreRegistered?: boolean;
}

/**
 * Full per-server auth entry in the keyring. All fields optional so an
 * entry may accumulate state incrementally (code verifier during the
 * flow, client info after registration, tokens after the exchange).
 */
export interface AuthEntry {
  tokens?: StoredTokens;
  clientInfo?: StoredClientInfo;
  /** PKCE code verifier persisted before the authorization request */
  codeVerifier?: string;
  /** Reserved: not set or read — the live CSRF state lives in
   * callback-server memory for the flow duration; kept for port-compat
   * with the reference adapter */
  oauthState?: string;
  /** Server URL the credentials were obtained for; persisted for debugging +
   * future url-binding validation — not read by current code */
  serverUrl?: string;
}
