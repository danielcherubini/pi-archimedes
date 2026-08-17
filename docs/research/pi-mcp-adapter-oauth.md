# OAuth + Authentication Subsystem Architecture Report
## Pi MCP Adapter

**Report Date:** 2025  
**Scope:** Complete OAuth 2.1 + PKCE implementation for MCP servers  
**Files Analyzed:** 
- `mcp-auth.ts` (1089 lines)
- `mcp-auth-flow.ts` (993 lines)
- `mcp-oauth-provider.ts` (616 lines)
- `mcp-callback-server.ts` (510 lines)
- `oauth.ts` (38 lines)
- `oauth-handler.ts` (31 lines)
- `mcp-keyring-helper.cjs` (97 lines)
- `OAUTH.md` (documentation)

---

## Executive Summary

The pi-mcp-adapter OAuth subsystem is a **production-grade OAuth 2.1 + PKCE implementation** built on the official MCP SDK's authentication primitives. It handles:
- **Two grant types:** authorization_code (interactive, browser-driven) and client_credentials (non-interactive, M2M)
- **Dynamic Client Registration fallback** when no pre-registered clientId is supplied
- **Secure token storage** via OS credential stores (macOS Keychain, Windows Credential Manager, Linux libsecret)
- **Automatic token refresh** with issuer binding validation
- **Local HTTP callback server** with manual fallback for headless environments

**Critical ports:** The system is **complex but well-isolated** into 5 core modules + 1 helper utility, with clear separation of concerns. Porting requires understanding the MCP SDK's `OAuthClientProvider` interface and the interaction between the callback server and token exchange flow.

---

## 1. OAuth Flow End-to-End

### User Perspective: `/mcp-auth <server>`

**Entry point:** `mcp-auth-flow.ts:authenticate()` (line 766–800)

```typescript
export async function authenticate(
  serverName: string,
  serverUrl: string,
  definition?: ServerEntry,
  options: AuthenticateOptions = {},
): Promise<AuthStatus>
```

### Flow Sequence

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. USER RUNS /mcp-auth my-server                                    │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. authenticate() → startAuth() [line 488–624]                      │
│                                                                       │
│    A. Check server definition for oauth config                      │
│    B. Determine grant type (client_credentials vs authorization_code)│
│    C. For authorization_code:                                       │
│       - Generate cryptographic state param [line 467]               │
│       - Ensure callback server [line 535]                           │
│       - Create McpOAuthProvider instance                            │
│       - Call MCP SDK auth() [line 574]                              │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. DISCOVERY [line 501–510]                                         │
│                                                                       │
│    probeAuthDiscovery(serverUrl) →                                  │
│    • POST /initialize to MCP server                                 │
│    • Extract resourceMetadataUrl + scope from 401/WWW-Authenticate  │
│    • Merge with config scope if present                             │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. runSdkAuth() with McpOAuthProvider [line 574]                    │
│                                                                       │
│    SDK calls provider.clientInformation() →                         │
│    • Check stored tokens (success path) [line 298]                  │
│    • Or trigger dynamic registration [line 319]                     │
│                                                                       │
│    If tokens present → "AUTHORIZED" (return early)                  │
│    If no tokens → SDK continues to browser auth                     │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. SDK Builds Authorization URL + redirectToAuthorization() [559]   │
│                                                                       │
│    • Constructs URL with code_challenge (PKCE S256)                 │
│    • Calls provider.redirectToAuthorization(url)                    │
│    • Saves authorizationUrl in in-flight pendingAuth struct         │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 6. OPEN BROWSER [line 724–733]                                      │
│                                                                       │
│    • options.onAuthorizationUrl() callback with URL                 │
│    • OR console.log() if headless                                   │
│    • OR open() library attempts to launch default browser           │
│                                                                       │
│    For SSH/headless: URL displayed, user copies to local browser    │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 7. CALLBACK RECEIVED [line 735–750]                                 │
│                                                                       │
│    A. Browser redirect → http://localhost:PORT/callback?code=...    │
│    B. Callback server accepts request [mcp-callback-server.ts:120]  │
│    C. Validates state parameter (CSRF)                              │
│    D. Extracts code + iss (RFC 9207 parameter, if present)          │
│    E. Resolves pending promise with { code, iss? }                  │
│       OR if no listener (manual mode): serve htmlManualSuccess()    │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 8. completeAuth() → Token Exchange [line 626–689]                   │
│                                                                       │
│    A. Extract code from callback or manual input                    │
│    B. Validate RFC 9207 issuer binding if present                   │
│    C. Call runSdkAuth(provider, { authorizationCode: code })        │
│    D. SDK exchanges code for tokens via provider.addClientAuth()    │
│    E. SDK calls provider.saveTokens()                               │
│       → updateTokens() → OS credential store [mcp-auth.ts:856]      │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 9. CLEANUP + RETURN [line 689]                                      │
│                                                                       │
│    • Clear pending auth state                                       │
│    • Release callback server reservation                            │
│    • Return "authenticated"                                         │
│    • User can now use server without auth required                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Functions and Signatures

| Function | File:Line | Purpose | Returns |
|----------|-----------|---------|---------|
| `authenticate()` | auth-flow:766 | Complete OAuth flow (main entry) | `Promise<AuthStatus>` |
| `startAuth()` | auth-flow:488 | Initialize flow, return auth URL | `Promise<{ authorizationUrl }>` |
| `completeAuth()` | auth-flow:626 | Exchange code for tokens | `Promise<AuthStatus>` |
| `getValidToken()` | auth-flow:802 | Get fresh token (refresh if expired) | `Promise<StoredTokens \| null>` |
| `extractOAuthConfig()` | auth-flow:177 | Parse oauth config from ServerEntry | `McpOAuthConfig` |
| `probeAuthDiscovery()` | auth-flow:195 | RFC 9728 metadata discovery | `Promise<AuthDiscovery>` |
| `waitForAuthorizationResponse()` | auth-flow:671 | Wait for callback or manual input | `Promise<AuthorizationResponse>` |

### State Parameter CSRF Protection

```typescript
function generateState(): string {  // line 467
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
```

- **Cryptographically secure**: 32 bytes of random data
- **Stored in:** `pendingAuthStates` Map (memory) during flow; callback validates match
- **Not persisted:** state is cleared after callback or 5-minute timeout

---

## 2. Callback Server

### Initialization and Lazy Binding

