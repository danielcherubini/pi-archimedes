---
status: committed
done-when: With default settings, the > prompt prefix in pi's editor shows a spinner while the agent is working and pi's standalone "Working" status line is hidden; the static > returns within one tick (~80 ms) when idle; EAW terminals get the ░▒▓█ shading walk (per-stage for typing, density-mapped for ported styles); toggling `editorSpinBorder` off in the settings UI restores pi's default "Working" line on next session (including after /reload).
---

# Prompt-Slot Spinner Plan

**Goal:** Replace pi's standalone "Working" status line with a spinner animation on the editor's `>` prompt prefix.
**Architecture:** `HephaestusEditor` (packages/core, custom editor) runs a self-driven 80 ms timer that advances braille frames in the 2-column prefix slot while `isIdle()` is false; `registerCore` (packages/core) hides the "working" indicator kind via `ctx.ui.setWorkingVisible(false)` on session start, restores it on session shutdown, and owns a module-scoped interval handle so `/reload` never leaks a timer. Verified against the pi 0.85.1 bundle: `setCustomEditorComponent` does NOT `dispose()` the replaced editor (it only `editorContainer.clear()`s), `resetExtensionUI()` resets `workingVisible = true` on every session invalidation (session_start re-applies everything afterwards), and `setWorkingVisible` affects only the "working" indicator kind — retry/compaction/branch-summary lines are a different kind and stay.
**Tech Stack:** TypeScript, pi-coding-agent 0.85.1 (type-level imports in `src/index.ts`; the `CustomEditor` value import in `src/editor/index.ts`; plus small value imports — `VERSION`, `AssistantMessageComponent`, `highlightCode`, `getAgentDir` — in `startup/`, `thinking/`, `settings-io.ts`), pi-tui (`visibleWidth`), vitest.

Conventions for every task below:
- Work in `packages/core` unless stated otherwise.
- Type-check: `cd packages/core && npx tsc --noEmit` — must exit 0 before committing.
- Tests: `cd packages/core && npx vitest run <file>` — must pass before committing.
- Do NOT run `npm install` / `npm publish`; this is a pnpm workspace.
- Do NOT modify `packages/core/src/chrome.ts` (PI_STR/PI_WIDTH/PI_SYMBOL_COL stay as-is), do NOT add theme keys, do NOT touch `settings-io.ts`.
- Do NOT use pi's `WorkingStatusIndicator` / `SelfStatusIndicator` / `embedWorkingStatus` plumbing — mechanism is a self-driven timer only.

---

### Task 1: Config field + settings item

**Context:**
One boolean gates the whole feature. It lives in the existing core config namespace `archimedes.core` (see `packages/core/src/config.ts`: `CoreConfig`, `DEFAULT_CORE_CONFIG`, `loadCoreConfig`, `saveCoreConfig`). Defaults follow the repo pattern `archimedes.*` in `~/.pi/agent/settings.json` via `settings-io.ts` (generic layer — do not modify). A default of `true` is deliberate: this suite's chrome is the default look; users who want pi's native "Working" line toggle the setting off (the OFF path is otherwise completely inert — no timer, no hide call, only an unconditional restore in the next session_start, see Task 3). A settings UI entry goes in `getCoreSettingsItems()` in `packages/core/src/index.ts` following the exact shape of the existing `mutedTheme` item (id/label/description/currentValue "On"/"Off"/values).

**Files:**
- Modify: `packages/core/src/config.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/config.test.ts`

**What to implement:**
- `config.ts`: add `editorSpinPrompt: boolean;` to `CoreConfig` and `editorSpinPrompt: true` to `DEFAULT_CORE_CONFIG`. Nothing else changes.
- `index.ts`: in `getCoreSettingsItems()`, append after the `animationStyle` item:
  ```ts
  {
    id: "editorSpinPrompt",
    label: "Editor Spin Prompt",
    description: "Spin the > prompt while the agent is working (hides the “Working” line)",
    currentValue: config.editorSpinPrompt ? "On" : "Off",
    values: ["On", "Off"],
  },
  ```
  (Match the object shape of the other items exactly — no extra properties.)
