# Plugin enable/disable via a single global gate Plan

**Goal:** Add a plugin manager to the meta orchestrator so users can enable/disable the optional pi-archimedes packages. An explicit manifest defines the non-core packages meta composes; an `archimedes.plugins` settings namespace (`{ [pluginId]: boolean }`) is the **single global enable gate**; a `/plugins` slash command opens a toggle-list overlay (the existing SettingsManager TUI) showing only installed packages. Core can never be disabled. Toggling takes effect on the next session/reload.

**Architecture:** `meta/src/plugins.ts` exports a `PLUGINS` manifest — one entry per non-core package, each with `id`, `label`, `description`, `defaultEnabled`, and a lazy `load()` import. The manifest is discovery-driven: an entry is "installed" iff its `import()` resolves, so the menu shows only what's actually present (per user requirement: "only show what's installed"). Enforcement is one `isPluginEnabled(id)` helper read from `archimedes.plugins` config, applied at **three gate points** in meta: (1) registration — skip `register*()` for disabled packages in the factory and session_start (which also skips their internal session/tool/command subscriptions); (2) settings items — `openSettings()` does not compose disabled packages' items; (3) shutdown — guard disabled packages' cleanup refs (e.g. `imagePasteShutdown`). `/plugins` opens a toggle list via the reused `createSettingsManager` (rows carry `values: ["On","Off"]`, cycled with **←/→** in that component) and writes `archimedes.plugins`.

**Tech Stack:** TypeScript, pi extension API (`ExtensionAPI`, `pi.registerCommand`, `ctx.ui.custom`), `@earendil-works/pi-tui` (`SettingItem`, `SettingsList`, `OVERLAY_CHROME`), `@pi-archimedes/core/settings-io` (config), `@pi-archimedes/core/overlay`, vitest, pnpm workspace. No new runtime deps (meta already deps on all packages).

**Decisions on record:** `docs/adr/0011-plugin-manager.md` (single global gate replaces per-package `enabled`; discovery-driven manifest; dedicated `/plugins` command). Interplay: plan-030 (sudo) — the sudo package has NO own `enabled` config; it's the first plugin in the manifest, gated by `archimedes.plugins.sudo` (meta skips `registerSudo` when disabled). Out of scope: runtime re-mount of an already-registered package mid-session (toggling applies next session/reload — pi creates a fresh Extension per session); core disable; per-package custom `enabled` flags; version bumps.

**Verification commands (used throughout):**
- `npx tsc --noEmit` in `meta` (and `packages/core` — settings-io untouched, but config changes touch core's contract)
- `npx vitest run` in `meta` — **a `meta/vitest.config.ts` is created in Task 1** (mirror `packages/core/vitest.config.ts`: `environment: "node"`, `include: ["src/**/*.test.ts"]`, `exclude: ["**/node_modules/**"]`). IMPORTANT: running `npx vitest run` from inside `meta/` walks UP to the root `vitest.config.ts`, whose `projects` paths are cwd-relative and break (startup error). Once `meta/vitest.config.ts` exists, `cd meta && npx vitest run` uses the package config correctly.
- Final full gate: `npx tsc --noEmit` in **all 11 valid dirs (10 packages + `meta/`)** — do NOT run tsc at the repo root (root `tsconfig.json` is a *base* template with `rootDir: "src"` and no `include`; `tsc --noEmit` at root fails TS6059 by design) + `npx vitest run` in every package with a `vitest.config.ts` — **9 total after this plan: meta + core/ask/footer/diff/mcp/subagent/todo (+ sudo only after plan-030 lands)**; image-paste/notify/session-name have no configs.

---

### Task 1: Plugin manifest + config gate + registration gating in meta

**Context:**
The meta factory (`meta/src/index.ts`) currently registers every package unconditionally: `registerCore`, `registerFooter`, `registerTodo`, `registerAsk`, `registerNotify`, `registerSessionName` in the factory (lines ~30-51), plus lazy `import()`s + registrations in `session_start` (diff, image-paste, subagent, mcp, lines ~70-101). There is no `enabled` concept anywhere. This task builds the manifest + the single gate and applies it to registration so disabled packages simply never mount (no tools, no commands, no session handlers).

The manifest is the authoritative list of what's toggleable. Core is NOT in it (can't be disabled). Every other package meta composes IS in it, default-enabled. Installed = the import resolves (an entry whose package is missing/unresolvable is hidden from the menu and simply never registered).