**File:** `mcp-callback-server.ts`  
**Key Constants:**
- `DEFAULT_OAUTH_CALLBACK_PORT = 19876` (line 40)
- `DEFAULT_OAUTH_CALLBACK_PATH = "/callback"` (line 41)
- `CALLBACK_TIMEOUT_MS = 5 * 60 * 1000` (line 82)

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│ LAZY INITIALIZATION                                     │
│ Called from startAuth() → ensureCallbackServer() [auth-flow:535] │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ ensureCallbackServer(options) [callback-server:351]     │
│                                                          │
│ • If already running: verify port/host/path match       │
│ • If needs rebind: stop old server, bind new one        │
│ • If strictPort (pre-registered client): require exact  │
│   port, else OS-assign a free port                      │
│ • Call handleRequest() on all incoming HTTP             │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ handleRequest(req, res) [callback-server:120]           │
│                                                          │
│ 1. Parse URL: req.url = "/callback?code=...&state=..." │
│ 2. Extract: code, state, iss (RFC 9207), error          │
│ 3. Validate state in pendingAuths or reservedAuthStates│
│ 4. If error param: reject promise with error message   │
│ 5. If no pending listener:                              │
│    → Serve htmlManualSuccess() (user manually pastes)   │
│ 6. If pending listener:                                 │
│    → Resolve with { code, iss? }                        │
│    → Serve htmlSuccess() + auto-close page              │
└─────────────────────────────────────────────────────────┘
```

### Handler Function (line 120–193)

```typescript
function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || "/", `http://${req.headers.host}`)
  
  // Verify correct path
  if (url.pathname !== getOAuthCallbackPath()) {
    res.writeHead(404, { "Content-Type": "text/plain" })
    res.end("Not found")
    return
  }
  
  // Extract params
  const code = url.searchParams.get("code")
  const iss = url.searchParams.get("iss")  // RFC 9207
  const state = url.searchParams.get("state")
  const error = url.searchParams.get("error")
  
  // CSRF check: state required
  if (!state) {
    res.writeHead(400, { "Content-Type": "text/html" })
    res.end(htmlError("Missing required state parameter"))
    return
  }
  
  const pending = pendingAuths.get(state)
  const isReserved = reservedAuthStates.has(state)
  
  // Error handling
  if (error) {
    if (!pending && !isReserved) {
      res.writeHead(400)
      res.end(htmlError("Invalid or expired state parameter"))
      return
    }
    const errorMsg = url.searchParams.get("error_description") || error
    res.writeHead(200, { "Content-Type": "text/html" })
    res.end(htmlError(errorMsg))
    if (pending) {
      clearTimeout(pending.timeout)
      pendingAuths.delete(state)
      setTimeout(() => pending.reject(new Error(errorMsg)), 0)
    }
    return
  }
  
  // Validate state (CSRF)
  if (!pending && !isReserved) {
    res.writeHead(400)
    res.end(htmlError("Invalid or expired state parameter"))
    return
  }
  
  // Require code
  if (!code) {
    res.writeHead(400)
    res.end(htmlError("No authorization code provided"))
    return
  }
  
  // Manual mode (no pending listener, user will paste)
  if (!pending) {
    res.writeHead(200, { "Content-Type": "text/html" })
    res.end(htmlManualSuccess())
    return
  }
  
  // Resolve promise and send success page
  clearTimeout(pending.timeout)
  pendingAuths.delete(state)
  pending.resolve({ code, ...(iss !== null ? { iss } : {}) })
  
  res.writeHead(200, { "Content-Type": "text/html" })
  res.end(htmlSuccess())
}
```

### Port and Host Configuration

```typescript
// Config priority: command-line env > config.redirectUri > defaults
const configuredOAuthCallbackPort = process.env.MCP_OAUTH_CALLBACK_PORT
  ? parseInt(process.env.MCP_OAUTH_CALLBACK_PORT, 10)
  : DEFAULT_OAUTH_CALLBACK_PORT  // 19876

// For dynamic (non-pre-registered) clients:
// - Host: "localhost" (DEFAULT_OAUTH_CALLBACK_HOST)
// - Port: 0 (OS-assigns free port)
// - Path: "/callback" (DEFAULT_OAUTH_CALLBACK_PATH)

// For pre-registered clients with oauth.redirectUri:
// - Exact host, port, path extracted from URI
// - Port must match exactly or flow fails
```

### State Management

```typescript
let server: Server | undefined                      // Singleton HTTP server
let bindingPromise: Promise<void> | undefined       // Mutual exclusion lock
let stoppingPromise: Promise<void> | undefined      // Stop signal
let callbackGeneration = 0                           // Invalidation counter
const pendingAuths = new Map<string, PendingAuth>() // Waiting callbacks
const reservedAuthStates = new Set<string>()        // Pre-reserved states

interface PendingAuth {
  resolve: (result: OAuthCallbackResult) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>            // 5-minute timeout
}
```

### Redirect Handling

```typescript
export function waitForCallback(oauthState: string): Promise<OAuthCallbackResult> {
  reservedAuthStates.delete(oauthState)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pendingAuths.has(oauthState)) {
        pendingAuths.delete(oauthState)
        reject(new Error("OAuth callback timeout - authorization took too long"))
      }
    }, CALLBACK_TIMEOUT_MS)  // 5 minutes
    
    pendingAuths.set(oauthState, { resolve, reject, timeout })
  })
}
```

**Key:** The callback code is **never stored**; it is passed directly through the resolved promise from callback server → `completeAuth()` → SDK token exchange.

### HTML Response Pages

The callback server serves self-contained HTML (no external assets, no fonts) with light/dark theme support:

- **Success (auto-close):** "You can close this window" + 2-second auto-close
- **Manual mode:** "Copy the full callback URL from your browser address bar"
- **Error:** Shows error message in red badge

---

## 3. Token Storage

### Storage Architecture

```
┌────────────────────────────────────────────────────┐
│ AUTHENTICATION ENTRY FORMAT (mcp-auth.ts:46–81)    │
└────────────────────────────────────────────────────┘

export interface AuthEntry {
  tokens?: StoredTokens              // OAuth tokens
  clientInfo?: StoredClientInfo      // Dynamic registration metadata
  codeVerifier?: string              // PKCE verifier (in-flight)
  oauthState?: string                // State param (in-flight)
  serverUrl?: string                 // URL binding for validation
}

export interface StoredTokens {
  accessToken: string                // Required
  refreshToken?: string              // Optional
  expiresAt?: number                 // Unix timestamp in seconds
  scope?: string
  issuer?: string                    // SEP-2352 issuer binding
}

export interface StoredClientInfo {
  clientId: string                   // Required
  clientSecret?: string              // Optional (dynamic clients only)
  clientIdIssuedAt?: number
  clientSecretExpiresAt?: number
  redirectUris?: string[]            // URLs returned by auth server
  issuer?: string                    // Issuer binding
  configPreRegistered?: boolean      // Marker for config-supplied clients
}
```

### Persistent Store: OS Credential Stores

**File:** `mcp-auth.ts:130–242` (keyring integration)

#### Platform Support

| Platform | Store | Implementation |
|----------|-------|-----------------|
| **macOS** | Keychain | `@napi-rs/keyring` + native binding |
| **Windows** | Credential Manager | `@napi-rs/keyring` + `keyring-win32-x64-msvc.node` |
| **Linux** | libsecret / Secret Service | `@napi-rs/keyring` + `keyring-linux-x64-gnu.node` |

#### Key APIs

```typescript
interface KeyringEntry {
  getPassword(): string | null
  setPassword(password: string): void
  deleteCredential(): boolean
}

// Entry account is deterministic from server name
function getAuthEntryAccount(serverName: string): string {
  return `sha256-${createHash("sha256")
    .update(serverName, "utf8")
    .digest("hex")}`
}
// Example: "sha256-7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069"

// Service name (constant across all servers)
const AUTH_SECRET_SERVICE = "pi-mcp-adapter.oauth"
```

#### Size Constraints and Chunking

Windows Credential Manager caps each value at **1280 characters** (2560 UTF-16 bytes). For larger entries, credentials are split:

```typescript
const AUTH_SECRET_CHUNK_SIZE = 1000
const AUTH_SECRET_VALUE_LIMIT = 1280

interface AuthEntryChunkManifest {
  [AUTH_CHUNK_MANIFEST_KEY]: 1
  chunkCount: number
  chunkDigest: string  // First 16 hex chars of SHA256
}

// Multi-chunk storage:
// 1. Split payload into 1000-char chunks
// 2. Write each chunk to account "sha256-<hash>.chunk.<digest>.0", ".1", etc.
// 3. Write manifest to main account with chunkCount + chunkDigest
// On read, manifest directs chunked read; chunks reassembled and parsed
```

#### Write Flow

```typescript
export function saveAuthEntry(
  serverName: string,
  entry: AuthEntry,
  serverUrl?: string,
  options?: AuthStorageOptions
): void {
  // Line 849–863
  if (serverUrl) entry.serverUrl = serverUrl
  writeSecureAuthEntry(serverName, entry)
  removeLegacyAuthEntry(serverName, options)  // Clean up old plaintext
}

