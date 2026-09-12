---
status: committed
done-when: A long busy episode (>45s) shows a fresh spinner quip re-picked every 15–45 seconds (subtle, never predictable); a new busy episode always starts a fresh quip and resets the rotation; idle persistence, custom/empty `editorSpinLabel`, and `spin: false` behavior are unchanged
---

# Quip timer rotation Plan

**Goal:** Re-rotate the spinner quip on a subtle random timer (15–45s) during long busy episodes, on top of the existing per-episode pick (plan: spinner quips, PR #50).

**Architecture:** Pure state inside the existing `spinTimer` tick loop in `HephaestusEditor` — no new `setInterval`. A per-episode tick counter (reset on each idle→busy transition, alongside the existing fresh pick) accumulates while busy; at a per-episode random threshold (15–45s converted to ticks) the quip is re-picked via the existing `pickQuip(previous)` (repeat exclusion already handled). Corrupt-config / custom-label / empty / `spin:false` paths are untouched — the quip block is the only place these fields are read.

**Tech Stack:** TypeScript (`.ts` via pi's jiti loader, no build step), vitest, pnpm workspace. Design authority: 2026-09-12 `ask` — **random 15–45s** (not fixed 30/60), **new episode resets the rotation and picks fresh**, zero-config (no new setting "editorSpinLabel family").

---

### Task 1: rotation state in the editor

**Context:** Today the quip is picked only on the idle→busy transition (shipped, PR #50). Long episodes (a 2-min build) show one quip for the whole time. This adds the in-episode re-rotation: a tick counter that accumulates only while busy, and a per-episode random threshold.

**Files:**
- Modify: `packages/core/src/editor/index.ts` (editor class + option doc comment near `spinLabel`)

**What to implement:**

- New private fields (next to `spinQuip` / `wasBusy`):
  - `spinQuipTicks: number` — ticks accumulated in the current rotation window (0 on pick/reset; **initializer `= 0`**)
  - `spinQuipEveryTicks: number` — this window's threshold in ticks (**initializer `= 0`** — safe: never read before the idle→busy branch assigns it, since `spinQuipTicks` only increments after that branch has run)
  - `quipRand: () => number` — injected random source, **initializer `= Math.random`**; constructor gains **no** signature change — tests override it the way this file's existing test seams work: direct `as any` overwrite of the private member (e.g. `(ed as any).quipRand = () => 0.5`), exactly like the `isIdle` override — **no setter is added to the class**
  - `spinTickMs` promoted from its local `const` to a `private readonly` field **with initializer `= 32`** (the clamp floor; when `spin: false` it stays at the harmless unused default — doc comment: "tempo set when `spin` is on; the default is inert since `rotationThresholdTicks()` is only reached on busy ticks, which imply spin is on") and **re-assigned inside the existing `if (spin)` block** next to the `setInterval` call (readonly reassignment in the constructor is legal TS; the initializer is required to avoid TS2463 under the root `strict` tsconfig)
- Constants in `spin-quips.ts`: `export const QUIP_ROTATION_MIN_SECS = 15; export const QUIP_ROTATION_MAX_SECS = 45;`
- `tickSpin` quip-block extension (case `labelMode === "quip"`):
  ```ts
  if (this.labelMode === "quip") {
    const busy = this.spinEnabled && !this.isIdle();
    if (busy && !this.wasBusy) {
      this.spinQuip = pickQuip(this.spinQuip, this.quipRand);
      this.spinQuipTicks = 0;                                   // episode start: fresh quip + reset
      this.spinQuipEveryTicks = this.rotationThresholdTicks();  // fresh 15–45s window
    } else if (busy) {
      this.spinQuipTicks += 1;
      if (this.spinQuipTicks >= this.spinQuipEveryTicks) {     // intra-episode re-rotation
        this.spinQuip = pickQuip(this.spinQuip, this.quipRand);
        this.spinQuipTicks = 0;
        this.spinQuipEveryTicks = this.rotationThresholdTicks(); // next window is a new draw
      }
    }
    this.wasBusy = busy;
  }
  ```
  `rotationThresholdTicks()` = `Math.ceil(seconds / this.spinTickMs)` where `seconds` is the **inclusive** 15–45s draw from the injected rand: `QUIP_ROTATION_MIN_SECS + Math.floor(this.quipRand() * (QUIP_ROTATION_MAX_SECS - QUIP_ROTATION_MIN_SECS + 1))` — the ceiling rounding guarantees the window is never shorter than requested.
  - While **idle** the counter neither accumulates nor resets (consumed window persists; the next busy episode re-starts anyway by the transition branch).
  - No rotation while `spinEnabled === false` (the quip block already gates on it via `busy`).
- Update the `spinLabel` option doc comment: "…re-picked on a random 15–45s timer while a busy episode continues".

**Steps:**
1. Read `packages/core/src/editor/index.ts` (spin timer setup + the shippable quip block) to place the fields and case exactly.
2. Add the constants to `spin-quips.ts` (export for tests' assertion of window bounds).
3. Implement the fields + the `rotationThresholdTicks()` + the injected `quipRand` (test seam via `as any`, no setter).
4. `npx tsc --noEmit` in `packages/core`.

**Notes / what NOT to change:**
- Do not add a `setInterval`; do not touch idle persistence (`spinQuip` survives idle — consumed, unchanged).
- No config shape change, no new "editorSpinLabel" family, no settings UI change.
- The 20-char-fit tier, wave-row case, and all previously-shippable label behavior is byte-unchanged.

---

### Task 2: tests

**Context:** Proven the rotation: (a) re-pick within a single long episode at the randomized interval, (b) episode re-start = new pick + reset, (c) no rotation while idle, (d) 15–45s window bounds, (e) all shippable behavior still holds (regression).

**Files:**
- Test: `packages/core/src/editor/index.test.ts` (extending the shippable quip cases, `vi.mock("./spin-quips.js")` is already in place)
- Test: `packages/core/src/editor/spin-quips.test.ts` (exporting the constant boundary)

**What to implement:** (extend the existing harness: `makeEditor(idleSeq)`, direct `tick()` calls, `busyAt(step)`)

- **Window bounds — ceiling form** (the real invariant; `ceil` can overshoot the max by less than one tick, so assert on **elapsed** seconds `seconds = ticks * tickMs / 1000`): `seconds >= 15` AND `seconds < 45 + tickMs / 1000`. Force periods via field override — no setting combination reaches them (`SPIN_INTERVALS` max 80 ms native × 1.5 (slow) = 120 ms): `(ed as any).spinTickMs = <ms>` immediately after `makeEditor(...)`, **before the first `tick()` call** (the window is drawn lazily on the first busy tick), with `(ed as any).quipRand = () => 0 | 0.5 | 1` for the three draws. For **exact** `[15, 45]` bounds use tick periods that divide 15000 / 30000 / 45000 evenly: **300 ms** (rand 0/0.5/1 → exactly 15 / 30 / 45 s), or 1000 ms (exact 15 / 30 / 45 s). The 2000 ms + rand=1 case (ceil(22.5) = 23 ticks = 46 s) exercises the loose ceiling bound.
- **Re-pick within a single episode:** one long busy run (`idleSeq` false for N ticks), mocked `pickQuip` (**unchanged** — it already ignores the 2nd `rand` argument; the `exclude = prior` assertion goes via the recorded first-arg call sequence), forced min window (rand = 0, tickMs = 300 → threshold T = 50 ticks), with **T < N < 2T (e.g. N = 60)**: the quip changes **exactly once** in-episode (the re-pick at tick 50; the next window re-draws at tick 100, never reached within the run), and each change is consumed with `exclude = prior`.
- **Idle consumption:** a busy run interrupted by idle: the counter does not accumulate during idle (no rotation across the idle gap), the label persists (shippable) — the tick paths of the two busy sides are the same until the next-episode branch runs.
- **Episode re-start resets:** after idle, when busy again: a new pick (with the existing exclude) is consumed and the counter resets (a re-rotation in the next episode needs the full window again, not the residual).
- **`spin:false` invariance** and **custom/empty-label regression** — re-assert the shippable cases are byte-unchanged (no new pick calls in those paths).
- Real `Math.random` (unmocked) sanity: 10 consecutive windows all within `[15 s, 45 s + 1 tick period)` (loop; loose upper bound made explicit — `ceil` overshoot adds at most one tick period).

**Steps:**
1. Extend `spin-quips.test.ts` with the boundary for the new exported constant.
2. Add the editor cases in `index.test.ts` (fake timers are already in the harness — direct `tick()` calls in tick units; no wall-clock advancement needed).
3. Run the core suite.

**Notes / what NOT to change:**
- Maintain the existing 12 spin-quip case and 42 editor cases green — only **add** cases; the `as any` field overwrites (`quipRand`, `spinTickMs`) are the only new surface the tests touch.

---

### Task 3: documentation sync

**Context:** The contracts in the README, glossary, and the released plan text say "once per busy episode" — that changes now.

**Files:**
- Modify: `packages/core/README.md` (spin bullets + the `editorSpinLabel` row)
- Modify: `CONTEXT.md` (spin-quip glossary entry — "picked per busy episode" → "picked per busy episode, re-picked on a random 15–45s timer while an episode continues")

**What to implement:**

- README bullet: `…the label switches to a random quip per busy episode — re-picked on a subtle random 15–45s timer while long episodes continue; set a custom value to pin it (an empty value still hides it as before).`
- The `editorSpinLabel` row likewise, in one short clause.
- Glossary: the spin-quip entry reflects the per-episode pick **and** the in-episode re-rotation; the busy-episode entry is implicitly unchanged.

**Steps:** edit both files; grep the repo for any residual "once per busy episode" in the current docs and bring them in line.

**Notes / what NOT to change:** plans (shippable, history) are never re-edited; no changelog (docs-only wording).

---

## Verification

- `npx tsc --noEmit` in `packages/core` (and the repo-wide sweep as before)
- `pnpm test` (all packages) — the new cases and **all** shippable cases green
- Manual smoke: a long busy run (e.g. a 1-minute build via a sub-agent) — QIP changes at **roughly irregular** 15–45s intervals; an idle gap preserves the last QIP; a new episode shows a different QIP immediately; custom `editorSpinLabel` freezes the rotation at that value; the narrow-terminal window-only tier is unchanged
