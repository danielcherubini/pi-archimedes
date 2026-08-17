# MCP Commands + Panels Plan (Phase 3 of the pi-mcp-adapter port)

**Goal:** Add the `/mcp` command with all subcommands (status, tools, prompts, reconnect, enable, disable, logout, panel, setup) and two interactive TUI panels: the **management panel** (`/mcp panel` — toggle which tools are exposed as direct tools, reconnect, authenticate) and the **setup panel** (`/mcp setup` — scaffold config, import host configs from Cursor/Claude Code/Codex). This completes the port to feature parity with `pi-mcp-adapter` (minus the deliberately-dropped UI/AppBridge subsystem).

**Architecture:** Builds on plan-025 (server manager, cache, config) and plan-026 (`/mcp-auth`, OAuth). Adds a `/mcp` command dispatcher that parses subcommands. The management panel is a pi-native `ctx.ui.custom()` overlay using `SelectList`/`Container`/`Text`/`DynamicBorder` (per docs/tui.md patterns) rather than the adapter's raw-ANSI `string[]` rendering — this is the "make it better" improvement. Config write-back (enable/disable, direct-tool selection) writes only the changed fields to the project-local `.pi/mcp.json` layer, never copying credentials.

**Tech Stack:** `@earendil-works/pi-coding-agent` (`registerCommand`, `ui.custom`, `DynamicBorder`, `BorderedLoader`), `@earendil-works/pi-tui` (`SelectList`, `Container`, `Text`), plan-025/026 modules.

**Reference:** `docs/research/pi-mcp-adapter-commands-tui.md`. Source: `/home/daniel/Coding/AI/pi-mcp-adapter/` files `commands.ts`, `mcp-panel.ts`, `mcp-setup-panel.ts`, `mcp-status.ts`, `config.ts` (write-back).

**Prerequisites:** plan-025 and plan-026 must be merged first.

**Deliberately dropped (do NOT port):** the UI/AppBridge iframe subsystem (`ui-server.ts`, `ui-session.ts`, `app-bridge.bundle.js`, `host-html-template.ts`), JSONL protocol tracing, `requestHeadersCommand`, sampling/elicitation handlers, the rainbow-gradient progress bar (use a simple `N/M` count), and fuzzy scoring (use substring match).

---

### Task 1: /mcp command dispatcher with text subcommands

**Context:**
The `/mcp` command routes to subcommands. The text-output subcommands (status, tools, prompts, reconnect, enable, disable, logout) are simpler than the panels and should land first. This task adds the dispatcher and all text subcommands; the panel/setup subcommands are stubbed to "coming next" and implemented in later tasks.

**Files:**
- Create: `packages/mcp/src/commands.ts`
- Modify: `packages/mcp/src/index.ts` (register `/mcp`, remove the standalone `/mcp-logout` from plan-026 — fold into `/mcp logout`)

**What to implement:**

`packages/mcp/src/commands.ts` — a `registerMcpCommand(pi, deps)` that registers `/mcp` and dispatches on the first arg:

| Subcommand | Behavior |
|---|---|
| `/mcp` (no args) or `/mcp status` | Per-server status: name, connection state (connected/cached/needs-auth/disabled/error), tool count. Note "run /mcp setup" if no servers. |
| `/mcp tools [server]` | List tools (from cache) per server or for one server. |
| `/mcp prompts [server]` | List discovered prompts. |
| `/mcp reconnect [server]` | Reconnect one server, or all if no arg. On `needs-auth`, tell the user to run `/mcp-auth`. |
| `/mcp enable <server>` | Write `{ disabled: false }` (or remove the disabled flag) to `.pi/mcp.json`; notify to run `/reload`. |
| `/mcp disable <server>` | Write `{ disabled: true }` to `.pi/mcp.json`; close the connection; notify to run `/reload`. |
| `/mcp logout <server>` | Delete the stored OAuth token (from plan-026 `auth-storage.deleteAuthEntry`); close the connection. |
| `/mcp auth <server>` | Alias to the plan-026 `/mcp-auth` flow. |
| `/mcp panel` | Open the management panel (Task 2). Stub for now → "coming in a later task". |
| `/mcp setup` | Open the setup panel (Task 4). Stub for now. |

