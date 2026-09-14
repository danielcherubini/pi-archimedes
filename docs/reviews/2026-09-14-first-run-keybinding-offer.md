# First-Run Keybinding Offer — 2026-09-14

## Summary

8 findings across 3 review iterations. 1 high, 3 medium, 2 low, 2 informational. All resolved. Merge-ready verdict issued at end of iteration 3.

## Context

- **Branch:** `feature/first-run-keybinding-offer`
- **Plan:** `docs/roadmap/first-run-keybinding-offer.md`
- **Commits (base → tip):**
  - `34a385c` `feat(image-paste): TDD first-run keybinding offer module`
  - `dc8bbe0` `feat(meta): wire first-run keybinding offer into session_start`
  - `83fefb7` `chore: document first-run keybinding offer in READMEs + settings tables`
  - `8bd7852` `fix(meta): correct the keybinding-offer gate rationale comment`
  - `e71c5d0` `test(meta): assert offerKeybindingFix wiring — invocation + rejection safety`
  - `02a3432` `chore: scope the first-run offer README wording to the suite install`
  - `9c8b51b` `docs: document the first-run offer exception to ADR 0012`
  - `4e31fc1` `test(image-paste): decouple error-path assertions; document TOCTOU test coupling`
  - `26ca129` `chore(tests): cosmetic nits — harness index comment, share CREATED_NOTIFY constant`
- **Change under review:** New module `packages/image-paste/src/keybinding-offer.ts` (`offerKeybindingFix`) — a one-time first-run offer to create `~/.pi/agent/keybindings.json` from the docs snippet so Pi's built-in `app.clipboard.pasteImage` binding does not double-fire with image-paste's Ctrl+V handler. Five gates in order: config-on → TUI mode → flag unset → file absent → confirm. Wired into `meta/src/index.ts` as a fire-and-forget `session_start` handler. Package gains `@pi-archimedes/core` workspace dependency and an exports map entry for the subpath. 101-test suite (`keybinding-offer.test.ts`). READMEs updated.
- **Iterations:** 3 (all findings resolved, no deferred items)
- **Verification (iteration 3):** `pnpm -r exec tsc --noEmit` clean; `pnpm test` 76 files / 1485 tests green; `meta` vitest 31/31 green

---

## Findings

### 🔴 High Severity

#### 1. Gate comment in `meta/src/index.ts` stated a false rationale
- **Lens:** Correctness / Documentation
- **Files:** `meta/src/index.ts:86–92` (original)
- **Severity:** High
- **Confidence:** High
- **Problem:** The comment above the `session_start` offer handler read: *"Deliberately NOT gated with `isPluginEnabled("image-paste")`: the module's own gate 1 (`isConfigEnabled("archimedes.imagePaste")`) is the single gate — meta's gate reads **a different namespace key** (ADR 0012), and double-gating would drift."* This is factually wrong: `isPluginEnabled("image-paste")` resolves to exactly `isConfigEnabled("archimedes.imagePaste")` (same call, same key). The comment named a false technical difference as the justification for an architectural decision, which would mislead future readers about how ADR 0012's gate works.
- **Proposal:** Correct the comment to state that adding a `isPluginEnabled` wrapper would be a redundant duplicate of the identical check already inside the module.
- **Resolution:** Fixed in `8bd7852`. Comment now reads: *"…that call resolves to `isConfigEnabled("archimedes.imagePaste")` (ADR 0012), which is exactly the same key the module's own gate 1 already checks — adding a wrapper here would be a redundant duplicate of the identical check."*

---

### 🟡 Medium Severity

