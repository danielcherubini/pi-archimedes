# pi-mcp-adapter — Core Server + Config + Tool Subsystem

> **Date:** 2026-08-17
> **Source:** `/home/daniel/Coding/AI/pi-mcp-adapter/`
> **Purpose:** Gap analysis for the full port into `@pi-archimedes/mcp`

Full architecture map of the "official" `pi-mcp-adapter`, with file:line references and a gap analysis against `packages/mcp/src/` in pi-archimedes.

---

## 0. Big Picture

The adapter is built around **one registered proxy tool (`mcp`)** plus **optionally-registered direct tools**. The key architectural insight is that MCP tools are *not* registered with pi (to keep the LLM context small); instead everything routes through the `mcp` gateway tool, and a persistent **metadata cache** lets search/describe/list work *without live connections*.

```
config.ts ──► loads/merges McpConfig (mcpServers + settings)
     │
     ▼
McpServerManager (server-manager.ts) ── owns SDK Client + Transport per server
     │                                    ├─ stdio / streamableHTTP / SSE / unix-socket
     │                                    ├─ needs-auth / connected / closed status
     │                                    ├─ single-flight connect/reconnect/close (generation-fenced)
     │                                    └─ inFlight + lastUsedAt (idle tracking)
     ▼
McpLifecycleManager (lifecycle.ts) ── keep-alive reconnection + idle shutdown (health-check interval)
     ▼
metadata-cache.ts ── persistent ~/.pi/agent/mcp-cache.json (tools/resources/prompts/instructions + configHash)
     ▼
tool-metadata.ts / direct-tools.ts ── build prefixed ToolMetadata / DirectToolSpec from live or cached data
     ▼
proxy-modes.ts ── the mcp() gateway action dispatcher (status/search/describe/list/connect/call/auth/...)
```

Central mutable state is `McpExtensionState` (`state.ts`) — holds `manager`, `lifecycle`, `toolMetadata: Map<server, ToolMetadata[]>`, `config`, `failureTracker`, `serverInstructions`, etc.

---

## 1. Server Manager (`server-manager.ts`, 1129 lines)

`McpServerManager` keeps maps keyed by server name:
- `connections: Map<string, ServerConnection>`
- `connectPromises` / `reconnectPromises` / `closePromises` — **single-flight dedup**
- `closeGenerations: Map<string, number>` — monotonic counter to **fence** a connect that finished after a `close()`
- `connectAttempts: Map<string, AbortController>` — per-attempt abort

`ServerConnection`: `{ client, transport, definition, tools[], resources[], prompts[], instructions?, lastUsedAt, inFlight, status: "connected"|"closed"|"needs-auth" }`

### Transports
Exactly one of `command`/`url`/`socket`:
- **stdio** — `StdioClientTransport`; resolves `npx`/`npm` to real bin via `resolveNpxBinary`; captures **bounded 8 KiB / 3-line stderr tail** for diagnostics.
- **streamableHTTP** → **SSE fallback** — fallback only on definitive endpoint incompatibility (404/405/406/415).
- **unix socket** — hand-rolled JSONL transport over `node:net`.

### Lifecycle
- **Lazy by default.** `connect()` dedups, fences against `closeGenerations`.
- **HTTP auth state machine**: `disabled`/`implicit-deferred`/`explicit`/`implicit-challenged`. On 401 with OAuth support, returns `needs-auth` instead of throwing.
- **reconnect()** — single-flight, identity-guarded.
- **close()** — bumps generation, aborts in-flight, deletes from map before awaiting cleanup.
- Discovery on connect: `Promise.all([fetchAllTools, fetchAllResources, fetchAllPrompts])` — all paginate via `nextCursor`.
- **listChanged handlers** — refresh cached lists on server notifications.

### Keepalive/idle (`lifecycle.ts`)
30s health-check interval. Keep-alive servers reconnect if down; non-keep-alive servers close once idle beyond `idleTimeout` (default 10 min). Lifecycle modes: `keep-alive | lazy | lazy-keep-alive | eager`.

---

## 2. Config Loading (`config.ts`, 1226 lines)