- `config.test.ts`: the existing `DEFAULT_CORE_CONFIG` shape test asserts the full object — update it to include `editorSpinPrompt: true`, and update the `loadCoreConfig → returns default config` assertion the same way. Do not change the other tests.

**Steps:**
- [ ] Write/extend the failing assertions in `packages/core/src/config.test.ts` (expecting `editorSpinPrompt: true` in the default shape)
- [ ] Run `cd packages/core && npx vitest run src/config.test.ts`
  - Did it fail with the missing-field assertion? If it passed unexpectedly, stop and investigate why.
- [ ] Implement the `config.ts` change
- [ ] Run `cd packages/core && npx vitest run src/config.test.ts`
  - Did all tests pass? If not, fix the failures and re-run before continuing.
- [ ] Implement the `getCoreSettingsItems` item
- [ ] Run `cd packages/core && npx tsc --noEmit`
  - Did it succeed? If not, fix and re-run before continuing.
- [ ] Run `cd packages/core && npx vitest run src/config.test.ts` (final)
- [ ] Commit with message: "feat(core): add editorSpinPrompt setting (default on)"

**Acceptance criteria:**
- [ ] `DEFAULT_CORE_CONFIG.editorSpinPrompt === true` and `CoreConfig` requires the field
- [ ] `getCoreSettingsItems({ ...DEFAULT_CORE_CONFIG })` contains the `editorSpinPrompt` item with `currentValue "On"` and `values ["On", "Off"]`
- [ ] `config.test.ts` green; `tsc --noEmit` green

---

### Task 2: Editor spinner engine

