# MCP Core Reliability Plan (Phase 1 of the pi-mcp-adapter port)

**Goal:** Bring `@pi-archimedes/mcp` up to production reliability by porting the core server/config/tool subsystem from `pi-mcp-adapter` — metadata cache (offline search), lifecycle management (idle/keepalive), robust connection handling (generation-fenced reconnect, session recovery, `needs-auth` status), npx resolution, stderr capture, pagination, and resource/prompt discovery.

**Architecture:** Extends the existing `packages/mcp/` package (from plan-024). Adds a persistent metadata cache (`~/.pi/agent/mcp-cache.json`) so search/describe/direct-tools work without connecting every server. Adds a lifecycle manager for idle shutdown + keep-alive health checks. Hardens `ServerClient`/`ServerManager` with single-flight generation fencing and a `needs-auth` status (OAuth itself lands in plan-026). Config gains the missing precedence layers and per-server settings.

**Tech Stack:** `@modelcontextprotocol/sdk` v1, `@pi-archimedes/core`, `@earendil-works/pi-coding-agent`, `node:crypto` (SHA-256 for cache hash), `node:fs`.

**Reference:** `docs/research/pi-mcp-adapter-server-config-tools.md` (gap analysis). Source repo: `/home/daniel/Coding/AI/pi-mcp-adapter/`.

**Scope boundary:** This plan does NOT include OAuth (plan-026) or the `/mcp` command + panels (plan-027). It DOES add the `needs-auth` connection status and a stub auth hook so plan-026 can slot in cleanly.

**SDK import paths:** Always import from `@modelcontextprotocol/sdk/client/...` (e.g. `@modelcontextprotocol/sdk/client/stdio.js`, `@modelcontextprotocol/sdk/client/streamableHttp.js`). The reference adapter uses its own `@modelcontextprotocol/client/...` alias — do NOT copy that; use the `/sdk/` paths that the existing `server-client.ts` already uses.

**Verified SDK APIs (v1.30.0):** `listTools({ cursor })`/`listResources`/`listPrompts` all return `{ ..., nextCursor?: string }`. `client.getServerCapabilities()` returns `{ resources?, prompts?, tools? }`. `client.getInstructions()` returns the server instructions string. `StdioClientTransport` accepts a `stderr` option and exposes `transport.stderr` (a stream, only non-null when `stderr: "pipe"`). HTTP errors throw `StreamableHTTPError` (from `@modelcontextprotocol/sdk/client/streamableHttp.js`) with a numeric `.code` (401, 404, etc.).

---

### Task 0: Wire packages/mcp into vitest

**Context:**
Every other package in the monorepo has a `vitest.config.ts` and is listed in the root `vitest.config.ts` `projects` array. `packages/mcp` is not — so the TDD steps in later tasks (`pnpm exec vitest run <name>`) cannot discover tests, and the root `pnpm exec vitest run` gate would silently skip all mcp tests. This must be done first.

**Files:**
- Create: `packages/mcp/vitest.config.ts`
- Modify: `vitest.config.ts` (repo root) — add `packages/mcp` to `projects`

**What to implement:**
1. Copy `packages/core/vitest.config.ts` to `packages/mcp/vitest.config.ts` (adjust name if the config references one). It should `include: ["src/**/*.test.ts"]`.
2. Add `"packages/mcp"` to the `projects` array in the root `vitest.config.ts` (match the existing entry format).
3. Create a trivial smoke test `packages/mcp/src/smoke.test.ts` with one `expect(true).toBe(true)` to verify discovery, then delete it after confirming.

**Steps:**
- [ ] Read `packages/core/vitest.config.ts` and the root `vitest.config.ts` to match the exact format
- [ ] Create `packages/mcp/vitest.config.ts`
- [ ] Add `packages/mcp` to root `projects`
- [ ] Create the smoke test, run `pnpm exec vitest run` from repo root, confirm the mcp smoke test is discovered and passes
- [ ] Delete the smoke test
- [ ] Commit: `test(mcp): wire packages/mcp into vitest`

**Acceptance criteria:**
- [ ] `pnpm exec vitest run` from repo root discovers and runs tests under `packages/mcp/src/`
- [ ] The config matches the pattern of other packages

---

### Task 1: Expand types for full server definitions and cache

**Context:**
The current `types.ts` (43 lines) only models stdio + http-with-token servers. The full port needs per-server lifecycle settings, tool filtering, prefixing, and the cache data structures. This task expands the type surface so all subsequent tasks have the types they need. No behavior change — types only.