**Files:**
- Create: `meta/src/plugins.ts` — `PluginDef` interface, `PLUGINS` manifest, `isPluginEnabled()`, `loadPluginsConfig()`
- Modify: `meta/src/index.ts` — gate the factory registrations + session_start lazy registrations behind `isPluginEnabled()`
- Create: `meta/plugins.test.ts` — config defaults, gating behavior, manifest integrity
- Create: `meta/vitest.config.ts` — mirror `packages/core/vitest.config.ts` (environment node, include `src/**/*.test.ts`, exclude node_modules)

**What to implement:**

`meta/src/plugins.ts`:
```ts
import { loadConfig } from "@pi-archimedes/core/settings-io";

export interface PluginDef {
  id: string;              // matches package npm name suffix, e.g. "mcp"
  label: string;           // human label, e.g. "MCP"
  description: string;     // one-liner shown in the menu
  defaultEnabled: boolean; // defaults to true for all current plugins
  load: () => Promise<unknown>; // lazy import for instance probing + future lazy mount
}

export const PLUGINS: PluginDef[] = [
  { id: "footer",       label: "Footer status bar",  description: "Status bar with cost/timer",                  defaultEnabled: true, load: () => import("@pi-archimedes/footer") },
  { id: "todo",         label: "Todo list",          description: "manage_todo_list tool + widget",               defaultEnabled: true, load: () => import("@pi-archimedes/todo") },
  { id: "ask",          label: "Ask tool",           description: "Structured in-conversation questions",         defaultEnabled: true, load: () => import("@pi-archimedes/ask") },
  { id: "notify",       label: "Notifications",      description: "Delayed desktop notifications",                defaultEnabled: true, load: () => import("@pi-archimedes/notify") },
  { id: "session-name", label: "Session naming",     description: "Auto session name via git diff",               defaultEnabled: true, load: () => import("@pi-archimedes/session-name") },
  { id: "diff",         label: "Diff rendering",     description: "Shiki-powered diff display",                   defaultEnabled: true, load: () => import("@pi-archimedes/diff") },
  { id: "image-paste",  label: "Image paste",        description: "Clipboard image paste",                        defaultEnabled: true, load: () => import("@pi-archimedes/image-paste") },
  { id: "subagent",     label: "Subagents",          description: "Live subagent dispatch (general, reviewer, …)", defaultEnabled: true, load: () => import("@pi-archimedes/subagent") },
  { id: "mcp",          label: "MCP",                description: "MCP client adapter + /mcp commands",           defaultEnabled: true, load: () => import("@pi-archimedes/mcp") },
  // future: sudo (plan-030) — added there; until then a non-existent entry is just "not installed"
];
```
Conventions:
- Ids match the package names with `@pi-archimedes/` stripped (they also match how other systems refer to them).
- **`load()` is dual-purpose**: the `/plugins` menu uses it for the "installed" probe (a probe can be `load().then(()=>true,()=>false)`); the meta factory uses the *static* `registerX` imports for actual registration (faster, and matches current structure). Registration does NOT go through `load()` in this plan — do not change the import structure in `index.ts` beyond adding gates.
- The manifest array order (above) is the menu display order — there is NO separate `PLUGIN_ORDER` constant (the array IS the order).