**Context:**
`HephaestusEditor` (packages/core/src/editor/index.ts) extends pi's `CustomEditor` and fully re-renders the editor chrome. On the first (input) line it draws `p.prefix(PI_STR)` where `PI_STR = "> "` (2 visible columns, `PI_WIDTH = 2`), and indents the autocomplete cursor line with `PI_SYMBOL_COL = 2` spaces. This task makes the 2-column prefix slot animate: static `>` when idle, current spinner frame + one space when busy, with a per-tick state machine that repaints the static `>` exactly once on busy→idle (a plain "idle → no-op" would leave a frozen frame on screen — this was a review finding). The timer must be flag-gated (no timer at all when `spin` is false) and clearable from outside the editor (pi 0.85.1 does not dispose replaced editors, so session hooks clear the module-scoped handle — see Task 3; the editor `dispose()` override is a safety net). Frame selection is probe-driven: braille frames `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` at 80 ms; if ANY frame's `visibleWidth()` is 2 (East-Asian-width terminals) use the width-1 fallback `|/-\`. No `chrome.ts` changes. No new theme keys — both the static `>` and the frames use the existing `p.prefix(...)` color.

**Files:**
- Modify: `packages/core/src/editor/index.ts`
- Create: `packages/core/src/editor/index.test.ts`

**What to implement:**
- Constructor options: extend the existing 4-arg constructor. Add two OPTIONAL fields (everything else unchanged, including the existing `super(tui, editorTheme, keybindings)` call):
  ```ts
  {
    getTheme,
    isIdle,
    shutdown,
    spin = false,
    onSpinInterval,
  }: {
    getTheme: () => Theme;
    isIdle: () => boolean;
    shutdown: () => void;
    /** Spin the > prompt while the agent is busy. */
    spin?: boolean;
    /** Lets an out-of-editor scope (core index.ts session hooks) clear the timer. */
    onSpinInterval?: (interval: ReturnType<typeof setInterval> | undefined) => void;
  }
  ```
- New private fields:
  ```ts
  private readonly spinFrames: string[];
  private readonly spinEnabled: boolean;
  private frameIdx = 0;
  private wasBusy = false;
  private spinTimer: ReturnType<typeof setInterval> | undefined;
  ```
  and static frame sets (module or class scope):
  ```ts
  const SPIN_FRAMES_BRAILLE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const SPIN_FRAMES_FALLBACK = ["|", "/", "-", "\\"];
  ```
- In the constructor body (after `super(...)` and the existing field assignments):
  - `this.spinEnabled = spin;`
  - `this.spinFrames = SPIN_FRAMES_BRAILLE.every((f) => visibleWidth(f) === 1) ? SPIN_FRAMES_BRAILLE : SPIN_FRAMES_FALLBACK;` (`visibleWidth` is already imported from `@earendil-works/pi-tui` in this file)
  - If `spin === true` (and only then):
    ```ts
    this.spinTimer = setInterval(() => this.tickSpin(), 80);
    this.onSpinInterval?.(this.spinTimer);
    ```
- New method (exact logic — busy advances from the previous frame; the first busy tick of a streak uses frame 0; idle-after-busy resets to 0 and repaints once; idle-after-idle is a full no-op):
  ```ts
  private tickSpin(): void {
    const busy = !this.isIdle();
    if (busy) {
      this.frameIdx = this.wasBusy ? (this.frameIdx + 1) % this.spinFrames.length : 0;
      this.tui.requestRender();
    } else if (this.wasBusy) {
      this.frameIdx = 0;
      this.tui.requestRender();
    }
    this.wasBusy = busy;
  }
  ```
- `render()`: replace `const piPrefix = p.prefix(PI_STR);` with:
  ```ts
  const spinPrefix =
    this.spinEnabled && !this.isIdle()
      ? this.spinFrames[this.frameIdx] + " "
      : PI_STR;
  const piPrefix = p.prefix(spinPrefix);
  ```
  Everything else in `render()` is unchanged (PI_WIDTH/PI_SYMBOL_COL math, autocomplete indent, hint logic).
- New `dispose()` method — the class has none today. **Verified against the installed 0.85.1 bundle: no pi-tui base type (`Component`, `EditorComponent`, `Editor`, `CustomEditor`) declares `dispose()`**, so define it WITHOUT `override` (structural typing accepts it; `override` would be a tsc error):
  ```ts
  dispose(): void {
    if (this.spinTimer) {
      clearInterval(this.spinTimer);
      this.spinTimer = undefined;
      this.onSpinInterval?.(undefined);
    }
  }
  ```
  (No `override` keyword — see the verified note above. Do not "fix" it to `override`.)
- `index.test.ts` — model the mocking approach on `packages/core/src/thinking/patch.test.ts` (`vi.mock` a module + dynamic `await import`). **Use `vi.useFakeTimers()` for the WHOLE file** (`beforeAll`/`afterAll` or per-test `useFakeTimers`/`useRealTimers` in `beforeEach`/`afterEach`) — every `spin: true` construction starts a live 80 ms interval, and tests 1–2 assert exact `requestRender` counts, which a real mid-test tick would break. Dispose all constructed editors in `afterEach`. Required constructor stubs: `tui: { requestRender: vi.fn(), terminal: { rows: 24 } } as unknown as TUI`, `editorTheme: { borderColor: (s: string) => s, selectList: {} as any } as unknown as EditorTheme`, `keybindings: {} as KeybindingsManager`, plus the options object. The `terminal` + `borderColor` stubs are REQUIRED for any test that calls `render()`: verified against the real 0.85.1 code — `Editor.prototype.render` reads `this.tui.terminal.rows` and calls `this.borderColor(border)` (set from `theme.borderColor` in the ctor); without them `render()` throws a `TypeError` (the re-throw in `render()` surfaces it). A plain `borderColor: (s) => s` keeps `isParentBorder` detection working so the `>` prefix line actually appears in the output. Tests to write:
  1. **Static prefix when idle (spin on, never busy):** construct with `spin: true`, `isIdle: () => true`; call `(ed as any).tickSpin()`; `requestRender` NOT called and `frameIdx` stays 0; `render` output (call with a width, stub theme via `getTheme: () => stubTheme` — reuse the minimal `{ fg: (k,t)=>t, ... }` stub pattern from `startup/sections.test.ts` if it fits, otherwise mock `../chrome.js` in this test file) contains `>` for the prefix.
  2. **Busy advances, then idle-after-busy repaints once:** `isIdle` mock returns false, false, true in sequence across three `tickSpin()` calls: busy #1 → `frameIdx === 0` + render; busy #2 → `frameIdx === 1` + render; idle → `frameIdx === 0` + exactly one render after the transition; a 4th idle tick → no further render (track with `requestRender` call count).
  3. **Timer lifecycle & gating:** with `vi.spyOn(globalThis, "setInterval")`: spin=false → not called; spin=true → called once with 80; `onSpinInterval` spy receives the handle at construction and `undefined` after `ed.dispose()`; `clearInterval` spy called on dispose. (Use `vi.useFakeTimers()`/`restore` around the suite so stray intervals can't fire.)
  4. **EAW width fallback:** in this file, `vi.mock("@earendil-works/pi-tui", ...)` providing `visibleWidth: (s: string) => (s === "⠋" ? 2 : 1)`-style behavior — i.e., any braille frame returns 2 → expect the prefix (busy) to come from `|/-\` (assert `frameIdx` math over a 4-frame set, e.g. tick twice busy → `frameIdx === 1`, and that the frame strings used are from the fallback set). Also provide the other value imports the editor uses (`truncateToWidth: (s, w, pad, incl) => s`, `isKeyRelease: () => false`) and type imports can be omitted from the mock. NOTE: `vi.mock` is hoisted — pick ONE mocking strategy for the file (either mock pi-tui for the whole file and stub `requestRender` on the tui everywhere, or use `vi.doMock` + dynamic import like patch.test.ts) so the mock applies consistently to all tests in the file.
  - Keep tests hermetic: every interval must be cleared in `afterEach` (`vi.useRealTimers()` + dispose any constructed editor).

**Steps:**
- [ ] Write the failing tests in `packages/core/src/editor/index.test.ts` (all four groups)
- [ ] Run `cd packages/core && npx vitest run src/editor/index.test.ts`
  - Did it fail (constructor option missing / no tickSpin / no dispose)? If it passed unexpectedly, stop and investigate why.
- [ ] Implement the changes in `packages/core/src/editor/index.ts`
- [ ] Run `cd packages/core && npx vitest run src/editor/index.test.ts`
  - Did all tests pass? If not, fix the failures and re-run before continuing.
- [ ] Run `cd packages/core && npx tsc --noEmit`
  - Did it succeed? If not, fix and re-run before continuing.
- [ ] Run `cd packages/core && npx vitest run src/editor/index.test.ts` (final)
- [ ] Commit with message: "feat(core): spin the > prompt while the agent is working"

**Acceptance criteria:**
- [ ] spin=false → zero timers, zero spawns, prefix is always `>` (behavior identical to today)
- [ ] spin=true → idle→busy→idle state machine paints: frame 0 on first busy tick, advancing while busy, one repaint + reset on return to idle, no-op after
- [ ] EAW terminals (any braille frame width 2) → `|/-\` set, 2-column slot preserved
- [ ] `dispose()` clears the timer and notifies `onSpinInterval(undefined)`
- [ ] spin=true still renders the static `>` when the agent is idle and is unused (prefix color unchanged, no new theme keys)

---

### Task 3: Session wiring (hide/restore + interval ownership)

**Context:**
`registerCore` in `packages/core/src/index.ts` already keeps `coreCtx` at module scope for shutdown cleanup and registers `session_shutdown` top-level (repo convention: top-level `pi.on(...)`, never inside `session_start`). Today `session_start` loads the config AFTER registering the editor factory (the `const config = loadCoreConfig()` line that feeds `patchThinkingRenderer`); the spin feature needs the flag BEFORE the factory, so the load moves up. This task wires: (1) `session_start` — store `spinFlag` in module scope, `clearSpinInterval()`, then UNCONDITIONALLY `ctx.ui.setWorkingVisible(!spinFlag)` (OFF → restores the default idempotently, recovering a carried-over hidden state; safe because pi's `resetExtensionUI()` resets `workingVisible = true` on every session invalidation before session_start re-applies), then register the editor factory with `spin: spinFlag` and `onSpinInterval: (i) => { spinInterval = i; }`; (2) `session_shutdown` — enabled-only restore `ctx.ui.setWorkingVisible(true)` + ALWAYS `clearSpinInterval()` + reset `spinFlag = false`. `/reload` rebind re-runs `session_start`, and the factory's pre-build `clearSpinInterval()` reaps an orphaned timer from the previous editor (pi does not dispose it — verified in the 0.85.1 bundle). The `onSpinInterval` callback is what makes `clearSpinInterval()` able to clear the editor's timer without a circular import (index.ts already imports editor/index.ts; the editor must NOT import index.ts).

**Files:**
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/src/index.test.ts`