**Files:**
- Modify: `packages/mcp/src/types.ts`

**What to implement:**

Add to `StdioServerDef`:
```typescript
export interface StdioServerDef {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  disabled?: boolean;
  // Lifecycle & tooling (shared — see SharedServerSettings below)
}
```

Add a shared settings mixin applied to both stdio and http defs:
```typescript
export interface SharedServerSettings {
  lifecycle?: "keep-alive" | "lazy" | "lazy-keep-alive" | "eager";
  idleTimeout?: number; // minutes; 0 disables
  requestTimeoutMs?: number;
  directTools?: boolean | string[];
  includeTools?: string[];
  excludeTools?: string[];
  toolPrefix?: ToolPrefix;
  exposeResources?: boolean;
  debug?: boolean;
  protocolVersion?: string;
}

export type ToolPrefix = "server" | "none" | "short" | "mcp";
```

Merge `SharedServerSettings` into both `StdioServerDef` and `HttpServerDef` (via `extends` or intersection). Keep `HttpServerDef.auth?: { token: string }` as-is (OAuth added in plan-026, but add `"oauth"` back as an accepted literal now that plan-026 will implement it — actually keep it `{ token: string }` only until plan-026 to avoid the dead-config warning; plan-026 will widen it).

Also add HTTP credential fields to `HttpServerDef` now (so the cache hash and url-binding security in later tasks have real fields to operate on): `headers?: Record<string, string>` and `bearerTokenEnv?: string`. Keep `auth?: { token: string }` as-is (OAuth widens it in plan-026).

Add cache types:
```typescript
export interface CachedTool {
  name: string;
  description?: string;
  inputSchema: unknown;
}

export interface ServerCacheEntry {
  configHash: string;
  tools: CachedTool[];
  resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }>;
  prompts?: Array<{ name: string; description?: string }>;
  instructions?: string;
  cachedAt: number;
}

export interface MetadataCache {
  version: number;
  servers: Record<string, ServerCacheEntry>;
}

export const CACHE_VERSION = 1;
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
```

Add per-server settings resolution helper types as needed. Extend `McpConfig` (the `archimedes.mcp` settings) with:
```typescript
export interface McpConfig {
  directTools: boolean;
  collapsedResultLines: 1 | 2 | 3;
  toolPrefix: ToolPrefix;          // default "server"
  idleTimeout: number;             // minutes, default 10
  warnOnLargeDirectTools: boolean; // default true
}
```
Update `DEFAULT_MCP_CONFIG` accordingly.

**Steps:**
- [ ] Add `ToolPrefix`, `SharedServerSettings`, merge into server defs
- [ ] Add cache types (`CachedTool`, `ServerCacheEntry`, `MetadataCache`, constants)
- [ ] Extend `McpConfig` + `DEFAULT_MCP_CONFIG`
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Fix any downstream type errors in existing files (config.ts, index.ts) caused by the McpConfig change
- [ ] Commit: `feat(mcp): expand types for full server defs and metadata cache`

**Acceptance criteria:**
- [ ] All new types compile
- [ ] `DEFAULT_MCP_CONFIG` has the new fields with correct defaults
- [ ] `npx tsc --noEmit` passes with 0 errors

---

### Task 2: Tool prefixing with full mode support and collision handling

**Context:**
The current `direct-tools.ts` prefixing is lossy (`_` for all non-alphanumerics) and only supports the `server` mode. Porting the adapter's `sanitizeServerPrefix` (hex-encoding) and all four `ToolPrefix` modes gives collision-safe, configurable naming and enables `resolveServerFromToolName` (inverse lookup) which later tasks need.

**Files:**
- Create: `packages/mcp/src/tool-naming.ts`
- Modify: `packages/mcp/src/direct-tools.ts` (use the new functions)

**What to implement:**

`packages/mcp/src/tool-naming.ts` — port from adapter `types.ts` lines ~740–860:

```typescript
import type { ToolPrefix } from "./types.js";

/** Sanitize a server name: keep [A-Za-z0-9_-], replace others with _<hex>_ */
export function sanitizeServerPrefix(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, (c) => `_${c.codePointAt(0)!.toString(16)}_`);
}

export function getServerPrefix(serverName: string, prefix: ToolPrefix): string {
  switch (prefix) {
    case "none": return "";
    case "short": return sanitizeServerPrefix(serverName.replace(/-?mcp$/i, ""));
    case "mcp": return `mcp__${sanitizeServerPrefix(serverName)}`;
    case "server":
    default: return sanitizeServerPrefix(serverName);
  }
}

/** Build prefixed tool name: <prefix>_<toolName with . → _> */
export function formatToolName(toolName: string, serverName: string, prefix: ToolPrefix): string {
  const p = getServerPrefix(serverName, prefix);
  const sanitized = toolName.replace(/\./g, "_");
  return p ? `${p}_${sanitized}` : sanitized;
}

/**
 * Inverse: find server owning a prefixed tool name by longest matching prefix.
 * Returns undefined if no match OR if two servers tie for the longest matching prefix (ambiguous).
 * IMPORTANT: compute each server's prefix using ITS OWN mode, not a hardcoded "server".
 */
export function resolveServerFromToolName(
  prefixedName: string,
  servers: Array<{ name: string; prefix: ToolPrefix }>,
): string | undefined {
  const matches: Array<{ name: string; prefixLen: number }> = [];
  for (const { name, prefix } of servers) {
    const p = getServerPrefix(name, prefix);
    if (p && prefixedName.startsWith(`${p}_`)) matches.push({ name, prefixLen: p.length });
  }
  if (matches.length === 0) return undefined;
  matches.sort((a, b) => b.prefixLen - a.prefixLen);
  // Ambiguous if the top two share the winning prefix length
  if (matches.length > 1 && matches[0]!.prefixLen === matches[1]!.prefixLen) return undefined;
  return matches[0]!.name;
}

export const BUILTIN_NAMES = new Set([
  "read", "bash", "edit", "write", "grep", "find", "ls", "mcp",
]);
```

Update `direct-tools.ts` to import `formatToolName` and `BUILTIN_NAMES` from `tool-naming.ts`, replacing the local `sanitizePrefix`/`buildDirectToolName`. Apply the `BUILTIN_NAMES` check to the **final prefixed name** (matters mainly for `toolPrefix: "none"`, which can produce a bare `read`), skipping with a `console.warn`. Keep the existing per-client WeakMap dedup.