#### 2. Package code reads the suite-managed `enabled` gate at runtime — undocumented ADR 0012 deviation
- **Lens:** Architecture / Policy
- **Files:** `packages/image-paste/src/keybinding-offer.ts:63` (gate 1), `docs/decisions/0012-plugin-gate-in-package-namespace.md`
- **Severity:** Medium
- **Confidence:** High
- **Problem:** `offerKeybindingFix` reads `archimedes.imagePaste.enabled` in-package at runtime (gate 1). AGENTS.md and ADR 0012 explicitly forbid package code from reading the suite-managed `enabled` flag — only meta may consume it. The plan approved this deviation, but the exception was not documented in the ADR or in the module, leaving an undocumented inconsistency with policy.
- **Proposal:** Add a sanctioned-exception block to ADR 0012 and a gate-comment in the module explaining why the rule cannot apply here (the handler fires before plugin registration, so there is no registration gate to catch it).
- **Resolution:** Documented in `9c8b51b`. ADR 0012 gained a formal `## Exception` section; gate 1 in the module gained a `// NOTE:` comment citing the exception and its rationale.

#### 3. No behavioral assertion on the offer wiring in `meta`
- **Lens:** Test Coverage
- **Files:** `meta/src/factory-lifecycle.test.ts`
- **Severity:** Medium
- **Confidence:** High
- **Problem:** The initial `meta/src/factory-lifecycle.test.ts` did not test that `offerKeybindingFix` is called from the `session_start` handler, or that a rejection inside it does not propagate to the caller. The fire-and-forget pattern is exactly the kind of wiring that silently breaks when someone adds a guard or changes the handler order.
- **Proposal:** Add two tests: (1) `offerKeybindingFix` is called exactly once with the session `ctx`; (2) `session_start` completes without throwing even when `offerKeybindingFix` rejects.
- **Resolution:** Added in `e71c5d0`. Both tests pass; the rejection test also asserts the error is logged via `console.error("[archimedes] keybinding offer failed:", ...)`.

#### 4. Standalone image-paste README overstated the offer
- **Lens:** Documentation Accuracy
- **Files:** `packages/image-paste/README.md`
- **Severity:** Medium
- **Confidence:** High
- **Problem:** The first-run offer note in the standalone README read "First-run offer (once ever, all platforms) — on the first TUI session…" without qualifying that the offer is only present when installed via the suite. A standalone `pi install @pi-archimedes/image-paste` user would have no `meta` session_start handler and would never see the offer — but the README implied otherwise.
- **Proposal:** Qualify the sentence to "when installed via the suite".
- **Resolution:** Fixed in `02a3432`. The note now reads "**First-run offer (once ever, all platforms)** — when installed via the suite, on the first TUI session…"

---

### 🟢 Low Severity

#### 5. OS-specific errno regex in error-path test assertions
- **Lens:** Test Fragility
- **Files:** `packages/image-paste/src/keybinding-offer.test.ts` (error-path describes)
- **Severity:** Low
- **Confidence:** High
- **Problem:** The error-path tests originally asserted on the exact error message string (e.g. checking for `EISDIR` or a platform-specific errno message). This couples tests to OS-level errno wording, which differs between Linux, macOS, and Windows — making the suite fragile on CI or when run cross-platform.
- **Proposal:** Decouple to non-empty message assertion (`expect(msg.length).toBeGreaterThan(0)`) plus behavioral invariants (flag unset, no file written, correct notify type).
- **Resolution:** Fixed in `4e31fc1`. Error-path assertions now check `type === "warning"` and `msg.length > 0`, plus the behavioral invariants.

#### 6. TOCTOU test coupled to exact `existsSync` call count
- **Lens:** Test Maintainability
- **Files:** `packages/image-paste/src/keybinding-offer.test.ts` (concurrent creation describe)
- **Severity:** Low
- **Confidence:** Medium
- **Problem:** The concurrent-creation test uses a spy that counts `existsSync` hits on the keybindings path and materializes the file on the second hit. This is intentionally coupled to the module's two `existsSync` calls (gate 4 check + pre-rename re-check). If the module ever de-duplicates or adds an existence check, the test will silently stop exercising the TOCTOU scenario.
- **Proposal:** Add a loud maintenance comment explaining the coupling, the expected call count, and the instruction to update the counter if the module's `existsSync` usage changes.
- **Resolution:** Added in `4e31fc1`. Comment now reads: *"NOTE: coupled to the module's two existsSync calls — gate-4 check, then the pre-rename re-check (keybinding-offer.ts). If the module de-duplicates or adds an existence check, update kbHits accordingly."*

