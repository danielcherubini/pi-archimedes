# MCP OAuth Plan (Phase 2 of the pi-mcp-adapter port)

**Goal:** Add OAuth 2.1 + PKCE authentication to `@pi-archimedes/mcp` so OAuth-protected MCP servers (Atlassian, Notion, GitHub, etc.) work. This includes the `/mcp-auth <server>` command, a local HTTP callback server, OS-keyring token storage, an `OAuthClientProvider` implementation for the MCP SDK, automatic token refresh, and wiring the `needs-auth` connection status (from plan-025) into an actual auth flow.

**Architecture:** Builds on plan-025's `needs-auth` status and `authenticate()` stub. Implements the MCP SDK's `OAuthClientProvider` interface (verified present in SDK v1.30.0 at `@modelcontextprotocol/sdk/client/auth.js`, alongside the `auth()` helper). Tokens are stored in the OS credential store via `@napi-rs/keyring` with chunking for Windows' 1280-char cap. A singleton local HTTP callback server (default port 19876) receives the OAuth redirect. Both interactive `authorization_code` (browser) and non-interactive `client_credentials` (M2M) grant types are supported.

**Tech Stack:** `@modelcontextprotocol/sdk` v1.30.0 (`OAuthClientProvider`, `auth()`), `@napi-rs/keyring` (OS credential store), `open` (browser launch), `node:http` (callback server), `node:crypto` (state/PKCE).

**Reference:** `docs/research/pi-mcp-adapter-oauth.md`. Source: `/home/daniel/Coding/AI/pi-mcp-adapter/` files `mcp-auth.ts`, `mcp-auth-flow.ts`, `mcp-oauth-provider.ts`, `mcp-callback-server.ts`.

**Prerequisite:** plan-025 must be merged first (provides `needs-auth` status, the `authenticate()` stub, and the connection hardening this builds on).

**Scope boundary:** Does NOT include the interactive `/mcp` panel or `/mcp setup` (plan-027). It DOES add the `/mcp-auth` command and the `/mcp logout` command, since those are auth-specific.

---

### Task 1: Add dependencies and OAuth types

**Context:**
OAuth needs three new npm dependencies and a set of storage/config types. This task adds them and defines the type surface. `@napi-rs/keyring` is a native module — it must be hoisted to the monorepo root `node_modules` (like `@modelcontextprotocol/sdk` in plan-024) so pi's jiti loader resolves it when the package is loaded via the `meta` symlink.

**Files:**
- Modify: `packages/mcp/package.json` (add deps)
- Modify: `.npmrc` (hoist keyring native module)
- Create: `packages/mcp/src/oauth-types.ts`
- Modify: `packages/mcp/src/types.ts` (widen `HttpServerDef.auth`)

**What to implement:**

Add to `packages/mcp/package.json` dependencies:
```json
"@napi-rs/keyring": "^1.3.0",
"open": "^10.2.0"
```
(`@modelcontextprotocol/sdk` is already present.)

Add to `.npmrc` (repo root) the hoist pattern so the native keyring module resolves through the symlink:
```
public-hoist-pattern[]=@napi-rs/keyring
public-hoist-pattern[]=@napi-rs/keyring-*
```
(The `@modelcontextprotocol/*` pattern is already there from plan-024.)

Widen `HttpServerDef.auth` in `types.ts`:
```typescript
auth?: { token: string } | "oauth" | McpOAuthConfig;
```
Add `McpOAuthConfig`:
```typescript
export interface McpOAuthConfig {
  grantType?: "authorization_code" | "client_credentials"; // default authorization_code
  clientId?: string;
  clientSecret?: string;   // may be "!command ..." to resolve from a subprocess
  scope?: string;
  redirectUri?: string;    // pre-registered clients only
  clientName?: string;
  authorizationServerUrl?: string;
}
```

