---
status: approved
done-when: A fresh install shows the modal on first TUI session; the three answers (or a skip) write thinkingStyle/toolStyle/editorSpinStyle/changed-plugin-flags + the onboarded marker; the modal never re-appears; an existing user's compactThinking migrates to thinkingStyle; thinkingStyle: Compact renders one-line thinking and toolStyle: Full starts all tools expanded; npx tsc --noEmit passes in ui + meta and the vitest suites are green.
---

# First-Run Onboarding + Full/Compact Style

## Problem

A user installing pi-archimedes gets a wall of defaults: the thinking block renders full, tools render collapsed, the spinner is `pendulum`, and all 11 plugins are on. There is no moment to shape the suite to their taste. This spec adds a **first-run onboarding modal** that asks three basic questions, and introduces a **Full/Compact output style** that the onboarding's first answer seeds.

## Decisions (from discussion)

| Question | Decision |
|---|---|
| What "tools" means | **All pi tools** (the native `ToolExecutionComponent`), not just the archimedes-styled bash tool. |
| Tool default | `toolStyle` **defaults to `Compact`** (today's collapsed-default); `Full` starts tools expanded. |
| Style shape | **One onboarding answer seeds two independent settings** — `thinkingStyle` and `toolStyle` (both `Full`/`Compact`); `/archimedes` exposes them separately so the user can diverge later. |
| When it shows | **Marker-gated, first-run only.** Show when `archimedes.meta.onboarded !== true`. A brand-new user *and* an existing user (who never onboarded) each see it exactly **once**, with current values pre-selected; never again. |
| On close/cancel | **Save the answered steps, keep current values for the rest, set the marker, never ask again.** |
| Where it lives | A module in **`meta`** (`meta/src/onboarding.ts`) — meta is the sole writer of the `enabled` flags (ADR 0012) and the orchestrator; mirrors the `offerKeybindingFix` first-run precedent. |
| How it's rendered | A **dedicated `ui.custom` overlay** (not a reuse of ask's `askQuestionsWithTabs`) — setup-wizard look, no "Other", reuses `OVERLAY_CHROME` + settings-manager patterns. |

## 1. Trigger & lifecycle (`meta/src/onboarding.ts`)

- `registerOnboarding(pi)` registered at the top level of meta's factory; opens the modal from a top-level `session_start` handler (the `offerKeybindingFix` pattern — deliberately not plugin-gated, since it runs before plugin registration).
- **Gates (all must pass):** (1) `ctx.mode === "tui"`; (2) `loadConfig("archimedes.meta", {onboarded:false}).onboarded !== true`.
- **Timing:** fire-and-forget (a throw is logged, never propagated); opens after a one-tick `setImmediate` deferral; renders as a centered `OVERLAY_CHROME` overlay over the splash header.
- **Completion (any dismissal):** explicit **Esc** (any step), **Enter on the final step**, or **/new //reload teardown** all run the same `finish()`. A **hard process-quit** leaves the marker unset → self-heals next session (accepted, matches `offerKeybindingFix`).
- **Write ordering:** (1) write answered settings — `archimedes.ui` via one `updateConfig` + only *changed* plugin `enabled` flags via `setConfigEnabled`; (2) **only on success**, set `archimedes.meta.onboarded: true`; (3) on write failure, `ctx.ui.notify(…)` and leave the marker unset.
- **Effect timing:** takes effect from the **next session** (or `/reload`) — consistent with the suite's session-scoped settings.

## 2. The modal

One `ui.custom` overlay component with an internal `step` state (0→1→2); no open/close flicker between steps.

- **Step 1 — Style** (single-select, 2 options): `Full` ("Full thinking blocks, tools expanded") / `Compact` ("One-line thinking, collapsed tools"). Pre-selected: current `thinkingStyle`.
- **Step 2 — Plugins** (multi-select, installed plugins only — same `load()` "installed" probe as `/plugins`): one row per plugin, `✓/· <label> — <description>` (manifest one-liner, truncated to fit). Pre-selected: each plugin's current `enabled` state.
- **Step 3 — Spinner** (single-select, 10 options): the ten `editorSpinStyle` values as a **plain name list** (no live preview). Pre-selected: current `editorSpinStyle`.
- **Keys:** ↑↓ move · **Enter confirms & advances** (final step: completes) · **Space toggles** (step 2 only) · **Esc finishes**.
- **Answer tracking:** a `confirmedSteps` set — Enter on step *i* adds *i*; Esc never adds the current step. `styleAnswered = .has(0)`, `pluginsAnswered = .has(1)`, `spinnerAnswered = .has(2)`.
- **`finish()` write logic** (only answered steps written; unanswered keep current values):
  ```
  uiMutations = {}
  if (styleAnswered)   { uiMutations.thinkingStyle = v; uiMutations.toolStyle = v; }  // seeds both
  if (spinnerAnswered) { uiMutations.editorSpinStyle = v; }
  if (uiMutations)      updateConfig("archimedes.ui", DEFAULT_UI_CONFIG, c => ({...c, ...uiMutations}))
  if (pluginsAnswered) for each plugin whose selection ≠ current enabled: setPluginEnabled(id, selected)
  updateConfig("archimedes.meta", {onboarded:false}, c => ({...c, onboarded:true}))   // marker last
  ```

