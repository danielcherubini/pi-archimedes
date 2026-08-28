# Plugin gate moves into each package's own namespace Plan

**Goal:** Replace the standalone `archimedes.plugins` map (plan 031) with the per-package switch `archimedes.<pkg>.enabled` — the on/off lives next to each package's own settings, meta stays the sole reader/writer, and the legacy map is migrated once then deleted.

**Supersedes (partially):** plan 031 / ADR 0011's *config shape* only. Everything else from plan 031 stays: the discovery-driven `PLUGINS` manifest, the three gate points (registration, settings items, shutdown), the `/plugins` toggle overlay, session-scoped effect, and core's absolute exemption. Recorded in ADR 0012.

**Motivation (user feedback on live config):** two coexisting switches for the same package — `archimedes.plugins.footer: false` AND the pre-existing `archimedes.notify.enabled` / `archimedes.sessionName.enabled` — with those legacy flags still enforced inside the packages' runtime code. Plus the map accumulating redundant explicit `true` entries every time a row was touched in `/plugins`.

**Target config shape** (`~/.pi/agent/settings.json`):
```jsonc
"archimedes.notify": { "enabled": true, "notifyOnAgentEnd": true, "notifyOnQuestion": true, "delayMs": 30000 },
"archimedes.footer": { "enabled": false }
// every other non-core package: switch present iff the user turned it off (or kept an explicit true)
// "archimedes.plugins" — gone after one-time migration
```

**Semantics (the whole contract):**
- A plugin with manifest `namespace` `NS` is enabled iff `settings[NS].enabled !== false` (absent key, absent namespace, or `true` ⇒ on; only explicit `false` ⇒ off).
- **Meta is the only thing that reads `enabled` to decide behavior, and the only thing that writes it** (via the new `settings-io` helpers). Package code never reads nor writes `enabled` — any existing runtime guard is deleted.
- Toggling **On deletes the key**; toggling **Off writes `enabled: false`** into that package's namespace (merge — the package's other settings in the same namespace are untouched). On-then-empty namespace is deleted from the file too (see `setConfigEnabled` below).
- Core is never gated; no `enabled` concept for `archimedes.core`.
- Effect still takes on next session/reload (unchanged from plan 031).

**Namespaces (fixed mapping — stored in the manifest, do not derive):**

| plugin id | namespace |
|---|---|
| footer | `archimedes.footer` |
| todo | `archimedes.todo` |
| ask | `archimedes.ask` |
| notify | `archimedes.notify` |
| session-name | `archimedes.sessionName` |
| diff | `archimedes.diff` |
| image-paste | `archimedes.imagePaste` |
| subagent | `archimedes.subagent` |
| mcp | `archimedes.mcp` |

(`session-name`/`image-paste` are the existing camelize/kebab conventions: `archimedes.sessionName` is pre-existing; `archimedes.imagePaste` follows it. The other namespaces are created only in settings.json when the user toggles the package off — no code namespace must pre-exist.)

**Tech Stack:** TypeScript, vitest, pnpm workspace. No new deps. Changed packages: core (3 settings-io helpers), meta (gate rework + migration + /plugins save path), notify + session-name (dead-flag cleanup). AGENTS.md/README/ADR-0012 docs.

**Verification commands:**
- `npx tsc --noEmit` in the 4 touched package dirs (`packages/core`, `meta`, `packages/notify`, `packages/session-name`) every task
- `npx vitest run` in `packages/core` and `meta` every task; in `packages/notify` + `packages/session-name` after Task 3
- Final: full repo gate — tsc in all 11 valid dirs (10 packages + meta, NOT repo root) + vitest in **all 10 test dirs**: the 9 packages in the root `vitest.config.ts` `projects` (core, diff, footer, subagent, todo, notify, ask, image-paste, mcp) PLUS `meta/` (its own `vitest.config.ts`). `session-name` has no test dir.

---

### Task 1: settings-io enable-key primitives in core