**Steps:**
- [ ] Write failing test `packages/mcp/src/tool-naming.test.ts` — verify: `sanitizeServerPrefix("a.b")` hex-encodes the dot; all four prefix modes; `resolveServerFromToolName` longest-match wins AND returns undefined when two servers tie on prefix length; `BUILTIN_NAMES` contains `mcp`
- [ ] Run `pnpm exec vitest run tool-naming` — must fail (module doesn't exist)
- [ ] Create `tool-naming.ts`
- [ ] Run `pnpm exec vitest run tool-naming` — must pass
- [ ] Update `direct-tools.ts` to use the new module + `BUILTIN_NAMES` guard
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Commit: `feat(mcp): full tool prefixing with collision handling`

**Acceptance criteria:**
- [ ] All four prefix modes produce correct names
- [ ] `resolveServerFromToolName` returns undefined on ambiguity
- [ ] Builtin tool names are never shadowed
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 3: npx/npm binary resolution and stderr tail capture

**Context:**
Real-world stdio MCP servers use `npx -y some-server`. Passing that straight to `StdioClientTransport` spawns the npm/npx parent process, which is slower and can leak. The adapter's `resolveNpxBinary` resolves the actual binary. Separately, when a stdio server fails to start, capturing its last few stderr lines is a huge debugging win (currently we get a generic error).

**Files:**
- Create: `packages/mcp/src/npx-resolver.ts`
- Modify: `packages/mcp/src/server-client.ts`

**What to implement:**

`packages/mcp/src/npx-resolver.ts` — port the essential logic from adapter `npx-resolver.ts` (543 lines → keep only the core resolution, drop the elaborate caching if it complicates):

```typescript
export interface NpxResolution {
  command: string;
  args: string[];
}

/** Pure helper: strip npx wrapper flags (-y, --yes, exec) from args. Exported for testing. */
export function parseNpxArgs(args: string[]): string[];

/**
 * If command is `npx`/`npm exec`, attempt to resolve the actual package binary
 * so we spawn it directly instead of the npm parent.
 * Returns null when the command is NOT npx/npm (caller uses the original command/args).
 */
export async function resolveNpxBinary(command: string, args: string[]): Promise<NpxResolution | null>;
```

**Critical:** `resolveNpxBinary` returns `NpxResolution | null` — `null` means "not an npx/npm command, use the original." The caller MUST handle null:
```typescript
const resolved = await resolveNpxBinary(def.command, def.args ?? []);
const command = resolved?.command ?? def.command;
const args = resolved?.args ?? (def.args ?? []);
```

Keep it pragmatic: detect `npx`/`npm`, strip `-y`/`--yes`/`exec` via `parseNpxArgs`, locate the package's `bin` via `node`'s resolution if possible; otherwise return the original command/args wrapped in a resolution (NOT null — null is only for non-npx commands). Read the adapter's `npx-resolver.ts` for matching logic but simplify aggressively.

In `server-client.ts`, for the stdio branch:
1. Resolve the binary (handling null as above) and use the resolved command/args.
2. **Pass `stderr: def.debug ? "inherit" : "pipe"` to the `StdioClientTransport` constructor** — `transport.stderr` is `null` unless `stderr` is `"pipe"`. Attach the stderr listener BEFORE calling `client.connect(transport)` (early crash output is otherwise lost). Guard for `transport.stderr` being null.
3. Capture a bounded stderr tail: keep the **last 8 KiB / last 3 lines**. On connection failure, append this tail to the error message.

Reference adapter `server-manager.ts` lines ~56–115 (stderr tail) and line ~382 (`stderr: definition.debug ? "inherit" : "pipe"`).

**Steps:**
- [ ] Write failing test `packages/mcp/src/npx-resolver.test.ts` — test the PURE helper `parseNpxArgs(["-y", "pkg"])` returns `["pkg"]` (no filesystem dependency); `resolveNpxBinary("node", ["x"])` returns `null` (not an npx command)
- [ ] Run `pnpm exec vitest run npx-resolver` — must fail
- [ ] Create `npx-resolver.ts`
- [ ] Run `pnpm exec vitest run npx-resolver` — must pass
- [ ] Wire `resolveNpxBinary` (handling null) + `stderr: "pipe"` + stderr tail into `server-client.ts` stdio branch
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Commit: `feat(mcp): npx resolution and stderr tail capture for stdio servers`

**Acceptance criteria:**
- [ ] `parseNpxArgs` strips `-y`/`--yes`/`exec`
- [ ] `resolveNpxBinary` returns null for non-npx commands (caller uses original)
- [ ] `StdioClientTransport` is constructed with `stderr: "pipe"` (non-debug), listener attached before connect
- [ ] Stdio connection failures include stderr tail in the error
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 4: Metadata cache — offline tool discovery

**Context:**
This is the highest-value feature. Currently every `search`/`describe`/`call` in `index.ts` does `Promise.allSettled(clients.map(c => c.connect()))` — connecting every server on every proxy call. The adapter persists tool metadata to `~/.pi/agent/mcp-cache.json` keyed by a config hash, so search/describe/direct-tools work offline and servers only connect when a tool is actually called.

**Files:**
- Create: `packages/mcp/src/metadata-cache.ts`
- Modify: `packages/mcp/src/server-client.ts` (write cache after discovery)
- Modify: `packages/mcp/src/server-manager.ts` (expose cached tools)

**What to implement:**

`packages/mcp/src/metadata-cache.ts` — port from adapter `metadata-cache.ts`:

```typescript
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ServerDef, MetadataCache, ServerCacheEntry, CachedTool } from "./types.js";
import { CACHE_VERSION, CACHE_MAX_AGE_MS } from "./types.js";

const CACHE_PATH = () => join(getAgentDir(), "mcp-cache.json");

/**
 * SHA-256 over identity-affecting fields only, stable-stringified (sorted keys).
 * ServerDef is a discriminated union — narrow with ("command" in def) / ("url" in def)
 * before accessing command/url, or project to an unknown-typed object first, to satisfy
 * strict tsc (exactOptionalPropertyTypes, noUncheckedIndexedAccess).
 * Hash fields: command, args, env, cwd, url, auth, headers, bearerTokenEnv,
 * protocolVersion, includeTools, excludeTools, exposeResources.
 * Do NOT hash runtime settings (lifecycle, idleTimeout, debug).
 */
export function computeServerHash(def: ServerDef): string;

export function loadMetadataCache(): MetadataCache;

/** Read-merge-write: merge one server's entry into the on-disk cache, atomic tmp+rename. */
export function saveServerCache(serverName: string, def: ServerDef, entry: Omit<ServerCacheEntry, "configHash" | "cachedAt">): void;

/** True if cache entry exists, hash matches, and not older than CACHE_MAX_AGE_MS. */
export function isServerCacheValid(def: ServerDef, entry: ServerCacheEntry | undefined): boolean;

/** Get cached tools for a server if valid, else undefined. */
export function getCachedTools(serverName: string, def: ServerDef): CachedTool[] | undefined;
```

`computeServerHash` must use a **stable stringify** (sorted keys) and only hash identity fields (command, args, env, cwd, url, auth, protocolVersion, includeTools, excludeTools) — NOT runtime settings (lifecycle, idleTimeout, debug).

In `server-client.ts`, after `listTools()`, call `saveServerCache(this.name, this.def, { tools, resources: [], prompts: [], instructions: undefined })`. **Task 6 (which runs AFTER this task) extends the payload** with real resources/prompts/instructions once discovery is added — at Task 4 time those fields don't exist yet, so save empty/undefined placeholders and Task 6 will fill them. Do NOT reference `this.resources`/`this.prompts` here (they don't exist until Task 6).