### Precedence (low → high)
1. `~/.config/mcp/mcp.json`
2. `~/.agents/mcp.json` and `~/.agents/mcp/mcp.json`
3. `<agentDir>/mcp.json` (Pi global override)
4. `<cwd>/.mcp.json`
5. `<cwd>/.pi/mcp.json` (highest)

Host configs load as lowest-precedence fallback when `hostConfigDiscovery === "on"`.

### Host config discovery
Imports from `cursor`, `claude-code`, `claude-desktop`, `codex` (TOML), `opencode`, `windsurf`, `vscode`. Via explicit `imports: []` or global `hostConfigDiscovery: "on"`.

### Security: credential/url binding
`URL_BOUND_AUTH_FIELDS = [headers, bearerToken, bearerTokenEnv, requestHeadersCommand]` are **dropped** when the url changes — prevents credential exfiltration via per-field merge.

### Machinery
- `stripJsonComments` + trailing commas; TOML via `smol-toml`.
- Provenance tracking (which file owns each server).
- `writeProjectServerDisabledOverride`, `writeDirectToolsConfig`, atomic writes, unified-diff previews.
- Known-server presets + RepoPrompt auto-detection.

---

## 3. Proxy Modes (`proxy-modes.ts`, 1331 lines)

Dispatch precedence: **`action > tool(call) > connect > describe > instructions > search > server(list) > nothing(status)`**.

| Mode | Function | Notes |
|---|---|---|
| status | `executeStatus` | Per-server status, tool counts |
| search | `executeSearch` | Fuzzy ranking OR regex with ReDoS safety, pagination |
| describe | `executeDescribe` | Ambiguity handling, TS shape / schema |
| list | `executeList` | Cached-vs-live note |
| instructions | `executeInstructions` | Server instructions text |
| connect | `executeConnect` | reconnect vs connect, auto-auth |
| call | `executeCall` (~500 lines) | The monster — tool resolution + auto-auth ladder + recovery |
| auth-start | `executeAuthStart` | Manual OAuth URL |
| auth-complete | `executeAuthComplete` | Paste redirect/code |
| ui-messages | `executeUiMessages` | UI-session messages |

`executeCall` is big because: multi-stage tool resolution × auto-auth retry at each stage × resource/tool/UI result variants × rich error taxonomy. ~60% is auth + UI-session + recovery machinery.

---

## 4. Direct Tools (`direct-tools.ts`, 607 lines)

`resolveDirectTools` builds `DirectToolSpec[]` **from the cache** so tools register at startup without connecting. Filter: `true`/`string[]`/`false` from `definition.directTools` → `settings.directTools` → env override. `BUILTIN_NAMES` (read/bash/edit/write/grep/find/ls/mcp) skipped. Resources become `read_<name>` tools. Advisory at ≥75 tools.

---

## 5. Metadata Cache (`metadata-cache.ts`, ~380 lines) — THE KEY MECHANISM

- File: `<agentDir>/mcp-cache.json`, `CACHE_VERSION=1`, `CACHE_MAX_AGE_MS=7 days`.
- `computeServerHash` — SHA-256 over identity-affecting fields only (excludes runtime settings). Stable stringify (sorted keys).
- `reconstructToolMetadata` — rebuilds prefixed `ToolMetadata[]` from cache alone. Powers search/describe/list **offline**.
- `getMissingConfiguredDirectToolServers` — tells init which servers need a live probe.

**This enables zero-connection startup:** cache → reconstruct → tools available in search and as direct tools before any server connects.

---

## 6. Tool Prefixing (`types.ts`)

- `ToolPrefix` = `server | none | short | mcp` (default `server`).
- `sanitizeServerPrefix` — keeps `[A-Za-z0-9_-]`, replaces others with `_<hex>_`.
- `formatToolName`: `<prefix>_<toolName with . → _>`.
- `resolveServerFromToolName` — inverse lookup by longest matching prefix; undefined if ambiguous.
- Include/exclude via glob patterns.

---

## 7. Settings (`McpSettings`)

`toolPrefix`, `showStatusIcon`, `mcpFooterStatus`, `notifyOnStartupConnect`, `hostConfigDiscovery`, `agentPluginPaths`, `idleTimeout`, `requestTimeoutMs`, `directTools`, `warnOnLargeDirectTools`, `scriptMode`, `toolResultRendering`, `collapsedResultLines`, `approveTools`, `disableProxyTool`, `freezeDirectTools`, `autoAuth`, `sampling`, `elicitation`, `outputGuard`, `trace`, `authRequiredMessage`, `oauthDir`.