---

### 💡 Informational (no action required)

#### 7. Concurrent-session edge — confirm resolves `false` on `/new` or `/reload`
- **Lens:** Edge Case / Documentation
- **Files:** `packages/image-paste/src/keybinding-offer.ts` (module doc comment)
- **Severity:** Informational
- **Confidence:** High
- **Problem / Note:** If the user runs `/new` or `/reload` while the confirm dialog is still open, `ctx.ui.confirm` resolves `false` (the TUI tears down). This counts as a decline — the one-shot flag is set and the offer will not appear again. The only recovery is manual deletion of `archimedes.imagePaste.keybindingsPromptDone` from `~/.pi/agent/settings.json`. This is intentional behavior (a torn-down session should not leave an open offer), but it was undocumented.
- **Resolution:** Documented in the module's top-level JSDoc comment in `34a385c` (initial implementation). No code change needed; the behavior is correct by design.

#### 8. Outer `try/catch` in the fire-and-forget handler — belt-and-suspenders
- **Lens:** Code Quality / Defensive Programming
- **Files:** `meta/src/index.ts:100–106`
- **Severity:** Informational
- **Confidence:** High
- **Problem / Note:** The `session_start` handler wraps `void offerKeybindingFix(ctx).catch(...)` in an outer `try/catch`. Since `offerKeybindingFix` is `async` and all throws from it flow into the `.catch()` chain, the outer `try/catch` cannot be reached by anything `offerKeybindingFix` throws — it would only catch a synchronous throw from the `void` expression itself, which cannot happen. The outer guard is therefore harmless redundancy.
- **Resolution:** Confirmed harmless during review. Left in place as belt-and-suspenders (the cost is zero; removing it would require a commit for no behavioral gain).

---

## Fixes Summary

| Commit | Description |
|--------|-------------|
| `8bd7852` | `fix(meta): correct the keybinding-offer gate rationale comment` |
| `e71c5d0` | `test(meta): assert offerKeybindingFix wiring — invocation + rejection safety` |
| `02a3432` | `chore: scope the first-run offer README wording to the suite install` |
| `9c8b51b` | `docs: document the first-run offer exception to ADR 0012` |
| `4e31fc1` | `test(image-paste): decouple error-path assertions; document TOCTOU test coupling` |
| `26ca129` | `chore(tests): cosmetic nits — harness index comment, share CREATED_NOTIFY constant` |

## Praise Worth Recording

- **101-test gate matrix** (`keybinding-offer.test.ts`): the 2×4×2×2×3 parametric suite (enabled × mode × file × flag × confirm outcome) covers every meaningful combination of the five gates in a single `it.each` block, with clear per-combination assertions on confirm call count, file creation, flag state, and notifications. Combined with the flag-preservation regression (load-modify-save must not erase other `archimedes.imagePaste` keys), two error-path describes, and the TOCTOU concurrency case, the suite is exhaustive and would catch any gate regression immediately.
- **Write ordering and TOCTOU handling in the module**: the file write strictly precedes the flag set (a failed write leaves both gates open → self-heals next session), and the pre-rename `existsSync` re-check prevents clobbering a concurrently created file. Both design decisions are tested explicitly.

---

## Top Recommendation

**Merge.** All findings were resolved across the review loop; iteration 3 verdict is Pass — zero actionable findings, `tsc --noEmit` clean, 1485 tests green.

Optional follow-up (not blocking): the `meta` vitest suite and the `sudo` package tests are not wired into the root vitest run or CI. Both packages are tested locally but the gap means a regression in `meta`'s `session_start` wiring or in `sudo`'s lifecycle would not be caught by CI. Worth a separate task to add `meta` (and `sudo`) to the root workspace test configuration.