In `server-manager.ts`, add:
```typescript
/** Tools from live connection if connected, else from valid cache. */
getToolsForServer(name: string, def: ServerDef): CachedTool[];
/** All tools across servers (live + cached), for offline search. */
getAllToolsWithCache(defs: Record<string, ServerDef>): Array<CachedTool & { serverName: string }>;
```

Then update `index.ts`: `search`/`describe`/`list` read from `getAllToolsWithCache` instead of force-connecting. Only `call` connects the owning server.

**Steps:**
- [ ] Write failing test `packages/mcp/src/metadata-cache.test.ts` — `computeServerHash` stable across key order; changes when command changes; `isServerCacheValid` false on hash mismatch and on age > 7 days; save+load round-trips
- [ ] Run `pnpm exec vitest run metadata-cache` — must fail
- [ ] Create `metadata-cache.ts`
- [ ] Run `pnpm exec vitest run metadata-cache` — must pass
- [ ] Wire cache write into `server-client.ts` post-discovery
- [ ] Add `getToolsForServer`/`getAllToolsWithCache` to `server-manager.ts`
- [ ] Update `index.ts` search/describe/list to use cache (remove force-connect-all)
- [ ] Run `pnpm exec tsc --noEmit` + `pnpm exec vitest run` in `packages/mcp/` — must pass
- [ ] Commit: `feat(mcp): metadata cache for offline tool discovery`

**Acceptance criteria:**
- [ ] `search`/`describe`/`list` work WITHOUT connecting servers (verified: no connect call when cache is valid)
- [ ] Cache invalidates on config change (hash) and after 7 days
- [ ] Cache file is written atomically (tmp+rename)
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 5: Connection hardening — generation fencing, needs-auth, session recovery

**Context:**
The current `ServerClient` has a per-client `connectPromise` (good dedup) but no coordination between connect/close/reconnect. A concurrent connect+close can leak a client. The adapter uses a monotonic `closeGenerations` counter to fence a connect that resolves after a close. It also treats auth failures as a first-class `needs-auth` status (not a generic error) and transparently recovers expired HTTP sessions (404 → reconnect). This task hardens the connection layer WITHOUT implementing OAuth — `needs-auth` is detected and surfaced, but the actual auth flow is a stub for plan-026.

**Files:**
- Modify: `packages/mcp/src/server-client.ts`
- Modify: `packages/mcp/src/server-manager.ts`

**What to implement:**

**ARCHITECTURE NOTE:** In pi-archimedes, `ServerClient` owns its own SDK `Client`, `connectPromise`, `connect()` and `close()`. `ServerManager` is a thin `Map<string, ServerClient>` wrapper that never calls `connect()` directly. Therefore generation fencing MUST live in `ServerClient` (not `ServerManager` as the adapter does — the adapter's manager owns the Client, ours doesn't).

In `ServerClient`:
1. Add `status: "disconnected" | "connecting" | "connected" | "error" | "needs-auth"` (add `needs-auth`).
2. **Generation fencing (in ServerClient):** add a private `generation = 0`. Bump it in `close()`. Capture `const gen = this.generation` at the start of `_doConnect()`; after the SDK `connect()` resolves, if `this.generation !== gen`, tear down the just-created client (`await client.close().catch(()=>{})`) and return without setting `connected` — a close raced ahead.
3. **needs-auth detection:** catch `StreamableHTTPError` with `.code === 401` during connect → set status `needs-auth`, do NOT throw. Import `StreamableHTTPError` from `@modelcontextprotocol/sdk/client/streamableHttp.js`. (Note: with no auth provider configured, a 401 throws `StreamableHTTPError`, NOT `UnauthorizedError` — verified.) Add a stub `authenticate(): Promise<void>` that throws `"OAuth not yet implemented (plan-026)"`. For token/no-auth servers, the surfaced message should be clear: "authentication required or token rejected — OAuth support arrives in plan-026" rather than implying a resolvable flow.
4. Add `lastUsedAt: number` and `inFlight: number` counters (increment before `callTool`, decrement in a `finally`).
5. **Session recovery:** wrap `callTool` so a `StreamableHTTPError` with `.code === 404` (session expired) triggers one `close()` + `connect()` + retry.
6. Add `isIdle(timeoutMs): boolean` on `ServerClient`: `status === "connected" && inFlight === 0 && (Date.now() - lastUsedAt) > timeoutMs`.