## 3. Config rename + migration (`packages/ui`)

- **`config.ts`:** new `OutputStyle = "Full" | "Compact"` (+ `OUTPUT_STYLE_VALUES`, `normalizeOutputStyle` with legacy fallback: `Off`→`Full`, `1 line`/`3 lines`/`5 lines`→`Compact`, else `Full`); `UIConfig` drops `compactThinking`, adds `thinkingStyle` + `toolStyle`; `DEFAULT_UI_CONFIG` sets `thinkingStyle: "Full"`, `toolStyle: "Compact"`.
- **`migration.ts`:** new `migrateCompactThinkingToStyle()` at the top of `registerUI` — idempotent no-op when `compactThinking` absent; `Off`→`Full`, `1/3/5 lines`→`Compact`, unknown→`Full`; deletes `compactThinking`; preserves an existing `thinkingStyle`; does not touch `toolStyle` (absent → `Compact` default at load).
- **`settings.ts`:** the `compactThinking` row becomes two rows — `thinkingStyle` and `toolStyle`, both `values: ["Full", "Compact"]`.
- **`meta/src/settings.ts`** `onChange`: `compactThinking` case → `thinkingStyle` (via `normalizeOutputStyle`); new `toolStyle` case.
- **Patch call sites** (`ui/src/index.ts` session_start): both patches take a **static config captured at session_start** (re-patched every `session_start`) — static on purpose (both patched methods run per-render; `loadUIConfig` is a disk read).

## 4. Patches

- **`patchThinkingRenderer`** (`ui/src/thinking/patch.ts`): the `compactLines` computation collapses to `config?.thinkingStyle === "Compact" ? 1 : 0` (3/5-line branches deleted); the existing `hidden`/`compact`/`full` state machine + click handler are untouched.
- **`patchToolRenderer`** (new `ui/src/tools/patch.ts`): wraps the native `ToolExecutionComponent` prototype methods (both names survive minification — verified in the 0.87.0 bundle):
  ```
  updateDisplay: if (!USER_TOGGLED && !this.expanded && liveConfig.toolStyle === "Full") this.expanded = true;  // first render → expanded
  setExpanded:   USER_TOGGLED = true;  // explicit user toggle → never auto-re-expand
  ```
  - `Full` → construction renders expanded; click-to-collapse sticks (per-instance `USER_TOGGLED` `Symbol`). `Compact` → zero behavior change.
  - **No double-wrap:** a module-level `wrapped` flag wraps once per process; later `session_start` calls only refresh a module-level `liveConfig`. `TOOL_PATCH_VERSION_KEY` set for observability (mirrors the thinking patch).
  - **Graceful degradation:** missing `ToolExecutionComponent`/methods → no-op, tools keep the native collapsed default.

## Files

- **new:** `meta/src/onboarding.ts` (+ the overlay component), `meta/src/onboarding.test.ts`, `packages/ui/src/tools/patch.ts`, `packages/ui/src/tools/patch.test.ts`
- **changed:** `meta/src/index.ts` (register `registerOnboarding`), `meta/src/settings.ts` (onChange), `packages/ui/src/config.ts`, `packages/ui/src/migration.ts` (+ test), `packages/ui/src/settings.ts`, `packages/ui/src/index.ts` (migration + `patchToolRenderer` call), `packages/ui/src/thinking/patch.ts` (+ test)

## Tests (vitest)

- `meta/src/onboarding.test.ts` — gates (TUI/marker/non-TUI), `finish()` write logic (answered-only, style seeds both, changed-only plugin writes, marker-last, marker-not-set-on-throw), pre-selection.
- `packages/ui/src/config.test.ts` — `normalizeOutputStyle` (new + legacy), `DEFAULT_UI_CONFIG`.
- `packages/ui/src/migration.test.ts` — `migrateCompactThinkingToStyle` (Off→Full, 1/3/5→Compact, no-op, preserves existing).
- `packages/ui/src/tools/patch.test.ts` — mock `@earendil-works/pi-coding-agent` (thinking-patch pattern): wrapped methods, `expanded→true` under `Full`, `USER_TOGGLED` blocks re-expand, no double-wrap, graceful no-op.
- `packages/ui/src/thinking/patch.test.ts` — update to `thinkingStyle` (drop 3/5-line cases, add Full/Compact).

## Non-goals

- No re-onboarding on update/new-plugin (first-run only). No live spinner preview. No per-question "Other"/free-text. No mid-session re-application of patches (next-session effect). No changes to the `ask` package.