function writeSecureAuthEntry(serverName: string, entry: AuthEntry): void {
  // Line 724–736
  try {
    writeSecureAuthEntryToStore(getAuthSecretStore(), serverName, entry)
  } catch (error) {
    // Linux keyring recovery: if keyrevoked, retry with helper subprocess
    if (!shouldAttemptLinuxKeyringRecovery(error)) throw error
    writeSecureAuthEntryToStore(linuxKeyringRecoveryAuthSecretStore, ...)
  }
}

function writeSecureAuthEntryToStore(
  store: AuthSecretStore,
  serverName: string,
  entry: AuthEntry
): void {
  // Lines 680–721
  const account = getAuthEntryAccount(serverName)
  const payload = JSON.stringify(entry)
  const previousManifest = readExistingChunkManifest(store, serverName, account)
  const manifest = payload.length > AUTH_SECRET_CHUNK_SIZE 
    ? createChunkManifest(payload)
    : undefined
  
  try {
    if (manifest) {
      // Write chunks
      for (let index = 0; index < manifest.chunkCount; index++) {
        const chunk = payload.slice(
          index * AUTH_SECRET_CHUNK_SIZE,
          (index + 1) * AUTH_SECRET_CHUNK_SIZE
        )
        store.write(
          getAuthEntryChunkAccount(account, manifest, index),
          chunk
        )
      }
      // Write manifest
      store.write(account, JSON.stringify(manifest))
    } else {
      // Single-write (compact, multiline forbidden for gnome-keyring plaintext)
      store.write(account, payload)
    }
    // Clean up old chunks if digest changed
    if (previousManifest?.chunkDigest !== manifest?.chunkDigest) {
      tryRemoveChunkPayloads(store, account, previousManifest)
    }
  } catch (error) {
    tryRemoveChunkPayloads(store, account, manifest)
    throw new OAuthCredentialStoreError(...)
  }
  
  // Update in-memory cache
  publishAuthEntryToCache(serverName, payload)
}
```

#### Read Flow

```typescript
export function getAuthEntry(
  serverName: string,
  options?: AuthStorageOptions
): AuthEntry | undefined {
  return readAuthEntry(serverName, options)
}

function readAuthEntry(
  serverName: string,
  options?: AuthStorageOptions,
  behavior: { migrateLegacy?: boolean } = {}
): AuthEntry | undefined {
  // Lines 741–768
  const cacheable = behavior.migrateLegacy !== false && isAuthEntryCacheEnabled()
  
  if (cacheable && authEntryCache.has(serverName)) {
    return cloneAuthEntry(authEntryCache.get(serverName))
  }
  
  let entry: AuthEntry | undefined
  try {
    entry = readAuthEntryFromStore(getAuthSecretStore(), serverName, options, behavior)
  } catch (error) {
    // Linux recovery retry
    if (!shouldAttemptLinuxKeyringRecovery(error)) throw error
    entry = readAuthEntryFromStore(linuxKeyringRecoveryAuthSecretStore, ...)
  }
  
  if (cacheable) authEntryCache.set(serverName, cloneAuthEntry(entry))
  return entry
}

function readAuthEntryFromStore(
  store: AuthSecretStore,
  serverName: string,
  options?: AuthStorageOptions,
  behavior: { migrateLegacy?: boolean } = {}
): AuthEntry | undefined {
  // Lines 709–738
  const account = getAuthEntryAccount(serverName)
  let payload: string | undefined
  
  try {
    payload = store.read(account)
  } catch (error) {
    throw new OAuthCredentialStoreError(...)
  }
  
  // Persistent store hit
  if (payload !== undefined) {
    const manifest = readChunkManifestFromPayload(serverName, payload, "...")
    const entry = manifest
      ? readChunkedAuthEntry(store, serverName, account, manifest)
      : parseAuthEntryPayload(serverName, payload, "OS secure credential store")
    removeLegacyAuthEntry(serverName, options)  // One-time cleanup
    return entry
  }
  
  // Fallback to legacy plaintext (one-way migration)
  const legacyEntry = readLegacyAuthEntry(serverName, options)
  if (!legacyEntry) return undefined
  
  if (behavior.migrateLegacy === false) return legacyEntry
  
  writeSecureAuthEntryToStore(store, serverName, legacyEntry)
  removeLegacyAuthEntry(serverName, options)
  return legacyEntry
}
```

### Cache Layer

```typescript
const authEntryCache = new Map<string, AuthEntry | undefined>()

function isAuthEntryCacheEnabled(): boolean {
  return process.env[AUTH_CACHE_DISABLED_ENV] !== '1'
}

// Cache behavior:
// - Filled on first successful or failed read (covers both present & absent)
// - Invalidated by: updateTokens(), updateClientInfo(), clearCodeVerifier(),
//   updateOAuthState(), clearOAuthState(), removeAuthEntry()
// - Bypassed by: inspectAuthForUrl() (status-panel use; doesn't migrate legacy)
// - Cleared on: runtime exit
// - Disable via: PI_MCP_ADAPTER_DISABLE_AUTH_CACHE=1 (for testing)

// Rationale: Avoids credential store reads on every tool call
// (SDK reads tokens before each request). On Linux, this reduces Secret
// Service daemon load. Trade-off: external mutations not observed
// immediately; picked up after first auth failure in needs-auth episode.
```

### Legacy Plaintext Migration

```typescript
function getAuthEntryFilePath(
  serverName: string,
  options?: AuthStorageOptions
): string {
  // Line 394–396
  return join(getServerDir(serverName, options), "tokens.json")
  // → ~/.pi/agent/mcp-oauth/sha256-<hash>/tokens.json (or MCP_OAUTH_DIR override)
}

function readLegacyAuthEntry(
  serverName: string,
  options?: AuthStorageOptions
): AuthEntry | undefined {
  // Lines 699–703
  const filePath = getAuthEntryFilePath(serverName, options)
  if (!existsSync(filePath)) return undefined
  const data = readFileSync(filePath, 'utf-8')
  return parseAuthEntryPayload(serverName, data, filePath)
}

function removeLegacyAuthEntry(
  serverName: string,
  options?: AuthStorageOptions
): void {
  // Lines 705–720
  const filePath = getAuthEntryFilePath(serverName, options)
  if (!existsSync(filePath)) return
  
  rmSync(filePath, { force: true })
  rmSync(getServerDir(serverName, options), { recursive: true })
}

// Migration flow:
// 1. Read from OS credential store → success, use it
// 2. Read from OS credential store → miss, try legacy plaintext file
// 3. Found legacy file → auto-import to OS store + delete plaintext
// 4. Next read hits OS store directly (plaintext gone)
```

### Linux Keyring Recovery Helper

**File:** `mcp-keyring-helper.cjs` (97 lines)

When Linux Keyring is revoked (inherited revoked session from parent process), the adapter spawns a fresh `keyctl session`:

```bash
keyctl session - node /path/to/mcp-keyring-helper.cjs
```

The helper runs in the new session with a fresh (non-revoked) keyring and can store/retrieve credentials:

```javascript
// Input (stdin): JSON request
{
  "operation": "read" | "write" | "remove",
  "service": "pi-mcp-adapter.oauth",
  "account": "sha256-...",
  "payload": "..." // Only for write
}

// Output (stdout): JSON response
{ "ok": true, "found": true, "value": "..." }  // read success
{ "ok": true, "found": false }                  // read miss
{ "ok": true }                                  // write/remove success
{ "ok": false, "error": "message" }             // error
```

**Environment Variables:**
- `PI_MCP_ADAPTER_DISABLE_KEYRING_RECOVERY=1` — disable recovery
- `PI_MCP_ADAPTER_KEYRING_RECOVERY_KEYCTL` — custom keyctl path
- `PI_MCP_ADAPTER_KEYRING_RECOVERY_NODE` — custom node path
- `PI_MCP_ADAPTER_KEYRING_RECOVERY_HELPER` — custom helper script path

---

## 4. OAuthClientProvider Interface Implementation

### Interface Contract

**File:** `mcp-oauth-provider.ts`  
**Class:** `McpOAuthProvider` (implements `OAuthClientProvider` from MCP SDK)

```typescript
export class McpOAuthProvider implements OAuthClientProvider {
  constructor(
    private serverName: string,
    private serverUrl: string,
    private config: McpOAuthConfig,
    private callbacks: McpOAuthCallbacks,
    private storageOptions: AuthStorageOptions = {},
    private runtimeSignal?: AbortSignal,
    initialState?: string,  // For in-flight flows
  )
}
```

### Required Methods (MCP SDK Contract)

#### 1. `redirectUrl: string | undefined` (getter)

```typescript
get redirectUrl(): string | undefined {
  return this.redirectUrlSnapshot
}