Per-server `ServerEntry` also: `lifecycle`, `idleTimeout`, `requestTimeoutMs`, `exposeResources`, `directTools`, `toolPrefix`, `includeTools`, `excludeTools`, `searchKeywords`, `approveTools`, `debug`, `trace`, `httpTransport`, `pluginDataDir`, `literalEnv`, `protocolVersion`, `disabled`.

---

## 8. Essential vs Over-Engineered

### Essential for a functional port
1. **Metadata cache** — the load-bearing feature. Highest-value missing piece.
2. **Single-flight + generation-fenced connect/close/reconnect**.
3. **Lazy connect + idle shutdown + keep-alive health check**.
4. **Tool prefixing + collision handling**.
5. **Config precedence + merge**.
6. **needs-auth as first-class connection status**.
7. **stderr tail capture** for stdio failures.
8. **npx/npm resolution**.

### Over-engineered / skippable (first port)
- OAuth 2.1 machinery (defer — but we WANT this per the port goal)
- UI/AppBridge subsystem (ui-server, app-bridge.bundle.js 295KB) — skip
- Sampling + elicitation handlers — optional
- JSONL protocol tracing
- requestHeadersCommand, searchKeywords, ReDoS-safe regex, renderTsShape
- Config write-back (provenance, presets, RepoPrompt) — nice for panel only
- Host-config import from 7 other agents — start with pi/project layers

---

## 9. What OUR Simple Versions Are Missing

Our `packages/mcp/src/` is ~950 lines vs the adapter's ~5000+ core lines.

### server-manager/server-client (ours: 57+179 lines)
- **No metadata cache** — tools only exist after live connect. We force-connect every server on search/describe/call.
- **No single-flight/generation fencing** for close/reconnect.
- **No idle shutdown / keep-alive / health check**.
- **No `needs-auth` status** — auth failures become generic error. No OAuth.
- **No reconnect/session-recovery** — expired HTTP session (404) is hard failure.
- **No stderr tail capture**, **no npx/npm resolution** (`npx -y foo` spawns npm parent).
- **No unix-socket transport**, **no protocolVersion**, **no requestTimeoutMs**, **no cwd**.
- **No resources or prompts** — only listTools.
- **No pagination** — ignore nextCursor, servers with >1 page truncated.
- **No listChanged handling**.

### config (ours: 71 lines)
- Miss `~/.agents/mcp.json` + `~/.agents/mcp/mcp.json`, host-config discovery, `imports: []`.
- **No credential/url-binding security merge** (landmine when HTTP auth arrives).
- No TOML (codex), no per-agent extraction.
- No provenance / write-back / disabled-override writer.
- No per-server settings (directTools, includeTools/excludeTools, toolPrefix, approveTools, idleTimeout, lifecycle).

### direct-tools (ours: 110 lines)
- Prefixing simpler & lossy (`_` vs `_<hex>_`); only `server` mode.
- No builtin-name collision guard, no include/exclude, no resource tools, no subset selection.
- Discards real input schema (`additionalProperties: true`).
- WeakMap-per-client re-registration is a clean idea the adapter doesn't need (registers once from cache).

### index.ts proxy (ours: 276 lines)
- Missing modes: instructions, auth-start/auth-complete, ui-messages, regex search, pagination, ambiguity handling, prefix-based lazy resolution, native-tool guard, output guard, approval gate.
- **Every non-status action force-connects all servers** — biggest behavioral gap.

### Recommended port priorities (in order)
1. **Metadata cache** — unlocks offline search/describe/direct-tools.
2. **lastUsedAt/inFlight + idle shutdown + keep-alive**.
3. **needs-auth status + generation-fenced close/reconnect + session recovery**.
4. **npx/npm resolution + stderr tail capture**.
5. **Full ToolPrefix modes + _<hex>_ sanitization + builtin-collision guard + include/exclude**.
6. **Resource + prompt discovery + pagination + listChanged**.
7. **OAuth** (per port goal — /mcp-auth, callback server, token storage).
8. Defer UI/AppBridge subsystem.
