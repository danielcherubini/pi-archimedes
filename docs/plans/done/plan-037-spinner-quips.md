# Plan 037: Random spinner quips

**Status:** ✅ COMPLETED (PR #50, squash `96386d5`)
**PR:** #50 (merged 2026-09-12)
**Created:** 2026-09-12

## Goal

The border spinner label (default "Working") picks a random short nerdy quip (~50-entry pool) once per busy episode, unless the user typed a custom `editorSpinLabel` — zero-config fun, no new settings.

Direction approved via `ask` (2026-09-12): **one quip per busy episode** (no timer-while-busy rotation); **option B** (random whenever the label is left at its default or is corrupt; a custom label wins; empty still hides — no new setting, no settings-UI change); pool shape **~50 quips, hard 20-char cap, mixed nerdy tone, includes the literal "Working"**.

## Context

- The label is painted by `HephaestusEditor` (`packages/core/src/editor/index.ts`): while busy, a 4-cell border window is typed at the editor frame's top border and the `editorSpinLabel` setting (default `"Working"`) follows it, shown only when the box is wide enough (`inner >= labelWidth + 9` — the label-fit tier; narrower → window only; empty label → hidden). Over-long labels never sink the row.
- Precedence rule (approved): `""` → hidden; non-default string → verbatim; default `"Working"` **or non-string (corrupt config)** → random quip per busy episode. The pool contains the literal `"Working"`, so a hand-typed "Working" (indistinguishable from the default) surfaces through the pool on average.
- **Busy episode** (glossary, `CONTEXT.md`): the span from the agent becoming busy (idle → working) back to idle. **Spin quip** (glossary): the short (≤ 20 visible chars, ASCII-only) random label; picked per busy episode whenever `editorSpinLabel` is at its default.
- The editor already holds `isIdle()` and a spin timer (`tickSpin()`), so detection rides the existing tick — no new timer. `spin: false` stays fully inert (no timer at all).
- **No** config-shape change, **no** settings-UI change, **no** `core/src/index.ts` / `meta` change — the editor's constructor signature is unchanged; `spinLabel` still flows in raw.

## Design

### 1. New module `packages/core/src/editor/spin-quips.ts`

- `export const SPIN_QUIPS: readonly string[] = Object.freeze([ … ~50 entries … ]);`
- `export function pickQuip(exclude?: string, rand: () => number = Math.random): string`
  - Uniform pick: `SPIN_QUIPS[Math.floor(rand() * SPIN_QUIPS.length)]` — under the repo's `noUncheckedIndexedAccess` that indexed access is `string | undefined`, so the implementation needs the `!` non-null assertion (matches codebase style, e.g. `spin.ts` / `index.test.ts`).
  - If the first pick equals `exclude`, exactly **one** re-roll: uniform pick restricted to entries ≠ `exclude` (no loops). `rand` is injectable for deterministic tests.
- Content rules (enforced by the invariant test, Task 1): **40–60 entries**; each **1–20 chars** (ASCII ≤ 20 = ≤ 20 visible chars), **printable ASCII only** (no EAW chars — `visibleWidth` = char length by the existing test-width-probe convention); no leading/trailing spaces, no double spaces; all unique; exactly one `"Working"`.
- Tone: mixed nerdy — compute/OS references ("Compiling...", "Linking...", "Process spawning..."), CS/programmer folklore ("It works on mine...", "Stack Overflow..."), math/physics ("Singularities...", "Entropy rising..."). Style consistent: one or two words with ASCII `...` (NOT U+2026 — the ASCII-only invariant and the glossary entry forbid it; U+2026 is EAW-ambiguous-width). All examples above are ≤ 20 chars on purpose — every pool entry must be. Draft the full ~50 at implementation; content is open for review before merge, but the invariants must hold.

### 2. `packages/core/src/editor/index.ts` — per-episode quip selection

- Import `pickQuip` from `"./spin-quips.js"`.
- Constructor: derive an immutable label mode from the raw `spinLabel` (after the existing non-string → `"Working"` fallback into `safeSpinLabel`):
  - raw `""` (string) → `"hidden"` — no quip (legacy precedence).
  - non-string (corrupt) → `safeSpinLabel` becomes `"Working"` → `"quip"`.
  - `safeSpinLabel === "Working"` (default, or hand-typed) → `"quip"`.
  - any other non-empty string → `"verbatim"`.
- New private fields: `labelMode: "hidden" | "quip" | "verbatim"`; `spinQuip: string | undefined` (starts `undefined`; survives idle; re-picked on the next idle→busy transition); `wasBusy = false` (so an already-busy agent gets a quip on the first tick).
- `tickSpin()` — before the existing `borderSpinner tick` (selection lands before the first repaint):
  ```ts
  if (this.labelMode === "quip") {
    const busy = this.spinEnabled && !this.isIdle();
    if (busy && !this.wasBusy) this.spinQuip = pickQuip(this.spinQuip);
    this.wasBusy = busy;
  }
  ```
- `render()` — in the `borderRun` IIFE, replace `const label = this.spinLabel;` with:
  ```ts
  const label = this.labelMode === "quip" ? (this.spinQuip ?? this.spinLabel) : this.spinLabel;
  ```
  (Before the first busy tick `spinQuip` is `undefined` → the default "Working" shows for at most one tick — approved.) The existing `labelW` / `labelShown` fit-tier logic then operates on the resolved label, unchanged.
- **Do NOT change** `BorderTypeSpinner`, `dispose()`, the fit tier, EAW `visibleWidth` handling, palette/chrome, or any other file.

### 3. No other changes

No config, no settings UI, no settings table change beyond the documentation note in Task 3.

## Testable behavior

- Per-episode selection: first idle→busy transition picks (deterministic via a mocked `pickQuip`); busy→idle keeps the current quip (no re-pick on idle ticks); the next busy transition picks again with `exclude` = previous (mocked → different string, no immediate back-to-back repeat).
- Precedence: custom label verbatim; `""` hidden (no window-breaking label at any width); non-string corrupt config → quip mode, no crash; `spin: false` → inert (no quip logic, plain border).
- Fit tier: a 20-char quip hides below `inner` 29 (render width < 33) and shows at/above (reuse the existing fit-tier **assertion pattern** — hidden / edge-1 / on — but the 20-char tier needs the 32/33 widths, not the 19/20 widths of the 7/8-char tests).
- **Invariants** (Task 1): entry count 40–60; 1–20 chars; printable ASCII; no edge/double spaces; unique; `"Working"` exactly once; `pickQuip` returns a pool member, honors `exclude` (re-roll), and respects an injected `rand`.

## Tasks

### 1. TDD: quip pool module + invariants

- Create `packages/core/src/editor/spin-quips.ts` + `spin-quips.test.ts`.
- No external mocks needed — `spin-quips.ts` imports nothing from `@earendil-works/pi-tui` (string math only); plain assertions on `length` and the printable-ASCII char class enforce the visible-width contract.
- Table-drive the invariants from "Testable behavior" above; `pickQuip` cases: `rand = () => 0` → `SPIN_QUIPS[0]`; `exclude` = that entry → distinct pool member (re-roll); exclude path respects a second injected `rand` call.
- `npx tsc --noEmit` in `packages/core` + `pnpm test packages/core/src/editor/spin-quips.test.ts` green; commit `feat(core): spinner quip pool + picker`.

### 2. TDD: per-episode quip selection in the editor

- Modify `packages/core/src/editor/index.ts` per Design §2.
- In `packages/core/src/editor/index.test.ts` (existing harness: `makeEditor` with `idleSeq`, `tick()`, `busyAt()`, `borderRun()`, `rowFirmsToDashes`):
  - Add a top-of-file `vi.mock("./spin-quips.js", …)` whose `pickQuip` implements the mock semantics `{ exclude === undefined → "Quip A"; exclude === "Quip A" → "Quip B"; else → "Quip A" }` as **`pickQuip: vi.fn(baselineFn)` — the baseline as the `vi.fn` constructor argument, NOT `vi.fn().mockImplementation(baselineFn)`**: `afterEach`'s `vi.restoreAllMocks()` runs `mockReset()`, which clears `implementation`; dispatch then falls back to `state.getOriginal()`, which is the constructor baseline for `vi.fn(baselineFn)` but the `vi.fn()` noop (pickQuip → undefined) for the `.mockImplementation` form — the noop form silently breaks every default-label test after the first `afterEach`.
  - **Update the existing default-label tests** — recommended swap: pass `spinLabel: "Loading"` (7 chars — same visible width as the 7-char default "Working": `labelFit` stays 16 and the `LABEL.length`-derived slice/dash offsets stay valid; the shared `LABEL` constant becomes ` Loading `). Alternative: assert the mocked quip text instead ("Quip A" is 6 chars → `labelFit` 15, ` Quip A ` = 14 — in that variant the boundary widths and the `beat`/`compensatedAt60` offsets must be re-derived from the quip width). Do NOT use 8-char labels ("Thinking") for this swap: they shift the asserted 16 boundary to 17 and break the tests for the wrong reason.
  - **Exact list of default-path tests to update** (assert the label text via `LABEL` / `beat` / `compensatedAt60`; give each an explicit `spinLabel: "Loading"` on its `makeEditor` call): the 38-step busy-streak test (`index.test.ts:273-300`), step 1/8/32/hold tests (`:318-340`), the label-fit tier tests (`:352-365`), the corrupt-config test (`:460-464`, asserts `toContain(LABEL)`), the EAW tests (`:585-618`), **and the wave-rows test (`:495-507`)** — wave-rows is default-label quip mode and it never ticks, so under the `LABEL` rename it renders the one-tick " Working " flash while asserting against the renamed ` Loading ` constant it would fail; give it `spinLabel: "Loading"` too (then it renders ` Loading ` and passes — the "one-tick flash" rationale no longer applies to it).
  - **Pass unchanged — do NOT "fix" these**: the narrow-width-14 / below-floor / idle-all-dashes / empty-label tests (assert shapes / `not.toContain("Working")`, which stays true under the mock), both custom-"Thinking" verbatim tests (including `survives the cycle` at `:420`), and the 60-char-label test.
  - **Corrupt-config test**: extend the existing `null as unknown as string` test to assert quip-mode behavior (the quip shows, no crash) — one corrupt-path test, not two near-identical ones.
  - New tests (from "Testable behavior"): default label → "Quip A" in a busy `borderRun` at 60 cols and NOT the literal ` Working ` label; busy→idle→busy → "Quip B" on the second episode (mocked exclude — this test relies on the `vi.fn(baselineFn)` default, so it must NOT use `mockImplementationOnce`); `spinLabel: ""` → no label anywhere; `spin: false` → inert; a 20-char quip ("TwentyCharsQuipQuiz!", ASCII, ≤ 20) via a per-test override — keep the editor in a **single busy episode** so the one-time override is consumed exactly once and the stored quip is what both renders see: `vi.mocked(pickQuip).mockImplementationOnce(() => "TwentyCharsQuipQuiz!")` (the module is `vi.mock`-ed so the re-stub is available; `afterEach`'s `vi.restoreAllMocks()` clears the consumed once-queue for isolation) — render at width 32 (`inner` 28, hidden) and 33 (`inner` 29 = 1 + 4 + (1 + 20 + 1) + 2, shown), reusing the existing fit-tier assertion *pattern* (hidden / edge-1 / on) — do not paste the 19/20 widths.
- `npx tsc --noEmit` in `packages/core` + full `pnpm test` green (do not break other packages' suites); commit `feat(core): per-episode spinner quip selection`.

### 3. Docs + final verification

- `packages/core/README.md`: spinner feature bullet (line ~33) — note the default label shows a random short quip per busy episode (a custom `editorSpinLabel` pins a label; empty still hides it); config table `editorSpinLabel` row (line ~47) — default column stays `Working`; description: "Label shown alongside the border spinner; the default is replaced by a random short quip per busy episode — set a custom value to pin it".
- Run `npx tsc --noEmit` in **every package directory** (root typecheck per AGENTS.md) and full `pnpm test`.
- Commit `docs(core): spinner quip notes`.

## Verification

1. `npx tsc --noEmit` green in `packages/core` (and all other packages per AGENTS.md release hygiene)
2. `pnpm test` green repo-wide
3. Manual: symlinked TUI session — agent busy with default settings shows a quip in the top border; a new work episode shows a different one (never the same back-to-back); a custom `editorSpinLabel` wins; empty hides; narrow terminal (< 33 cols for a 20-char quip) drops the label to the window-only tier.

## Risks & notes

- The existing default-label tests in `index.test.ts` are the main breakage surface — Task 2 must update them deliberately (verbatim or quip-asserted), not delete them.
- `wasBusy` starts `false` **by design** so an already-busy session gets a quip on its first tick; do not "fix" this to read `isIdle()` at construction.
- Quips are ASCII-only on purpose: the label-fit tier uses `visibleWidth`, and the test-width probe already models ASCII = 1/char — any EAW mixed-in entry would make fit math unreliable under the mock.
- The one-tick "Working" flash before the first quip pick (busy agent, before the first tick) is accepted per the approved spec — not a bug to chase.
- No ADR is recorded for the "no shuffle toggle" trade-off (cheap to reverse — a toggle can be added later if users ask).