// Set in constructor:
this.redirectUrlSnapshot = config.grantType === "client_credentials"
  ? undefined
  : config.redirectUri ?? `http://localhost:${getOAuthCallbackPort()}${getOAuthCallbackPath()}`
```

**Purpose:** Advertises callback URI to authorization server during registration.  
**Behavior:** 
- For `client_credentials`: undefined (no redirect needed)
- For `authorization_code` + pre-registered: exact config URI
- For `authorization_code` + dynamic: default localhost:19876/callback (or OS-assigned port)

#### 2. `clientMetadata: OAuthClientMetadata` (getter)

```typescript
get clientMetadata(): OAuthClientMetadata {
  if (this.usesClientCredentials) {
    return {
      client_name: this.config.clientName ?? defaultClientName(),
      redirect_uris: [],
      grant_types: ["client_credentials"],
      token_endpoint_auth_method: this.config.clientSecret ? "client_secret_post" : "none",
    }
  }
  
  // authorization_code flow
  const redirectUrl = this.redirectUrl
  if (!redirectUrl) {
    throw new Error("redirectUrl is required for authorization_code flow")
  }
  
  return {
    redirect_uris: [redirectUrl],
    client_name: this.config.clientName ?? defaultClientName(),
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: this.config.clientSecret ? "client_secret_post" : "none",
    ...(this.config.scope !== undefined ? { scope: this.config.scope } : {}),
  }
}
```

#### 3. `async clientInformation(): Promise<OAuthClientInformationMixed | undefined>`

```typescript
async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
  // Lines 253–307
  const issuer = this.discoveredIssuer  // From discovery state
  const stored = await getAuthForUrl(this.serverName, this.serverUrl, this.storageOptions)
  
  this.assertStoredIssuerBindings(stored, issuer)
  
  // Pre-registered client (from config)
  if (this.config.clientId) {
    const storedClient = stored?.clientInfo?.clientId === this.config.clientId
      ? stored.clientInfo
      : undefined
    
    // Bind issuer to config client
    if (issuer && (storedClient?.issuer !== issuer || storedClient.configPreRegistered !== true)) {
      updateClientInfo(
        this.serverName,
        { clientId: this.config.clientId, issuer, configPreRegistered: true },
        this.serverUrl,
        this.storageOptions,
      )
    }
    
    // Resolve secret (may be a command: "!command ...")
    const clientSecret = this.config.clientSecret?.startsWith("!")
      ? resolveCommandSecret(
          this.config.clientSecret,
          `MCP server "${this.serverName}" OAuth clientSecret`,
        )
      : this.config.clientSecret
    
    return {
      client_id: this.config.clientId,
      client_secret: clientSecret,
      ...(issuer !== undefined ? { issuer } : {}),
    }
  }
  
  // Dynamically registered client (from storage)
  const clientInfo = this.flowClientInfo ?? stored?.clientInfo
  if (clientInfo) {
    // Reject config stubs (SEP-2352 issuer stubs without registration metadata)
    const isConfigStub = clientInfo.configPreRegistered === true
      || (clientInfo.clientSecret === undefined
        && clientInfo.clientIdIssuedAt === undefined
        && clientInfo.clientSecretExpiresAt === undefined
        && clientInfo.redirectUris === undefined)
    
    if (isConfigStub && !this.config.clientId) {
      return undefined  // Not usable without config secret
    }
    
    // Check expiry
    if (clientInfo.clientSecretExpiresAt && clientInfo.clientSecretExpiresAt < Date.now() / 1000) {
      return undefined
    }
    
    // Check issuer match
    if (issuer && clientInfo.issuer && !issuersMatch(clientInfo.issuer, issuer)) {
      return undefined
    }
    
    // Bind issuer if missing
    if (issuer && clientInfo.issuer === undefined) {
      clientInfo.issuer = issuer
      this.flowClientInfo = clientInfo
      updateClientInfo(this.serverName, clientInfo, this.serverUrl, this.storageOptions)
    }
    
    // Return full registration metadata
    return {
      client_id: clientInfo.clientId,
      client_secret: clientInfo.clientSecret,
      client_id_issued_at: clientInfo.clientIdIssuedAt,
      client_secret_expires_at: clientInfo.clientSecretExpiresAt,
      redirect_uris: clientInfo.redirectUris,
      ...(clientInfo.issuer !== undefined ? { issuer: clientInfo.issuer } : {}),
    }
  }
  
  return undefined  // Will trigger dynamic registration
}
```

**Behavior:**
- **Config client:** Returns config ID + secret (secret resolved if command)
- **Dynamic client (stored):** Returns registration metadata if valid/not expired
- **None found:** Returns undefined → SDK triggers Dynamic Client Registration RFC 7591

#### 4. `async saveClientInformation(info: OAuthClientInformationMixed): Promise<void>`

```typescript
async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
  // Lines 309–347
  this.throwIfInactive()
  const issuer = this.discoveredIssuer ?? (info as IssuerBoundClientInformation).issuer
  
  // Config client: save issuer binding stub
  if (this.config.clientId && info.client_id === this.config.clientId) {
    updateClientInfo(
      this.serverName,
      {
        clientId: info.client_id,
        issuer: issuer,
        configPreRegistered: true,  // Marker for config client
      },
      this.serverUrl,
      this.storageOptions,
    )
    return
  }
  
  // Dynamic client: save full registration metadata
  const redirectUris = ("redirect_uris" in info ? info.redirect_uris : undefined)
    ?? (this.redirectUrl ? [this.redirectUrl] : undefined)
  
  const clientInfo: StoredClientInfo = {
    clientId: info.client_id,
    clientSecret: info.client_secret,
    clientIdIssuedAt: info.client_id_issued_at,
    clientSecretExpiresAt: info.client_secret_expires_at,
    redirectUris: redirectUris,
    issuer: issuer,
  }
  
  this.flowClientInfo = clientInfo  // Keep in flight
  updateClientInfo(this.serverName, clientInfo, this.serverUrl, this.storageOptions)
}
```

#### 5. `async tokens(): Promise<OAuthTokens | undefined>`

```typescript
async tokens(): Promise<OAuthTokens | undefined> {
  // Lines 349–371
  const entry = await getAuthForUrl(this.serverName, this.serverUrl, this.storageOptions)
  if (!entry?.tokens) return undefined
  
  const issuer = this.discoveredIssuer
  this.assertStoredIssuerBindings(entry, issuer)
  
  // Bind issuer if missing
  if (issuer && entry.tokens.issuer === undefined) {
    entry.tokens.issuer = issuer
    updateTokens(this.serverName, entry.tokens, this.serverUrl, this.storageOptions)
  }
  
  return {
    access_token: entry.tokens.accessToken,
    token_type: "Bearer",
    refresh_token: entry.tokens.refreshToken,
    expires_in: entry.tokens.expiresAt
      ? Math.max(0, Math.floor(entry.tokens.expiresAt - Date.now() / 1000))
      : undefined,
    scope: entry.tokens.scope,
    ...(entry.tokens.issuer !== undefined ? { issuer: entry.tokens.issuer } : {}),
  }
}
```

#### 6. `async saveTokens(tokens: OAuthTokens): Promise<void>`

```typescript
async saveTokens(tokens: OAuthTokens): Promise<void> {
  // Lines 373–396
  const issuer = this.discoveredIssuer ?? (tokens as IssuerBoundTokens).issuer
  
  const storedTokens: StoredTokens = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expires_in !== undefined 
      ? Date.now() / 1000 + tokens.expires_in
      : undefined,
    scope: tokens.scope,
    issuer: issuer,
  }
  
  this.throwIfInactive()
  updateTokens(this.serverName, storedTokens, this.serverUrl, this.storageOptions)
  
  // Clear discovery after token issuance (so later 401 rereads PRM)
  this.flowDiscoveryState = undefined
}
```

#### 7. `async redirectToAuthorization(authorizationUrl: URL): Promise<void>`

```typescript
async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
  // Lines 398–420
  if (this.usesClientCredentials) {
    throw new Error("redirectToAuthorization is not used for client_credentials flow")
  }
  
  this.throwIfInactive()
  
  // No flow-local state = post-refresh re-auth (cannot proceed in-process)
  if (!this.flowState) {
    throw new UnauthorizedError(
      `Re-authentication required for MCP server: ${this.serverName}`,
    )
  }
  
  // Append config authorizationParams (e.g., Google's { access_type: "offline" })
  // and invoke callback to open browser
  await this.callbacks.onRedirect(
    addAuthorizationParams(authorizationUrl, this.config.authorizationParams)
  )
}
```

**Key:** Throws `UnauthorizedError` when SDK falls back to auth after a failed refresh and the adapter has no in-flight state to handle it (user interaction required but unavailable).

#### 8. Additional Methods

| Method | Purpose | Line |
|--------|---------|------|
| `async saveCodeVerifier(cv: string)` | Store PKCE verifier | 422 |
| `async codeVerifier(): Promise<string>` | Retrieve PKCE verifier | 431 |
| `async saveDiscoveryState(state)` | Cache discovery metadata | 441 |
| `async discoveryState()` | Retrieve discovery for issuer validation | 446 |
| `async saveState(state: string)` | Store OAuth state param (CSRF) | 451 |
| `async state(): Promise<string>` | Retrieve state for validation | 461 |
| `async invalidateCredentials(type)` | Clear tokens/client/all | 473 |
| `async addClientAuthentication(...)` | Add token endpoint auth (PKCE scope + client auth) | 500 |
| `prepareTokenRequest(scope?)` | Build client_credentials token request | 544 |

---

## 5. Token Refresh

### Automatic Refresh via `getValidToken()`

**File:** `mcp-auth-flow.ts:802–860`

```typescript
export async function getValidToken(
  serverName: string,
  serverUrl: string,
  options: AuthenticateOptions = {},
): Promise<StoredTokens | null> {
  const runtime = getRuntime(options)
  const authStorageOptions = options.authStorageOptions ?? {}
  const signal = combineAbortSignals(runtime.signal, options.signal)
  throwIfAborted(signal)
  
  // Read current tokens
  const entry = await getAuthForUrl(serverName, serverUrl, authStorageOptions)
  throwIfAborted(signal)
  
  if (!entry?.tokens) {
    return null
  }
  
  // Check expiry
  const expired = await isTokenExpired(serverName, authStorageOptions)
  
  if (expired === false) {
    return entry.tokens  // Still valid
  }
  
  // Expired and refresh token available
  if (expired === true && entry.tokens.refreshToken) {
    console.log(`MCP Auth: Token expired for ${serverName}, attempting refresh`)
    
    try {
      const authProvider = new McpOAuthProvider(
        serverName,
        serverUrl,
        {},  // Config empty (use stored client info)
        { onRedirect: async () => {} },
        authStorageOptions,
        runtime.signal
      )
      
      try {
        const clientInfo = await authProvider.clientInformation()
        throwIfAborted(signal)
        
        if (!clientInfo) {
          console.log(`MCP Auth: No client info for refresh for ${serverName}`)
          return null
        }
        
        // Run SDK auth with stored tokens + refresh token
        const discovery = await probeAuthDiscovery(serverUrl, undefined, signal)
        throwIfAborted(signal)
        
        const result = await abortable(runSdkAuth(authProvider, {
          serverUrl,
          ...discovery,
          ...(options.skipIssuerMetadataValidation === true ? { skipIssuerMetadataValidation: true } : {}),
        }), signal)
        throwIfAborted(signal)
        
        if (result !== "AUTHORIZED") {
          return null
        }
        
        // Read refreshed tokens
        const refreshed = await getAuthForUrl(serverName, serverUrl, authStorageOptions)
        throwIfAborted(signal)
        
        return refreshed?.tokens ?? null
      } finally {
        authProvider.deactivate()
      }
    } catch (error) {
      if (isAbortError(error, signal) || error instanceof OAuthCredentialStoreError) throw error
      console.error(`MCP Auth: Token refresh failed for ${serverName}`, { error })
      return null
    }
  }
  
  // No expiration info or no refresh token, assume valid
  return entry.tokens
}
```

### How Refresh Works

1. **Expiry Check:** `isTokenExpired()` compares `expiresAt` to current time (line 824)
   ```typescript
   export function isTokenExpired(serverName: string, options?: AuthStorageOptions): boolean | null {
     const entry = getAuthEntry(serverName, options)
     if (!entry?.tokens) return null
     if (!entry.tokens.expiresAt) return false
     return entry.tokens.expiresAt < Date.now() / 1000
   }
   ```

2. **SDK Refresh:** `runSdkAuth()` with stored provider automatically calls `provider.tokens()` 
   → SDK checks expiry + refresh token → SDK POSTs to token endpoint with grant_type=refresh_token → SDK calls `saveTokens()`

3. **Storage Update:** `saveTokens()` (line 373) updates expiresAt with new expiry

### Issuer Binding Validation

Tokens and client info are stored with an optional `issuer` field (SEP-2352 issuer binding). On each read:

```typescript
private assertStoredIssuerBindings(entry: AuthEntry | undefined, issuer: string | undefined): void {
  // Lines 237–251
  if (this.flowIssuerMismatch) {
    throw new Error(
      `OAuth authorization server issuer changed for ${this.serverName}; clear credentials before authenticating again`,
    )
  }
  if (!entry || !issuer) return
  
  const storedIssuers = [entry.clientInfo?.issuer, entry.tokens?.issuer]
    .filter((storedIssuer): storedIssuer is string => storedIssuer !== undefined)
  
  if (storedIssuers.some(storedIssuer => !issuersMatch(storedIssuer, issuer))) {
    this.flowIssuerMismatch = true
    throw new Error(
      `OAuth authorization server issuer changed for ${this.serverName}; clear credentials before authenticating again`,
    )
  }
}

