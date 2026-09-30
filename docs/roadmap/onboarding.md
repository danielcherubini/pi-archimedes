---
status: committed
done-when: A fresh install shows the modal on first TUI session; the three answers (or a skip) write thinkingStyle/toolStyle/editorSpinStyle/changed-plugin-flags + the onboarded marker; the modal never re-appears; an existing user's compactThinking migrates to thinkingStyle; thinkingStyle: Compact renders one-line thinking and toolStyle: Full starts all tools expanded; npx tsc --noEmit passes in ui + meta and the vitest suites are green.
---

# First-Run Onboarding + Full/Compact Style — Plan

> **Superseded (2026-09-30):** the single "style" question was split into **TWO independent questions** (thinking style + tool style), making the wizard a **4-step flow** (thinking → tool → plugins → spinner). The "seeds both to the same value" write was removed — `thinkingStyle` and `toolStyle` are now written independently (answered-only). The `styleAnswered`/`styleValue`, `styleDefault`/`STYLE_OPTIONS`, 3-element `cursorByStep`/`confirmed`, and shared-seeding descriptions below are stale.

> **Superseded wiring note (2026-09-15):** the Task 4 order `[keybinding-offer, onboarding, lazy-load]` (two separate first-run `session_start` handlers) was replaced by a **single merged first-run handler** that awaits `offerKeybindingFix` (now `Promise<boolean>`) and only then runs `runOnboarding` fire-and-forget — so the keybinding confirm never stacks with the onboarding overlay, and a triggered reload skips the onboarding on the stale ctx. `registerOnboarding` was removed; the lazy-load handler remains the LAST `session_start` handler.

**Goal:** Add a first-run onboarding modal (style / plugins / spinner) in `meta`, and introduce a `Full`/`Compact` output style that collapses the `compactThinking` setting and adds a `toolStyle` setting honored by a new native-tool patch.

**Architecture:** The onboarding is a module in `meta` (the sole writer of plugin `enabled` flags, ADR 0012) that opens a dedicated `ui.custom` overlay on `session_start` when `archimedes.meta.onboarded` is unset. The style is two independent `ui` settings (`thinkingStyle`, `toolStyle`); `thinkingStyle` replaces `compactThinking` (with a one-shot migration) and drives the existing thinking patch, while `toolStyle` drives a new `patchToolRenderer` that wraps the native `ToolExecutionComponent` so `Full` starts tools expanded.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), `@earendil-works/pi-coding-agent` (native components to patch), `@earendil-works/pi-tui` (overlay chrome), `@pi-archimedes/core/settings-io` (config read/write), vitest.

**Conventions for every task (CRITICAL — the root `tsconfig.json` is strict and test files ARE type-checked):**
- `strict` + `noUncheckedIndexedAccess` (every array index read is `T | undefined` — use `?? fallback` or a guard), `exactOptionalPropertyTypes`, `noImplicitReturns`, `verbatimModuleSyntax` (type-only imports use `import type`).
- **`npx tsc --noEmit` in a package type-checks `src/**/*.ts` INCLUDING `*.test.ts`** (the package `tsconfig.json` uses `include: ["src"]`). Every test edit must type-check.
- No build step — verify with `npx tsc --noEmit` in the package dir. No formatter — match the surrounding style (tabs).
- Run a targeted test with `npx vitest run <file>`.
- The native `ToolExecutionComponent` (`.d.ts`) declares `private expanded` and `private updateDisplay` (only `setExpanded` is public) — patch code must `as any` the prototype to touch them.

---

### Task 1: Full/Compact style — config rename + migration + settings items + thinking patch

**Context:**
Foundational rename everything else builds on. Today `ui` has a `compactThinking` setting (`"Off" | "1 line" | "3 lines" | "5 lines"`, where `"Off"` = full thinking and the rest = last-N-lines). Collapse it to a single `OutputStyle` type (`"Full" | "Compact"`) and add a second, independent `toolStyle` setting of the same type. Because removing `compactThinking` from `UIConfig` breaks every consumer at once, this task updates the config, the one-shot migration, the `UI_CONFIG_KEYS` list, the `/archimedes` settings items, the `meta` `onChange` handler, the package re-exports, the `patchThinkingRenderer` signature + `compactLines` computation, AND the three existing test files that assert on `compactThinking` — so the code type-checks and the suite is green after the commit. `Full` = today's `"Off"`; `Compact` = today's `"1 line"`; the 3/5-line branches are deleted.