In `ServerManager`:
1. Add `isIdle(name, timeoutMs)` that delegates to `this.clients.get(name)?.isIdle(timeoutMs) ?? false`.
2. `close()` and `sync()` already delete from the map before awaiting; confirm they remain correct with the new generation logic.

Reference adapter `server-manager.ts` lines ~210–320 (connect/reconnect/close) and ~1090–1100 (isIdle) for the LOGIC, but implement the fencing on `ServerClient` per the architecture note above.

**Steps:**
- [ ] Write failing test `packages/mcp/src/server-client.test.ts` (fencing lives on ServerClient) — generation fencing: bumping generation during a connect causes the resolved connection to be torn down; `isIdle` returns false when inFlight > 0; `isIdle` true after timeout with inFlight 0. Use a fake SDK Client/transport injected or a minimal stub.
- [ ] Run `pnpm exec vitest run server-manager` — must fail
- [ ] Implement generation fencing, needs-auth status, session recovery, idle tracking
- [ ] Run `pnpm exec vitest run server-manager` — must pass
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Commit: `feat(mcp): connection hardening — generation fencing, needs-auth, session recovery`

**Acceptance criteria:**
- [ ] Concurrent connect+close cannot leak a connection (generation fence)
- [ ] HTTP 401 sets `needs-auth` status without throwing
- [ ] Expired HTTP session (404) auto-reconnects once and retries the call
- [ ] `isIdle` correctly accounts for in-flight calls
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 6: Resource + prompt discovery and pagination

**Context:**
We currently only call `listTools()` and ignore `nextCursor`, so servers with more than one page of tools are truncated, and resources/prompts are never discovered. The adapter paginates all three and exposes resources as `read_<name>` tools.

**Files:**
- Modify: `packages/mcp/src/server-client.ts`

**What to implement:**

1. **Paginate `listTools`** — the cursor must be passed back in as a param, or you get an infinite loop:
   ```typescript
   const tools = [];
   let cursor: string | undefined;
   do {
     const r = await this.client.listTools(cursor ? { cursor } : undefined);
     tools.push(...r.tools);
     cursor = r.nextCursor;
   } while (cursor);
   ```
2. **Capability-gate resources/prompts** — calling `listResources()` on a server WITHOUT the capability throws (`assertCapabilityForMethod`), so the guard is mandatory:
   ```typescript
   const caps = this.client.getServerCapabilities();
   if (caps?.resources) { /* paginate listResources with the same cursor pattern */ }
   if (caps?.prompts) { /* paginate listPrompts */ }
   ```
3. Store `instructions` from `this.client.getInstructions()` (NOT the raw initialize result).
4. Expose discovered data on the client (`get resources()`, `get prompts()`, `get instructions()`).
5. **Extend the Task-4 cache write** to include the now-real `resources`, `prompts`, `instructions` in the `saveServerCache` payload (replace the empty placeholders from Task 4).

Resources-as-tools registration is deferred (or wire minimally: in `direct-tools.ts`, register `read_<sanitized>` tools when `exposeResources !== false`). Keep this task focused on discovery + pagination.

Reference adapter `server-manager.ts` lines ~490–520, ~950–1010.

**Steps:**
- [ ] Write failing test — a fake client returning two pages of tools (page 1 with `nextCursor`, page 2 without) yields all tools combined
- [ ] Run `pnpm exec vitest run` for the relevant test — must fail
- [ ] Implement pagination for tools/resources/prompts + capability checks + instructions
- [ ] Run tests — must pass
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Commit: `feat(mcp): resource/prompt discovery and pagination`

**Acceptance criteria:**
- [ ] Tools list is complete across multiple pages
- [ ] Resources/prompts discovered only when capability is advertised
- [ ] Server instructions captured
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 7: Lifecycle manager — idle shutdown and keep-alive