function issuersMatch(first: string, second: string): boolean {
  // Lines 155–160
  return first === second
    || (first.endsWith("/") && first.slice(0, -1) === second)
    || (second.endsWith("/") && second.slice(0, -1) === first)
}
```

**Purpose:** Prevents issuer mix-up attacks (attacker's server masquerading as auth server).

---

## 6. Client Credentials Flow (Machine-to-Machine)

### Configuration

```json
{
  "mcpServers": {
    "my-service": {
      "url": "https://api.example.com/mcp",
      "auth": "oauth",
      "oauth": {
        "grantType": "client_credentials",
        "clientId": "service-id",
        "clientSecret": "service-secret",
        "scope": "read write"
      }
    }
  }
}
```

### Flow Diagram

```
startAuth() → [grantType === "client_credentials"] → Line 509
              ↓
              No callback server needed
              No browser redirect
              No state parameter
              ↓
              McpOAuthProvider(config) with empty callbacks
              ↓
              probeAuthDiscovery(serverUrl) → discovery metadata
              ↓
              runSdkAuth(provider, { serverUrl, ...discovery })
              ↓
              SDK calls provider.clientInformation() → config ID + secret
              SDK calls provider.prepareTokenRequest()
              ↓
              provider.addClientAuthentication() posts:
                grant_type=client_credentials
                client_id=...
                client_secret=... (or Basic auth)
                scope=... (if configured)
              ↓
              SDK calls provider.saveTokens()
              ↓
              Return { authorizationUrl: "" } (no browser needed)