`deps` provides: `getManager()`, `getServerDefs()`, `getCache()`, `getConfigPaths()`, and the plan-026 auth functions.

Reference adapter `commands.ts` for the exact status formatting (lines 20–105).

Config write-back for enable/disable: port `writeProjectServerDisabledOverride` from adapter `config.ts` — write ONLY the `disabled` field into `.pi/mcp.json` (create if missing), never copying credentials or other fields from other layers. Atomic write (tmp+rename).

**Steps:**
- [ ] Write failing test `packages/mcp/src/commands.test.ts` — test the subcommand parser (dispatch table): `parseMcpSubcommand("status")`, `("reconnect foo")`, `("enable bar")` return the right `{ subcommand, args }`. Test `writeProjectServerDisabledOverride` writes only `disabled` to a temp `.pi/mcp.json`.
- [ ] Run `pnpm exec vitest run commands` — must fail
- [ ] Create `commands.ts` with dispatcher + text subcommands + disabled write-back
- [ ] Wire into `index.ts`; remove standalone `/mcp-logout`
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Manual test: `/mcp status`, `/mcp tools`, `/mcp disable X` + `/reload` (X gone), `/mcp enable X` + `/reload` (X back)
- [ ] Commit: `feat(mcp): /mcp command dispatcher with text subcommands`

**Acceptance criteria:**
- [ ] All text subcommands work
- [ ] enable/disable writes only the `disabled` field to `.pi/mcp.json`
- [ ] `/mcp logout` clears the OAuth token
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 2: Management panel — pi-native server/tool overlay

**Context:**
The interactive `/mcp panel` lets users browse servers, expand to see tools, and toggle which tools are exposed as "direct tools" (registered individually vs only via the proxy). The adapter renders this with raw ANSI `string[]`; we render it with pi-native components (`Container`/`Text`/`SelectList`/`DynamicBorder`) for theme correctness and maintainability. This is the "make it better" improvement over the source.

**Files:**
- Create: `packages/mcp/src/panel.ts`

**What to implement:**

A `openMcpPanel(pi, ctx, deps)` that opens a `ctx.ui.custom()` overlay. Port the STATE MODEL from adapter `mcp-panel.ts` but render with pi components:

State (from adapter, simplified):
```typescript
interface ServerRow {
  name: string;
  expanded: boolean;
  status: "connected" | "cached" | "needs-auth" | "disabled" | "error";
  failureMessage?: string;
  tools: ToolRow[];
  hasCachedData: boolean;
}
interface ToolRow {
  name: string;
  description: string;
  isDirect: boolean;   // current toggle
  wasDirect: boolean;  // original
}
```

Rendering (pi-native, per docs/tui.md Pattern 1):
- A `Container` with a `DynamicBorder` top/bottom (typed color fn: `(s: string) => theme.fg("accent", s)`).
- Title line: `theme.fg("accent", theme.bold("MCP Servers"))`.
- A flat list of visible rows (servers + expanded tools) rendered as `Text` lines:
  - Server row: `▸`/`▾` expand caret + status glyph (● connected / ○ cached / ⚠ needs-auth / ✗ error) + name + `(N/M tools)` count. Use `theme.fg` tokens: connected→`success`, needs-auth→`warning`, error→`error`, name→`accent`.
  - Tool row (when expanded): `●`/`○` direct toggle + tool name + dimmed description (`theme.fg("dim", ...)`).
- Help line: `theme.fg("dim", "↑↓ navigate · space toggle · enter expand · ctrl+a auth · ctrl+r reconnect · ctrl+s save · esc cancel")`.