**Context:**
Connections currently live forever once opened. The adapter runs a 30s health-check interval that reconnects keep-alive servers and closes idle non-keep-alive servers past their `idleTimeout`. This is the resource-lifecycle layer that makes long sessions clean.

**Files:**
- Create: `packages/mcp/src/lifecycle.ts`
- Modify: `packages/mcp/src/index.ts` (start/stop the lifecycle manager)

**What to implement:**

`packages/mcp/src/lifecycle.ts`:

```typescript
import type { ServerManager } from "./server-manager.js";
import type { ServerDef } from "./types.js";

export class LifecycleManager {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private manager: ServerManager,
    private getDefs: () => Record<string, ServerDef>,
    private getGlobalIdleMinutes: () => number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 30_000);
    this.timer.unref?.(); // don't keep the process alive
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private tick(): void {
    const defs = this.getDefs();
    for (const client of this.manager.getClients()) {
      const def = defs[client.name];
      if (!def) continue;
      const lifecycle = def.lifecycle ?? "lazy";
      if (lifecycle === "keep-alive" || lifecycle === "lazy-keep-alive") {
        if (client.status === "disconnected") void client.connect().catch(() => {});
      } else {
        const idleMin = def.idleTimeout ?? this.getGlobalIdleMinutes();
        if (idleMin > 0 && this.manager.isIdle(client.name, idleMin * 60_000)) {
          void client.close();
        }
      }
    }
  }
}
```

In `index.ts`: create a module-level `LifecycleManager`, `start()` it in `session_start` after `manager.sync`, and `stop()` it in `session_shutdown` (alongside `closeAll`).

**Steps:**
- [ ] Write failing test `packages/mcp/src/lifecycle.test.ts` — with fake manager: keep-alive server that's disconnected gets `connect()` called on tick; lazy server past idle gets `close()` called; lazy server within idle is left alone
- [ ] Run `pnpm exec vitest run lifecycle` — must fail
- [ ] Create `lifecycle.ts`
- [ ] Run `pnpm exec vitest run lifecycle` — must pass
- [ ] Wire start/stop into `index.ts`
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Commit: `feat(mcp): lifecycle manager for idle shutdown and keep-alive`

**Acceptance criteria:**
- [ ] Keep-alive servers reconnect when down
- [ ] Idle non-keep-alive servers close past their timeout
- [ ] The interval is `unref`'d (doesn't block process exit)
- [ ] `stop()` clears the timer (no accumulation on `/reload`)
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 8: Config precedence completion and per-server settings

**Context:**
The current `config.ts` misses two precedence layers (`~/.agents/mcp.json`, `~/.agents/mcp/mcp.json`) and doesn't parse per-server settings or the credential/url-binding security rule. This task completes config to match the adapter's precedence and adds per-server setting resolution.

**Files:**
- Modify: `packages/mcp/src/config.ts`

**What to implement:**

1. Add the missing precedence layers. Final order (low → high):
   ```
   ~/.config/mcp/mcp.json
   ~/.agents/mcp.json
   ~/.agents/mcp/mcp.json
   <agentDir>/mcp.json
   <cwd>/.mcp.json
   <cwd>/.pi/mcp.json
   ```