```

### Implementation Details

**Entry:** `startAuth()` line 509–521

```typescript
if (config.grantType === "client_credentials") {
  const storedAuth = await getAuthForUrl(serverName, serverUrl, authStorageOptions)
  
  // Clear stale client info from previous registration attempts
  if (storedAuth?.clientInfo && !storedAuth.tokens && !config.clientId) {
    clearClientInfo(serverName, authStorageOptions)
    clearCodeVerifier(serverName, authStorageOptions)
    await clearOAuthState(serverName, authStorageOptions)
  }
  
  const authProvider = new McpOAuthProvider(serverName, serverUrl, config, {
    onRedirect: async () => {
      throw new Error("Browser redirect is not used for client_credentials flow")
    },
  }, authStorageOptions, runtime.signal)
  
  try {
    const discovery = applyOAuthConfig(await probeAuthDiscovery(serverUrl, definition, signal), config)
    throwIfAborted(signal)
    const result = await abortable(runSdkAuth(authProvider, { serverUrl, ...discovery }), signal)
    throwIfAborted(signal)
    if (result !== "AUTHORIZED") {
      throw new UnauthorizedError("Failed to authorize")
    }
    return { authorizationUrl: "" }
  } finally {
    authProvider.deactivate()
  }
}
```

**Provider Methods Called:**

```typescript
// clientMetadata (grants = ["client_credentials"])
get clientMetadata(): OAuthClientMetadata {
  if (this.usesClientCredentials) {
    return {
      client_name: this.config.clientName ?? defaultClientName(),
      redirect_uris: [],  // Empty for M2M
      grant_types: ["client_credentials"],
      token_endpoint_auth_method: this.config.clientSecret ? "client_secret_post" : "none",
    }
  }
  // ...
}

// prepareTokenRequest (called by SDK)
prepareTokenRequest(scope?: string): URLSearchParams | undefined {
  if (!this.usesClientCredentials) {
    return undefined
  }
  
  const params = new URLSearchParams({ grant_type: "client_credentials" })
  const requestedScope = scope ?? this.config.scope
  if (requestedScope) {
    params.set("scope", requestedScope)
  }
  return params
}

// Callbacks not called (no redirect)
private callbacks: McpOAuthCallbacks = {
  onRedirect: async () => {
    throw new Error("Browser redirect is not used for client_credentials flow")
  }
}
```

**Key Differences:**
- No callback server started
- No state parameter generated
- No PKCE (not needed for confidential client)
- No issuer binding for RFC 9207 (iss parameter)
- Direct token exchange (no redirect)

---

## 7. Dependencies

### npm Packages (package.json)

```json
{
  "dependencies": {
    "@modelcontextprotocol/client": "2.0.0",      // MCP SDK (OAuth + auth)
    "@modelcontextprotocol/core": "2.0.0",        // MCP SDK core types
    "@napi-rs/keyring": "^1.3.0",                 // OS credential store (all platforms)
    "@napi-rs/keyring-win32-x64-msvc": "^1.3.0", // Windows native binding
    "@napi-rs/keyring-darwin-arm64": "^1.3.0",   // macOS ARM64 binding
    "@napi-rs/keyring-darwin-x64": "^1.3.0",     // macOS x64 binding
    "@napi-rs/keyring-linux-x64-gnu": "^1.3.0",  // Linux x64 GNU binding
    "@napi-rs/keyring-linux-x64-musl": "^1.3.0", // Linux x64 MUSL binding
    "open": "^10.2.0"                             // Browser launch (cross-platform)
  },
  "peerDependencies": {
    "@earendil-works/pi-ai": "^0.84.1",           // Optional Pi AI runtime
    "@earendil-works/pi-tui": "*"                 // Optional Pi TUI
  }
}
```

### Imported Modules (by file)

**mcp-auth.ts**
```typescript
import { spawnSync } from 'child_process'              // Linux keyring recovery
import { createHash } from 'crypto'                    // Account hash
import { createRequire } from 'module'                 // Keyring loading
import { readFileSync, existsSync, rmSync } from 'fs' // Legacy file migration
import { dirname, join } from 'path'                   // Path handling
import { fileURLToPath } from 'url'                    // ESM URL handling
import '@napi-rs/keyring'                              // OS credential store
```

**mcp-auth-flow.ts**
```typescript
import {
  auth as runSdkAuth,
  extractWWWAuthenticateParams,
  LATEST_PROTOCOL_VERSION,
  UnauthorizedError,
  type AuthOptions,
} from "@modelcontextprotocol/client"                 // MCP SDK

import open from "open"                                // Browser launch

import { McpOAuthProvider, ... } from "./mcp-oauth-provider.ts"
import {
  ensureCallbackServer,
  waitForCallback,
  cancelPendingCallback,
  stopCallbackServer,
  releaseCallbackServer,
} from "./mcp-callback-server.ts"
import {
  getAuthForUrl,
  isTokenExpired,
  ...
} from "./mcp-auth.ts"
```

**mcp-oauth-provider.ts**
```typescript
import {
  UnauthorizedError,
  type AddClientAuthentication,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  type OAuthTokens,
} from "@modelcontextprotocol/client"              // MCP SDK OAuth types

import {
  getAuthForUrl,
  updateTokens,
  ...
} from "./mcp-auth.ts"