Keybindings (`handleInput`):
| Key | Action |
|---|---|
| `↑`/`↓` | Move cursor across visible rows |
| `space` | Toggle direct status of the selected server (all its tools) or tool |
| `enter` | Expand/collapse server; if `needs-auth`, trigger auth |
| type letters | Incremental name filter |
| `backspace` | Edit filter |
| `ctrl+a` | Authenticate selected server (calls plan-026 `authenticate`) |
| `ctrl+r` | Reconnect selected server |
| `ctrl+s` | Save changes + close |
| `esc` | If unsaved changes → discard-confirm; else close |
| `ctrl+c` | Abort, discard |

On save: compute the per-server direct-tool selection (`true` = all, `false` = none, `string[]` = subset) and write it to `.pi/mcp.json` via a `writeDirectToolsConfig` helper (port from adapter `config.ts`, writing only the `directTools` field per server). Notify the user to `/reload`.

Simplifications vs adapter: substring filter (no fuzzy scoring), simple `N/M` count (no rainbow bar), drop the separate description-search mode (single filter over name+description is fine), drop the 60s inactivity auto-close (or keep it simple).

Reference: adapter `mcp-panel.ts` for state/keybindings; docs/tui.md Pattern 1 (SelectList + DynamicBorder) and the "Container Components with Embedded Inputs" / Focusable notes for the filter input.

**Steps:**
- [ ] Write failing test `packages/mcp/src/panel.test.ts` — test the pure state helpers: building visible rows from servers (expanded vs collapsed); toggling a tool updates `isDirect`; computing the save selection (`true`/`false`/`string[]`) from tool states; substring filter. Do NOT test the overlay rendering (that needs a live TUI).
- [ ] Run `pnpm exec vitest run panel` — must fail
- [ ] Create `panel.ts` (state helpers + overlay)
- [ ] Run `pnpm exec vitest run panel` — must pass
- [ ] Wire `openMcpPanel` into the `/mcp panel` subcommand in `commands.ts`
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Manual test: `/mcp panel`, expand a server, toggle a tool, save, `/reload`, confirm the direct-tool set changed
- [ ] Commit: `feat(mcp): pi-native management panel`

**Acceptance criteria:**
- [ ] Panel lists servers with correct status glyphs/colors
- [ ] Expand/collapse and toggle work; filter narrows the list
- [ ] Save writes per-server `directTools` to `.pi/mcp.json`
- [ ] `ctrl+a` triggers auth for needs-auth servers
- [ ] State-helper tests pass, `npx tsc --noEmit` clean

---

### Task 3: Config write-back helpers

**Context:**
The panel and enable/disable subcommands need to write config changes back to `.pi/mcp.json` safely. This task ports the write-back helpers as a focused module so Task 1 and Task 2 can share them. (If Task 1 already inlined `writeProjectServerDisabledOverride`, refactor it here.)

**Files:**
- Create: `packages/mcp/src/config-write.ts`
- Modify: `packages/mcp/src/commands.ts`, `packages/mcp/src/panel.ts` (use the shared helpers)

**What to implement:**

Port from adapter `config.ts` (write-back sections):
```typescript
/** Write only { disabled } for a server into .pi/mcp.json. Never copies credentials. */
export function writeServerDisabled(cwd: string, serverName: string, disabled: boolean): void;

/** Write only { directTools } for a server into .pi/mcp.json. */
export function writeServerDirectTools(cwd: string, serverName: string, value: true | false | string[]): void;
```

Details:
- Target file is always the project-local Pi override `<cwd>/.pi/mcp.json` (highest-precedence Pi layer), created if missing.
- Read-modify-write: parse existing JSON (with comment support), set only the one field under `mcpServers[serverName]`, write atomically (tmp+rename).
- Never read from or copy other config layers — only touch the one field.
- Preserve existing content and formatting as much as reasonable (2-space indent).

