# MCP Commands + Panels Plan (Phase 3 of the pi-mcp-adapter port)

**Goal:** Add the `/mcp` command with all subcommands (status, tools, prompts, reconnect, enable, disable, logout, auth, panel, setup) and two interactive panels — the **management panel** (`/mcp panel`: toggle direct tools, reconnect, authenticate) and the **setup panel** (`/mcp setup`: scaffold config, import host configs). This completes the port to feature parity with `pi-mcp-adapter` (minus the deliberately-dropped UI/AppBridge subsystem).

**Architecture:** Builds on plan-025 (server manager, metadata cache, config) and plan-026 (`/mcp-auth`, OAuth, `deleteAuthEntry`). The `/mcp` command dispatches on a raw-string first arg. Both panels use the **shared pi-archimedes overlay chrome** (`@pi-archimedes/core/overlay`) and the mode-based `string[]` render pattern of `/agents` and `/archimedes` — NOT generic pi-tui components (see ADR 0003). Config write-back of FIELD CHANGES targets `.pi/mcp.json` (ADR 0002); `/mcp setup` new server *definitions* target the project-shared `.mcp.json` (Task 4).

**Tech Stack:** `@earendil-works/pi-coding-agent` (`registerCommand`, `ui.custom`, `CONFIG_DIR_NAME`), `@pi-archimedes/core/overlay` (`OVERLAY_CHROME`, `renderHeader`, `renderFooter`, `wrapWithBorder`, `borderContentWidth`, `hardTruncate`, `padEnd`, `visibleWidth`), plan-025/026 modules.

**Reference research:** `docs/research/pi-mcp-adapter-commands-tui.md`. **ADRs:** 0002 (write-back), 0003 (panel chrome), 0004 (persisted connection outcome), 0005 (in-panel auth UX) — in `docs/decisions/`. Source: adapter `commands.ts`, `mcp-panel.ts`, `mcp-setup-panel.ts`, `config.ts`. **Design reference to mirror:** `packages/subagent/src/agent-manager.ts` (the `/agents` panel — same chrome, mode state machine, `string[]` render, bracket-hint footers).

**Prerequisites:** plan-025 AND plan-026 merged first.

> **NOTE for plan-025:** plan-025 Task 8 (`config.ts`) must also export `loadAllServerDefs(workingDir?): Record<string, ServerDef>` — identical to `loadServerDefs` but WITHOUT the `disabled` filter (returns disabled servers with their flag). This plan depends on it (see Task 0). If plan-025 has already been executed without it, add it as a prerequisite fix before starting this plan.

**Design decisions (locked via discussion — see ADRs 0002–0005 in `docs/decisions/`):**
- **Panels use the shared overlay chrome** and mode-based `string[]` rendering (ADR 0003) — mirror `agent-manager.ts`, do NOT use `SelectList`/`DynamicBorder`.
- **Filter is a self-managed string** in `handleInput` (printable capture + backspace), like `agent-manager`'s `[/] search`. No embedded Input, no Focusable.
- **Config write-back (field changes to *existing* servers: `disabled`, `directTools`) always targets `.pi/mcp.json`** via `CONFIG_DIR_NAME`, only the changed field (ADR 0002). New server *definitions* written by `/mcp setup` (Task 4) target the project-shared `.mcp.json` instead — out of ADR 0002's scope; see its Consequences.
- **Host import: JSON-only** — Cursor, Claude Code, Claude Desktop, VSCode. Codex/TOML deferred.
- **`/mcp` is the ONLY command family** — plan-026's standalone `/mcp-auth` + `/mcp-logout` are RETIRED in Task 2: their logic is extracted into shared fns (`runMcpAuthCommand`, `mcpLogoutServer`) called from `/mcp auth` / `/mcp logout` and the panel. The panel is the single home for INTERACTIVE actions (auth `[a]`/`enter`, enable/disable `[e]`, logout `[l]`, reconnect `[r]`, save `ctrl+s`); text subcommands that stay (`status`/`tools`/`prompts`) exist for LLM-visible, scriptable output.
- **Included extras:** `/mcp prompts` (name+description list). **Dropped:** status footer indicator, 60s inactivity auto-close, discard-confirm dialog (Esc just closes; unsaved toggles are lost — quick to re-open).