import { resolveCommandSecret } from "./utils.ts"
import { getAppClientUri, getAppName } from "./agent-dir.ts"
```

**mcp-callback-server.ts**
```typescript
import { createServer, type Server, ... } from "http"  // Node.js HTTP server
import { getAppName } from "./agent-dir.ts"
import {
  DEFAULT_OAUTH_CALLBACK_PATH,
  getConfiguredOAuthCallbackPort,
  ...
} from "./mcp-oauth-provider.ts"
```

**oauth.ts**
```typescript
import { getValidToken } from "./mcp-auth-flow.ts"
import {
  inspectAuthForUrl,
  updateTokens,
  type AuthStorageOptions,
  type StoredTokens,
} from "./mcp-auth.ts"
```

**oauth-handler.ts**
```typescript
import type { OAuthTokens } from "@modelcontextprotocol/client"
import { getAuthEntry } from "./mcp-auth.ts"
```

**mcp-keyring-helper.cjs**
```typescript
const { createRequire } = require('node:module')
const { dirname, join } = require('node:path')
require('@napi-rs/keyring')  // Native binding fallback loading
```

### No Build Step Required

All files are `.ts` (or `.cjs` for the helper) and loaded at runtime via jiti loader. **TypeScript compilation only for type checking:**

```bash
npx tsc --noEmit  # Verify in package directory
```

---

## 8. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PI MCP ADAPTER                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  COMMAND LAYER (index.ts / CLI integration)                         │
│  ├── /mcp-auth <server>                                             │
│  ├── /mcp logout <server>                                           │
│  └── mcp({ action: "auth-start" | "auth-complete", ... })          │
│                                                                       │
├─────────────────────────────────────────────────────────────────────┤
│                    mcp-auth-flow.ts (993 lines)                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ authenticate()           ← Main entry point                  │  │
│  │ startAuth()              ← Init flow + open browser          │  │
│  │ completeAuth()           ← Exchange code for tokens          │  │
│  │ getValidToken()          ← Get token with refresh            │  │
│  │ extractOAuthConfig()     ← Parse config from ServerEntry     │  │
│  │ probeAuthDiscovery()     ← RFC 9728 metadata discovery       │  │
│  │ createOAuthRuntime()     ← Lifecycle management              │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                  │                                   │
│                                  ▼                                   │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │      mcp-oauth-provider.ts (616 lines)                       │  │
│  │   OAuthClientProvider interface implementation                │  │
│  │                                                               │  │
│  │  McpOAuthProvider(serverName, serverUrl, config, callbacks)  │  │
│  │  ├── clientInformation()     ← Get client ID/secret           │  │
│  │  ├── saveClientInformation() ← Store dynamic registration    │  │
│  │  ├── tokens()                ← Read stored tokens            │  │
│  │  ├── saveTokens()            ← Store tokens                  │  │
│  │  ├── redirectToAuthorization()← Open browser URL            │  │
│  │  ├── codeVerifier()          ← PKCE verifier                │  │
│  │  ├── state()                 ← CSRF state parameter         │  │
│  │  ├── addClientAuthentication()← Token endpoint auth         │  │
│  │  └── invalidateCredentials() ← Clear on error               │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                  │                                   │
│                    ┌─────────────┼─────────────┐                   │
│                    ▼             ▼             ▼                    │
│  ┌──────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │ mcp-auth.ts      │  │ mcp-callback-   │  │ MCP SDK          │  │
│  │ (1089 lines)     │  │ server.ts       │  │ @modelcontext...│  │
│  │                  │  │ (510 lines)     │  │                  │  │
│  │ Storage Layer    │  │ HTTP Listener   │  │ runSdkAuth()    │  │
│  ├──────────────────┤  ├─────────────────┤  ├──────────────────┤  │
│  │ getAuthEntry()   │  │ ensureCallback  │  │ Token exchange  │  │
│  │ saveAuthEntry()  │  │ Server()        │  │ Discovery       │  │
│  │ updateTokens()   │  │                 │  │ Dynamic reg.    │  │
│  │ updateClientInfo │  │ handleRequest() │  │ Refresh logic   │  │
│  │ clearAllCredentials
│  │                 │  │ waitForCallback │  │                  │  │
│  │ isTokenExpired() │  │ cancelPending   │  │                  │  │
│  └──────────────────┘  │ stopCallbackServer()
│  │                  │  │                 │  │                  │  │
│  │ OS CREDENTIAL STORE
│  │ @napi-rs/keyring │  │ PORT 19876      │  └──────────────────┘  │
│  │ (Windows/Mac/    │  │ localhost       │                        │
│  │  Linux)          │  │ /callback       │                        │
│  │                  │  │                 │                        │
│  │ Legacy .json     │  │ .html pages     │                        │
│  │ import + delete  │  │ (self-contained │                        │
│  │                  │  │  light/dark)    │                        │
│  │ In-memory cache  │  │                 │                        │
│  │ (opt-out via env)│  │ Browser         │                        │
│  └──────────────────┘  │ redirects here  │                        │
│                        └─────────────────┘                        │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ mcp-keyring-helper.cjs (97 lines)                            │  │
│  │ Linux keyring recovery subprocess                            │  │
│  │ Spawned via: keyctl session - node helper.cjs               │  │
│  │ Recovers from revoked parent keyring                         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ oauth.ts (38 lines) + oauth-handler.ts (31 lines)            │  │
│  │ Public API re-exports for internal + external consumers      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 9. Key Data Structures

### In-Flight OAuth State

```typescript
// mcp-auth-flow.ts:133–143
type PendingAuth = {
  serverName: string
  authProvider: McpOAuthProvider
  serverUrl: string
  authorizationUrl: string                    // Full URL with code_challenge
  discovery: AuthDiscovery                   // Metadata for token exchange
  authStorageOptions: AuthStorageOptions
}

type RuntimeState = {
  controller: AbortController                // Abort signal for cleanup
  generation: number                         // Invalidation counter
  pendingAuths: Map<string, PendingAuth>     // In-flight flows by key
  pendingAuthStates: Map<string, string>     // state param by flow key
  pendingAuthCleanupTimers: Map<string, ...> // 5-minute timeouts
  pendingAuthentications: Map<string, ...>   // Duplicate-request dedup
}

// Storage key format: "${serverName}|${getAuthBaseDir(options)}"
```

### Callback Server State

```typescript
// mcp-callback-server.ts:77–93
interface PendingAuth {
  resolve: (result: OAuthCallbackResult) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

interface OAuthCallbackResult {
  code: string
  iss?: string  // RFC 9207
}

let pendingAuths = new Map<string, PendingAuth>()          // By state param
let reservedAuthStates = new Set<string>()                 // Pre-reserved
let callbackGeneration = 0                                 // Invalidation
```

### McpOAuthProvider Internal State

```typescript
// mcp-oauth-provider.ts:175–182
export class McpOAuthProvider implements OAuthClientProvider {
  private flowClientInfo: StoredClientInfo | undefined     // Dynamic client reg
  private flowCodeVerifier: string | undefined             // PKCE S256
  private flowDiscoveryState: OAuthDiscoveryState | undefined // Issuer check
  private flowIssuerMismatch = false                       // Error flag
  private flowState: string | undefined                   // CSRF state (in-flow)
  private active = true                                    // Deactivation flag
}
```

---

## 10. Porting Checklist: Essential vs Optional

### **ESSENTIAL** ✓ (Must Port)

1. **mcp-auth.ts** (Token Storage)
   - OS credential store integration (Windows Credential Manager, macOS Keychain, Linux Secret Service)
   - OR substitute with secure local store (SQLCipher, etc.)
   - Cache layer (in-memory, on every request)
   - Legacy plaintext migration (one-time import)
   - Chunking for large credentials (Windows 1280-char limit)

2. **mcp-auth-flow.ts** (OAuth Flow Orchestration)
   - `authenticate()`, `startAuth()`, `completeAuth()`, `getValidToken()`
   - State generation and validation (CSRF protection)
   - Discovery probing (RFC 9728)
   - Runtime lifecycle (abort signals, pending auth tracking)
   - Token refresh logic
   - Command-secret resolution (`!command` syntax)

3. **mcp-oauth-provider.ts** (MCP SDK Interface)
   - Must implement `OAuthClientProvider` interface
   - All 8 required methods + `addClientAuthentication()` + `prepareTokenRequest()`
   - PKCE verifier handling
   - Issuer binding validation (SEP-2352)
   - Config vs dynamic client distinction
   - Client credentials support

4. **mcp-callback-server.ts** (HTTP Callback Handler)
   - HTTP listener on loopback (localhost or 127.0.0.1)
   - State validation (CSRF)
   - Error handling and display
   - Timeout management (5 minutes)
   - HTML response pages
   - Port selection (dynamic vs pre-registered)

### **OPTIONAL** ◐ (Can Substitute/Omit)

1. **mcp-keyring-helper.cjs** (Linux Keyring Recovery)
   - Only needed for headless Linux with revoked keyrings
   - Can omit if target platform doesn't use Linux or handles keyrings differently
   - Fallback: let failed store access bubble up as "unavailable"

2. **oauth.ts** and **oauth-handler.ts** (Public API Re-exports)
   - Thin wrappers around core modules
   - Only needed if external code needs the public surface
   - Can fold into single internal module

3. **HTML Response Templates** (mcp-callback-server.ts:11–68)
   - Can replace with simpler/custom pages
   - Must return 200 OK with HTML content
   - Success page should show server name (fetched dynamically via `getAppName()`)

4. **Command-Secret Resolution** (utils.ts integration)
   - `!command` syntax for secret resolution
   - Optional if port doesn't need dynamic secrets
   - Can hardcode secrets instead

### **HARD TO SUBSTITUTE** ⚠ (Deep Integration)

1. **MCP SDK `auth()` function and `OAuthClientProvider` interface**
   - Core protocol contract
   - Must use exact MCP SDK version (2.0.0) or compatible fork
   - If swapping SDK, must re-implement OAuth SDK contract

2. **Issuer Binding Validation (SEP-2352)**
   - Prevents authorization-server mix-up attacks
   - Must validate issuer on every token read/refresh
   - No shortcut; must track issuer across flows

3. **Token Expiry and Refresh**
   - Expiry stored as Unix seconds (not ms)
   - Refresh happens transparently before token use
   - SDK controls refresh logic; must hook `saveTokens()`

---

## 11. Error Handling & Edge Cases

### Credential Store Failures

```typescript
// mcp-auth.ts:75–81
export class OAuthCredentialStoreError extends Error {
  readonly code = 'OAUTH_CREDENTIAL_STORE_UNAVAILABLE'
  constructor(
    message: string,
    readonly operation: 'read' | 'write' | 'remove',
    cause: unknown,
  )
}

// Fail-closed: if store unavailable, auth fails
// No plaintext fallback; forces user to configure credential store
```

### Linux Keyring Revoked

```typescript
// mcp-auth.ts:200–242 (Linux recovery)
function shouldAttemptLinuxKeyringRecovery(error: unknown): boolean {
  return isLinuxKeyringRecoveryEnabled()
    && causeChainContains(error, /key\s*(?:has been\s*)?revoked|keyrevoked/i)
}

// First attempt: normal keyring → fails with "KeyRevoked"
// Recovery attempt: keyctl session - node helper.cjs → new session keyring
// If recovery fails: bubble up original error (fail-closed)
```

### Issuer Mismatch Attack Detection

```typescript
// mcp-oauth-provider.ts:237–251
private assertStoredIssuerBindings(entry: AuthEntry | undefined, issuer: string | undefined): void {
  if (this.flowIssuerMismatch) {
    throw new Error(`OAuth authorization server issuer changed for ${this.serverName}; 
                     clear credentials before authenticating again`)
  }
  
  const storedIssuers = [entry.clientInfo?.issuer, entry.tokens?.issuer]
    .filter(...): string[]
  
  if (storedIssuers.some(storedIssuer => !issuersMatch(storedIssuer, issuer))) {
    this.flowIssuerMismatch = true
    throw new Error(...)
  }
}

// Once set, flowIssuerMismatch blocks all future operations until deactivate()
```

### Callback Timeout

```typescript
// mcp-callback-server.ts:298–313
export function waitForCallback(oauthState: string): Promise<OAuthCallbackResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pendingAuths.has(oauthState)) {
        pendingAuths.delete(oauthState)
        reject(new Error("OAuth callback timeout - authorization took too long"))
      }
    }, CALLBACK_TIMEOUT_MS)  // 5 minutes
    
    pendingAuths.set(oauthState, { resolve, reject, timeout })
  })
}