**Files:**
- Modify: `packages/ui/src/config.ts`
- Modify: `packages/ui/src/migration.ts` (add `migrateCompactThinkingToStyle` + update `UI_CONFIG_KEYS`)
- Modify: `packages/ui/src/settings.ts`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/src/thinking/patch.ts`
- Modify: `meta/src/settings.ts`
- Test: `packages/ui/src/config.test.ts`
- Test: `packages/ui/src/migration.test.ts`
- Test: `packages/ui/src/settings.test.ts`
- Test: `packages/ui/src/index.test.ts`
- Test: `packages/ui/src/thinking/patch.test.ts`

**What to implement:**

`packages/ui/src/config.ts`:
- Add `export type OutputStyle = "Full" | "Compact";`
- Add `export const OUTPUT_STYLE_VALUES: readonly OutputStyle[] = ["Full", "Compact"] as const;`
- Add `export const SPINNER_STYLES: readonly string[] = ["typing","pulse","rain","cascade","columns","wave-rows","diagonal-swipe","sparkle","pendulum","marquee"];` (the 10 `editorSpinStyle` values, matching the existing `SpinnerStyle` union exactly — do not reorder).
- Add:
  ```ts
  export function normalizeOutputStyle(value: unknown): OutputStyle {
    if (value === "Full" || value === "Compact") return value;
    if (value === "Off") return "Full";
    if (value === "1 line" || value === "3 lines" || value === "5 lines") return "Compact";
    return "Full";
  }
  ```
- In `UIConfig`: remove `compactThinking: CompactThinking;` and add `thinkingStyle: OutputStyle;` and `toolStyle: OutputStyle;`.
- In `DEFAULT_UI_CONFIG`: remove `compactThinking: "Off"` and add `thinkingStyle: "Full"` and `toolStyle: "Compact"`.
- Remove `export type CompactThinking = ...`, `export const COMPACT_THINKING_VALUES = ...`, and `export function normalizeCompactThinking(...)`.

`packages/ui/src/migration.ts`:
- Update `UI_CONFIG_KEYS` (currently `readonly (keyof UIConfig)[]` containing `"compactThinking"`): widen the type to `readonly (keyof UIConfig | "compactThinking")[]`, **keep** `"compactThinking"` in the list (so a legacy `archimedes.core.compactThinking` is still copied into `archimedes.ui` by `migrateCoreToUIConfig`, landing in reach of `migrateCompactThinkingToStyle`), and **add** `"thinkingStyle"` and `"toolStyle"`.
- Add a new export (the file already imports `loadConfig`, `saveConfig` from `@pi-archimedes/core/settings-io`):
  ```ts
  export function migrateCompactThinkingToStyle(): void {
    const raw = loadConfig("archimedes.ui", {});
    if (!("compactThinking" in raw)) return; // idempotent no-op
    const migrated: Record<string, unknown> = { ...raw };
    delete migrated.compactThinking;
    if (!("thinkingStyle" in migrated)) {
      const legacy = raw.compactThinking;
      migrated.thinkingStyle =
        legacy === "Off" ? "Full"
        : legacy === "1 line" || legacy === "3 lines" || legacy === "5 lines" ? "Compact"
        : "Full";
    }
    saveConfig("archimedes.ui", migrated);
  }
  ```
  (Read with an empty `{}` default so `raw` is the stored config, not a defaults-merged one. Preserve an existing `thinkingStyle`; do not touch `toolStyle`.)

`packages/ui/src/settings.ts` (`getUISettingsItems`):
- Replace the single `compactThinking` item (currently `values: ["Off","1 line","3 lines","5 lines"]`) with two items, each `values: [...OUTPUT_STYLE_VALUES]`:
  ```ts
  {
    id: "thinkingStyle",
    label: "Thinking Style",
    description: "How thinking blocks display (Full = full text, Compact = one line, click to expand)",
    currentValue: normalizeOutputStyle(config.thinkingStyle),
    values: [...OUTPUT_STYLE_VALUES],
  },
  {
    id: "toolStyle",
    label: "Tool Style",
    description: "How tool results display (Full = expanded, Compact = collapsed, click to expand)",
    currentValue: normalizeOutputStyle(config.toolStyle),
    values: [...OUTPUT_STYLE_VALUES],
  },
  ```
- Update the `./config.js` import in this file: replace `normalizeCompactThinking` with `normalizeOutputStyle`, and add `OUTPUT_STYLE_VALUES`.

`packages/ui/src/index.ts`:
- In the `./config.js` import: replace `normalizeCompactThinking` with `normalizeOutputStyle`.
- Add `import { migrateCompactThinkingToStyle } from "./migration.js";` and call `migrateCompactThinkingToStyle();` immediately after the existing `migrateCoreToUIConfig();` at the top of `registerUI`.
- In the `patchThinkingRenderer(...)` call in the `session_start` handler: replace `compactThinking: normalizeCompactThinking(config.compactThinking)` with `thinkingStyle: normalizeOutputStyle(config.thinkingStyle)`.
- In the `export { ... } from "./config.js"` re-export block: add `normalizeOutputStyle`, `OUTPUT_STYLE_VALUES`, and `type OutputStyle` (keep the existing re-exports).

`packages/ui/src/thinking/patch.ts`:
- Change the `./config.js` import from `import type { CompactThinking } from "../config.js";` to `import type { OutputStyle } from "../config.js";`.
- In the `patchThinkingRenderer` signature, change the config param field `compactThinking?: CompactThinking;` to `thinkingStyle?: OutputStyle;`.
- Replace the multi-branch `compactLines` computation with:
  ```ts
  const compactLines = config?.thinkingStyle === "Compact" ? 1 : 0;
  ```
  (Delete the `"3 lines"` / `"5 lines"` branches. Leave the `hidden`/`compact`/`full` state machine and the `MouseRegion` click handler untouched.)

`meta/src/settings.ts` (`openSettings` → `onChange`):
- Replace `case "compactThinking": uiConfig.compactThinking = newValue as UIConfig["compactThinking"]; break;` with:
  ```ts
  case "thinkingStyle": uiConfig.thinkingStyle = normalizeOutputStyle(newValue); break;
  case "toolStyle": uiConfig.toolStyle = normalizeOutputStyle(newValue); break;
  ```
- Update the `@pi-archimedes/ui` import to also bring in `normalizeOutputStyle` (re-exported from the package root by the `index.ts` change above).

**Existing test updates (required — these currently assert on `compactThinking` and will break):**
- `packages/ui/src/settings.test.ts`: the item-count assertion (currently 12) becomes **13** (one `compactThinking` row replaced by two: `thinkingStyle` + `toolStyle`); update the `id` list (drop `compactThinking`, add `thinkingStyle` + `toolStyle`); update the `currentValue` assertion (was `toBe("Off")` for `compactThinking`) to assert `thinkingStyle`/`toolStyle` `currentValue` is `"Full"`/`"Compact"`; update the invalid-value test (was `{ ...DEFAULT_UI_CONFIG, compactThinking: "invalid" as any }`) to `{ ...DEFAULT_UI_CONFIG, thinkingStyle: "invalid" as never }` asserting `normalizeOutputStyle` normalizes it to `"Full"`. Also update the test title ("exposes all 12 UI setting items…") to 13.
- `packages/ui/src/index.test.ts`: (a) extend the `vi.mock("./migration.js", ...)` factory to include `migrateCompactThinkingToStyle: vi.fn()` (the new call at the top of `registerUI` would otherwise throw `not a function` in every test in this file); (b) change the `patchThinkingRenderer` assertion (currently `objectContaining({ ..., compactThinking: "Off" })`) to `objectContaining({ ..., thinkingStyle: "Full" })`.
- `packages/ui/src/migration.test.ts`: the `UI_CONFIG_KEYS` test — keep the `toContain("compactThinking")` assertion (still true, we keep it) and add `toContain("thinkingStyle")` and `toContain("toolStyle")`.

**Steps:**
- [ ] In `packages/ui/src/config.test.ts`, write failing tests for `normalizeOutputStyle` (returns `"Full"`/`"Compact"` as-is; maps `"Off"`→`"Full"`, `"1 line"`/`"3 lines"`/`"5 lines"`→`"Compact"`, and any other/`undefined`→`"Full"`), `OUTPUT_STYLE_VALUES` (`["Full","Compact"]`), `SPINNER_STYLES` (the 10 values), and `DEFAULT_UI_CONFIG` (`thinkingStyle === "Full"`, `toolStyle === "Compact"`). Remove/replace any tests for the removed `normalizeCompactThinking`/`COMPACT_THINKING_VALUES`. **Also update the two full-object `toEqual({...})` fixtures** (the `loadUIConfig` fixture ~line 37 and the `DEFAULT_UI_CONFIG` fixture ~line 80) to swap `compactThinking: "Off"` for `thinkingStyle: "Full"`, `toolStyle: "Compact"`.
- [ ] Run `npx vitest run packages/ui/src/config.test.ts`
  - Did it fail (function/exports missing)? If it passed unexpectedly, stop and investigate why.
- [ ] In `packages/ui/src/migration.test.ts`, (a) add `migrateCompactThinkingToStyle` tests: `"Off"`→writes `thinkingStyle:"Full"` + deletes `compactThinking`; `"1 line"`/`"3 lines"`/`"5 lines"`→`thinkingStyle:"Compact"`; unknown legacy→`"Full"`; no `compactThinking`→no `saveConfig` call (no-op); both `compactThinking` and `thinkingStyle` present→keeps existing `thinkingStyle`, deletes `compactThinking`; (b) update the `UI_CONFIG_KEYS` test per the "Existing test updates" above. Reuse the existing `vi.mock("@pi-archimedes/core/settings-io", ...)` in this file (it already mocks `loadConfig`/`saveConfig`/`removeConfig` via `vi.fn()` + per-test `mockImplementation` — extend it, don't replace it).
- [ ] Run `npx vitest run packages/ui/src/migration.test.ts`
  - Did it fail? If it passed unexpectedly, stop and investigate.
- [ ] Apply the `packages/ui/src/settings.test.ts` and `packages/ui/src/index.test.ts` updates above.
- [ ] In `packages/ui/src/thinking/patch.test.ts`, (a) change the `import type { CompactThinking } from "../config.js";` (line 2) to `import type { OutputStyle } from "../config.js";`; (b) change the helper's option field `compactThinking?: CompactThinking;` (line ~413) to `thinkingStyle?: OutputStyle;`; (c) map the `config: { compactThinking: "3 lines" }` / `"5 lines"` / `"1 line"` fixtures to `thinkingStyle: "Compact"` where the one-line behavior is under test and `thinkingStyle: "Full"` where the full behavior is; (d) remove the `"3 lines"`/`"5 lines"` cases and add cases asserting `thinkingStyle:"Compact"` yields the one-line (compact) render path and `thinkingStyle:"Full"` (or omitted) yields the full path. Keep the existing mock of `@earendil-works/pi-coding-agent`. **Note: vitest does not type-check** — the (a)/(b) type-level edits only surface at the `npx tsc --noEmit` gate, so apply them explicitly.
- [ ] Run `npx vitest run packages/ui/src/thinking/patch.test.ts`
  - Did it fail? If it passed unexpectedly, stop and investigate.
- [ ] Implement the `config.ts`, `migration.ts`, `settings.ts`, `index.ts`, `thinking/patch.ts`, and `meta/src/settings.ts` changes above.
- [ ] Run `npx vitest run packages/ui/src/config.test.ts packages/ui/src/migration.test.ts packages/ui/src/settings.test.ts packages/ui/src/index.test.ts packages/ui/src/thinking/patch.test.ts`
  - Did all tests pass? If not, fix the failures and re-run before continuing.
- [ ] Run `npx tsc --noEmit` in `packages/ui`
  - Did it succeed? If not, fix and re-run.
- [ ] Run `npx tsc --noEmit` in `meta`
  - Did it succeed? If not, fix and re-run.
- [ ] Commit with message: "feat(ui): replace compactThinking with thinkingStyle + toolStyle (Full/Compact) and add migration"

**Acceptance criteria:**
- [ ] `UIConfig` has `thinkingStyle` and `toolStyle` (both `OutputStyle`) and no `compactThinking`; `UI_CONFIG_KEYS` is widened to include `thinkingStyle`/`toolStyle` and still carries `compactThinking`.
- [ ] `normalizeOutputStyle` maps new + legacy values as specified; `DEFAULT_UI_CONFIG` is `thinkingStyle:"Full"`, `toolStyle:"Compact"`; `SPINNER_STYLES` matches the `SpinnerStyle` union.
- [ ] `migrateCompactThinkingToStyle` is idempotent and converts `compactThinking`→`thinkingStyle` correctly.
- [ ] `/archimedes` shows `Thinking Style` and `Tool Style` rows (`["Full","Compact"]`); `meta` `onChange` handles both via `normalizeOutputStyle`.
- [ ] `patchThinkingRenderer` takes `thinkingStyle` and computes `compactLines = Compact ? 1 : 0`; 3/5-line branches are gone.
- [ ] `npx tsc --noEmit` passes in `packages/ui` and `meta`; all five `packages/ui` test files are green.

---

### Task 2: Tool patch (`patchToolRenderer`) + wiring

**Context:**
Adds `patchToolRenderer` so `toolStyle: "Full"` starts every native tool expanded and `toolStyle: "Compact"` (the default) leaves the native collapsed behavior untouched. It mirrors the `patchThinkingRenderer` pattern (a prototype patch applied on `session_start`, gracefully degrading to a no-op if the native shape changes). Unlike the thinking patch (a full *replacement* of `updateContent`, safe to re-apply), this is a *wrapper* around the native `updateDisplay`/`setExpanded`, so it must wrap **once per process** (a module-level `wrapped` guard) while refreshing a module-level `liveConfig` on every call. The native `ToolExecutionComponent` (exported from `@earendil-works/pi-coding-agent`) has `expanded = false` as a class field and prototype methods `updateDisplay()` (called at the end of the constructor and on every state change) and `setExpanded(v)` (the only write path for `expanded`); both names survive minification (verified in the 0.87.0 bundle). **The `.d.ts` declares `private expanded` and `private updateDisplay`** — so the patch must `as any` the prototype to read/write them (runtime is unaffected; this is purely the strict type-check).

**Files:**
- Create: `packages/ui/src/tools/patch.ts`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/tools/patch.test.ts`
- Modify: `packages/ui/src/index.test.ts` (mock `./tools/patch.js` so the real patch isn't applied as a test side effect)

**What to implement:**

`packages/ui/src/tools/patch.ts` (new):
```ts
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import type { OutputStyle } from "../config.js";

const TOOL_FRESH_KEY = Symbol.for("archimedes:toolFresh");

// Module-level: wrap once per process; refresh the live config on every call.
// A pi upgrade = a fresh module instance = fresh `wrapped`, so the wrapper is
// naturally re-applied to the new prototype — no version bookkeeping needed.
let liveConfig: { toolStyle?: OutputStyle } = {};
let wrapped = false;

/**
 * Make `toolStyle: "Full"` start every native tool expanded; `Compact` (the
 * default) leaves the native collapsed behavior untouched.
 *
 * The tricky part: pi calls `component.setExpanded(this.toolOutputExpanded)`
 * (default `false`) immediately after constructing each `ToolExecutionComponent`
 * (interactive-mode.js lines 2753/2820/3149 — synchronous, and therefore always
 * the FIRST `setExpanded` on any instance). The other `setExpanded` calls on a
 * `ToolExecutionComponent` — the result-area click handler (tool-execution.js,
 * `this.setExpanded(!this.expanded)`) and the ctrl+o `setToolsExpanded` loop
 * (interactive-mode.js, duck-typed over `isExpandable` chatContainer children)
 * — arrive later and MUST be respected. A naive "auto-expand on updateDisplay,
 * flag on setExpanded" is defeated by that programmatic `setExpanded(false)`. So:
 *   - `updateDisplay` auto-expands a FRESH tool under Full (fresh = no
 *     `setExpanded` seen yet — the constructor's `updateDisplay` runs before pi's
 *     programmatic `setExpanded`).
 *   - `setExpanded` ignores the FIRST `setExpanded(false)` under Full (pi's
 *     construction default) but respects every other call (a user click, a
 *     ctrl+o `setToolsExpanded` toggle, or a `setExpanded(true)`), so a user
 *     collapse/expand sticks.
 */
export function patchToolRenderer(config: { toolStyle?: OutputStyle }): void {
  liveConfig = config; // always refresh (so /resume + re-patches see fresh config)
  if (!ToolExecutionComponent) return;
  // `updateDisplay` and `expanded` are `private` in the .d.ts — cast to patch them.
  const proto: any = ToolExecutionComponent.prototype;
  if (!proto) return;
  if (typeof proto.updateDisplay !== "function" || typeof proto.setExpanded !== "function") return; // graceful no-op
  if (wrapped) return; // already wrapped this process — do NOT double-wrap

  const origUpdateDisplay = proto.updateDisplay as (...args: unknown[]) => unknown;
  const origSetExpanded = proto.setExpanded as (expanded: boolean) => void;

  proto.updateDisplay = function (this: any, ...args: unknown[]): unknown {
    // Auto-expand a fresh tool under Full (fresh = pi's programmatic
    // setExpanded hasn't arrived yet — the constructor's updateDisplay is first).
    if (liveConfig.toolStyle === "Full" && !this[TOOL_FRESH_KEY] && !this.expanded) {
      this.expanded = true;
    }
    return origUpdateDisplay.apply(this, args);
  };
  proto.setExpanded = function (this: any, expanded: boolean): void {
    if (!this[TOOL_FRESH_KEY]) {
      this[TOOL_FRESH_KEY] = true;
      // Ignore pi's programmatic setExpanded(false) at construction under Full
      // (it would override the auto-expand). Respect setExpanded(true) and,
      // after the first call, every call (user click / ctrl+o).
      if (expanded === false && liveConfig.toolStyle === "Full") {
        return; // keep the auto-expanded state
      }
    }
    return origSetExpanded.call(this, expanded);
  };

  wrapped = true;
}
```
(`TOOL_FRESH_KEY` is per-instance — it marks that pi's construction-time `setExpanded` has arrived, after which every `setExpanded` (user click / ctrl+o) is respected. The `wrapped` guard prevents double-wrapping across sessions within one process.)

`packages/ui/src/index.ts`:
- Add `import { patchToolRenderer } from "./tools/patch.js";`.
- In the `session_start` handler, immediately after the `patchThinkingRenderer(...)` call (inside the same `if (ctx.hasUI)` block), add:
  ```ts
  patchToolRenderer({ toolStyle: normalizeOutputStyle(config.toolStyle) });
  ```

`packages/ui/src/index.test.ts`:
- Add `vi.mock("./tools/patch.js", () => ({ patchToolRenderer: vi.fn() }))` so the tests don't mutate the real `ToolExecutionComponent.prototype` as a side effect (and the new `patchToolRenderer` call in `registerUI` is a no-op in tests).

**Steps:**
- [ ] In `packages/ui/src/tools/patch.test.ts`, mock `@earendil-works/pi-coding-agent` (a `ToolExecutionComponent` class whose `prototype.updateDisplay`/`setExpanded` are spy functions), using the same `vi.doMock` + `vi.resetModules()` + dynamic-import pattern as `packages/ui/src/thinking/patch.test.ts`. Write failing tests asserting: (a) after `patchToolRenderer({ toolStyle: "Full" })`, `proto.updateDisplay` and `proto.setExpanded` are replaced (spies wrapped); (b) a fresh fake instance `{ expanded: false }` run through the wrapped `updateDisplay` ends with `expanded === true` when `toolStyle:"Full"` (auto-expand); (c) **pi's construction sequence** — a fresh instance under `Full`: run `updateDisplay` (auto-expands → `expanded === true`), then `setExpanded(false)` (pi's construction default → ignored, `expanded` stays `true`), then `updateDisplay` again → `expanded` is still `true` (the tool ends expanded, NOT collapsed — this is the regression the naive design fails); (d) **user collapse sticks** — a fresh instance under `Full`: `updateDisplay` (auto-expand → `true`), `setExpanded(false)` (first → ignored, stays `true`), `setExpanded(false)` again (second → respected → `expanded === false`), then `updateDisplay` → `expanded` stays `false` (no re-expand); (e) `toolStyle:"Compact"` (or omitted) leaves `expanded` `false` (no auto-expand) and `setExpanded(true)` expands it (respected); (f) calling `patchToolRenderer` twice does NOT double-wrap (one `updateDisplay` invocation calls the original spy exactly once); (g) when `ToolExecutionComponent` is `undefined` or the methods are missing, `patchToolRenderer` is a no-op (no throw, methods unchanged); (h) **per-instance fresh flag** — two fresh instances under `Full`: interleave `updateDisplay`/`setExpanded(false)` on instance A, then run `updateDisplay` on instance B → BOTH end `expanded === true` (a module-level fresh flag would fail this).
- [ ] Run `npx vitest run packages/ui/src/tools/patch.test.ts`
  - Did it fail (module missing / behavior absent)? If it passed unexpectedly, stop and investigate why.
- [ ] Implement `packages/ui/src/tools/patch.ts` and the `index.ts` + `index.test.ts` changes above.
- [ ] Run `npx vitest run packages/ui/src/tools/patch.test.ts packages/ui/src/index.test.ts`
  - Did all tests pass? If not, fix and re-run.
- [ ] Run `npx tsc --noEmit` in `packages/ui`
  - Did it succeed? If not, fix and re-run.
- [ ] Commit with message: "feat(ui): add patchToolRenderer (toolStyle Full starts tools expanded)"

**Acceptance criteria:**
- [ ] `patchToolRenderer` wraps `updateDisplay` (auto-expands a fresh tool under `Full`) and `setExpanded` (ignores the first `setExpanded(false)` under `Full` — pi's construction default — but respects every later call), wraps once per process, refreshes `liveConfig` every call, and no-ops gracefully when the native shape is missing.
- [ ] `index.ts` calls `patchToolRenderer({ toolStyle: normalizeOutputStyle(config.toolStyle) })` in `session_start` alongside `patchThinkingRenderer`; `index.test.ts` mocks `./tools/patch.js`.
- [ ] `npx tsc --noEmit` passes in `packages/ui`; the new test file is green.

---

### Task 3: Onboarding overlay component (pure UI)

**Context:**
Builds the onboarding modal's presentation as a pure, self-contained TUI component in `meta` — deliberately NOT a reuse of the `ask` package's `askQuestionsWithTabs` (whose "Other" option, cancel-discards-everything semantics, and blocked empty-multi-select don't fit a setup wizard). The component is a single `ui.custom` overlay (chrome from `@pi-archimedes/core/overlay`: `OVERLAY_CHROME`, `wrapWithBorder`, `renderHeader`, `renderFooter`, `padEnd`; `matchesKey`/`Key`/`truncateToWidth` from `@earendil-works/pi-tui`) with an internal `step` state (0→1→2) and no open/close flicker between steps. It is a pure function: it takes the pre-selected values + an `onDone` callback and returns a TUI component; it knows nothing about settings or plugins, so it is testable in isolation. The orchestration (Task 4) supplies the data and the `onDone` write logic. The `theme` option is typed as the structural `OverlayTheme` (not the `Theme` class, which has private members and can't be satisfied by a plain object mock).

**Files:**
- Create: `meta/src/onboarding/overlay.ts`
- Test: `meta/src/onboarding/overlay.test.ts`

**What to implement:**

`meta/src/onboarding/overlay.ts` (new):
```ts
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import {
  padEnd,
  renderFooter,
  renderHeader,
  wrapWithBorder,
  type OverlayTheme,
} from "@pi-archimedes/core/overlay";
import type { OutputStyle } from "@pi-archimedes/ui/config";

export interface OnboardingResult {
  styleAnswered: boolean;
  styleValue: OutputStyle;
  pluginsAnswered: boolean;
  pluginSelections: Record<string, boolean>;
  spinnerAnswered: boolean;
  spinnerValue: string;
}

export interface OnboardingOverlayOptions {
  theme: OverlayTheme;
  styleDefault: OutputStyle;
  plugins: { id: string; label: string; description: string; selected: boolean }[];
  spinners: readonly string[];
  spinnerDefault: string;
  onDone: (result: OnboardingResult) => void;
}

const STYLE_OPTIONS: { label: OutputStyle; description: string }[] = [
  { label: "Full", description: "Full thinking blocks, tools expanded" },
  { label: "Compact", description: "One-line thinking, collapsed tools" },
];

export function createOnboardingOverlay(opts: OnboardingOverlayOptions) {
  const theme = opts.theme;
  let activeStep = 0;
  // Clamp the pre-selected indices (a corrupt/unknown value → index 0, never -1).
  const cursorByStep: number[] = [
    Math.max(0, STYLE_OPTIONS.findIndex((o) => o.label === opts.styleDefault)),
    0,
    Math.max(0, opts.spinners.indexOf(opts.spinnerDefault)),
  ];
  const pluginToggles: boolean[] = opts.plugins.map((p) => p.selected);
  const confirmed: boolean[] = [false, false, false];
  let finalized = false;

  function optionsCountForStep(step: number): number {
    if (step === 0) return STYLE_OPTIONS.length;
    if (step === 1) return opts.plugins.length;
    return opts.spinners.length;
  }

  function finalize(): void {
    if (finalized) return;
    finalized = true;
    const styleIdx = cursorByStep[0] ?? 0;
    const spinnerIdx = cursorByStep[2] ?? 0;
    const pluginSelections: Record<string, boolean> = {};
    for (let i = 0; i < opts.plugins.length; i++) {
      const p = opts.plugins[i];
      if (!p) continue;
      pluginSelections[p.id] = pluginToggles[i] ?? false;
    }
    opts.onDone({
      styleAnswered: confirmed[0] ?? false,
      styleValue: STYLE_OPTIONS[styleIdx]?.label ?? "Full",
      pluginsAnswered: confirmed[1] ?? false,
      pluginSelections,
      spinnerAnswered: confirmed[2] ?? false,
      spinnerValue: opts.spinners[spinnerIdx] ?? "",
    });
  }

  function handleInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      cursorByStep[activeStep] = Math.max(0, (cursorByStep[activeStep] ?? 0) - 1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      cursorByStep[activeStep] = Math.min(
        optionsCountForStep(activeStep) - 1,
        (cursorByStep[activeStep] ?? 0) + 1,
      );
      return;
    }
    if (matchesKey(data, Key.space) && activeStep === 1) {
      const cur = cursorByStep[1] ?? 0;
      pluginToggles[cur] = !(pluginToggles[cur] ?? false);
      return;
    }
    if (matchesKey(data, Key.enter)) {
      confirmed[activeStep] = true;
      if (activeStep === 2) finalize();
      else activeStep += 1;
      return;
    }
    if (matchesKey(data, Key.escape)) {
      finalize();
      return;
    }
  }

  function render(width: number): string[] {
    const lines: string[] = [];
    lines.push(renderHeader(" Welcome to pi-archimedes ", width - 2, theme));
    lines.push(padEnd(`Set up your preferences · ${activeStep + 1}/3`, width - 2));
    lines.push("");

    if (activeStep === 0) {
      lines.push(padEnd("How should the output look?", width - 2));
      lines.push("");
      for (let i = 0; i < STYLE_OPTIONS.length; i++) {
        const opt = STYLE_OPTIONS[i];
        if (!opt) continue;
        const marker = i === (cursorByStep[0] ?? 0) ? "> " : "  ";
        lines.push(
          padEnd(
            `${marker}${opt.label.padEnd(9)}${truncateToWidth(opt.description, width - 14, "")}`,
            width - 2,
          ),
        );
      }
      lines.push("");
      lines.push(renderFooter(" [↑↓] move  [enter] next  [esc] finish ", width - 2, theme));
    } else if (activeStep === 1) {
      lines.push(padEnd("Which plugins do you want?", width - 2));
      lines.push("");
      for (let i = 0; i < opts.plugins.length; i++) {
        const p = opts.plugins[i];
        if (!p) continue;
        const marker = (pluginToggles[i] ?? false) ? "✓ " : "· ";
        const label = truncateToWidth(p.label, 18, "");
        lines.push(
          padEnd(
            `${marker}${label.padEnd(19)}${truncateToWidth(p.description, width - 22, "")}`,
            width - 2,
          ),
        );
      }
      lines.push("");
      lines.push(renderFooter(" [↑↓] move  [space] toggle  [enter] next  [esc] finish ", width - 2, theme));
    } else {
      lines.push(padEnd("Which spinner for the editor border?", width - 2));
      lines.push("");
      for (let i = 0; i < opts.spinners.length; i++) {
        const name = opts.spinners[i] ?? "";
        const marker = i === (cursorByStep[2] ?? 0) ? "> " : "  ";
        lines.push(padEnd(`${marker}${name}`, width - 2));
      }
      lines.push("");
      lines.push(renderFooter(" [↑↓] move  [enter] done  [esc] finish ", width - 2, theme));
    }

    return wrapWithBorder(lines, width, theme);
  }

  return {
    focused: true,
    render,
    handleInput,
    invalidate(): void {},
    dispose(): void {},
  };
}
```
(Notes: the `theme` option is `OverlayTheme` so a plain `{ fg: ... }` mock satisfies it; all index reads use `?? fallback` / guards for `noUncheckedIndexedAccess`; the `spinners` option is `readonly string[]` to match `SPINNER_STYLES`; pre-selected indices are clamped with `Math.max(0, …)` so a corrupt `spinnerDefault`/`styleDefault` lands on index 0, never `-1`; `finalize()` is the single `onDone` call site, guarded by `finalized`.)

**Steps:**
- [ ] In `meta/src/onboarding/overlay.test.ts`, build a mock `theme` as `{ fg: (_t: string, s: string) => s }` (satisfying `OverlayTheme`) and a spy `onDone` (`vi.fn()`). **Feed raw terminal input sequences, not `Key.*` literals** — the component's `handleInput(data: string)` runs `matchesKey(data, Key.X)`, and `matchesKey` compares against raw sequences (verified: `matchesKey("down","down")===false` but `matchesKey("\x1b[B","down")===true`). Use `"\x1b[B"` (down), `"\x1b[A"` (up), `"\r"` (enter), `" "` (space), `"\x1b"` (escape). Write failing tests asserting: (a) `render(80)` at step 0 shows both style options and the `styleDefault` carries the `> ` cursor; (b) `handleInput("\x1b[B")` then `handleInput("\r")` advances to step 1 (render shows the plugins header) and a later `finalize` reports `styleAnswered:true`; (c) on step 1, `handleInput(" ")` toggles the selected plugin and `finalize` reports the toggled `pluginSelections`; (d) `handleInput("\x1b")` on step 0 calls `onDone` exactly once with `styleAnswered:false`, `pluginsAnswered:false`, `spinnerAnswered:false`; (e) completing all three steps (`"\r"` ×3) calls `onDone` with all `*Answered:true` and the selected `styleValue`/`spinnerValue`/`pluginSelections`; (f) `onDone` is called at most once (a second `finalize`/escape is a no-op).
- [ ] Run `npx vitest run meta/src/onboarding/overlay.test.ts`
  - Did it fail (module missing)? If it passed unexpectedly, stop and investigate why.
- [ ] Implement `meta/src/onboarding/overlay.ts` above.
- [ ] Run `npx vitest run meta/src/onboarding/overlay.test.ts`
  - Did all tests pass? If not, fix and re-run.
- [ ] Run `npx tsc --noEmit` in `meta`
  - Did it succeed? If not, fix and re-run.
- [ ] Commit with message: "feat(meta): add onboarding overlay component (3-step setup wizard)"

**Acceptance criteria:**
- [ ] `createOnboardingOverlay` returns a TUI component with `render`/`handleInput`/`invalidate`/`dispose`/`focused`, renders the 3 steps with correct chrome, and drives `confirmed`/`cursor`/`pluginToggles` per the key map.
- [ ] `finalize()` calls `onDone` exactly once with the correct `OnboardingResult`; pre-selected indices are clamped (never `-1`).
- [ ] `npx tsc --noEmit` passes in `meta`; the test file is green.

---

### Task 4: Onboarding orchestration (gates + write logic + wiring)

**Context:**
Adds the onboarding's control logic in `meta`: the `session_start` gates (TUI-only + marker-unset), the config read for pre-selection, the `finish()` write logic (answered-only writes, style seeds both `thinkingStyle`+`toolStyle`, changed-only plugin `enabled` writes, marker-last self-heal ordering, per-invocation idempotence), and the `registerOnboarding` wiring into the meta factory. It reuses the Task 3 component and the existing `@pi-archimedes/core/settings-io` primitives (`updateConfig` for the `ui` namespace — concurrency-safe, preserves sibling keys — and `setPluginEnabled` from `../plugins.js` for plugin flags — on = delete key, off = write `false`). The marker lives in a new `archimedes.meta` namespace. This mirrors the `offerKeybindingFix` first-run precedent: a top-level `session_start` handler, fire-and-forget, deliberately not plugin-gated.

**Files:**
- Create: `meta/src/onboarding/index.ts`
- Modify: `meta/src/index.ts` (register `registerOnboarding` **between** the keybinding-offer `session_start` handler and the lazy-load `session_start` handler)
- Modify: `meta/src/factory-lifecycle.test.ts` (mock `./onboarding/index.js`)
- Test: `meta/src/onboarding/index.test.ts`

**What to implement:**

`meta/src/onboarding/index.ts` (new):
```ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, updateConfig } from "@pi-archimedes/core/settings-io";
import { OVERLAY_CHROME } from "@pi-archimedes/core/overlay";
import {
  DEFAULT_UI_CONFIG,
  loadUIConfig,
  normalizeOutputStyle,
  SPINNER_STYLES,
} from "@pi-archimedes/ui/config";
import { isPluginEnabled, PLUGINS, setPluginEnabled } from "../plugins.js";
import { createOnboardingOverlay, type OnboardingResult } from "./overlay.js";

const META_NS = "archimedes.meta";

export function registerOnboarding(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    void runOnboarding(ctx).catch((err) => console.error("[archimedes] onboarding failed:", err));
  });
}

export async function runOnboarding(ctx: ExtensionContext): Promise<void> {
  // Gate 1: TUI only (the marker is not consumed in non-TUI modes, so a later
  // TUI session still gets the onboarding — same as offerKeybindingFix gate 2).
  if (ctx.mode !== "tui") return;
  // Gate 2: marker unset.
  if (loadConfig(META_NS, { onboarded: false }).onboarded === true) return;
  // Defer one tick so the TUI processes current state (mirrors the ask IPC relay).
  await new Promise((resolve) => setImmediate(resolve));
  // Re-check the marker after the defer (a concurrent session may have set it).
  if (loadConfig(META_NS, { onboarded: false }).onboarded === true) return;

  const ui = loadUIConfig();
  const plugins = PLUGINS.map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    selected: isPluginEnabled(p.id),
  }));

  // Per-invocation idempotence: onDone runs the write at most once per runOnboarding.
  // A failed write leaves the marker unset, so the NEXT session re-runs with a
  // fresh `finished` and retries (self-heal).
  let finished = false;
  const finish = (result: OnboardingResult): void => {
    if (finished) return;
    finished = true;
    const uiMutations: Partial<typeof DEFAULT_UI_CONFIG> = {};
    if (result.styleAnswered) {
      uiMutations.thinkingStyle = result.styleValue;
      uiMutations.toolStyle = result.styleValue; // seeds both to the same value
    }
    if (result.spinnerAnswered) {
      uiMutations.editorSpinStyle = result.spinnerValue as typeof DEFAULT_UI_CONFIG["editorSpinStyle"];
    }
    try {
      if (Object.keys(uiMutations).length > 0) {
        updateConfig("archimedes.ui", DEFAULT_UI_CONFIG, (c) => ({ ...c, ...uiMutations }));
      }
      if (result.pluginsAnswered) {
        for (const p of PLUGINS) {
          const selected = result.pluginSelections[p.id];
          if (selected !== undefined && selected !== isPluginEnabled(p.id)) {
            setPluginEnabled(p.id, selected);
          }
        }
      }
      updateConfig(META_NS, { onboarded: false }, (c) => ({ ...c, onboarded: true })); // marker last
    } catch (err) {
      console.error("[archimedes] onboarding save failed:", err); // marker NOT set → self-heals
    }
  };

  await ctx.ui.custom((_tui, theme, _keybindings, done) => {
    return createOnboardingOverlay({
      theme,
      styleDefault: normalizeOutputStyle(ui.thinkingStyle),
      plugins,
      spinners: SPINNER_STYLES,
      spinnerDefault: ui.editorSpinStyle,
      onDone: (result: OnboardingResult) => {
        finish(result);
        done(undefined);
      },
    });
  }, { overlay: true, overlayOptions: OVERLAY_CHROME });
}
```
(Notes: `finished` is per-invocation (inside `runOnboarding`), NOT module-level — so a failed write that skips the marker still retries next session. `updateConfig` persists the full merged `ui` defaults (materializing all keys) — harmless. `setPluginEnabled` is imported from `../plugins.js` (it wraps `setConfigEnabled`).)

`meta/src/index.ts`:
- Add `import { registerOnboarding } from "./onboarding/index.js";`.
- Call `registerOnboarding(pi);` **between** the keybinding-offer `pi.on("session_start", …)` block and the lazy-load `pi.on("session_start", …)` block, so the `session_start` handler order is `[keybinding-offer, onboarding, lazy-load]` — preserving `factory-lifecycle.test.ts`'s assumptions that the offer handler is at index 0 and the lazy-load handler is LAST. Add an `archTime("registerOnboarding")` timing marker to match the surrounding pattern.

`meta/src/factory-lifecycle.test.ts`:
- Add `vi.mock("./onboarding/index.js", () => ({ registerOnboarding: vi.fn() }))` so the factory's `registerOnboarding(pi)` is a no-op in this fully-mocked harness (no real `runOnboarding` runs during unrelated tests, and no extra `session_start` handler shifts the index assumptions).

**Steps:**
- [ ] In `meta/src/onboarding/index.test.ts` (co-located with the module under test so the `vi.mock` specifiers `../plugins.js` and `./overlay.js` resolve to `meta/src/plugins.js` and `meta/src/onboarding/overlay.js`), mock `@pi-archimedes/core/settings-io` (in-memory store for `loadConfig`/`updateConfig`), `@pi-archimedes/ui/config` (`loadUIConfig`, `DEFAULT_UI_CONFIG`, `normalizeOutputStyle`, `SPINNER_STYLES`), `../plugins.js` (`PLUGINS`, `isPluginEnabled`, `setPluginEnabled`), and `./overlay.js` (`createOnboardingOverlay: vi.fn((opts) => { capturedOnDone = opts.onDone; return { render: () => [], handleInput: () => {}, invalidate: () => {}, dispose: () => {} }; })` to capture the `onDone` callback). Build a mock `ctx` (`{ mode: "tui", ui: { custom: vi.fn((factory) => { factory({} as never, { fg: (_t: string, s: string) => s } as never, {} as never, vi.fn()); return Promise.resolve(undefined); }), notify: vi.fn() } }`) — the `custom` mock **invokes the passed factory** so the (mocked) `createOnboardingOverlay` runs and `capturedOnDone` is set. Pass the mock to `runOnboarding` as `mockCtx as unknown as ExtensionContext` (the bare literal won't type-check under `npx tsc --noEmit`, which includes `src/`). Write failing tests asserting: (a) `runOnboarding` with `mode:"tui"` + marker unset calls `ctx.ui.custom`; (b) `mode:"rpc"` → `ctx.ui.custom` NOT called; (c) marker already `true` → `ctx.ui.custom` NOT called; (d) invoking the captured `onDone` with all-answered → `updateConfig("archimedes.ui", …)` writes `thinkingStyle`+`toolStyle` (both = the style value) + `editorSpinStyle`, `setPluginEnabled` is called only for changed plugins, and `updateConfig("archimedes.meta", …)` sets `onboarded:true` last; (e) invoking `onDone` with nothing answered → no `archimedes.ui` write, no plugin writes, but the marker IS set; (f) making a settings write throw → the marker is NOT set (self-heal).
- [ ] Run `npx vitest run meta/src/onboarding/index.test.ts`
  - Did it fail (module missing)? If it passed unexpectedly, stop and investigate why.
- [ ] Implement `meta/src/onboarding/index.ts` and the `meta/src/index.ts` + `factory-lifecycle.test.ts` changes above.
- [ ] Run `npx vitest run meta/src/onboarding/index.test.ts`
  - Did all tests pass? If not, fix and re-run.
- [ ] Run `npx vitest run meta/src/factory-lifecycle.test.ts`
  - Did all tests pass (handler positions intact)? If not, fix the `registerOnboarding` placement and re-run.
- [ ] Run `npx tsc --noEmit` in `meta`
  - Did it succeed? If not, fix and re-run.
- [ ] Run `npx vitest run meta` (the whole meta project) to confirm no regressions.
- [ ] Commit with message: "feat(meta): add first-run onboarding (gates + write logic + factory wiring)"

**Acceptance criteria:**
- [ ] `registerOnboarding` registers a top-level `session_start` handler that runs `runOnboarding` fire-and-forget, placed between the keybinding-offer and lazy-load handlers.
- [ ] `runOnboarding` gates on TUI-mode + marker-unset (re-checked after the tick deferral), reads current config for pre-selection, and opens the Task 3 overlay as a centered `OVERLAY_CHROME` overlay.
- [ ] `finish()` writes answered-only settings (style seeds both `thinkingStyle`+`toolStyle`), changed-only plugin `enabled` flags, and sets `archimedes.meta.onboarded` last (not on write failure); it is per-invocation idempotent.
- [ ] `factory-lifecycle.test.ts` passes (offer at index 0, lazy-load last) with `./onboarding/index.js` mocked.
- [ ] `npx tsc --noEmit` passes in `meta`; `npx vitest run meta` is green.

---

## Verification (after all tasks)
- `npx tsc --noEmit` in `packages/ui` and `meta` — both pass.
- `pnpm test` (root, all projects) — green.
- Manual smoke (optional): with a clean `~/.pi/agent/settings.json`, start pi in TUI → the onboarding overlay appears (3 steps); answer or Esc → settings written + `archimedes.meta.onboarded:true`; restart → no onboarding. Set `toolStyle:"Full"` → new tools render expanded; click to collapse sticks.

## Out of scope
No re-onboarding on update/new-plugin. No live spinner preview. No per-question "Other"/free-text. No mid-session re-application of patches (next-session effect). No changes to the `ask` package. Cosmetic note: the onboarding lists raw kebab spinner values while `/archimedes` shows Title-Case labels — accepted.