**Deliberately dropped (do NOT port):** UI/AppBridge iframe subsystem, JSONL tracing, `requestHeadersCommand`, sampling/elicitation, rainbow progress bar (use `N/M`), fuzzy scoring (substring match), provenance-based write-back, Codex TOML import, status footer, inactivity auto-close, discard-confirm.

**Panel chrome quick-reference (from `@pi-archimedes/core/overlay`, used by agent-manager.ts):**
- Open: `ctx.ui.custom(fn, { overlay: true, overlayOptions: OVERLAY_CHROME })` — centered, width 84, maxHeight 80%.
- Component MUST implement the pi-tui `Component` interface: `render(width): string[]`, `invalidate(): void` (REQUIRED by the interface), and `handleInput(data): void` (optional in the interface but needed here). `agent-manager.ts` also implements `dispose()` — follow it. Omitting `invalidate()` fails `tsc` against `ui.custom`'s return type.
- Build lines: `renderHeader(" Title [N] ", width, theme)` first, body lines, `renderFooter(" [key] action  [esc] close ", width, theme)` last, then `return wrapWithBorder(lines, width, theme)`.

**Disabled-server access:** `loadServerDefs()` FILTERS OUT disabled servers. The `/mcp` status/enable/disable subcommands and the panel need to SEE disabled servers. plan-025 Task 8 must be extended (see this plan's Task 0) to also export `loadAllServerDefs()` which returns ALL servers including disabled ones (with the `disabled` flag intact). `deps.getServerDefs` points at `loadAllServerDefs`, and callers compute the `disabled` status from the flag.
- Inner content width: `borderContentWidth(width)`. Truncate long lines: `hardTruncate(line, contentWidth)`. Pad: `padEnd(text, width)`.

---

### Task 0: Prerequisite verification

**Context:**
This plan depends on two exports that plan-025 Task 8 adds to `config.ts`: `loadAllServerDefs` (unfiltered — includes disabled servers) and `stripJsonComments`. Verify they exist before starting; if plan-025 was executed before its Task 8 was updated with these, add them now.

**Files:**
- Verify (or modify): `packages/mcp/src/config.ts`

**Steps:**
- [ ] Confirm `config.ts` exports `loadAllServerDefs(workingDir?): Record<string, ServerDef>` (returns disabled servers with the flag) and `stripJsonComments`. Both are specified in plan-025 Task 8.
- [ ] If either is missing: add per plan-025 Task 8 item 5 (`loadServerDefs = filter-out-disabled(loadAllServerDefs())`, export both) and export `stripJsonComments`; extend `config.test.ts` accordingly; run `pnpm exec vitest run config` + `pnpm exec tsc --noEmit`
- [ ] Commit only if changes were needed: `feat(mcp): ensure loadAllServerDefs + stripJsonComments exports`

**Acceptance criteria:**
- [ ] `loadAllServerDefs` (includes disabled) and `stripJsonComments` are exported from `config.ts`

---

### Task 1: Config write-back helpers

**Context:**
The `/mcp` command (enable/disable) and the management panel (direct-tools save) both write config changes back. Per ADR 0002 all writes go to the project-local `.pi/mcp.json` override, only the changed field, never copying credentials. This is built FIRST so the command dispatcher (Task 2) and panel (Task 3) import it cleanly — no inlining/refactor churn.

**Files:**
- Create: `packages/mcp/src/config-write.ts`

**What to implement:**

```typescript
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
/** Write only { disabled } for a server into <cwd>/<CONFIG_DIR_NAME>/mcp.json. Never copies credentials. */
export function writeServerDisabled(cwd: string, serverName: string, disabled: boolean): void;
/** Write only { directTools } for a server into the same file. */
export function writeServerDirectTools(cwd: string, serverName: string, value: true | false | string[]): void;
```

Details:
- Target file: `join(cwd, CONFIG_DIR_NAME, "mcp.json")` (create the dir + file if missing). `CONFIG_DIR_NAME` from `@earendil-works/pi-coding-agent` (do NOT hardcode `.pi` — rebranded distros).
- Read-modify-write: parse existing JSON (support `//` comments + trailing commas — reuse the `stripJsonComments` helper added by plan-025 Task 8 in `config.ts`; export it from there if it isn't already exported); set only the one field under `mcpServers[serverName]` (create the nested objects if absent); write atomically (tmp + rename); 2-space indent.
- `directTools` value type is `boolean | string[]` (from `SharedServerSettings`, plan-025 Task 1).
- Never read other config layers; only touch the one field in this one file.

**Steps:**
- [ ] Write failing test `packages/mcp/src/config-write.test.ts` — on a temp cwd, `writeServerDisabled(cwd, "x", true)` creates `<cwd>/<CONFIG_DIR_NAME>/mcp.json` (build the expected path from the imported `CONFIG_DIR_NAME` constant — never hardcode `.pi` in the assertion) with `{ mcpServers: { x: { disabled: true } } }`; a second `writeServerDirectTools(cwd, "x", ["a"])` merges to `{ disabled: true, directTools: ["a"] }` without clobbering; writing a different server preserves the first
- [ ] Run `pnpm exec vitest run config-write` — must fail
- [ ] Create `config-write.ts`
- [ ] Run `pnpm exec vitest run config-write` — must pass
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Commit: `feat(mcp): safe config write-back helpers`

**Acceptance criteria:**
- [ ] Writes target only the Pi override file and only the changed field
- [ ] Existing content preserved across writes; comments tolerated on read
- [ ] No credential copying
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 2: /mcp command dispatcher with text subcommands

**Context:**
The `/mcp` command routes to subcommands. Text-output subcommands (status, tools, prompts, reconnect, enable, disable, logout, auth) land here; panel/setup subcommands are stubbed to "coming next" and implemented in Tasks 3–4. Uses the Task 1 write-back helpers for enable/disable.

**Files:**
- Create: `packages/mcp/src/commands.ts`
- Modify: `packages/mcp/src/index.ts` (register `/mcp`; REMOVE the plan-026 `/mcp-auth` + `/mcp-logout` registrations)
- Modify: `packages/mcp/src/commands-auth.ts` (drop both `registerCommand` calls; export the shared handlers `runMcpAuthCommand(args, ctx, { getServerDef, getManager })` — unchanged BorderedLoader body — and `mcpLogoutServer(name, getManager): { ok: boolean; error?: string }` (deleteAuthEntry + close managed client)

**What to implement:**

`registerMcpCommand(pi, deps)` registers `/mcp` and dispatches on the first whitespace-split token of the raw args string. `deps` (defined against ACTUAL plan-025/026 exports):
```typescript
interface McpCommandDeps {
  getManager: () => ServerManager;                 // module-level singleton via getter in index.ts
  getServerDefs: () => Record<string, ServerDef>;  // loadAllServerDefs() — INCLUDES disabled servers (Task 0)
  getCachedTools: (serverName: string, def: ServerDef) => CachedTool[] | undefined; // metadata-cache (plan-025)
  getCachedPrompts: (serverName: string, def: ServerDef) => Array<{ name: string; description?: string }> | undefined; // NEW helper mirroring getCachedTools (reuses isServerCacheValid)
}
```

Deliberately NOT in deps: `authenticate` / `deleteAuthEntry` / `extractOAuthConfig` / `loadMetadataCache` — no text subcommand needs them (`/mcp auth` delegates to `runMcpAuthCommand`; the shared logout fn imports `deleteAuthEntry` itself; `extractOAuthConfig` is pure — direct import where needed; prompts come from `getCachedPrompts`). `runMcpAuthCommand`'s `getServerDef` (http-only single-server lookup) is NOT injected either — the call site derives it: `const d = deps.getServerDefs()[name]; return d !== undefined && isHttpDef(d) ? d : undefined;` (mirrors the current `index.ts` registration; stays test-injectable through `getServerDefs`).
```

| Subcommand | Behavior |
|---|---|
| `/mcp` / `/mcp status` | Per-server status: name, state (connected/cached/needs-auth/disabled/error), tool count — `needs-auth`/`error` surface across sessions from the PERSISTED connection outcome (ADR 0004), timestamped when stale. "run /mcp setup" if none. |
| `/mcp tools [server]` | Tools from cache (`getCachedTools`) per server or one server. |
| `/mcp prompts [server]` | Prompts from cache — **name + description only** (cache limitation; no slash-command registration). |
| `/mcp reconnect [server]` | Reconnect one or all; `recordServerOutcome` on settle (ADR 0004); on `needs-auth`, say "run /mcp auth <server>". |
| `/mcp enable <server>` | `writeServerDisabled(cwd, name, false)`; notify to `/reload`. |
| `/mcp disable <server>` | `writeServerDisabled(cwd, name, true)`; close connection; notify to `/reload`. |
| `/mcp logout <server>` | Shared `mcpLogoutServer(name)` (deleteAuthEntry + close managed client, `{ ok, error? }` result) — the same fn the panel's `[l]` uses (Task 3). |
| `/mcp auth <server>` | Delegates to the extracted `runMcpAuthCommand` (same BorderedLoader UX the former `/mcp-auth` had — its registration is REMOVED in this task). |
| `/mcp panel` | Stub → notify "coming in a later task" (Task 3 wires it). |
| `/mcp setup` | Stub → notify (Task 4 wires it). |

**ADR 0004 — persist last connection outcome:** additive `serverStatuses?: Record<string, { status: "connected" | "needs-auth" | "error"; error?: string; at: number }>` on the `MetadataCache` type in **`types.ts`** + a single recorder `recordServerOutcome(serverName, status, error?)` in `metadata-cache.ts`. A missing key means "not verified" — back-compatible, so NO `CACHE_VERSION` bump. **Round-trip requirement (data-loss trap):** `loadMetadataCache` currently reconstructs only `{ version, servers }` and silently drops every other top-level field; `saveServerCache` is load → mutate → full rewrite and runs on EVERY successful connect — so without a fix it would ERASE `serverStatuses` on the next tool-cache write. Update `loadMetadataCache`/`saveServerCache` to preserve the map (spread the parsed object; neither writer may drop the other's field) + a regression test asserting a `saveServerCache` after `recordServerOutcome` (and vice versa) preserves both fields. Call the recorder at EVERY settle point: the `session_start` background probe's success / needs-auth / catch branches, the proxy `p.connect` action, the proxy `p.tool` lazy `await client.connect()`, the direct-tool `resolveClient` connect, the `reconnect` subcommand, and (Task 3) the panel's `r` / auth paths — all through the same fn.

Extract a pure `parseMcpSubcommand(args: string): { subcommand: string; rest: string[] }` for testing.

Status formatting: reference adapter `commands.ts:20–105`.

In `index.ts`: expose `manager` via a getter; register `/mcp`; **remove** the plan-026 `/mcp-auth` + `/mcp-logout` registrations (post-change command registry: `mcp` only), routing both through the shared fns (acceptance: `/mcp auth X` and `/mcp logout X` behave identically to the removed standalone commands). Sweep user-facing guidance `/mcp-auth <server>` → `/mcp auth <server>`: `server-client.ts` `NEEDS_AUTH_MESSAGE`, `auto-auth.ts` `needsAuthToolResult` (LLM/user-visible text), repo-root `CONTEXT.md` glossary (`needs-auth` → "Resolved by `/mcp auth` … panel", `callback server` → "during `/mcp auth` …"), plus doc comments in `auth-flow.ts` / `auth-run.ts` / `commands-auth.ts` and every test asserting those strings.

**Steps:**
- [ ] Write failing test `packages/mcp/src/commands.test.ts` — `parseMcpSubcommand("status")` → `{ subcommand: "status", rest: [] }`; `("reconnect foo")` → `{ "reconnect", ["foo"] }`; `("")` → `{ "status", [] }` (default)
- [ ] Run `pnpm exec vitest run commands` — must fail
- [ ] Add `getCachedPrompts(serverName, def)` to `metadata-cache.ts` (mirrors `getCachedTools`; reuses `isServerCacheValid`) + test
- [ ] ADR 0004: add `serverStatuses` to the `MetadataCache` type in `types.ts` + the `recordServerOutcome` recorder in `metadata-cache.ts` (additive, no version bump; update `loadMetadataCache`/`saveServerCache` to round-trip it) + regression tests; wire the recorder at ALL `index.ts` settle points (probe success/needs-auth/catch, `p.connect`, `p.tool` lazy connect, `resolveClient` connect) and in the `reconnect` subcommand
- [ ] Create `commands.ts` (dispatcher + text subcommands; uses Task 1 helpers + the shared auth/logout fns)
- [ ] Run `pnpm exec vitest run commands` — must pass
- [ ] Wire into `index.ts`; remove the `/mcp-auth` + `/mcp-logout` registrations (command registry: `mcp` only)
- [ ] Port `commands-auth.test.ts` → `runMcpAuthCommand` / `mcpLogoutServer` tests (same expectations; loader stub as today); update the `index.test.ts` auth-wiring test (registry `["mcp"]` only, no `mcp-auth`/`mcp-logout`)
- [ ] Sweep the `/mcp-auth <server>` guidance strings → `/mcp auth <server>` and fix the string-asserting tests
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Manual test: `/mcp status` (incl. a needs-auth server after a fresh session restart — ADR 0004), `/mcp tools`, `/mcp auth X` (loader UX unchanged), `/mcp disable X` + `/reload` (gone), `/mcp enable X` + `/reload` (back), `/mcp logout X`
- [ ] Commit: `feat(mcp): /mcp command dispatcher with text subcommands`

**Acceptance criteria:**
- [ ] All text subcommands work; `parseMcpSubcommand` tested
- [ ] Command registry contains ONLY `/mcp` (standalone `/mcp-auth` + `/mcp-logout` removed)
- [ ] enable/disable write only `disabled` to `.pi/mcp.json`
- [ ] `/mcp auth X` == the removed `/mcp-auth X`; `/mcp logout X` == the removed `/mcp-logout X`
- [ ] A `needs-auth` outcome from a previous session is visible in `/mcp status` (ADR 0004), timestamped when stale
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 3: Management panel (shared overlay chrome)

**Context:**
`/mcp panel` is the single INTERACTIVE management surface: browse servers, expand to see tools, toggle direct tools, and per-server actions — in-panel auth (ADR 0005), reconnect, enable/disable (`[e]`), logout (`[l]`). It uses the shared pi-archimedes overlay chrome and mode-based `string[]` rendering (ADR 0003), mirroring `packages/subagent/src/agent-manager.ts`. Filter is a self-managed string. No status footer, no inactivity close, no discard-confirm (Esc closes; unsaved toggles lost).

**Files:**
- Create: `packages/mcp/src/panel.ts`

**What to implement:**

Read `packages/subagent/src/agent-manager.ts` FIRST to copy the structure: the `Component` shape (`render(width): string[]` + `handleInput(data)`), the mode state machine, and the `renderHeader`/`renderFooter`/`wrapWithBorder` usage.

State:
```typescript
interface ServerRow {
  name: string;
  expanded: boolean;
  status: "connected" | "cached" | "needs-auth" | "disabled" | "error";
  failureMessage?: string;
  statusAt?: number; // ADR 0004: persisted-outcome timestamp for the "(2d ago)" display
  tools: ToolRow[];
  hasCachedData: boolean;
}
interface ToolRow { name: string; description: string; isDirect: boolean; wasDirect: boolean; }
// plus panel-level state (mirror agent-manager's shape): cursor: number; filter: string; filterMode: boolean;
// authing: { serverName: string } | null;  changedServers: Set<string>  // ctrl+s dirty tracking: isDirect != wasDirect
```

```typescript
interface McpPanelDeps {
  getServerDefs: () => Record<string, ServerDef>;              // includes disabled (Task 0)
  getCachedTools: (serverName: string, def: ServerDef) => CachedTool[] | undefined;
  getManager: () => ServerManager;                              // live clients: auth (ADR 0005), reconnect, status
}
```

Everything else is a DIRECT import, not injected: `writeServerDirectTools` (Task 1; `ctx.cwd` from the panel closure), `extractOAuthConfig`, `openAuthUrl`, `reconnectAfterAuth`, `resolveServerSettings`/`loadMcpConfig` (seed `wasDirect`), `recordServerOutcome` (ADR 0004).

`openMcpPanel(pi, ctx, deps)`:
1. Guard `if (!ctx.hasUI) { ctx.ui.notify("…requires interactive TUI"); return; }`.
2. Build `ServerRow[]` from `deps.getServerDefs()` (INCLUDES disabled servers — Task 0) + cache (`getCachedTools`) + live status (`manager.getClient(name)?.status`) — LIVE wins when present, else the persisted outcome (`MetadataCache.serverStatuses`, ADR 0004; `statusAt` populated for the "(2d ago)" suffix). A server with `def.disabled === true` gets `status: "disabled"`. `wasDirect`/`isDirect` seeded from the resolved per-server `directTools` setting (`boolean | string[]` on `SharedServerSettings`, plan-025 Task 1).
3. `await ctx.ui.custom<void>((tui, theme, _kb, done) => makeMcpPanel(...), { overlay: true, overlayOptions: OVERLAY_CHROME })`.

Rendering (`render(width)`), building `string[]` then `wrapWithBorder`:
- `renderHeader(\` MCP Servers [${rows.length}] \`, width, theme)`.
- If filtering, a line showing the current filter (e.g. `theme.fg("dim", \` / ${filter}\`)`).
- A flat list of **visible rows** (servers + tools of expanded servers), cursor-highlighted (`theme.fg("accent", ...)` on the selected row):
  - Server row: expand caret `▸`/`▾` + status glyph (● connected→`success`, ○ cached→`dim`, ⚠ needs-auth→`warning`, ✗ error→`error`, ⊘ disabled→`dim`) + name (`accent`) + `(N/M tools)` count. Truncate with `hardTruncate(line, borderContentWidth(width))`.
  - Tool row (expanded server): indented `●`/`○` direct-toggle + tool name + `theme.fg("dim", description)`.
- `renderFooter(" [↑/↓] move  [space] toggle  [enter] expand/auth  [a] auth  [e] en/dis  [l] logout  [r] reconnect  [/] search  [ctrl+s] save  [esc] close ", width, theme)` — at width 84 the full string overflows the 80-char content width, so implement as TWO pre-split `renderFooter` lines (`renderFooter` does NOT wrap — pre-split the hint text into two `renderFooter` lines when it would overflow `borderContentWidth(width)`, else one line).

`handleInput(data)`:
- `↑`/`↓`: move cursor across visible rows (rebuild visible list on expand/collapse).
- `space`: toggle direct status of the selected server (all its tools) or the selected tool; mark dirty. While `filter` is being typed, `space` is captured into `filter` as a character (NOT a toggle) — it is in agent-manager's printable set.
- `enter`: on a `needs-auth` server → IN-PANEL AUTH ONLY (no expand; mirrors the adapter) — ADR 0005; do NOT reuse `runAuthWithLoader`. Else expand/collapse the selected server. Auth flow: if `extractOAuthConfig(def.auth)` is null → transient error line "not configured for OAuth"; else enter the `authing` substate (all other keys ignored), render a transient line `Authenticating <name>… (esc to cancel)`, run `client.authenticate({ onAuthorizationUrl, signal })` — on URL: `openAuthUrl(url)` + `ctx.ui.notify` full URL (parity with the command path); `esc` → `controller.abort()` (surfaces as a cancellation, NOT an error); on success `reconnectAfterAuth(client)` → `reconnected`: refresh row status + rebuild its tools + success line (`reconnect-failed`/flow-error → error line); exit `authing` when settled; `ctrl+c` during `authing` aborts AND closes the panel; `recordServerOutcome` on the settle (ADR 0004).
- `/`: begin filter mode (or just always-append — mirror agent-manager: printable chars append to `filter`, `backspace` edits). Filter narrows visible rows by substring over name+description.
- `e` (server rows only): toggle enable — disabled → `writeServerDisabled(ctx.cwd, name, false)`; enabled → `writeServerDisabled(ctx.cwd, name, true)` + `client.close()`; refresh row + notify `/reload to apply` (identical semantics to `/mcp enable|disable`).
- `l` (server rows only): shared `mcpLogoutServer(name)` (Task 2) → refresh row (`needs-auth` → cached/not-authed) + transient line with the result.
- `a` (server rows only, **normal mode**): in-panel auth — same flow as `enter` on a needs-auth row (ADR 0005). Action keys `a`/`r`/`e`/`l` are INERT while `filter` is being typed (printables are captured into `filter` — agent-manager semantics).
- `r` (server rows only, normal mode): reconnect the selected server (`manager.getClient(name)?.close()` then `.connect()`), rebuild its tools, `recordServerOutcome` (ADR 0004).
- `ctrl+s`: compute per-server selection (`true` all / `false` none / `string[]` subset) from `isDirect` states, call `writeServerDirectTools(ctx.cwd, name, value)` (direct import) for each changed server, notify "/reload to apply", `done()`.
- `esc` / `ctrl+c`: `done()` (discard — no confirm).
- `tui.requestRender()` after state changes.

Extract pure helpers for testing: `buildVisibleRows(servers)`, `toggleTool(row)`, `computeSelection(toolRows): true | false | string[]`, `filterRows(servers, query)`.

Wire `openMcpPanel` into the `/mcp panel` stub in `commands.ts`.

**Steps:**
- [ ] Read `agent-manager.ts` to mirror the chrome + mode + render structure
- [ ] Write failing test `packages/mcp/src/panel.test.ts` — pure helpers: `buildVisibleRows` (collapsed shows only servers; expanded interleaves tools); `computeSelection` returns `true`/`false`/`string[]` correctly; `filterRows` substring-narrows; toggling flips `isDirect`
- [ ] Run `pnpm exec vitest run panel` — must fail
- [ ] Create `panel.ts` (helpers + overlay component using shared chrome)
- [ ] Run `pnpm exec vitest run panel` — must pass
- [ ] Wire `openMcpPanel` into `/mcp panel` in `commands.ts`
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Manual test: `/mcp panel` — looks identical in chrome to `/agents`; expand a server, toggle a tool, `ctrl+s`, `/reload`, confirm the direct-tool set changed; in-panel auth on a needs-auth server (URL line, `esc` cancels cleanly, success → row `connected` + tools); `[e]` flips a server's flag (`/reload` applies); `[l]` logs out a needs-auth server
- [ ] Commit: `feat(mcp): management panel using shared overlay chrome`

**Acceptance criteria:**
- [ ] Panel uses `OVERLAY_CHROME` + `renderHeader`/`renderFooter`/`wrapWithBorder` — visually matches `/agents`
- [ ] Expand/collapse, toggle, substring filter work; cursor navigation correct
- [ ] `ctrl+s` writes per-server `directTools` to `.pi/mcp.json`
- [ ] In-panel auth (ADR 0005): `esc` cancels without error, success updates row + tools, plumbing-only reuse (`client.authenticate`/`openAuthUrl`/`reconnectAfterAuth`)
- [ ] `[e]` enable/disable + `[l]` logout behave exactly like the command equivalents
- [ ] Pure-helper tests pass, `npx tsc --noEmit` clean

---

### Task 4: Setup panel + host-config discovery (shared overlay chrome)

**Context:**
`/mcp setup` helps users with nothing configured, or who have MCP servers in another tool (Cursor, Claude Code, Claude Desktop, VSCode). It scaffolds a minimal `.mcp.json`, offers curated known servers, and imports host configs with a preview. Same shared overlay chrome as the management panel.

**Files:**
- Create: `packages/mcp/src/host-configs.ts`
- Create: `packages/mcp/src/setup-panel.ts`
- Modify: `packages/mcp/src/config-write.ts` (add `mergeServerDefinitions` + test)
- Modify: `packages/mcp/src/commands.ts` (wire `/mcp setup`)

**What to implement:**

`packages/mcp/src/host-configs.ts` — JSON-only discovery (ADR/discussion decision). Correct reference paths:
```typescript
export interface HostConfig {
  agent: "cursor" | "claude-code" | "claude-desktop" | "vscode";
  path: string;
  servers: Record<string, ServerDef>;
}
export function discoverHostConfigs(cwd: string): HostConfig[];
```
Paths (use `os.homedir()`):
- Cursor: `~/.cursor/mcp.json` (+ project `.cursor/mcp.json`) — key `mcpServers`.
- Claude Code: `~/.claude/mcp.json`, `~/.claude.json` — key `mcpServers`.
- Claude Desktop: `~/.claude/claude_desktop_config.json` — key `mcpServers`.
- VSCode: `<cwd>/.vscode/mcp.json` — top-level key `servers` (per VSCode docs, VSCode deliberately uses `servers`, NOT `mcpServers`; verified 2026-08-19 against https://code.visualstudio.com/docs/agents/reference/mcp-configuration). **Do NOT copy the adapter's `extractServers` for the vscode case — it is outdated and reads `mcpServers`, which would import zero VSCode servers.**
Cursor/Claude extraction CAN mirror the adapter (`config.ts:724–801`, they use `mcpServers`). Skip files that don't exist or don't parse. Do NOT include `~/.config/mcp/mcp.json` (that's pi's own layer — self-import loop).

`packages/mcp/src/setup-panel.ts` — mode-based overlay using the shared chrome (mirror agent-manager modes):
- Mode `menu` (entry): options — "Scaffold minimal .mcp.json", "Add a known server", "Import from another tool", "Cancel". Rendered as a cursor-selectable list via the shared chrome.
- Mode `import`: checklist of `discoverHostConfigs(ctx.cwd)` results (`[x] cursor  ~/.cursor/mcp.json`); space toggles; enter shows a **preview** (the servers to be added, listed) then confirm writes them to `<cwd>/.mcp.json` (project shared) via a small merge-write (only add servers not already present).
- Mode `known`: curated list (deepwiki, context7, chrome-devtools, etc. — a small hardcoded array of `{ name, def }`); enter writes the entry to `.mcp.json`.
- Footer hints per mode (bracket style). `esc` backs out a mode / closes.
- Guard `ctx.hasUI`.

Writes to `.mcp.json` (project shared, NOT the Pi override — new server definitions belong in the shared file) via the explicit helper `mergeServerDefinitions(cwd, servers: Record<string, ServerDef>)` in `config-write.ts`: target `join(cwd, ".mcp.json")` (**NOT** `CONFIG_DIR_NAME`), per-server **add-if-absent** (existing entries untouched), atomic tmp+rename, 2-space indent; reads tolerate comments (`stripJsonComments`) — accepted trade-off: the rewrite drops comments in the shared file (machine-managed scaffold/import file; documented). Show the preview (server list) before writing — a plain list, not a unified diff.

**Steps:**
- [ ] Write failing tests for `mergeServerDefinitions` in `config-write.test.ts` — creates a fresh `.mcp.json`; merging server B preserves server A's entry; an EXISTING entry is not overwritten (add-if-absent);
- [ ] Implement `mergeServerDefinitions` in `config-write.ts`; `pnpm exec vitest run config-write` passes
- [ ] Write failing test `packages/mcp/src/host-configs.test.ts` — point `HOME` at a temp dir with a `~/.cursor/mcp.json`; `discoverHostConfigs` finds it and extracts servers; returns `[]` when nothing exists; ignores malformed JSON
- [ ] Run `pnpm exec vitest run host-configs` — must fail
- [ ] Create `host-configs.ts`
- [ ] Run `pnpm exec vitest run host-configs` — must pass
- [ ] Create `setup-panel.ts` (modes + overlay using shared chrome)
- [ ] Wire `/mcp setup` in `commands.ts`
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Manual test: with a Cursor/Claude config present, `/mcp setup` → Import → select → preview → write → `/reload` → servers appear
- [ ] Commit: `feat(mcp): setup panel with host-config import`

**Acceptance criteria:**
- [ ] `discoverHostConfigs` finds + extracts JSON host configs (correct paths, no self-import)
- [ ] Setup panel scaffolds `.mcp.json` and imports selected host configs with a preview
- [ ] Uses the shared overlay chrome (matches `/agents`)
- [ ] Writes are atomic, to `.mcp.json`, add-if-absent tested
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 5: Final integration, type-check all packages, docs, plan index

**Context:**
Final verification and documentation for the completed port. Ensure the whole monorepo type-checks and all tests pass, document the full `/mcp` surface and all settings, mark the port complete.

**Files:**
- Modify: `README.md`, `AGENTS.md`, `docs/plans/README.md`

**Steps:**
- [ ] Run `pnpm exec tsc --noEmit` in all 10 `packages/*` dirs plus `meta` (11 runs) — fix any new errors
- [ ] Run `pnpm exec vitest run` at repo root — all tests pass
- [ ] Update `README.md`: document `/mcp` as the ONLY command family (subcommands status/tools/prompts/reconnect/enable/disable/logout/auth/panel/setup) and **REWRITE the README OAuth section that currently presents `/mcp-auth`/`/mcp-logout` as the primary surface** — standalones retired; the documented paths are `/mcp auth`, in-panel `[a]`/`enter`, `autoAuth`, and the README's command list throughout, all `archimedes.mcp` settings (directTools, collapsedResultLines, toolPrefix, idleTimeout, warnOnLargeDirectTools, autoAuth), the `auth` config field, per-server settings, and both write-back targets: field changes to `.pi/mcp.json` (ADR 0002) and the setup panel's new-definition target `.mcp.json`
- [ ] Update `AGENTS.md` mcp entry to reflect full-adapter status
- [ ] Update `docs/plans/README.md`: mark plan-026 + plan-027
- [ ] Commit: `docs: document full mcp adapter (commands, panels, settings)`

**Acceptance criteria:**
- [ ] All 11 `tsc --noEmit` runs pass
- [ ] All tests pass
- [ ] README fully documents the mcp package
- [ ] Plan index updated
- [ ] Port has reached feature parity with pi-mcp-adapter (minus dropped UI/AppBridge and the documented simplifications)