// If user doesn't complete auth in 5 minutes, callback server cleans up state
```

### URL Change Detection

```typescript
// mcp-auth.ts:815–823
export function getAuthForUrl(
  serverName: string,
  serverUrl: string,
  options?: AuthStorageOptions
): AuthEntry | undefined {
  const entry = getAuthEntry(serverName, options)
  if (!entry) return undefined
  
  // If no serverUrl is stored, this is from an old version - consider it invalid
  if (!entry.serverUrl) return undefined
  
  // If URL has changed, credentials are invalid
  if (entry.serverUrl !== serverUrl) return undefined
  
  return entry
}

// Protects against using same server name with different URL
```

---

## 12. Configuration Deep-Dive

### OAuth Config Schema

```typescript
// mcp-auth-flow.ts:177–237
export interface McpOAuthConfig {
  grantType?: "authorization_code" | "client_credentials"
  clientId?: string
  clientSecret?: string                    // Can be "!command"
  scope?: string
  authorizationParams?: Record<string, string>
  redirectUri?: string                     // Must be http://localhost:PORT/path
  clientName?: string
  clientUri?: string
  logoUri?: string                         // Must be https:// absolute URL
  skipIssuerMetadataValidation?: boolean
}

// Environment variable interpolation:
// - ${ENV_VAR} or $ENV_VAR → expanded
// - !command arg... → lazy resolution at auth time (not expanded early)
```

### Discovery Query Parameters

```typescript
// mcp-auth-flow.ts:195–228
async function probeAuthDiscovery(
  serverUrl: string,
  definition?: ServerEntry,
  signal?: AbortSignal
): Promise<AuthDiscovery> {
  // POST /initialize to MCP server
  // Parse 401 response for WWW-Authenticate header
  // Extract: resourceMetadataUrl, scope
  
  // RFC 9728: Fetch resourceMetadataUrl/.well-known/oauth-protected-resource
  // Returns: issuer, authorization_endpoint, token_endpoint, etc.
}

// If no discovery: SDK falls back to default RFC 9728 endpoints
// (/.well-known/oauth-protected-resource, etc.)
```

---

## 13. Testing Considerations

### Test Isolation

```typescript
// mcp-auth.ts:281–315 (Test Helpers)

// Swap credential store for testing
process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE = 'memory'      // In-memory
process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE = 'sizelimited' // Test Windows cap
process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE = 'unavailable' // Simulate failure
process.env.PI_MCP_ADAPTER_TEST_AUTH_STORE = 'keyrevoked'  // Simulate revoked

// Reset cache
resetAuthEntryCache()
resetTestAuthSecretStore()

// Inspect stored data
getTestAuthSecretStoreReadCount()
getTestAuthSecretStoreEntries()
```

### Callback Server Testing

```typescript
// mcp-callback-server.ts:347–400 (Manual binding tests)

// Can manually bind to specific port for integration tests
ensureCallbackServer({
  strictPort: true,
  port: 19876,
  callbackHost: "localhost",
  callbackPath: "/callback",
})

// Simulate callback
handleRequest(mockReq, mockRes)  // Internal only; would need test harness
```

---

## Summary: Porting Strategy

### Phase 1: Core Storage (Week 1)
1. Implement OS credential store adapter (or SQLCipher fallback)
2. Implement cache layer
3. Port legacy migration logic
4. Test with mcp-auth.test.ts fixtures

### Phase 2: OAuth Flow (Week 2)
1. Port `McpOAuthProvider` class
2. Implement discovery probing
3. Port token refresh logic
4. Integrate MCP SDK `auth()` function

### Phase 3: Callback Server (Week 2)
1. Port HTTP callback handler
2. Implement HTML response templates
3. Test CSRF state validation
4. Test timeout management

### Phase 4: Integration (Week 3)
1. Port `authenticate()`, `startAuth()`, `completeAuth()`
2. Port runtime lifecycle management
3. Test end-to-end flows (interactive + M2M)
4. Test error handling (credential store failures, timeouts, issuer mismatch)

### Phase 5: Platform-Specific (Week 3)
1. Linux: Keyring recovery helper (if needed)
2. Command-secret resolution (if needed)
3. Test on target platform

### Estimated Effort
- **Straightforward:** mcp-callback-server.ts, oauth.ts, oauth-handler.ts (~1 day)
- **Medium:** mcp-auth-flow.ts, mcp-oauth-provider.ts (~2–3 days)
- **Complex:** mcp-auth.ts (OS integration, chunking, recovery) (~3–4 days)
- **Testing + Integration:** ~3 days

**Total:** ~2–3 weeks for complete port with full test coverage.

---

## References

- **MCP SDK:** `@modelcontextprotocol/client` v2.0.0
  - `auth()` function for OAuth orchestration
  - `OAuthClientProvider` interface contract
  - `OAuthTokens`, `OAuthClientMetadata` types

- **Standards:**
  - OAuth 2.1 (draft-ietf-oauth-v2-1-11)
  - PKCE (RFC 7636)
  - Dynamic Client Registration (RFC 7591)
  - RFC 9728 (OAuth Protected Resource Metadata)
  - SEP-2352 (Issuer Identifier in Responses)
  - RFC 9207 (OAuth 2.0 Authorization Server Issuer Identification)

- **Credential Stores:**
  - `@napi-rs/keyring` — macOS Keychain, Windows Credential Manager, Linux libsecret
  - Windows Credential Manager API (1280-char per value limit)
  - GNOME Keyring / libsecret (multiline forbidden in plaintext mode)

---

**End of Report**