**What to implement:**
- Module state (next to the existing `coreRef`/`coreCtx`/`coreTui` block):
  ```ts
  let spinFlag = false;
  let spinInterval: ReturnType<typeof setInterval> | undefined;
  function clearSpinInterval(): void {
    if (spinInterval) {
      clearInterval(spinInterval);
      spinInterval = undefined;
    }
  }
  ```
- `session_start` handler, in this order (relative to existing lines):
  1. After `coreCtx = ctx;` add: `const config = loadCoreConfig();` and `spinFlag = config.editorSpinPrompt;`
  2. Delete the later `const config = loadCoreConfig();` line (the one before `patchThinkingRenderer`) — use the hoisted `config`.
  3. Immediately BEFORE `ctx.ui.setEditorComponent(...)`: `clearSpinInterval();` and `ctx.ui.setWorkingVisible(!spinFlag);`
  4. Inside the `setEditorComponent` factory, extend the existing `new HephaestusEditor(...)` options with: `spin: spinFlag, onSpinInterval: (i) => { spinInterval = i; }`.
- `session_shutdown` handler, at the VERY TOP of the handler body (before the `if (coreRef)` listing-settled block — the snippet uses the handler's existing `_ctx` parameter):
  ```ts
  if (spinFlag) { _ctx.ui.setWorkingVisible(true); }
  clearSpinInterval();
  spinFlag = false;
  ```
- `index.test.ts` — `registerCore`'s only pure-logic seams are the `pi.on` handlers. Test approach: `const piMock = { on: vi.fn() } as unknown as ExtensionAPI; registerCore(piMock);` then pull captured handlers: `const handlers = piMock.on.mock.calls` — find `["session_start", fn]` and `["session_shutdown", fn]` (they are the ones registered for these literal strings; `message_end` is registered INSIDE the session_start handler, so the captured top-level calls are exactly: `session_shutdown` + `session_start`). **Verified empirically (node, plain imports): both `@earendil-works/pi-tui` and `@earendil-works/pi-coding-agent` import cleanly in the vitest node environment, and none of `index.ts`'s value imports have import-time side effects** (`bus.ts`/`capture.ts` define only functions; `patchConsoleLog` — called inside `registerCore` — is a pass-through; `thinking/patch.ts`, `startup/index.ts` are top-level function/constant declarations; the real `CustomEditor` ctor only stores references). Therefore the only mandatory mock is `vi.mock("./config.js", () => ({ ...vi.importActual("./config.js"), loadCoreConfig: vi.fn() }))` (plus optional hygiene no-op mocks of `./bus.js`, `./startup/capture.js`, `./thinking/patch.js` for a hermetic suite). Keep the REAL `HephaestusEditor` in the test — that is what makes the `setInterval`/`onSpinInterval` assertions meaningful. Stub ctx:
  ```ts
  const ctx: ExtensionContext = {
    ui: {
      setHeader: vi.fn(),
      setEditorComponent: vi.fn(),
      setWorkingVisible: vi.fn(),
      theme: {} as Theme,
    },
    isIdle: vi.fn(() => true),
    shutdown: vi.fn(),
  } as unknown as ExtensionContext;
  ```
  Mock the config seam: `vi.mock("./config.js", () => ({ ...vi.importActual("./config.js"), loadCoreConfig: vi.fn() }))` and control `editorSpinPrompt` per test. Mock the heavy side-effect modules the same way as `config.test.ts` does for `settings-io` — at minimum `./startup/capture.js` (`patchConsoleLog`/`unpatchConsoleLog` no-ops) and `./bus.js` (`initBus` no-op), plus `./thinking/patch.js` (`patchThinkingRenderer` no-op) and `./startup/index.js` (`renderHeader`, `patchStartupListing` no-ops) if they require real TUIs — keep the mock surface minimal; verify via `vi.mock` what actually throws if not mocked. Spies: `vi.spyOn(globalThis, "setInterval")` / `clearInterval`. Tests:
  1. **Default (on):** session_start → `setWorkingVisible` called with `false`; the `setEditorComponent` mock captured a factory — call it with `({}, {}, {}) as [TUI, EditorTheme, KeybindingsManager]` and assert the `setInterval` spy was called with `fn, 80` (i.e. a spinner timer exists for the constructed editor) and that `onSpinInterval` stored it (observable: `clearInterval` spy fires after the shutdown step below).
  2. **ON shutdown:** call the captured `session_shutdown` handler with `ctx` → `setWorkingVisible(true)` called, `clearInterval` spy called (timer reaped), `spinFlag` reset (observable: a SECOND shutdown call does NOT call `setWorkingVisible` again).
  3. **OFF:** `loadCoreConfig` mock → `{ ...DEFAULT_CORE_CONFIG, editorSpinPrompt: false }`; session_start → `setWorkingVisible` called with `true`; constructed editor creates NO `setInterval`; shutdown → `setWorkingVisible` NOT called, `clearInterval` NOT called (nothing to reap), and the next session_start still calls `setWorkingVisible(true)` (idempotent restore; the flag is re-stored).
  4. **Orphaned-timer reaping — exact sequence:** (1) invoke the session_start handler with `ctx` → capture factory A via the `setEditorComponent` mock → call factory A (real ctor starts `setInterval` → `onSpinInterval` stores the token); (2) note that token — it IS the module handle now; (3) **re-invoke the session_start handler with `ctx`** (this is the /reload rebind — `clearSpinInterval()` runs INSIDE session_start, so merely calling factory A again would NOT trigger it); (4) call the newly captured factory B; (5) assert `clearInterval(token)` occurred BEFORE factory B's `setInterval` via `spy.mock.invocationCallOrder`.
  - IMPORTANT: the real `HephaestusEditor` constructor runs (it extends the real pi `CustomEditor`; constructing it with the Task-2 stub shapes — `tui: { requestRender, terminal: { rows: 24 } }`, `editorTheme: { borderColor, selectList }`, `keybindings: {}` — is safe, verified: the base ctor only stores references). The `setInterval` assertion in test 1 depends on that real ctor; do NOT mock `./editor/index.js` unless something actually throws at import/construct time (per the verified note above, it will not). If you DID mock it, the mock class must itself call `setInterval` in its ctor (or replace test 1's timer assertion with one on recorded options) — a plain recording-only mock class silently breaks test 1.

**Steps:**
- [ ] Write the failing tests in `packages/core/src/index.test.ts` (all four groups)
- [ ] Run `cd packages/core && npx vitest run src/index.test.ts`
  - Did it fail (no module state / factory options missing / shutdown restore missing)? If it passed unexpectedly, stop and investigate why.
- [ ] Implement the `index.ts` wiring
- [ ] Run `cd packages/core && npx vitest run src/index.test.ts`
  - Did all tests pass? If not, fix the failures and re-run before continuing.
- [ ] Run `cd packages/core && npx tsc --noEmit`
  - Did it succeed? If not, fix and re-run before continuing.
- [ ] Run `cd packages/core && npx vitest run` (whole package — regression)
  - Did all suites pass? If not, fix and re-run.
- [ ] Commit with message: "feat(core): hide Working line + own the spinner timer across session lifecycle"

**Acceptance criteria:**
- [ ] ON: session_start hides the "working" line, factory constructs the editor with `spin: true` and a module-scoped interval handle; shutdown restores + reaps; a second shutdown is a no-op
- [ ] OFF: no timer, `setWorkingVisible(true)` (default), shutdown makes no `setWorkingVisible` call
- [ ] /reload (factory re-run) reaps an orphaned timer before constructing the new editor
- [ ] `message_end`/thinking code still receives `config` after the load move (whole-package test suite green)
- [ ] No circular import: `editor/index.ts` does not import `./index.js`

---

### Task 4: ADR + plan-file commit

**Context:**
Replacing pi's native "Working (⛟ ...)" status line with a prompt spinner is a genuine trade-off (screen cleanliness vs. losing the "esc to interrupt" label and the working label text) that a future reader will ask "why?" about. Repo convention: **ADR 0006+ live in `docs/adr/`** (highest existing number: **0013**, `0013-notify-on-pi-native-events.md`). (`docs/decisions/` contains only the early 0001–0005 with a divergent slug scheme — do NOT continue that sequence, and do NOT read 0012 from there.) Repo convention (AGENTS.md): plan/decision files are committed to git even though they start untracked.

**Files:**
- Create: `docs/adr/0014-prompt-slot-spinner.md`
- Modify: `docs/plans/README.md`
- Stage + commit: `docs/roadmap/prompt-slot-spinner.md` (this plan — the whole `docs/roadmap/` directory is currently untracked; `git add` it explicitly)

**What to implement:**
- ADR in the repo's existing ADR format (read `docs/adr/0013-notify-on-pi-native-events.md` — and 0012 for a second reference — and mirror their headings exactly). Content: context (pi 0.85.0 moved the working indicator into the default editor's top border; custom editors keep the standalone line unless `embedWorkingStatus` — which our editor's full re-render would silently swallow), decision (prompt-slot spinner via a self-driven timer; hide the "working" kind with `setWorkingVisible(false)` on session start; restore on shutdown), trade-offs accepted (no "esc to interrupt" label; retry/compaction/branch-summary lines remain as their own lines; custom editor + self-driven mechanism chosen over `embedWorkingStatus`+private-field access — see the 0.85.x changelog review), reversal path (toggle off via `archimedes.core.editorSpinPrompt`).
- `docs/plans/README.md` (repo plan-tracking index per AGENTS.md): add a row for this work pointing at `docs/roadmap/prompt-slot-spinner.md` with status IN PROGRESS (mark COMPLETED when the implementing PR merges), noting why this plan lives in `docs/roadmap/` rather than `docs/plans/plan-NNN-*` (skill-driven naming; the next `docs/plans` number would be 034).
- A short "manual verification" checklist in the ADR's "Consequences" section: start a turn (spinner + line gone) → turn end (static `>` ≤ ~80 ms) → `/compact` (compaction line + spinner) → toggle OFF + `/reload` (default "Working" line back) → East-Asian-width terminal (`|/-\`, 2 cols, autocomplete line aligned).

**Steps:**
- [ ] Read `docs/adr/0013-notify-on-pi-native-events.md` (and 0012) for the format
- [ ] Write `docs/adr/0014-prompt-slot-spinner.md`
- [ ] Add the `docs/plans/README.md` tracking row for `docs/roadmap/prompt-slot-spinner.md` (IN PROGRESS, with the naming note)
- [ ] `git add docs/adr/0014-prompt-slot-spinner.md docs/plans/README.md docs/roadmap/prompt-slot-spinner.md`
- [ ] `git commit -m "docs: ADR + plan for prompt-slot spinner"`
    - Commit succeeded? Confirm `git log --oneline -1` shows it.

**Acceptance criteria:**
- [ ] ADR lives at `docs/adr/0014-prompt-slot-spinner.md`, matches the 0012/0013 format, and is committed together with the plan file and the `docs/plans/README.md` row
