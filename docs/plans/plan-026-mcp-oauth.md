# MCP OAuth Plan (Phase 2 of the pi-mcp-adapter port)

**Goal:** Add OAuth 2.1 + PKCE authentication to `@pi-archimedes/mcp` so OAuth-protected MCP servers (Atlassian, Notion, GitHub, etc.) work: the `/mcp-auth <server>` command, a local HTTP callback server, OS-keyring token storage, an `OAuthClientProvider` for the MCP SDK, SDK-driven token refresh, and wiring the `needs-auth` connection status (from plan-025) into a real auth flow.

**Architecture:** Builds on plan-025's `needs-auth` status and `authenticate()` stub. Implements the MCP SDK's `OAuthClientProvider` interface (verified in SDK v1.30.0 at `@modelcontextprotocol/sdk/client/auth.js`, with the `auth()` orchestrator). Tokens persist in the OS credential store via `@napi-rs/keyring` with chunking for Windows' per-value cap. A singleton local HTTP callback server (default port 19876) receives the OAuth redirect. Interactive `authorization_code` (browser) and non-interactive `client_credentials` (M2M) grants are supported.

**Tech Stack:** `@modelcontextprotocol/sdk` v1.30.0 (`OAuthClientProvider`, `auth()`), `@napi-rs/keyring`, `open`, `node:http`, `node:crypto`.

**Reference research:** `docs/research/pi-mcp-adapter-oauth.md`. **ADRs:** 0001 (refresh strategy). Source files: `/home/daniel/Coding/AI/pi-mcp-adapter/{mcp-auth,mcp-auth-flow,mcp-oauth-provider,mcp-callback-server}.ts`.

**Prerequisite:** plan-025 MUST be merged first (provides `needs-auth` status, the `authenticate()` stub, connection hardening). The `packages/mcp/vitest.config.ts` wiring from plan-025 Task 0 must exist.

**Design decisions (locked via discussion — see ADR 0001):**
- **Refresh:** SDK-driven via `auth()` + a lightweight config-stub guard (clientId without secret + expired token → tell user to re-auth, do NOT auto-refresh).
- **Cancellation:** `waitForCallback` accepts an `AbortSignal`; the `/mcp-auth` BorderedLoader's cancel aborts it.
- **`!command` client secrets:** NOT ported (literal secret strings only; future enhancement).

**Verified SDK facts (v1.30.0 — do not re-derive, these are authoritative):**
- `OAuthClientProvider` methods: `get redirectUrl(): string | URL | undefined`, `get clientMetadata(): OAuthClientMetadata`, `state?(): string | Promise<string>` (OPTIONAL), `clientInformation(): OAuthClientInformationMixed | undefined | Promise<...>`, `saveClientInformation?(info: OAuthClientInformationMixed)` (OPTIONAL), `tokens(): OAuthTokens | undefined | Promise<...>`, `saveTokens(tokens: OAuthTokens): void | Promise<void>`, `redirectToAuthorization(url: URL): void | Promise<void>`, `saveCodeVerifier(v: string): void | Promise<void>`, `codeVerifier(): string | Promise<string>`.
- Use `OAuthClientInformationMixed` (NOT `OAuthClientInformationFull`) for `clientInformation`/`saveClientInformation` — the parameter is contravariant; the narrower type fails `implements`.
- `OAuthTokens` fields (snake_case): `{ access_token, token_type (REQUIRED — hardcode "Bearer"), expires_in?, scope?, refresh_token?, id_token? }`.
- `auth(provider, { serverUrl, authorizationCode?, scope? })` — the orchestrator reads tokens/client-info FROM the provider; there is no "pass stored tokens" parameter.
- Import types from `@modelcontextprotocol/sdk/shared/auth.js`; `auth`/`OAuthClientProvider` from `@modelcontextprotocol/sdk/client/auth.js`.

**Scope boundary:** Adds `/mcp-auth` and `/mcp-logout` as standalone commands (plan-027 folds `/mcp-logout` into `/mcp logout`). Does NOT add the `/mcp` panel or `/mcp setup`.

---

### Task 1: Add dependencies, hoist native module, add OAuth types