`packages/mcp/src/oauth-types.ts` — storage types (port from adapter `mcp-auth.ts:46–81`):
```typescript
export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;   // unix seconds
  scope?: string;
  issuer?: string;
}
export interface StoredClientInfo {
  clientId: string;
  clientSecret?: string;
  redirectUris?: string[];
  issuer?: string;
  configPreRegistered?: boolean;
}
export interface AuthEntry {
  tokens?: StoredTokens;
  clientInfo?: StoredClientInfo;
  codeVerifier?: string;
  oauthState?: string;
  serverUrl?: string;
}
```

**Steps:**
- [ ] Add deps to `packages/mcp/package.json`
- [ ] Add keyring hoist patterns to `.npmrc`
- [ ] Run `pnpm install` from repo root; confirm `@napi-rs/keyring` appears in root `node_modules`
- [ ] Create `oauth-types.ts`; widen `HttpServerDef.auth`; add `McpOAuthConfig`
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass (fix the config-load warning from plan-024/025 that rejected `"oauth"` — now it's valid again)
- [ ] Update `config.ts` `loadServerDefs` auth-type warning: `"oauth"` and object configs are now valid; only warn on genuinely-unknown auth values
- [ ] Commit: `feat(mcp): add oauth dependencies and storage types`

**Acceptance criteria:**
- [ ] `@napi-rs/keyring` and `open` are installed and hoisted to root `node_modules`
- [ ] `HttpServerDef.auth` accepts `{ token }`, `"oauth"`, and `McpOAuthConfig`
- [ ] The config warning no longer fires for `auth: "oauth"`
- [ ] `npx tsc --noEmit` passes with 0 errors

---

### Task 2: Token storage via OS keyring with chunking

**Context:**
OAuth tokens must persist securely across sessions. The adapter uses `@napi-rs/keyring` (macOS Keychain / Windows Credential Manager / Linux libsecret) with a fail-closed policy (no plaintext fallback) and chunking to work around Windows' 1280-char per-value cap. This task ports that storage layer.

**Files:**
- Create: `packages/mcp/src/auth-storage.ts`

**What to implement:**

Port from adapter `mcp-auth.ts` (storage sections). Public API:
```typescript
import type { AuthEntry } from "./oauth-types.js";

export function getAuthEntry(serverName: string): AuthEntry | undefined;
export function saveAuthEntry(serverName: string, entry: AuthEntry, serverUrl?: string): void;
export function deleteAuthEntry(serverName: string): void;
```

Implementation details:
- Service name constant: `const AUTH_SECRET_SERVICE = "pi-archimedes-mcp.oauth"` (note: DIFFERENT from the adapter's `pi-mcp-adapter.oauth` so the two don't collide if both are installed).
- Account key: `sha256-<hex sha256 of serverName>`.
- `@napi-rs/keyring` `Entry(service, account)` with `.getPassword()`, `.setPassword()`, `.deletePassword()`.
- **Chunking:** if the JSON payload exceeds 1000 chars, split into 1000-char chunks written to `<account>.chunk.<digest>.<index>` accounts, plus a manifest `{ __chunks: 1, chunkCount, chunkDigest }` at the main account. On read, detect the manifest and reassemble. Reference adapter `mcp-auth.ts:680–768`.
- **In-memory cache** keyed by serverName to avoid repeated keyring reads within a session (clone on get/set to avoid mutation leaks).
- **Fail-closed:** if the keyring is unavailable, throw a clear error (`"OS credential store unavailable — cannot store OAuth tokens securely"`). Do NOT fall back to plaintext.

**Steps:**
- [ ] Write failing test `packages/mcp/src/auth-storage.test.ts` — mock `@napi-rs/keyring` `Entry` with an in-memory map; verify save+get round-trips; verify a >1000-char payload chunks and reassembles; verify delete removes all chunks
- [ ] Run `pnpm exec vitest run auth-storage` — must fail
- [ ] Create `auth-storage.ts`
- [ ] Run `pnpm exec vitest run auth-storage` — must pass
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Commit: `feat(mcp): oauth token storage via OS keyring with chunking`

**Acceptance criteria:**
- [ ] Tokens round-trip through save/get
- [ ] Payloads >1000 chars chunk and reassemble correctly
- [ ] Delete removes the manifest and all chunks
- [ ] Keyring unavailable → clear thrown error, no plaintext fallback
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 3: Local OAuth callback server

**Context:**
The `authorization_code` flow redirects the browser to `http://localhost:19876/callback?code=...&state=...`. A singleton local HTTP server receives this, validates the CSRF `state`, and hands the code back to the waiting auth flow. This task ports the callback server.

**Files:**
- Create: `packages/mcp/src/callback-server.ts`

**What to implement:**

Port from adapter `mcp-callback-server.ts`. Public API:
```typescript
export const DEFAULT_CALLBACK_PORT = 19876;
export const DEFAULT_CALLBACK_PATH = "/callback";

export function getCallbackPort(): number; // env MCP_OAUTH_CALLBACK_PORT override
export function getCallbackPath(): string;

/** Ensure the singleton server is bound. Returns the actual bound port. */
export async function ensureCallbackServer(opts?: { strictPort?: boolean; port?: number; path?: string }): Promise<number>;

/** Register a state and wait (5-min timeout) for its callback. */
export function waitForCallback(oauthState: string): Promise<{ code: string; iss?: string }>;

/** Reserve a state before the browser opens (manual-mode support). */
export function reserveAuthState(oauthState: string): void;

export async function stopCallbackServer(): Promise<void>;
```

Details:
- Singleton `http.Server`; a `bindingPromise` mutex prevents concurrent binds; a `callbackGeneration` counter invalidates stale binds.
- `handleRequest`: parse `code`/`state`/`iss`/`error`/`error_description`; 404 on wrong path; 400 on missing state; validate state against `pendingAuths` / `reservedAuthStates`; resolve the pending promise; serve self-contained HTML (success auto-close / manual-paste / error) with no external assets.
- `CALLBACK_TIMEOUT_MS = 5 * 60 * 1000`.
- For dynamic clients: bind port 0 (OS-assigned) unless `strictPort`. For pre-registered clients with a fixed `redirectUri`, bind the exact port.
- The HTML pages: keep them minimal, self-contained, light/dark aware (port the adapter's `host-html-template`/inline HTML but trim aggressively — no need for the full styling).

**Steps:**
- [ ] Write failing test `packages/mcp/src/callback-server.test.ts` — start the server on an ephemeral port; `reserveAuthState` + `waitForCallback`; simulate a GET to `/callback?code=abc&state=<state>` (via `fetch` or `http.get`); assert the promise resolves with `{ code: "abc" }`; assert wrong state → 400 and promise not resolved; stop the server
- [ ] Run `pnpm exec vitest run callback-server` — must fail
- [ ] Create `callback-server.ts`
- [ ] Run `pnpm exec vitest run callback-server` — must pass
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Commit: `feat(mcp): local oauth callback server`

**Acceptance criteria:**
- [ ] Callback with matching state resolves the waiting promise with the code
- [ ] Missing/invalid state returns 400 and does not resolve
- [ ] 5-minute timeout rejects the waiter
- [ ] Server binds a singleton, cleans up on stop
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 4: OAuthClientProvider implementation

**Context:**
The MCP SDK's `auth()` helper drives OAuth through an `OAuthClientProvider` you supply. This class bridges the SDK to our token storage, callback server, and config. It's the central contract of the whole subsystem.

**Files:**
- Create: `packages/mcp/src/oauth-provider.ts`

**What to implement:**

Port from adapter `mcp-oauth-provider.ts`. Implement `OAuthClientProvider` from `@modelcontextprotocol/sdk/client/auth.js`:

```typescript
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientMetadata, OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { McpOAuthConfig } from "./types.js";

export interface OAuthCallbacks {
  onAuthorizationUrl?: (url: string) => void; // open browser / display for headless
}

export class McpOAuthProvider implements OAuthClientProvider {
  constructor(
    private serverName: string,
    private serverUrl: string,
    private config: McpOAuthConfig,
    private callbacks: OAuthCallbacks,
    initialState?: string,
  ) {}

  get redirectUrl(): string | undefined;         // localhost:port/callback, or undefined for client_credentials
  get clientMetadata(): OAuthClientMetadata;      // redirect_uris, grant_types, token_endpoint_auth_method
  state(): string;                                // returns the CSRF state
  async clientInformation(): Promise<OAuthClientInformationFull | undefined>;  // stored or config clientId
  async saveClientInformation(info: OAuthClientInformationFull): Promise<void>; // dynamic registration result
  async tokens(): Promise<OAuthTokens | undefined>;   // from storage
  async saveTokens(tokens: OAuthTokens): Promise<void>; // to storage
  async redirectToAuthorization(url: URL): Promise<void>; // open browser via callbacks
  async saveCodeVerifier(verifier: string): Promise<void>;
  async codeVerifier(): Promise<string>;
}
```

Details:
- `redirectUrl`: `undefined` for `client_credentials`; else `config.redirectUri ?? http://localhost:${getCallbackPort()}${getCallbackPath()}`.
- `clientMetadata`: build from grant type — `client_credentials` → `{ grant_types: ["client_credentials"], token_endpoint_auth_method }`; `authorization_code` → `{ redirect_uris, grant_types: ["authorization_code","refresh_token"], response_types: ["code"], scope? }`.
- `clientInformation`: return config `clientId` if present, else stored `clientInfo` from `getAuthEntry`. Resolve a `!command` clientSecret via a subprocess (port `resolveCommandSecret`, or defer with a TODO if you want to keep it simple — but note it).
- `tokens`/`saveTokens`: map SDK `OAuthTokens` ↔ our `StoredTokens` (compute `expiresAt` from `expires_in`), persist via `auth-storage`.
- `saveCodeVerifier`/`codeVerifier`: store the PKCE verifier in the `AuthEntry` (in-flight).
- `redirectToAuthorization`: call `this.callbacks.onAuthorizationUrl?.(url.toString())` — the flow (Task 5) wires this to `open()` the browser and print the URL for headless.

Verify the exact `OAuthClientProvider` method signatures against the SDK's `auth.d.ts` before implementing — the SDK version's interface is authoritative (some methods may be optional or have slightly different names like `saveClientInformation` vs `saveClientInformationFull`).

**Steps:**
- [ ] Read `node_modules/.pnpm/@modelcontextprotocol+sdk@*/node_modules/@modelcontextprotocol/sdk/dist/esm/client/auth.d.ts` to get the EXACT `OAuthClientProvider` interface
- [ ] Write failing test `packages/mcp/src/oauth-provider.test.ts` — construct a provider with a mocked `auth-storage`; verify `clientMetadata` shapes for both grant types; verify `saveTokens` maps `expires_in` → `expiresAt` and persists; verify `redirectUrl` undefined for client_credentials
- [ ] Run `pnpm exec vitest run oauth-provider` — must fail
- [ ] Create `oauth-provider.ts`
- [ ] Run `pnpm exec vitest run oauth-provider` — must pass
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Commit: `feat(mcp): OAuthClientProvider implementation`

**Acceptance criteria:**
- [ ] Implements the SDK's `OAuthClientProvider` interface exactly (compiles against it)
- [ ] `clientMetadata` correct for both grant types
- [ ] `saveTokens` computes `expiresAt` and persists via storage
- [ ] `redirectUrl` is undefined for client_credentials
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 5: Auth flow — authenticate, discovery, token exchange, refresh

**Context:**
This ties the provider, callback server, and SDK `auth()` helper into the actual flows: interactive `authenticate()`, non-interactive client_credentials, and `getValidToken()` (refresh-if-expired). This replaces the `authenticate()` stub `ServerClient` got in plan-025.

**Files:**
- Create: `packages/mcp/src/auth-flow.ts`
- Modify: `packages/mcp/src/server-client.ts` (replace the `authenticate()` stub; use `getValidToken` for HTTP auth headers)

**What to implement:**

Port from adapter `mcp-auth-flow.ts`. Public API:
```typescript
import type { McpOAuthConfig } from "./types.js";

export type AuthStatus = "authenticated" | "needs-interaction" | "failed";

export interface AuthenticateOptions {
  onAuthorizationUrl?: (url: string) => void;
  signal?: AbortSignal;
}

/** Full interactive OAuth flow: discovery → browser → callback → token exchange. */
export async function authenticate(
  serverName: string,
  serverUrl: string,
  config: McpOAuthConfig,
  options?: AuthenticateOptions,
): Promise<AuthStatus>;

/** Get a valid access token, refreshing if expired. Returns null if not authenticated. */
export async function getValidToken(
  serverName: string,
  serverUrl: string,
  config: McpOAuthConfig,
): Promise<string | null>;

/** Extract/normalize oauth config from a server's `auth` field. */
export function extractOAuthConfig(auth: unknown): McpOAuthConfig | null;
```

Details:
- `authenticate` (authorization_code): generate a CSRF `state`; `reserveAuthState(state)`; `ensureCallbackServer()`; build `McpOAuthProvider`; call the SDK `auth(provider, { serverUrl, ... })` — the SDK triggers `redirectToAuthorization` → open browser; then `waitForCallback(state)` for the code; call `auth(provider, { authorizationCode: code, ... })` to exchange for tokens (SDK calls `saveTokens`). Return `"authenticated"`.
- For headless (no display): the `onAuthorizationUrl` callback prints the URL and instructs the user to open it and paste the redirect (manual mode via callback server's manual-paste path).
- `client_credentials`: no browser; call `auth()` with the provider — SDK does the token exchange directly.
- `getValidToken`: read stored tokens; if `expiresAt` in the past and a `refreshToken` exists, run the SDK refresh (via `auth()` with stored tokens); return the fresh access token. If no tokens, return null.
- `extractOAuthConfig`: `"oauth"` string → `{ grantType: "authorization_code" }`; object → validated `McpOAuthConfig`; `{ token }` → null (that's static bearer, not oauth).

In `server-client.ts`:
- Replace the plan-025 `authenticate()` stub with a call to `auth-flow.authenticate(...)`, passing an `onAuthorizationUrl` that uses `open()` + a console message.
- For HTTP servers with oauth config: before connecting, call `getValidToken` and attach `Authorization: Bearer <token>` via the transport's `requestInit.headers`. On a 401 during connect, set `needs-auth` (already done in plan-025) — the user then runs `/mcp-auth`.

**Steps:**
- [ ] Write failing test `packages/mcp/src/auth-flow.test.ts` — test `extractOAuthConfig` for `"oauth"` / object / `{token}` / undefined; test `getValidToken` returns null when no stored tokens (mock `auth-storage`). (Full browser flow is not unit-testable — cover the pure helpers.)
- [ ] Run `pnpm exec vitest run auth-flow` — must fail
- [ ] Create `auth-flow.ts`
- [ ] Run `pnpm exec vitest run auth-flow` — must pass
- [ ] Wire `server-client.ts`: real `authenticate()`, `getValidToken` for HTTP headers
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Commit: `feat(mcp): oauth authenticate flow, token exchange, and refresh`

**Acceptance criteria:**
- [ ] `extractOAuthConfig` correctly classifies all auth shapes
- [ ] `getValidToken` refreshes expired tokens and returns null when unauthenticated
- [ ] `server-client.authenticate()` runs the real flow (no longer a stub)
- [ ] HTTP oauth servers attach a bearer token from storage on connect
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 6: /mcp-auth and /mcp logout commands

**Context:**
Users trigger authentication with `/mcp-auth <server>` and clear it with `/mcp logout <server>`. This task registers those commands. The interactive `/mcp` panel and `/mcp setup` come in plan-027 — this task only adds the two auth commands.

**Files:**
- Create: `packages/mcp/src/commands-auth.ts`
- Modify: `packages/mcp/src/index.ts` (register the commands)

**What to implement:**

`packages/mcp/src/commands-auth.ts`:
```typescript
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export function registerAuthCommands(pi: ExtensionAPI, deps: {
  getServerDef: (name: string) => import("./types.js").HttpServerDef | undefined;
  getManager: () => import("./server-manager.js").ServerManager;
}): void;
```

- `/mcp-auth <server>`:
  1. Look up the server def; extract oauth config via `extractOAuthConfig`. If not an oauth server → notify "server X is not configured for OAuth".
  2. Run `authenticate(name, url, config, { onAuthorizationUrl: (u) => { open(u); ctx.ui.notify("Opening browser… if it didn't open, visit: " + u, "info"); } })`.
  3. On success → notify "Authenticated with X"; reconnect the server (`manager.getClient(name)?.close()` then `connect()`); notify tool count.
  4. On failure → notify the error.
  Use a `BorderedLoader` (from `@earendil-works/pi-coding-agent`) during the flow so the user can cancel (see tui.md Pattern 2).
- `/mcp logout <server>`:
  1. `deleteAuthEntry(name)`; close the connection; notify "Logged out of X".

Register both in `index.ts` via `pi.registerCommand`. The command names are `mcp-auth` and — since `logout` is a subcommand of a future `/mcp` — register `/mcp-auth` as its own command now, and handle `logout` as an arg later in plan-027's `/mcp` dispatcher. For this plan, add a standalone `/mcp-logout <server>` command (plan-027 can fold it into `/mcp logout`).

**Steps:**
- [ ] Create `commands-auth.ts` with `registerAuthCommands`
- [ ] Wire into `index.ts` (pass `getServerDef` + `getManager` deps)
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Manual test: configure an oauth server (or the Atlassian one), run `/mcp-auth atlassian`, complete the browser flow, verify the server connects and tools appear
- [ ] Manual test: `/mcp-logout atlassian` clears the token (subsequent connect → needs-auth)
- [ ] Commit: `feat(mcp): /mcp-auth and /mcp-logout commands`

**Acceptance criteria:**
- [ ] `/mcp-auth <server>` runs the OAuth flow and connects on success
- [ ] Non-oauth servers get a clear "not configured for OAuth" message
- [ ] `/mcp-logout <server>` deletes the stored token
- [ ] The flow is cancellable (BorderedLoader)
- [ ] `npx tsc --noEmit` clean; manual auth against a real server works

---

### Task 7: Auto-auth on needs-auth + type-check + docs

**Context:**
Final integration. When a tool call hits a `needs-auth` server and `autoAuth` is enabled, optionally trigger the flow automatically. Then verify the whole monorepo and document the OAuth settings.

**Files:**
- Modify: `packages/mcp/src/index.ts` (auto-auth hook in the proxy `call` path)
- Modify: `packages/mcp/src/types.ts` (add `autoAuth` to `McpConfig`)
- Modify: `README.md`, `docs/plans/README.md`

**What to implement:**
1. Add `autoAuth: boolean` (default `false`) to `McpConfig` + `DEFAULT_MCP_CONFIG`.
2. In the proxy `call` action (and direct-tool executor), when the owning server is `needs-auth`: if `autoAuth`, run `authenticate(...)` inline (with the loader), then retry the call; else return a message telling the user to run `/mcp-auth <server>`.
3. Update `README.md` mcp section: document `/mcp-auth`, `/mcp-logout`, the `auth` config field (`"oauth"` / `{ token }` / object), and `autoAuth`.

**Steps:**
- [ ] Add `autoAuth` to config
- [ ] Wire auto-auth / needs-auth message into the call path
- [ ] Run `pnpm exec tsc --noEmit` in all 11 package directories — fix any new errors
- [ ] Run `pnpm exec vitest run` at repo root — all pass
- [ ] Update `README.md` + `docs/plans/README.md`
- [ ] Commit: `feat(mcp): auto-auth on needs-auth + document oauth`

**Acceptance criteria:**
- [ ] `needs-auth` on a call gives a clear "run /mcp-auth" message (or auto-auths if enabled)
- [ ] All 11 `tsc --noEmit` pass
- [ ] All tests pass
- [ ] README documents the OAuth surface