**Steps:**
- [ ] Write failing test `packages/mcp/src/config-write.test.ts` — `writeServerDisabled` on a temp cwd creates `.pi/mcp.json` with only `{ mcpServers: { X: { disabled: true } } }`; a second call for a different field merges without clobbering; `writeServerDirectTools` writes the array form
- [ ] Run `pnpm exec vitest run config-write` — must fail
- [ ] Create `config-write.ts`
- [ ] Run `pnpm exec vitest run config-write` — must pass
- [ ] Refactor `commands.ts` + `panel.ts` to use it
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Commit: `feat(mcp): safe config write-back helpers`

**Acceptance criteria:**
- [ ] Writes target only `.pi/mcp.json` and only the changed field
- [ ] Existing content is preserved across writes
- [ ] No credential copying between layers
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 4: Setup panel — scaffold and host-config import

**Context:**
`/mcp setup` helps users who have nothing configured, or who have MCP servers set up in another tool (Cursor, Claude Code, Codex). It scaffolds a minimal `.mcp.json`, offers curated known servers, and imports host configs with a preview before writing. This is the onboarding flow.

**Files:**
- Create: `packages/mcp/src/setup-panel.ts`
- Create: `packages/mcp/src/host-configs.ts` (discovery of other agents' configs)
- Modify: `packages/mcp/src/commands.ts` (wire `/mcp setup`)

**What to implement:**

`packages/mcp/src/host-configs.ts` — port the discovery from adapter `config.ts` (IMPORT_PATHS + extraction). Support at least the common ones:
```typescript
export interface HostConfig {
  agent: "cursor" | "claude-code" | "claude-desktop" | "codex" | "vscode";
  path: string;
  servers: Record<string, ServerDef>;
}
/** Scan known host-config locations, return those that exist with their servers. */
export function discoverHostConfigs(cwd: string): HostConfig[];
```
- Cursor: `~/.cursor/mcp.json` (+ project `.cursor/mcp.json`)
- Claude Code: `~/.config/mcp/mcp.json` / project `.mcp.json`
- Claude Desktop: platform-specific `claude_desktop_config.json`
- Codex: `~/.codex/config.toml` (TOML — needs a TOML parser; add `smol-toml` dep or skip Codex if you want to defer)
- VSCode: `.vscode/mcp.json`
Each has bespoke extraction (see adapter `config.ts` `extractServers`). Keep the ones that are straightforward JSON; note Codex needs TOML.

`packages/mcp/src/setup-panel.ts` — a `ctx.ui.custom()` overlay with screens (port state model from adapter `mcp-setup-panel.ts`):
1. **Empty screen** (no config): options — scaffold minimal `.mcp.json`, add a known server (deepwiki/context7/etc.), import from a discovered host config, or inspect what was found.
2. **Import screen**: checklist of discovered host configs (`[x] cursor  ~/.cursor/mcp.json`), select which to import, PREVIEW the exact file change (a diff), confirm before writing.
3. **Known-servers screen**: pick from a curated list, writes the entry to `.mcp.json`.

Render with pi components (SelectList/SettingsList per docs/tui.md Patterns 1 & 3). Writes go to `.mcp.json` (project shared) or the Pi layer as appropriate, atomically, with a preview shown first.

Simplifications: start with JSON host configs only (defer Codex TOML if it complicates), a small curated known-server list, and a plain confirmation instead of a full unified-diff renderer (show the servers to be added as a list).

**Steps:**
- [ ] Write failing test `packages/mcp/src/host-configs.test.ts` — `discoverHostConfigs` finds a temp `~/.cursor/mcp.json` (point HOME at a temp dir) and extracts its servers; returns empty when nothing exists
- [ ] Run `pnpm exec vitest run host-configs` — must fail
- [ ] Create `host-configs.ts`
- [ ] Run `pnpm exec vitest run host-configs` — must pass
- [ ] Create `setup-panel.ts` (screens + overlay)
- [ ] Wire `/mcp setup` in `commands.ts`
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Manual test: with a Cursor/Claude config present, `/mcp setup` → import → preview → write → `/reload` → servers appear
- [ ] Commit: `feat(mcp): setup panel with host-config import`

**Acceptance criteria:**
- [ ] `discoverHostConfigs` finds and extracts JSON host configs
- [ ] Setup panel scaffolds `.mcp.json` and imports selected host configs with a preview
- [ ] Writes are atomic and go to the correct file
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 5: Status snapshot + footer integration

**Context:**
The adapter publishes an MCP status snapshot for the footer (connected server count, needs-auth indicators). This gives at-a-glance visibility. Port a lightweight version that integrates with the existing `@pi-archimedes/footer` or sets a status via `ctx.ui.setStatus`.

**Files:**
- Create: `packages/mcp/src/status.ts`
- Modify: `packages/mcp/src/index.ts`

**What to implement:**

```typescript
/** Build a compact status string: e.g. "MCP 2/3 · 1 needs auth" */
export function buildMcpStatus(manager: ServerManager, defs: Record<string, ServerDef>): string;
```
- Count connected vs configured servers, and how many are `needs-auth`.
- In `index.ts`, on connection state changes (and on a light interval or after connect/close), call `ctx.ui.setStatus("mcp", buildMcpStatus(...))` using the theme (green when all connected, yellow when any needs-auth). Clear on shutdown.
- Respect a `mcpFooterStatus: "full" | "compact" | "off"` setting (add to `McpConfig`, default `"compact"`).

Reference adapter `mcp-status.ts`. Keep it simple — a single status string, not a full event-publishing system.

**Steps:**
- [ ] Write failing test `packages/mcp/src/status.test.ts` — `buildMcpStatus` with fake manager/defs returns the right counts and needs-auth indicator; `"off"` yields empty
- [ ] Run `pnpm exec vitest run status` — must fail
- [ ] Create `status.ts`
- [ ] Run `pnpm exec vitest run status` — must pass
- [ ] Wire `ctx.ui.setStatus` into `index.ts` (respect the setting)
- [ ] Run `pnpm exec tsc --noEmit` in `packages/mcp/` — must pass
- [ ] Commit: `feat(mcp): status snapshot and footer integration`

**Acceptance criteria:**
- [ ] Status string reflects connected/configured/needs-auth counts
- [ ] `mcpFooterStatus: "off"` disables it
- [ ] Status clears on shutdown (no accumulation on /reload)
- [ ] Tests pass, `npx tsc --noEmit` clean

---

### Task 6: Final integration, type-check all packages, docs, plan index

**Context:**
Final verification and documentation for the completed port. Ensure the whole monorepo type-checks and all tests pass, document the full `/mcp` command surface and all settings, and mark the port complete.

**Files:**
- Modify: `README.md` (full mcp feature section: commands, settings, config)
- Modify: `AGENTS.md` (note mcp is now a full adapter)
- Modify: `docs/plans/README.md`

**Steps:**
- [ ] Run `pnpm exec tsc --noEmit` in all 11 package directories — fix any new errors
- [ ] Run `pnpm exec vitest run` at repo root — all tests pass
- [ ] Update `README.md`: document `/mcp` subcommands (status/tools/prompts/reconnect/enable/disable/logout/auth/panel/setup), `/mcp-auth`, all `archimedes.mcp` settings (directTools, collapsedResultLines, toolPrefix, idleTimeout, warnOnLargeDirectTools, autoAuth, mcpFooterStatus), the `auth` config field, and per-server settings
- [ ] Update `AGENTS.md` mcp entry to reflect full-adapter status
- [ ] Update `docs/plans/README.md`: add plan-026 + plan-027
- [ ] Commit: `docs: document full mcp adapter (commands, panels, settings)`

**Acceptance criteria:**
- [ ] All 11 `tsc --noEmit` pass
- [ ] All tests pass
- [ ] README fully documents the mcp package
- [ ] Plan index updated
- [ ] The port has reached feature parity with pi-mcp-adapter (minus dropped UI/AppBridge)