**Context:**
The gate now lives in arbitrary package namespaces, and `meta/src/plugins.ts` must read/write one boolean key in each namespace without touching the namespace's other keys. `packages/core/src/settings-io.ts` currently exports only `loadConfig(namespace, defaults)` and `saveConfig(namespace, config)` — both operate on whole namespaces. We add three small primitives here (single home, reusable, unit-testable against the real file via the existing test harness in `packages/core/src/settings-io.test.ts`). Note `readSettings()` returns `{}` on missing/corrupt file and `saveConfig` writes atomically (tmp + rename with fallback) — reuse those exact behaviors.

**Files:**
- Modify: `packages/core/src/settings-io.ts` — add `removeConfig`, `isConfigEnabled`, `setConfigEnabled`
- Test: `packages/core/src/settings-io.test.ts` — extend

**What to implement:**
```ts
/** Delete a namespace section from settings.json entirely. No-op if the key is absent. Atomic write, same pattern as saveConfig. */
export function removeConfig(namespace: string): void

/** True unless settings[namespace].enabled === false. Missing file/namespace/key ⇒ true. */
export function isConfigEnabled(namespace: string): boolean {
  const cfg = loadConfig(namespace, {}) as { enabled?: boolean };
  return cfg.enabled !== false;
}

/** off: write settings[ns].enabled = false (merged — other keys in the namespace survive).
 * on: delete the enabled key; if that leaves the namespace with zero keys, remove the whole namespace key from the file. */
export function setConfigEnabled(namespace: string, enabled: boolean): void
```
Implementation notes:
- `setConfigEnabled` reads the live namespace with `loadConfig(namespace, {})` (spreads the file's whole namespace over `{}`), mutates a copy, writes back via `saveConfig`. The delete branch of `removeConfig` mirrors `saveConfig`'s atomic write (tmp + rename + unlink/fallback).
- Both new writers must not create a namespace with just `{}` — after deleting `enabled`, check `Object.keys(cfg).length === 0` → `removeConfig(namespace)` instead of saving.
- `isConfigEnabled` is the only semantic reader — strict `=== false` check (a string `"false"` or `0` does NOT disable; document that in the JSDoc).

**Steps:**
- [ ] Extend `packages/core/src/settings-io.test.ts` with failing tests:
  - `removeConfig` deletes an existing namespace key and leaves sibling keys intact; no-op when the key is absent, including when **`settings.json` does not exist at all → the file must remain nonexistent** (a read-then-write implementation that creates an empty file must fail this test); when the file exists but the key is absent, assert no rewrite/key-set change (mtime or spy)
  - `isConfigEnabled` matrix: missing namespace → true; `{}` → true; `{ enabled: true }` → true; `{ enabled: false }` → false; `{ enabled: "false" }` → true (strict check)
  - `setConfigEnabled(ns, false)` on an existing namespace with other keys → `enabled: false` added, other keys intact
  - `setConfigEnabled(ns, true)` on `{ enabled: false }` → key deleted → namespace removed from file entirely (zero keys)
  - `setConfigEnabled(ns, true)` on `{ enabled: false, other: 1 }` → namespace remains as `{ other: 1 }`
  - run against a temp HOME / temp settings path using the same harness the existing file's tests use (read that file first and mirror it)
- [ ] Run `cd packages/core && npx vitest run src/settings-io.test.ts` — expect FAIL (exports missing)
- [ ] Implement the three functions in `settings-io.ts`
- [ ] Run `cd packages/core && npx vitest run` — all core tests pass
- [ ] Run `cd packages/core && npx tsc --noEmit` — green
- [ ] Commit: `feat(core): settings-io enable-key primitives for per-namespace plugin gate (plan 032)`

**Acceptance criteria:**
- [ ] Three exported helpers with the exact signatures above
- [ ] All listed tests pass in the existing core suite (no regressions)
- [ ] Single commit

**Do NOT change:** `loadConfig`/`saveConfig` semantics; anything else in core.

---

### Task 2: Meta gate rework — per-namespace gate, legacy-map migration, `/plugins` save path

**Context:**
Task 1 (already landed on this branch) provides `removeConfig` / `isConfigEnabled` / `setConfigEnabled` in `@pi-archimedes/core/settings-io`. Plan 031's `meta/src/plugins.ts` currently exposes `PLUGINS` (9 entries: id, label, description, `defaultEnabled`, lazy `load()`), `PluginsConfig`, `loadPluginsConfig()`, `savePluginsConfig()` (standalone `archimedes.plugins` namespace via `loadConfig(NAMESPACE, {})`), and `isPluginEnabled(id)`. This task re-points the gate at the namespace mapping, adds the one-time migration of the legacy map, and re-wires the `/plugins` manager's onChange. `meta/src/index.ts` (factory + session_start + session_shutdown gates, all calling `isPluginEnabled`) and `meta/src/plugin-manager.ts` (rows via `isPluginEnabled`, onChange currently calling `savePluginsConfig`) need the minimal re-wire. The manifest is the single source of the id→namespace mapping.

**Files:**
- Modify: `meta/src/plugins.ts` — manifest `namespace` field; drop `defaultEnabled`, `PluginsConfig`, `loadPluginsConfig`, `savePluginsConfig`; keep `PLUGINS`, `isPluginEnabled` (re-implemented), add `setPluginEnabled`, add `migrateLegacyPluginsMap`
- Modify: `meta/src/index.ts` — call `migrateLegacyPluginsMap()` at the very top of the factory, before any `isPluginEnabled` registration gate
- Modify: `meta/src/plugin-manager.ts` — onChange → `setPluginEnabled(p.id, value === "On")` instead of `savePluginsConfig({...loadPluginsConfig(), [id]: ...})`
- Modify: `meta/src/plugins.test.ts` — re-target gate tests to namespaces; add migration + save-path tests
- Do NOT touch: `meta/src/settings.ts` item-gating (it already calls `isPluginEnabled` — re-pointed automatically), the shutdown gate, registration bodies, core's registration

**What to implement:**

`meta/src/plugins.ts`:
```ts
import { isConfigEnabled, setConfigEnabled, loadConfig, removeConfig } from "@pi-archimedes/core/settings-io";

export interface PluginDef {
  id: string;              // "mcp"
  label: string;           // "MCP"
  description: string;     // one-liner for the /plugins menu
  namespace: string;       // "archimedes.mcp" — the settings.json key holding this plugin's { enabled, ...settings }
  load: () => Promise<unknown>; // installed-probe for the /plugins menu
}
```
- Update all 9 manifest entries with the `namespace` values from the table in the plan header; **remove** the `defaultEnabled` field (uniform default-on now lives in `isConfigEnabled`'s `!== false`). Keep the array order (menu order).
```ts
export function isPluginEnabled(id: string): boolean {
  const def = PLUGINS.find((p) => p.id === id);
  if (!def) return true; // unknown id defaults on (unchanged from plan 031)
  return isConfigEnabled(def.namespace);
}
export function setPluginEnabled(id: string, enabled: boolean): boolean {
  const def = PLUGINS.find((p) => p.id === id);
  if (!def) return false;
  setConfigEnabled(def.namespace, enabled);
  return true;
}
export function migrateLegacyPluginsMap(): void {
  const legacy = loadConfig("archimedes.plugins", {}) as Record<string, unknown>;
  if (Object.keys(legacy).length === 0) return; // nothing to do
  for (const [id, value] of Object.entries(legacy)) {
    const def = PLUGINS.find((p) => p.id === id);
    if (!def) continue;                    // unknown id: drop
    if (value === false) setConfigEnabled(def.namespace, false);
    // explicit true / non-boolean: equal to default-on → nothing to write
  }
  removeConfig("archimedes.plugins");      // idempotent: second run takes the early return
}
```
- Delete `PluginsConfig`, `loadPluginsConfig`, `savePluginsConfig`, and the `NAMESPACE = "archimedes.plugins"` const (the string literal is now only referenced inside `migrateLegacyPluginsMap`).
- The settings file in the tests reaches these via the existing mocked `settings-io` — keep the existing in-memory-store mock approach from `meta/src/plugins.test.ts` (an in-memory `settings.json` object with the same `loadConfig`/`saveConfig` semantics); extend the mock with `removeConfig`/`isConfigEnabled`/`setConfigEnabled` implemented in terms of the store (mirror their real semantics, esp. the delete-on-On / empty-namespace-removal behavior — the meta tests must verify the manager flow through the SAME primitives core uses).

`meta/src/index.ts`:
- Factory: first line of the exported default function → `migrateLegacyPluginsMap();` (before `registerCore` is fine — but MUST be before any `isPluginEnabled(...)` gate evaluation).
- Everything else unchanged.

`meta/src/plugin-manager.ts`:
- `onChange`: strip the `plugin:` prefix → `setPluginEnabled(pluginId, newValue === "On")`.
- Row building continues to use `isPluginEnabled(p.id)`; installed probe + empty-state + no-prompts overlay all unchanged.

`meta/src/plugins.test.ts` (re-target existing 23 tests + new):
- Gate (namespace-backed): manifest empty config → all `isPluginEnabled` true; in-memory store `{"archimedes.mcp": {"enabled": false}}` → mcp false, footer true; explicit true → enabled; unknown id → true.
- Migration: store `{"archimedes.plugins": {"footer": false, "ask": true, "junk": false}}` → after `migrateLegacyPluginsMap()`: `archimedes.footer.enabled === false`; no `archimedes.ask` namespace (true = default, nothing written... but note: ask has no pre-existing namespace in the store → stays absent); unknown `junk` dropped; `archimedes.plugins` key REMOVED. Idempotent: second call no-op. Also: legacy entry for a plugin whose namespace already has other settings → other keys survive the merge (store `{"archimedes.notify": {"delayMs": 30000, ...}, "archimedes.plugins": {"notify": false}}` → notify keeps delayMs, gains enabled:false).
- Save path: `setPluginEnabled("footer", false)` → `archimedes.footer.enabled === false`; `setPluginEnabled("footer", true)` → key gone, namespace gone if it was only `enabled`; `setPluginEnabled("unknown", true)` → false returned, no writes.
- `/plugins` manager tests (existing harness driving the real `createSettingsManager`): the On→Off→On cycle now asserts `setConfigEnabled` behavior on the package namespaces (Off → `{ enabled: false }` present; back On → namespace absent/empty-key removed) — update the previous `savePluginsConfig` assertions accordingly.
- Delete the old `savePluginsConfig` round-trip test (API removed) — replace with the save-path tests above.
- **Compile fallout (vitest does not type-check — expect these to surface at the tsc round, not the vitest round):**
  - the `footerPlugin`/`ghostPlugin` stub literals (`~lines 277–283`, typed `PluginDef`) need a `namespace` field once `defaultEnabled` is dropped from the interface;
  - the manifest-integrity test asserting `plugin.defaultEnabled` (`~line 152`) must be replaced with a namespace check (e.g. every entry has a unique, non-empty `namespace`);
  - `fakeAllConfig()` (`~lines 188–196`) carries `notify: { enabled: true }` / `sessionName: { enabled: true }` — clean in the same pass.

**Steps:**
- [ ] Read current `meta/src/plugins.ts`, `meta/src/index.ts` (factory top), `meta/src/plugin-manager.ts` (onChange), `meta/src/plugins.test.ts` (mock harness) fully.
- [ ] Rewrite/extend `meta/src/plugins.test.ts` (failing first).
- [ ] Run `cd meta && npx vitest run` — expect FAIL.
- [ ] Implement `meta/src/plugins.ts` rework + `index.ts` migration call + `plugin-manager.ts` onChange.
- [ ] Run `cd meta && npx vitest run` — pass; `cd meta && npx tsc --noEmit` — green.
- [ ] Verify no other file references `savePluginsConfig`/`loadPluginsConfig`/`PluginsConfig`/`defaultEnabled` (grep `meta/` — settings.ts must NOT need changes beyond what already exists).
- [ ] Run `cd meta && npx tsc --noEmit` again + full `cd meta && npx vitest run` — green.
- [ ] Commit: `feat(meta): plugin gate in archimedes.<pkg>.enabled + legacy archimedes.plugins migration (plan 032)`

**Acceptance criteria:**
- [ ] Manifest carries `namespace`; no `defaultEnabled`/`PluginsConfig`/`loadPluginsConfig`/`savePluginsConfig` anywhere in meta
- [ ] `migrateLegacyPluginsMap()` runs before the first gate evaluation; idempotent; verified by test
- [ ] `/plugins` toggle persists to the package's own namespace only
- [ ] All meta tests green; single commit

**Do NOT change:** `register*()` bodies; settings.ts composition; shutdown gate; plan/docs files; version numbers.

---

### Task 3: Dead-flag cleanup in notify + session-name, docs (ADR 0012, README, AGENTS.md), full gate

**Context:**
Tasks 1–2 moved the gate to per-namespace `enabled` managed exclusively by meta. Two packages still (a) read their own `enabled` at runtime and (b) expose a toggle row for it in `/archimedes` — both now dead/dangerous code paths that can desync from the real gate. This task removes both surfaces and updates the docs to the final shape. ADR 0012 is ALREADY committed (planning step) — this task only updates README.md, AGENTS.md, and the plan index.

**Files:**
- Modify: `packages/notify/src/index.ts` — delete runtime guard + settings item + prompts entry; `enabled` becomes optional in the type (no default)
- Modify: `packages/session-name/src/index.ts` — same
- Modify: `meta/src/settings.ts` — delete the two now-dead `onChange` branches: `case "enabled":` (~line 119) and `case "sessionNameEnabled":` (~line 129) — their items no longer exist; also refresh the stale `archimedes.plugins` header comments (~lines 8, 39) to per-namespace wording
- Test: `packages/notify/src/default-export.test.ts` (check for `enabled` export assertions — adjust if present), `meta/src/plugins.test.ts` (the `vi.mock` item arrays hardcode the removed rows — the notify mock includes `{ id: "enabled", ... }` (~line 42) and the session-name mock includes `{ id: "sessionNameEnabled", ... }` (~line 49); remove those two entries from the mocked item arrays so the mocks stop diverging from the real packages' item lists, not just the assertions)
- Modify: `README.md` — plugin-manager section: switches live in each package's own namespace (`archimedes.<pkg>.enabled`); drop the `archimedes.plugins` settings-table row. **Also remove/replace the four now-stale package-level `enabled` setting rows** (the toggle they describe is removed by this task): `README.md:316` (`| enabled | bool | true | Enable desktop notifications |` in the notify table), `README.md:325` (`| enabled | bool | true | Enable automatic session naming |` in the session-name table), `packages/notify/README.md:36` and `packages/session-name/README.md:36` (same rows per-package) — replace each with a one-line pointer to the suite-managed flag ("on/off via `/plugins` — `archimedes.<ns>.enabled`, default on"), or drop them
- Modify: `AGENTS.md` — Config section: document the suite-wide `enabled` key (suite-managed by meta's plugin gate; package code must NOT read it); "Adding a New Package" checklist: manifest entry now includes `namespace: "archimedes.<newkey>"`
- Modify: `meta/src/plugin-manager.ts` — refresh ONLY the stale doc comment (~line 7, "persists immediately to `archimedes.plugins`" → per-namespace wording); do not touch logic (rewired in Task 2)
- Modify: `docs/plans/README.md` — plan 032 row (added at planning step as IN PROGRESS) → ✅ COMPLETED (PR #39), Quick Stats Completed/In Progress/Backlog counts, move file to `done/` with `git mv` (this plan only — do not touch other entries)

**What to implement:**

`packages/notify/src/index.ts`:
- `NotifyConfig` interface: `enabled: boolean` → `enabled?: boolean` with a comment: `// suite-managed by meta's plugin gate (archimedes.notify.enabled — see ADR 0012); notify never reads this`
- `DEFAULT_NOTIFY_CONFIG`: remove the `enabled: true` line
- Delete the guard in the trigger path: `if (!config.enabled) {\n return;\n }` (~line 156)
- Delete the settings item `id: "enabled"` (the current On/Off `SettingItem` around line 230) from the items array AND its entry in the prompts/`onChange` wiring that saves it — check how `saveNotifyConfig` is called for that item and remove the branch. The remaining items (`notifyOnAgentEnd`, `notifyOnQuestion`, `delayMs`) keep working identically.
- Grep the package + `meta/` for other `\.enabled` reads of the notify config (e.g. composed config in `meta/src/config.ts` — it re-exports `loadNotifyConfig`; composed consumers may display the field — if any UI row elsewhere renders notify's enabled, remove it there too).

`packages/session-name/src/index.ts`:
- `SessionNameSettings`: `enabled?: boolean` (already optional) + same comment
- `DEFAULT_SESSION_NAME_CONFIG` (`packages/session-name/src/index.ts` AND its re-export copy `DEFAULT_SESSION_NAME_CONFIG` in `meta/src/config.ts` — both set `enabled: true`): remove the field from both
- Delete the guard `if (!settings.enabled) return;` (~line 89)
- Delete the `sessionNameEnabled` settings item (~line 248) + its prompts/onChange wiring; `sessionNameModel` item stays
- Grep `meta/` + `packages/` for other reads of session-name `enabled`.

Docs:
- `README.md`: locate the plugin-manager section plan 031 added (feature bullet + `/plugins` command docs + settings table row for `archimedes.plugins`). Rewrite: the on/off for each optional package is the `enabled` key inside that package's own `archimedes.*` namespace (shown only when you set it, default on), toggled from `/plugins`; `core` can never be disabled. Remove/replace the `archimedes.plugins` table row AND the four package-level `enabled` rows listed in Files (root README ×2, notify README, session-name README).
- `AGENTS.md`: (1) Config section — add a line: all non-core packages' settings namespaces may carry a suite-managed `enabled` boolean (default true when absent; **only meta reads/writes it** — via `/plugins`; package code must never read it as a runtime guard). (2) "Adding a New Package" — the plan-031 manifest-entry step now reads: add a `PLUGINS` entry in `meta/src/plugins.ts` with `id`, `label`, `description`, and `namespace: "archimedes.<newkey>"`; registration alone is not enough — the gate, settings items, shutdown and `/plugins` menu all key off the manifest.
- `docs/plans/README.md`: plan 032 → Done table row `| 32 | [Plugin gate in package namespaces](done/plan-032-gate-in-package-namespace.md) | ✅ COMPLETED (PR #39) | 2026-08-28 |`, remove from Backlog, `git mv docs/plans/plan-032-gate-in-package-namespace.md docs/plans/done/`, Quick Stats: Total 32, Completed +1, In Progress −1, Backlog −1.

**Steps:**
- [ ] Read `packages/notify/src/index.ts` and `packages/session-name/src/index.ts` fully (items arrays, prompts maps, onChange wiring for the enabled items).
- [ ] Grep: `grep -rn 'enabled' packages/notify/src packages/session-name/src meta/src | grep -v test` — enumerate every read; classify (suite-gate = keep only in meta/plugins.ts; runtime-guard/item/onChange-branch = delete — this surfaces the two cases in `meta/src/settings.ts`).
- [ ] Remove notify surface → `cd packages/notify && npx vitest run && npx tsc --noEmit` green (update `default-export.test.ts` only if it pins `enabled`).
- [ ] Remove session-name surface → `cd packages/session-name && npx tsc --noEmit` green (no test dir expected).
- [ ] `cd meta && npx vitest run && npx tsc --noEmit` green (meta composes these packages' items — `/archimedes` tests, if any assert the removed rows, update them).
- [ ] Remove the two dead `onChange` cases (`"enabled"`, `"sessionNameEnabled"`) from `meta/src/settings.ts` + refresh its two stale `archimedes.plugins` comments.
- [ ] Remove the `enabled`/`sessionNameEnabled` entries from the `vi.mock` item arrays in `meta/src/plugins.test.ts` (see Files).
- [ ] Update README.md (all six rows) + AGENTS.md per above.
- [ ] Full repo gate: `npx tsc --noEmit` in ALL 11 valid dirs (10 packages + meta, not repo root); `npx vitest run` in ALL 10 test dirs (9 root-config packages + meta).
- [ ] Plan index: `git mv` + README table/stats edits.
- [ ] Commit: `docs+fix: per-namespace plugin gate surface — dead-flag cleanup (notify, session-name) + docs (plan 032)`

**Acceptance criteria:**
- [ ] `grep -rn '\.enabled' packages/notify/src packages/session-name/src` shows no runtime reads; no `enabled` settings rows in either package
- [ ] `grep -rn 'sessionNameEnabled\|case "enabled"' meta/src` is clean (both onChange cases gone)
- [ ] `meta/src/plugins.test.ts` mock item arrays no longer contain the removed rows
- [ ] `DEFAULT_NOTIFY_CONFIG` / `DEFAULT_SESSION_NAME_CONFIG` (both copies) no longer contain `enabled`
- [ ] No `archimedes.plugins` row in README; no stale package-level `enabled` setting rows anywhere (root README ×2, notify README, session-name README); AGENTS.md documents the suite-managed key + namespace in the checklist
- [ ] Stale in-code `archimedes.plugins` comments refreshed (plugin-manager.ts, settings.ts)
- [ ] Full repo gate green (11 dirs tsc + 10 vitest dirs); single commit

**Do NOT change:** packages/diff, footer, mcp, todo, ask, image-paste, subagent code (they have no guard to remove); core's primitives; the migration; version numbers.

---

## Out of scope (do NOT build)

- **Runtime re-mount** — still next session/reload.
- **Removal of users' explicit `enabled: true` entries** — left alone (harmless, user-owned); only the legacy `archimedes.plugins` map is rewritten.
- **Relocating per-package namespaces** (e.g. `archimedes.sessionName` staying camelCase) — the fixed mapping in the header stands.
- **plan-030 (sudo)** — its branch will simply read `archimedes.sudo.enabled` per ADR 0012; nothing to do here.

## Cross-task notes for the executing agent

- Monorepo has NO build step — `tsc --noEmit` + vitest only. Run vitest inside each package dir.
- Final gate = 11 tsc dirs + **10** vitest dirs (9 packages from the root config — notify and image-paste have `default-export.test.ts` suites — plus meta). Do not stop at 8.
- Since Tasks 1 and 2 modify different packages, run each package's own suite before committing that task; the full 11-tsc/10-vitest gate is Task 3's final step.
- The in-memory settings mock in `meta/src/plugins.test.ts` must implement `removeConfig`/`isConfigEnabled`/`setConfigEnabled` with core's exact semantics (including delete-on-On and empty-namespace removal) — meta tests verify the manager flow through those primitives.
- ADR 0012 + plan 032 file + plans README Backlog entry are planned together at planning time (before execution) — the executing agent only touches `docs/plans/README.md` in Task 3.
- Loop-break: a check failing twice without edits between → report BLOCKED.
- PR is #39 (feature/plan-031-plugin-manager) — commit to the current branch, do not create new ones.