Config + gate:
```ts
export interface PluginsConfig { [id: string]: boolean }
const NAMESPACE = "archimedes.plugins";
export function loadPluginsConfig(): PluginsConfig {
  return loadConfig(NAMESPACE, {}) as PluginsConfig; // defaults to {} (all absent = enabled)
}
export function savePluginsConfig(cfg: PluginsConfig): void {
  // saveConfig(NAMESPACE, cfg) — use @pi-archimedes/core/settings-io saveConfig
}
export function isPluginEnabled(id: string): boolean {
  const cfg = loadPluginsConfig();
  const explicit = cfg[id];
  if (explicit === false) return false;
  const def = PLUGINS.find((p) => p.id === id);
  return def ? def.defaultEnabled : true; // unknown id defaults on
}
```
- Semantics: `archimedes.plugins` = partial map; a plugin is enabled unless explicitly `false` (or its `defaultEnabled` is false, which none are today). `savePluginsConfig` writes only the toggled map.
- `savePluginsConfig` should preserve the "only write what changed" behavior: when the user toggles a plugin On, set `cfg[id] = true`; when Off, `cfg[id] = false`. (Explicit true is fine — the gate treats absent-or-true as enabled.)

`meta/src/index.ts` gating (registration only in Task 1; settings/shutdown in Task 2):
- Import `{ isPluginEnabled } from "./plugins.js"`.
- Factory: wrap each `registerX(pi)` call:
  ```ts
  if (isPluginEnabled("footer")) registerFooter(pi);
  if (isPluginEnabled("todo"))   registerTodo(pi);
  if (isPluginEnabled("ask"))    registerAsk(pi);
  if (isPluginEnabled("notify")) registerNotify(pi);
  if (isPluginEnabled("session-name")) registerSessionName(pi);
  ```
- `session_start` lazy block: gate the imports AND the registrations. The current code does `import("@pi-archimedes/diff").catch(...)` for all four in a `Promise.all`. Change to:
  ```ts
  const diffMod = isPluginEnabled("diff") ? await import("@pi-archimedes/diff").catch((e) => { console.error(...); return null; }) : null;
  const ipMod   = isPluginEnabled("image-paste") ? await import("@pi-archimedes/image-paste").catch(...) : null;
  const saMod   = isPluginEnabled("subagent") ? await import("@pi-archimedes/subagent").catch(...) : null;
  const mcpMod  = isPluginEnabled("mcp") ? await import("@pi-archimedes/mcp").catch(...) : null;
  ```
  (Keep the parallel `Promise.all` if preferred — `Promise.all([...])` where each element is `isEnabled ? import().catch(...) : Promise.resolve(null)`.) The registration `if (diffMod) { diffMod.registerDiffTools... }` blocks stay — they already no-op on null. **Do NOT change** the registration bodies themselves.