2. Add credential/url-binding security to the merge: when a higher-precedence source changes a server's `url`, DROP inherited `auth`/`headers`/`bearerToken` fields (prevent sending credentials to a new endpoint). Define `URL_BOUND_AUTH_FIELDS`.
3. Add `stripJsonComments` support (JSON with `//` comments and trailing commas) so real-world configs parse. **Export `stripJsonComments`** (plan-027's config-write helpers reuse it).
4. Add a `resolveServerSettings(def, globalConfig)` helper that merges per-server settings over global defaults (lifecycle, idleTimeout, toolPrefix, directTools, includeTools/excludeTools).
5. **Refactor for disabled-server visibility:** extract the merge/precedence logic into `loadAllServerDefs(workingDir?): Record<string, ServerDef>` (returns ALL servers, disabled ones with their flag intact), and make `loadServerDefs = filter-out-disabled(loadAllServerDefs())`. Export BOTH. plan-027's `/mcp` status/enable/disable and the panel need `loadAllServerDefs` to see disabled servers.

Reference adapter `config.ts` lines ~350–510.

**Steps:**
- [ ] Write failing test `packages/mcp/src/config.test.ts` — precedence: higher layer overrides lower; url change drops inherited auth; JSON-with-comments parses; `resolveServerSettings` merges correctly; `loadAllServerDefs` includes a `{ disabled: true }` server while `loadServerDefs` excludes it
- [ ] Run `pnpm exec vitest run config` — must fail
- [ ] Implement the layers, security merge, comment stripping, settings resolution
- [ ] Run `pnpm exec vitest run config` — must pass
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Commit: `feat(mcp): complete config precedence and per-server settings`

**Acceptance criteria:**
- [ ] All six precedence layers load in correct order
- [ ] Changing a server's url drops inherited credentials
- [ ] JSON with comments/trailing commas parses (and `stripJsonComments` is exported)
- [ ] Per-server settings override global defaults
- [ ] `loadAllServerDefs` (exported) includes disabled servers; `loadServerDefs` excludes them
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 9: Wire everything together + register direct tools from cache

**Context:**
Final integration task. Update `index.ts` so direct tools register from the metadata cache at startup (not by connecting every server), the lifecycle manager runs, and the proxy tool uses cache-first resolution. This is what turns the individual pieces into the working reliability improvement.

**Files:**
- Modify: `packages/mcp/src/index.ts`
- Modify: `packages/mcp/src/direct-tools.ts`

**What to implement:**

1. In `session_start`: `manager.sync(defs)`, then register direct tools from `getCachedTools` for each server (no connect). For servers with no valid cache, do a one-time background probe (connect → discover → cache → register) via `Promise.allSettled` so first-run still populates.
2. **Dedup for cache-based registration:** the current `direct-tools.ts` dedups via `WeakMap<ServerClient, Set<string>>` keyed on the live client. Registering from cache has no live client, so switch the dedup to a module-level `Set<string>` keyed by the final prefixed tool name (or `Map<serverName, Set<toolName>>`). The executor must resolve the live client lazily AT CALL TIME via `manager.getClient(serverName)` → `connect()` → `callTool` — it can no longer close over a `client` instance.
3. Start the `LifecycleManager`.
4. The proxy `call` action: resolve the owning server via `resolveServerFromToolName` (pass each server's actual prefix mode) + cache, then lazily connect only that server.
5. `search`/`describe`/`list`: serve from cache (already done in Task 4, confirm wired).
6. Ensure `session_shutdown` stops lifecycle + closes all.

**Steps:**
- [ ] Update `index.ts` session_start: cache-first direct tool registration + background probe for uncached servers
- [ ] Update `direct-tools.ts` to register from `CachedTool[]` without a live client; switch dedup to a module-level `Set<string>` (prefixed name) or `Map<serverName, Set<toolName>>`; executor resolves the client lazily via `manager.getClient(serverName).connect()` at call time
- [ ] Verify proxy `call` uses `resolveServerFromToolName` (with per-server prefix modes) + lazy single-server connect
- [ ] Run `pnpm exec tsc --noEmit` + `pnpm exec vitest run` in `packages/mcp/` — must pass
- [ ] Manual test: restart pi, run `mcp({ search: "..." })` — confirm it returns results without connecting all servers (check no spawn storms); call a tool — confirm only its server connects
- [ ] Commit: `feat(mcp): cache-first startup and lazy per-tool connection`

**Acceptance criteria:**
- [ ] Direct tools register at startup from cache (no connect storm)
- [ ] First run (no cache) still populates via background probe
- [ ] `call` connects only the owning server
- [ ] Lifecycle manager runs and is torn down on shutdown
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 10: Type-check all packages, update docs and plan index

**Context:**
Final verification and documentation. Ensure the whole monorepo still type-checks, update the README settings table with the new `archimedes.mcp` options, and mark the plan.

**Files:**
- Modify: `README.md` (settings table for new mcp options)
- Modify: `docs/plans/README.md`

**Steps:**
- [ ] Run `pnpm exec tsc --noEmit` in all 11 package directories — fix any new errors
- [ ] Run `pnpm exec vitest run` at repo root — all tests pass
- [ ] Update `README.md` mcp settings table: `toolPrefix`, `idleTimeout`, `warnOnLargeDirectTools`, plus note per-server settings
- [ ] Update `docs/plans/README.md`: add plan-025
- [ ] Commit: `docs: document mcp core reliability settings`

**Acceptance criteria:**
- [ ] All 11 `tsc --noEmit` runs pass
- [ ] All tests pass
- [ ] README documents new settings
- [ ] Plan index updated