**Context:**
OAuth needs three deps and a storage/config type surface. `@napi-rs/keyring` is a native module — like `@modelcontextprotocol/sdk` in plan-024, it must be hoisted to the monorepo root `node_modules` (via `.npmrc`) so pi's jiti loader resolves it when the package loads through the `meta` symlink. `open` is pure-JS but its runtime resolution through the symlink must also be verified (hoist if needed). This task is types + deps only — no behavior.

**Files:**
- Modify: `packages/mcp/package.json`
- Modify: `.npmrc` (repo root)
- Create: `packages/mcp/src/oauth-types.ts`
- Modify: `packages/mcp/src/types.ts`
- Modify: `packages/mcp/src/config.ts` (auth-type warning)

**What to implement:**

1. In `packages/mcp/package.json` dependencies: bump `"@modelcontextprotocol/sdk"` floor to `"^1.30.0"`, add `"@napi-rs/keyring": "^1.3.0"`, `"open": "^10.2.0"`.
2. In root `.npmrc`, append (the `@modelcontextprotocol/*` line is already there from plan-024):
   ```
   public-hoist-pattern[]=@napi-rs/keyring
   public-hoist-pattern[]=@napi-rs/keyring-*
   ```
3. Widen `HttpServerDef.auth` in `types.ts` to `{ token: string } | "oauth" | McpOAuthConfig` and add:
   ```typescript
   export interface McpOAuthConfig {
     grantType?: "authorization_code" | "client_credentials"; // default authorization_code
     clientId?: string;
     clientSecret?: string;   // literal only (no "!command" resolution — see ADR/scope)
     scope?: string;
     redirectUri?: string;    // pre-registered clients only
     clientName?: string;
     authorizationServerUrl?: string;
   }
   ```
4. Create `packages/mcp/src/oauth-types.ts` (port adapter `mcp-auth.ts:46–81`):
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
5. In `config.ts` `loadServerDefs`, update the auth-type warning added in plan-025: `"oauth"` and object (`McpOAuthConfig`) are now valid — only warn on genuinely-unknown auth shapes.

**Steps:**
- [ ] Bump SDK floor + add `@napi-rs/keyring`, `open` to `packages/mcp/package.json`
- [ ] Append keyring hoist patterns to `.npmrc`
- [ ] Run `pnpm install` from repo root
- [ ] Confirm `ls node_modules/@napi-rs/keyring` exists (hoisted to root)
- [ ] Confirm `open` resolves through the symlink: `node -e "require('/home/daniel/.npm-packages/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti')('/home/daniel/Coding/AI/pi-archimedes/meta/src/index.ts').import('open')"` — if it throws MODULE_NOT_FOUND, add `public-hoist-pattern[]=open` to `.npmrc` and re-run `pnpm install`
- [ ] Create `oauth-types.ts`; widen `HttpServerDef.auth`; add `McpOAuthConfig`
- [ ] Update the `config.ts` auth-type warning
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Commit: `feat(mcp): add oauth dependencies and storage types`

**Acceptance criteria:**
- [ ] `@napi-rs/keyring` is hoisted to root `node_modules`; `open` resolves through the symlink
- [ ] `HttpServerDef.auth` accepts `{ token }`, `"oauth"`, and `McpOAuthConfig`
- [ ] The config warning no longer fires for `auth: "oauth"` or object configs
- [ ] `npx tsc --noEmit` passes

---

### Task 2: Token storage via OS keyring with chunking

**Context:**
OAuth tokens must persist securely across sessions. Port the adapter's keyring storage (macOS Keychain / Windows Credential Manager / Linux libsecret) with fail-closed policy (no plaintext fallback) and chunking for Windows' 1280-char cap.

**Files:**
- Create: `packages/mcp/src/auth-storage.ts`

**What to implement:**

Port from adapter `mcp-auth.ts` storage sections. Public API:
```typescript
import type { AuthEntry } from "./oauth-types.js";
export function getAuthEntry(serverName: string): AuthEntry | undefined;
export function saveAuthEntry(serverName: string, entry: AuthEntry, serverUrl?: string): void;
export function deleteAuthEntry(serverName: string): void;
```