- Core (`registerCore`) is ALWAYS called — never gated.
- `registerSudo` hook point (future, plan-030): when plan-030 lands, wrap `registerSudo(pi)` in `if (isPluginEnabled("sudo"))` — **NOT** inside the `saMod` block (that's the subagent module). The ownership is: plan-031 provides the pattern + gate; plan-030's Task 3 adds the sudo `PLUGINS` entry + the `registerSudo` gate wrap (both plans' cross-notes say so).

**Tests — `meta/src/plugins.test.ts`** (write failing FIRST):
- `isPluginEnabled("mcp")` → true when config empty (default-on).
- After mock `archimedes.plugins = { mcp: false }` → `isPluginEnabled("mcp")` false; `isPluginEnabled("footer")` still true.
- Unknown id → true (default-on).
- Manifest integrity: every non-core package meta imports has a manifest entry (i.e. `PLUGINS` ids ⊆ {footer, todo, ask, notify, session-name, diff, image-paste, subagent, mcp} and the set equals it — assert coverage so the checklist can't silently drift).
- Probe: `PLUGINS[i].load()` resolves for a real installed package (e.g. `footer`).
- `savePluginsConfig` round-trips a partial map through settings-io mock.

**Steps:**
- [ ] Read `meta/src/index.ts` fully (the factory + session_start blocks) and `meta/src/config.ts` (settings-io usage precedent).
- [ ] Write failing `meta/src/plugins.test.ts`.
- [ ] Run `cd meta && npx vitest run` (meta/vitest.config.ts created in the Files step above) — expect FAIL.
- [ ] Implement `meta/src/plugins.ts` + gate `meta/src/index.ts` registration.
- [ ] Run tests again — pass.
- [ ] Run `cd meta && npx tsc --noEmit` — green.
- [ ] Commit: `feat(meta): plugin manifest + archimedes.plugins registration gate (plan 031)`

**Acceptance criteria:**
- [ ] `PLUGINS` manifest lists all 9 non-core packages (footer, todo, ask, notify, session-name, diff, image-paste, subagent, mcp), default-enabled, with `load()` lazy imports.
- [ ] `isPluginEnabled` defaults-on; `archimedes.plugins` partial map; disabled package's `register*()` never runs (registration gate) — verified by test.
- [ ] Core always registers; unknown ids default on.
- [ ] `meta` tsc + vitest green; single commit.

**Do NOT change:** the registration bodies in `index.ts` (only wrap with gates); `openSettings()` (Task 2); session_shutdown cleanup refs (Task 2); core's registration; `docs/plans/done/**`.

---

### Task 2: Settings-item gate + shutdown gate + `/plugins` command + docs

**Context:**
Task 1 gated registration, but a disabled package can still leak back in through two other meta surfaces: `openSettings()` composes settings items from every package (so a disabled package's settings would still appear in `/archimedes`), and `session_shutdown` references `imagePasteShutdown` from a possibly-never-registered image-paste. This task adds the settings-item gate and the shutdown gate, then builds the `/plugins` command (the toggle UI) and the docs (README feature, AGENTS.md wiring note).

**Files:**
- Modify: `meta/src/index.ts` — `/plugins` command registration + shutdown-gate for `imagePasteShutdown` + factory `/archimedes` registration stays
- Modify: `meta/src/settings.ts` — `openSettings()` skips disabled packages' items
- Modify: `meta/src/plugins.ts` — `savePluginsConfig` write-path (if not already), `isPluginEnabled`
- Modify: `README.md` — feature bullet for plugin manager + `/plugins` command + settings-table note
- Modify: `AGENTS.md` — "Adding a New Package" checklist: new packages must gain a `PLUGINS` manifest entry (single gate applies)
- Test: `meta/src/plugins.test.ts` (extend: settings-item gating, shutdown gating, `/plugins` command registration)

**What to implement:**

`meta/src/settings.ts` — skip disabled packages' items in `openSettings()`:
- The composed items are `coreItems, footerItems, diffItems, notifyItems, sessionNameItems` (lines ~48-52). Wrap each non-core composition in `isPluginEnabled(...)`:
  ```ts
  const items = [...coreItems]; // core always included
  if (isPluginEnabled("footer")) items.push(...footerItems);
  if (isPluginEnabled("notify")) items.push(...notifyItems);
  if (isPluginEnabled("session-name")) items.push(...sessionNameItems);
  // diff is lazy-imported inside openSettings — gate after the await
  if (isPluginEnabled("diff")) items.push(...diffItems);
  ```
  (Read the current file — the items are passed to the SettingsManager constructor; adjust to a single accumulated array. The `PROMPTS` map is keyed by item id and only referenced when an item is rendered, so disabled packages' prompt entries can stay — they're inert if the item is absent.)
- Ensure the diff lazy-import only happens when `diff` is enabled (`getDiffSettingsItems` is imported via `await import("@pi-archimedes/diff")` — move that inside the gate to avoid pulling shiki for a disabled package).

`meta/src/index.ts` — shutdown gate:
- `session_shutdown` handler: `imagePasteShutdown?.()` only if image-paste was actually registered. The module var `imagePasteShutdown` is `undefined` unless image-paste registered, so `imagePasteShutdown?.()` already no-ops — BUT it's set in session_start's `if (ipMod)` block which Task 1 gates, so a disabled image-paste never sets it. Keep as-is; add an explicit `if (isPluginEnabled("image-paste")) imagePasteShutdown?.();` for clarity (optional but recommended so the intent is visible).

`/plugins` command (SINGLE home — in `meta/src/plugin-manager.ts`, NOT inline in `index.ts`):
```ts
// meta/src/plugin-manager.ts — the ONLY registration path (mirror subagent's registerAgentsCommand)
export function registerPluginsCommand(pi: ExtensionAPI): void {
  pi.registerCommand("plugins", {
    description: "Enable or disable optional archimedes plugins",
    handler: async (_args, ctx) => {
      const { buildPluginManager } = await import("./plugin-manager.js");
      await buildPluginManager(ctx);
    },
  });
}
```
The manager UI (`meta/src/plugin-manager.ts`):
- Probe installed: `const installed = (await Promise.all(PLUGINS.map(async (p) => [p, await p.load().then(() => true, () => false)]))).filter(([,ok]) => ok)`.
- Build `SettingItem[]`: for each installed plugin, `{ id: `plugin:${p.id}`, label: p.label, description: p.description, currentValue: isPluginEnabled(p.id) ? "On" : "Off", values: ["On", "Off"] }`. **Cycle binding truth:** in `createSettingsManager` (`meta/src/settings-manager.ts`) the `values` array cycles with **←/→** keys (`handleListInput` matches `Key.left`/`Key.right`); **Enter is inert** on a row unless the item has a prompt descriptor (`opts.prompts[item.id]` — the plugins manager has none, so Enter does nothing) and **Space is inert** in list mode. Toggle UX = select row, press ←/→ to flip, on-change persists. Do NOT add prompt descriptors (that would open a text prompt instead of toggling). No new TUI component.
- On change (`onChange(id, newValue)`): parse `plugin:` prefix, `savePluginsConfig({ ...loadPluginsConfig(), [pluginId]: newValue === "On" })`.
- Reuse the SettingsManager/overlay pattern: read `meta/src/settings.ts` `openSettings()` for how it composes + invokes the manager (it uses `createSettingsManager` from `./settings-manager.js` with `OVERLAY_CHROME`); mirror that for `/plugins` with a minimal `PLUGIN_PROMPTS: Record<string, ...> = {}` (no free-input prompts). `createSettingsManager` requires `onChange`, `onSave`, AND `onClose` — supply a no-op `onSave: () => {}` (toggles persist in `onChange`) and `onClose: () => done(undefined)`.
- Empty-state: if `installed.length === 0` (only core present), notify "No optional plugins installed." and return.

**Tests** (extend `meta/src/plugins.test.ts`):
- Settings gate: `openSettings` with `archimedes.plugins = { mcp: false, footer: false, diff: false, session-name: false }` produces no footer items and does NOT lazy-import diff (mock `@pi-archimedes/diff` or gate it) — set `diff: false` so the test never pulls shiki; add one assertion that the diff lazy-import is skipped when disabled.
- Shutdown gate: `/plugins`-command registration + manager `buildPluginManager` with a stubbed ctx (mock `ctx.ui.custom` capture) returns items only for installed plugins; toggling "On"→"Off" calls `savePluginsConfig` with the right map.
- Command registration: `registerPluginsCommand(pi)` in `meta/src/plugin-manager.ts` (mirror `packages/subagent/src/index.ts` `registerAgentsCommand`: `pi.registerCommand("plugins", ...)` + lazy-manager + `ctx.ui.custom<void>(factory, { overlay: true, overlayOptions: OVERLAY_CHROME })`); called from the meta factory alongside `/archimedes`. Test captures `pi.registerCommand` and asserts `/plugins` is registered.
- README/AGENTS: assert the feature bullet + manifest-checklist note exist (or just update them; a doc assertion is optional).

**Steps:**
- [ ] Read `meta/src/settings.ts` (composition + manager invocation), `meta/src/settings-manager.ts` (constructor), `meta/src/index.ts` (command registration).
- [ ] Write failing tests for settings gate + `/plugins` manager + command.
- [ ] Implement `meta/src/settings.ts` gate + `meta/src/index.ts` (`imagePasteShutdown` gate + call `registerPluginsCommand(pi)` from the factory alongside `/archimedes`) + `meta/src/plugin-manager.ts` (`registerPluginsCommand` + `buildPluginManager`).
- [ ] Run `cd meta && npx vitest run` — pass; `cd meta && npx tsc --noEmit` — green.
- [ ] Update `README.md` (feature bullet + `/plugins` + settings table) + `AGENTS.md` ("Adding a New Package" checklist: add a manifest-entry step).
- [ ] Full repo gate: `npx tsc --noEmit` in all 11 valid dirs (10 packages + `meta/`, NOT the repo root); `npx vitest run` in every vitest-config package.
- [ ] Commit: `feat(meta): /plugins manager, settings/shutdown gates + docs (plan 031)`

**Acceptance criteria:**
- [ ] `/plugins` command registered; manager lists only installed packages; each row cycles On/Off via `values`; toggles persist to `archimedes.plugins`.
- [ ] `openSettings()` skips disabled packages' items (and doesn't lazy-import diff when disabled); `imagePasteShutdown` gated.
- [ ] README feature bullet + AGENTS.md manifest-checklist step present.
- [ ] Full gate green (11 valid dirs tsc + vitest); single commit.

**Do NOT change:** `register*()` bodies; the core registrations; plan docs; the sudo package (plan-030); version numbers.

## Out of scope (deferred; do NOT build in this plan)

- **Runtime re-mount** — toggling applies on next session/reload (pi creates a fresh Extension per session; registration is session-scoped). No mid-session hot-disabling.
- **Core disable** — core is never in the manifest, never toggleable.
- **Per-package `enabled` flags** — the single `archimedes.plugins` gate replaces any `archimedes.<pkg>.enabled` (ADR 0011; plan-030 sudo has none).
- **Plugin install/uninstall** — this is enable/disable of already-present packages only (no package manager).
- Version bumps — release-time per AGENTS.md.

## Cross-task notes for the executing agent

- The monorepo has NO build step — verification is `tsc --noEmit` + vitest only (AGENTS.md).
- Meta is `meta/` (the orchestrator package) — imports at `meta/src/...`; cross-package imports use subpath exports (`@pi-archimedes/core/settings-io`, `@pi-archimedes/core/overlay`).
- `@pi-archimedes/core/settings-io` exports `loadConfig(namespace, defaults)` / `saveConfig(namespace, config)` — verify exact names in `packages/core/src/settings-io.ts` (used by notify/mcp/config modules).
- `meta/vitest.config.ts` is created in Task 1 — always run `cd meta && npx vitest run`; **never** run vitest from the repo root (its `projects` paths are cwd-relative and error, and the root config excludes meta).
- In `createSettingsManager`, `values` cycles with **←/→** (not Enter/Space — settings-manager.ts:230 matches Key.left/right; Enter only opens prompt mode for items with a prompt descriptor). Verify against the installed `@earendil-works/pi-tui` `settings-list.d.ts` (`values?: string[]` present) — the component this plan reuses is meta's `settings-manager.ts`, not pi-tui's `SettingsList` directly.
- Each task must end green (meta tsc + vitest; final task full gate).
- If a check fails twice without edits between, report BLOCKED (AGENTS.md).
- Do NOT touch `docs/plans/done/**`; do NOT bump versions.