Details:
- Service constant: `const AUTH_SECRET_SERVICE = "pi-archimedes-mcp.oauth"` (DIFFERENT from the adapter's `pi-mcp-adapter.oauth` so both can coexist).
- Account key: `sha256-<hex sha256 of serverName>` (`node:crypto` `createHash("sha256")`).
- `@napi-rs/keyring`: `new Entry(service, account)`, `.getPassword()`, `.setPassword(value)`, `.deletePassword()`.
- **Chunking:** if the JSON payload > 1000 chars, split into 1000-char chunks written to `<account>.chunk.<digest>.<index>` accounts, plus a manifest `{ __chunks: 1, chunkCount, chunkDigest }` (digest = first 16 hex chars of sha256(payload)) at the main account. On read, detect the manifest, read + reassemble chunks. On delete/overwrite, remove stale chunks. Reference adapter `mcp-auth.ts:680–768`.
- **In-memory cache** keyed by serverName; clone on get/set to avoid mutation leaks.
- **Fail-closed:** wrap keyring access; if unavailable, throw `new Error("OS credential store unavailable — cannot store OAuth tokens securely")`. No plaintext fallback.

**Steps:**
- [ ] Write failing test `packages/mcp/src/auth-storage.test.ts` — mock `@napi-rs/keyring` with `vi.mock` providing an `Entry` class backed by an in-memory `Map<service+account, string>`; verify save+get round-trips a small entry; a >1000-char entry chunks (assert multiple accounts written) and reassembles; delete removes manifest + all chunks
- [ ] Run `pnpm exec vitest run auth-storage` — must fail
- [ ] Create `auth-storage.ts`
- [ ] Run `pnpm exec vitest run auth-storage` — must pass
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Commit: `feat(mcp): oauth token storage via OS keyring with chunking`

**Acceptance criteria:**
- [ ] Tokens round-trip through save/get
- [ ] Payloads >1000 chars chunk and reassemble
- [ ] Delete removes manifest + all chunks
- [ ] Keyring unavailable → clear thrown error, no plaintext fallback
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 3: Local OAuth callback server (AbortSignal-cancellable)

**Context:**
The `authorization_code` flow redirects the browser to `http://localhost:19876/callback?code=...&state=...`. A singleton local HTTP server receives this, validates the CSRF `state`, and hands the code back to the waiting flow. Per the discussion decision, `waitForCallback` accepts an `AbortSignal` so the `/mcp-auth` loader can cancel a stuck flow.

**Files:**
- Create: `packages/mcp/src/callback-server.ts`

**What to implement:**

Port from adapter `mcp-callback-server.ts`. Public API:
```typescript
export const DEFAULT_CALLBACK_PORT = 19876;
export const DEFAULT_CALLBACK_PATH = "/callback";
export function getCallbackPort(): number; // env MCP_OAUTH_CALLBACK_PORT override
export function getCallbackPath(): string;
export async function ensureCallbackServer(opts?: { strictPort?: boolean; port?: number; path?: string }): Promise<number>;
export function reserveAuthState(oauthState: string): void;
/** Wait for the callback for this state. Rejects on 5-min timeout OR when signal aborts. */
export function waitForCallback(oauthState: string, signal?: AbortSignal): Promise<{ code: string; iss?: string }>;
export async function stopCallbackServer(): Promise<void>;
```

Details:
- Singleton `http.Server`; a `bindingPromise` mutex prevents concurrent binds; a `callbackGeneration` counter invalidates stale binds.
- `handleRequest`: parse `code`/`state`/`iss`/`error`/`error_description`; 404 wrong path; 400 missing state; validate state against `pendingAuths`/`reservedAuthStates`; resolve the pending promise; serve self-contained HTML (success auto-close / manual-paste / error), no external assets.
- `CALLBACK_TIMEOUT_MS = 5 * 60 * 1000`.
- **AbortSignal:** in `waitForCallback`, if `signal` is provided, add an `abort` listener that clears the timeout, removes the pending entry, and rejects with `new Error("OAuth cancelled")`. If `signal.aborted` already, reject immediately. Clean up the listener on resolve/reject.
- Dynamic clients bind port 0 (OS-assigned) unless `strictPort`; pre-registered clients with a fixed `redirectUri` bind the exact port.
- HTML pages: minimal, self-contained, light/dark aware (trim the adapter's aggressively).

**Steps:**
- [ ] Write failing test `packages/mcp/src/callback-server.test.ts` — start on an ephemeral port; `reserveAuthState` + `waitForCallback`; `http.get` to `/callback?code=abc&state=<state>`; assert resolves `{ code: "abc" }`; wrong state → 400 and unresolved; an `AbortController.abort()` rejects the waiter with "OAuth cancelled"; stop the server
- [ ] Run `pnpm exec vitest run callback-server` — must fail
- [ ] Create `callback-server.ts`
- [ ] Run `pnpm exec vitest run callback-server` — must pass
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Commit: `feat(mcp): local oauth callback server with abort support`

**Acceptance criteria:**
- [ ] Matching-state callback resolves with the code
- [ ] Missing/invalid state → 400, unresolved
- [ ] 5-minute timeout rejects
- [ ] AbortSignal rejects the waiter with "OAuth cancelled"
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 4: OAuthClientProvider implementation

**Context:**
The MCP SDK's `auth()` helper drives OAuth through an `OAuthClientProvider` you supply. This class bridges the SDK to our token storage, callback server, and config. It's the central contract.

**Files:**
- Create: `packages/mcp/src/oauth-provider.ts`

**What to implement:**

Implement `OAuthClientProvider` from `@modelcontextprotocol/sdk/client/auth.js` (signatures are in the "Verified SDK facts" block above — use them verbatim):

```typescript
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientMetadata, OAuthClientInformationMixed, OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { McpOAuthConfig } from "./types.js";

export interface OAuthCallbacks {
  onAuthorizationUrl?: (url: URL) => void | Promise<void>;
}

export class McpOAuthProvider implements OAuthClientProvider {
  constructor(
    private serverName: string,
    private serverUrl: string,
    private config: McpOAuthConfig,
    private callbacks: OAuthCallbacks,
    private csrfState?: string,
  ) {}

  get redirectUrl(): string | URL | undefined { /* undefined for client_credentials; else config.redirectUri ?? http://localhost:${getCallbackPort()}${getCallbackPath()} */ }
  get clientMetadata(): OAuthClientMetadata { /* per grant type (below) */ }
  state(): string { return this.csrfState ?? ""; }   // SDK method is optional; concrete impl is fine. Empty string only occurs for client_credentials which does not use state — intentional, do NOT change to throw.
  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> { /* config.clientId, else stored clientInfo */ }
  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> { /* persist to AuthEntry.clientInfo */ }
  async tokens(): Promise<OAuthTokens | undefined> { /* map StoredTokens → OAuthTokens, token_type: "Bearer" */ }
  async saveTokens(tokens: OAuthTokens): Promise<void> { /* map OAuthTokens → StoredTokens (expiresAt = now + expires_in), persist */ }
  async redirectToAuthorization(url: URL): Promise<void> { await this.callbacks.onAuthorizationUrl?.(url); }
  async saveCodeVerifier(verifier: string): Promise<void> { /* store in AuthEntry.codeVerifier */ }
  async codeVerifier(): Promise<string> { /* read AuthEntry.codeVerifier, throw if missing */ }
}
```

Details:
- `redirectUrl`: `undefined` when `config.grantType === "client_credentials"`; else `config.redirectUri ?? \`http://localhost:${getCallbackPort()}${getCallbackPath()}\``.
- `clientMetadata`:
  - client_credentials → `{ client_name, redirect_uris: [], grant_types: ["client_credentials"], token_endpoint_auth_method: config.clientSecret ? "client_secret_post" : "none" }`.
  - authorization_code → `{ redirect_uris: [redirectUrl], client_name, grant_types: ["authorization_code","refresh_token"], response_types: ["code"], token_endpoint_auth_method: config.clientSecret ? "client_secret_post" : "none", ...(config.scope ? { scope: config.scope } : {}) }`.
- `clientInformation`: if `config.clientId` → return `{ client_id: config.clientId, ...(config.clientSecret ? { client_secret: config.clientSecret } : {}) }`; else return stored `clientInfo` mapped to the SDK shape (or `undefined`).
- `tokens`: read `AuthEntry.tokens`; map to `{ access_token, token_type: "Bearer", ...(refreshToken ? { refresh_token } : {}), ...(expiresAt ? { expires_in: Math.max(0, expiresAt - nowSeconds) } : {}), ...(scope ? { scope } : {}) }`.
- `saveTokens`: map to `StoredTokens` (`expiresAt = nowSeconds + (tokens.expires_in ?? 0)` when `expires_in` present), persist via `saveAuthEntry` (merge into existing entry to preserve `clientInfo`/`codeVerifier`).
- Read the actual `auth.d.ts` before writing to confirm no signature drift.

**Steps:**
- [ ] Read `node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@4.4.3/node_modules/@modelcontextprotocol/sdk/dist/esm/client/auth.d.ts` (the `OAuthClientProvider` interface) to confirm signatures
- [ ] Write failing test `packages/mcp/src/oauth-provider.test.ts` — mock `auth-storage`; verify `clientMetadata` for both grant types; `saveTokens` maps `expires_in` → `expiresAt` and persists; `tokens()` maps back with `token_type: "Bearer"`; `redirectUrl` undefined for client_credentials
- [ ] Run `pnpm exec vitest run oauth-provider` — must fail
- [ ] Create `oauth-provider.ts`
- [ ] Run `pnpm exec vitest run oauth-provider` — must pass
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass (it must satisfy `implements OAuthClientProvider`)
- [ ] Commit: `feat(mcp): OAuthClientProvider implementation`

**Acceptance criteria:**
- [ ] Compiles against `implements OAuthClientProvider` (uses `OAuthClientInformationMixed`)
- [ ] `clientMetadata` correct for both grant types
- [ ] `saveTokens`/`tokens` round-trip with `token_type: "Bearer"` and `expires_in`↔`expiresAt`
- [ ] `redirectUrl` undefined for client_credentials
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 5: Auth flow — authenticate, refresh (with config-stub guard), extract config

**Context:**
Ties provider + callback server + SDK `auth()` into the flows: interactive `authenticate()`, `getValidToken()` (SDK-driven refresh + config-stub guard per ADR 0001), and `extractOAuthConfig()`. Replaces the `authenticate()` stub `ServerClient` got in plan-025.

**Files:**
- Create: `packages/mcp/src/auth-flow.ts`
- Modify: `packages/mcp/src/server-client.ts`

**What to implement:**

Port from adapter `mcp-auth-flow.ts`. Public API:
```typescript
import type { McpOAuthConfig } from "./types.js";
export type AuthStatus = "authenticated" | "needs-interaction" | "failed";
export interface AuthenticateOptions {
  onAuthorizationUrl?: (url: URL) => void | Promise<void>;
  signal?: AbortSignal;
}
export async function authenticate(serverName: string, serverUrl: string, config: McpOAuthConfig, options?: AuthenticateOptions): Promise<AuthStatus>;
export async function getValidToken(serverName: string, serverUrl: string, config: McpOAuthConfig): Promise<string | null>;
export function extractOAuthConfig(auth: unknown): McpOAuthConfig | null;
```

Details:
- `extractOAuthConfig`: `"oauth"` → `{ grantType: "authorization_code" }`; object with oauth-ish fields → validated `McpOAuthConfig`; `{ token }` → `null` (static bearer, not oauth); else `null`.
- `authenticate` (authorization_code):
  1. Generate CSRF `state` (32 random bytes hex via `crypto.getRandomValues`).
  2. `reserveAuthState(state)`; `await ensureCallbackServer()`.
  3. Build `McpOAuthProvider(serverName, serverUrl, config, { onAuthorizationUrl: options.onAuthorizationUrl }, state)`.
  4. `await auth(provider, { serverUrl })` — SDK triggers `redirectToAuthorization` → the callback opens the browser.
  5. `const { code } = await waitForCallback(state, options.signal)`.
  6. `await auth(provider, { serverUrl, authorizationCode: code })` — SDK exchanges code → calls `saveTokens`.
  7. Return `"authenticated"`. On abort/timeout → `"failed"` (or rethrow the abort).
- `authenticate` (client_credentials): build provider, `await auth(provider, { serverUrl })` (no browser), return `"authenticated"`.
- `getValidToken`:
  1. Read stored tokens via `getAuthEntry`. If none → return `null`.
  2. If not expired (`expiresAt` absent or in the future) → return `accessToken`.
  3. If expired: **config-stub guard (ADR 0001)** — if `config.clientId && !config.clientSecret` (pre-registered public client), do NOT refresh; return `null` (caller surfaces "run /mcp-auth"). Otherwise build the provider and `await auth(provider, { serverUrl })` to run the SDK refresh grant, then re-read tokens and return the fresh `accessToken` (or `null` if refresh failed).

In `server-client.ts`:
- Replace the plan-025 `authenticate()` stub. **Target signature:** `authenticate(options?: { onAuthorizationUrl?: (url: URL) => void | Promise<void>; signal?: AbortSignal }): Promise<void>`. It derives `serverUrl` from `this.def.url` and `cfg` from `extractOAuthConfig(this.def.auth)` (throw a clear error if `cfg` is null — the server isn't oauth). Body calls `auth-flow.authenticate(this.name, this.def.url, cfg, options)`.
- For HTTP servers with an oauth config: before connecting, `const token = await getValidToken(name, url, cfg)`; if present, attach `Authorization: Bearer <token>` via the transport's `requestInit.headers`. On a 401 during connect, `needs-auth` is already set (plan-025) — user runs `/mcp-auth`.

**Single auth entry point (avoid divergence):** `ServerClient.authenticate(options)` is the ONE method that runs the flow. Both `/mcp-auth` (Task 6) and auto-auth (Task 7) call `manager.getClient(name).authenticate(options)` — they do NOT call `auth-flow.authenticate` directly. `auth-flow.authenticate` is the internal implementation; `ServerClient.authenticate` is the public entry that sources `url`/`cfg` from `this.def`.

**Steps:**
- [ ] Write failing test `packages/mcp/src/auth-flow.test.ts` — `extractOAuthConfig` for `"oauth"` / object / `{token}` / undefined; `getValidToken` returns `null` with no stored tokens; `getValidToken` returns `null` (no refresh attempt) for an expired token when `clientId` set + no secret (config-stub guard); `getValidToken` returns the token when not expired. Mock `auth-storage`.
- [ ] Run `pnpm exec vitest run auth-flow` — must fail
- [ ] Create `auth-flow.ts`
- [ ] Run `pnpm exec vitest run auth-flow` — must pass
- [ ] Wire `server-client.ts`: real `authenticate()`; `getValidToken` for HTTP bearer headers
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Commit: `feat(mcp): oauth authenticate flow, refresh with config-stub guard`

**Acceptance criteria:**
- [ ] `extractOAuthConfig` classifies all auth shapes correctly
- [ ] `getValidToken` refreshes normally but honors the config-stub guard (no refresh → null for clientId-without-secret)
- [ ] `server-client.authenticate()` runs the real flow (no longer a stub)
- [ ] HTTP oauth servers attach a bearer token on connect
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 6: /mcp-auth and /mcp-logout commands

**Context:**
Users trigger authentication with `/mcp-auth <server>` and clear it with `/mcp-logout <server>`. Both are standalone commands here (plan-027 folds `/mcp-logout` into `/mcp logout`). The flow is cancellable via a `BorderedLoader` whose abort feeds the auth `AbortSignal`.

**Files:**
- Create: `packages/mcp/src/commands-auth.ts`
- Modify: `packages/mcp/src/index.ts`

**What to implement:**

`packages/mcp/src/commands-auth.ts`:
```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export function registerAuthCommands(pi: ExtensionAPI, deps: {
  getServerDef: (name: string) => import("./types.js").HttpServerDef | undefined;
  getManager: () => import("./server-manager.js").ServerManager;
}): void;
```

- `/mcp-auth <server>`:
  1. Guard `if (!ctx.hasUI) { ctx.ui.notify("…requires interactive TUI"); return; }`.
  2. Look up the def: `const def = deps.getServerDef(name)`; `const cfg = extractOAuthConfig(def?.auth)`. If `null` → notify "server X is not configured for OAuth". Bind `const url = def!.url;`.
  3. Open a `BorderedLoader` via `ctx.ui.custom` (see tui.md Pattern 2). Its `onAbort` calls `abortController.abort()`.
  4. Call `manager.getClient(name)?.authenticate({ signal: abortController.signal, onAuthorizationUrl: async (u) => { await open(u.toString()); ctx.ui.notify("Opening browser… if it didn't open, visit: " + u.toString(), "info"); } })` — the single entry point (sources url/cfg from the def internally).
  5. On success → close loader; reconnect (`manager.getClient(name)?.close()` then `.connect()`); notify tool count. On thrown error/abort → close loader; notify.
  6. On `"failed"`/abort → close loader; notify.
- `/mcp-logout <server>`: `deleteAuthEntry(name)`; `manager.getClient(name)?.close()`; notify "Logged out of X".

Register both in `index.ts` via `pi.registerCommand`, passing `getServerDef`/`getManager` closures over the module-level `manager` and `loadServerDefs()`.

**Steps:**
- [ ] Create `commands-auth.ts`
- [ ] Wire into `index.ts` (expose `manager` via a getter; pass `getServerDef` reading `loadServerDefs()`)
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Manual test: configure the Atlassian server (`auth: "oauth"`), run `/mcp-auth atlassian`, complete the browser flow, verify it connects and Atlassian tools appear
- [ ] Manual test: `/mcp-logout atlassian` clears the token (next connect → needs-auth)
- [ ] Manual test: Esc during `/mcp-auth` cancels cleanly (loader closes, no hang)
- [ ] Commit: `feat(mcp): /mcp-auth and /mcp-logout commands`

**Acceptance criteria:**
- [ ] `/mcp-auth <server>` runs the OAuth flow and connects on success
- [ ] Non-oauth servers get "not configured for OAuth"
- [ ] `/mcp-logout <server>` deletes the token
- [ ] Esc cancels the flow (loader + AbortSignal)
- [ ] `npx tsc --noEmit` clean; manual auth against Atlassian works

---

### Task 7: Auto-auth on needs-auth, type-check, docs, plan index

**Context:**
Final integration. When a tool call hits a `needs-auth` server, either auto-auth (if enabled) or tell the user to run `/mcp-auth`. Verify the monorepo and document.

**Files:**
- Modify: `packages/mcp/src/index.ts`, `packages/mcp/src/types.ts`
- Modify: `README.md`, `docs/plans/README.md`

**What to implement:**
1. Add `autoAuth: boolean` (default `false`) to `McpConfig` + `DEFAULT_MCP_CONFIG`.
2. In the proxy `call` action and direct-tool executor, when the owning server is `needs-auth`: if `autoAuth`, call `manager.getClient(name)?.authenticate({ onAuthorizationUrl })` inline (with a loader) then retry the call; else return content telling the user to run `/mcp-auth <server>` (with `isError: false` — it's guidance, not a crash). Use the same single entry point (`ServerClient.authenticate`), never `auth-flow.authenticate` directly.
3. Update `README.md`: `/mcp-auth`, `/mcp-logout`, the `auth` config field (`"oauth"` / `{ token }` / `McpOAuthConfig`), `autoAuth`, and the config-stub re-auth behavior (ADR 0001).

**Steps:**
- [ ] Add `autoAuth` to config + defaults
- [ ] Wire needs-auth handling into the call path
- [ ] Run `pnpm exec tsc --noEmit` in all 10 `packages/*` dirs plus `meta` (11 runs) — fix any new errors
- [ ] Run `pnpm exec vitest run` at repo root — all pass
- [ ] Update `README.md` + `docs/plans/README.md`
- [ ] Commit: `feat(mcp): auto-auth handling + document oauth`

**Acceptance criteria:**
- [ ] `needs-auth` on a call gives a clear "run /mcp-auth" message (or auto-auths if enabled)
- [ ] All 11 `tsc --noEmit` runs pass
- [ ] All tests pass
- [ ] README documents the OAuth surface
