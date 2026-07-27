# Add Tests Plan

**Goal:** Add Vitest unit tests for pure-logic functions across the monorepo (~50-70 test cases).
**Architecture:** Root Vitest workspace config pointing to all 8 packages. Tests live inline as `src/foo.test.ts` next to source files. No build step — Vitest handles TypeScript directly.
**Tech Stack:** Vitest (workspace mode), Node environment, no mocking framework needed (pure logic only).

---

### Task 1: Vitest Infrastructure

**Context:**
Set up the testing infrastructure — Vitest workspace config, per-package configs, and root test script. This is pure configuration with no test code yet. After this task, `pnpm test` should run (finding 0 tests) without error.

**Files:**
- Modify: `package.json` (root) — add vitest devDependency and test script
- Create: `vitest.workspace.ts` (root)
- Create: `packages/core/vitest.config.ts`
- Create: `packages/diff/vitest.config.ts`
- Create: `packages/footer/vitest.config.ts`
- Create: `packages/subagent/vitest.config.ts`
- Create: `packages/todo/vitest.config.ts`
- Create: `packages/notify/vitest.config.ts`
- Create: `packages/ask/vitest.config.ts`
- Create: `packages/image-paste/vitest.config.ts`

**What to implement:**

1. **Root `package.json`** — add to `scripts` and `devDependencies`:
   ```json
   "scripts": {
     "preinstall": "...",
     "test": "vitest run"
   },
   "devDependencies": {
     "vitest": "^3.0.0"
   }
   ```
   Do NOT modify any other fields.

2. **Root `vitest.workspace.ts`**:
   ```ts
   import { defineWorkspace } from "vitest/config";
   export default defineWorkspace([
     "packages/core",
     "packages/diff",
     "packages/footer",
     "packages/subagent",
     "packages/todo",
     "packages/notify",
     "packages/ask",
     "packages/image-paste",
   ]);

   // Note: meta is excluded — it is the orchestrator (depends on all packages) and
   // has no pure-logic functions to test in isolation.
   ```

3. **Each `packages/*/vitest.config.ts`** — identical content for all 8 packages:
   ```ts
   import { defineConfig } from "vitest/config";
   export default defineConfig({
     test: {
       environment: "node",
       include: ["src/**/*.test.ts"],
       exclude: ["**/node_modules/**"],
     },
   });
   ```

**Steps:**
- [ ] Add vitest to root package.json devDependencies and test script
- [ ] Run `pnpm install`
- [ ] Create `vitest.workspace.ts` at root
- [ ] Create `vitest.config.ts` in each of the 8 package directories
- [ ] Run `pnpm test` — should complete with 0 tests found (no error)
- [ ] Run `pnpm -r exec -- tsc --noEmit` — ensure type-check still passes
- [ ] Commit with message: "chore: add vitest test infrastructure"

**Acceptance criteria:**
- [ ] `pnpm test` runs without error (0 tests is fine)
- [ ] `pnpm -r exec -- tsc --noEmit` still passes
- [ ] All config files are valid TypeScript

---

### Task 2: Core Package Tests (color, text, bus)

**Context:**
Test the pure-logic functions in `@pi-archimedes/core`. These are the most reusable utilities — color conversion, ANSI stripping, key formatting, and the pub/sub bus. All are testable without mocking external dependencies (bus uses globalThis which we reset between tests).

**Files:**
- Create: `packages/core/src/color.test.ts`
- Create: `packages/core/src/text.test.ts`
- Create: `packages/core/src/bus.test.ts`

**What to implement:**

1. **`packages/core/src/color.test.ts`** — test all exported functions from `color.ts`:
   - `hexToRgb`: valid 6-char hex, 3-char shorthand, with/without `#`, invalid input throws
   - `rgbToHex`: round-trip with hexToRgb, clamps to 0-255
   - `rgbToHsl`: grayscale (r=g=b), pure red/green/blue, white, black
   - `hslToRgb`: round-trip with rgbToHsl, s=0 produces grayscale, h wraps at 360
   - `ansi256ToRgb`: codes 0-15 (xterm palette), 16-231 (6x6x6 cube), 232-255 (grayscale), out-of-range throws
   - `parseAnsiFgToRgb`: truecolor sequence (`\x1b[38;2;R;G;Bm`), 256 palette (`\x1b[38;5;Nm`), null/empty input
   - `deriveDimColor`: number input (ansi256), string input (hex), saturationFactor default 0.5, lightness clamping
   - `rgbToTruecolorFg`: produces correct `\x1b[38;2;R;G;Bm` format
   - `gray`: produces truecolor gray with correct level, clamps 0-255
   - `rgb`: produces truecolor with correct values
   - `extractRgb`: extracts from themed string, returns [100,100,100] default
   - `lerp`: t=0 returns a, t=1 returns b, t=0.5 returns midpoint

2. **`packages/core/src/text.test.ts`** — test pure functions from `text.ts`:
   - `stripAnsi`: CSI sequences, OSC sequences, DCS/SOS/APC/PM, character set escapes, nested escapes, empty string, no-escape string
   - `isParentBorder`: border char `─` returns true, border with SGR returns true, non-border returns false, empty returns false
   - `formatKey`: `ctrl+a` → `Ctrl+A`, `alt+shift+f` → `Alt+Shift+F`, `cmd` → `Cmd`, `meta` → `Cmd`, single char uppercase, multi-word capitalize, undefined returns "that key"
   - Skip `clampLine` and `clampLines` — these depend on `@earendil-works/pi-tui` which is a peer dep not available in tests

3. **`packages/core/src/bus.test.ts`** — test pub/sub + queue from `bus.ts`:
   - **CRITICAL:** Each test must reset `globalThis[Symbol.for("archimedes:bus")]` and `globalThis[Symbol.for("archimedes:busQueue")]` in `afterEach` to avoid test pollution
   - `emit` → `on` delivery: subscriber receives payload
   - Multiple subscribers: all receive the event
   - Unsubscribe: removed subscriber does not receive subsequent events
   - Error isolation: one listener throwing does not prevent others from receiving
   - Late subscriber queue: events emitted before `on()` are delivered when subscriber registers
   - `initBus`: flushes queued events
   - `Events` constant: verify all event names are defined

**Steps:**
- [ ] Write `color.test.ts` with all test cases listed above
- [ ] Run `pnpm test -- packages/core/src/color.test.ts` — verify all pass
- [ ] Write `text.test.ts` with all test cases listed above
- [ ] Run `pnpm test -- packages/core/src/text.test.ts` — verify all pass
- [ ] Write `bus.test.ts` with all test cases listed above (include globalThis cleanup)
- [ ] Run `pnpm test -- packages/core/src/bus.test.ts` — verify all pass
- [ ] Run `pnpm -r exec -- tsc --noEmit` — ensure type-check still passes
- [ ] Commit with message: "test: add core package tests (color, text, bus)"

**Acceptance criteria:**
- [ ] All 3 test files pass with `pnpm test`
- [ ] No test pollution (bus tests clean up globalThis)
- [ ] `tsc --noEmit` still passes across all packages

---

### Task 3: Diff Package Tests (ansi width, manip, word-diff)

**Context:**
Test the ANSI manipulation and width calculation utilities in `@pi-archimedes/diff`. These are critical for correct diff rendering — width miscalculations cause TUI overflow bugs.

**Files:**
- Create: `packages/diff/src/ansi/width.test.ts`
- Create: `packages/diff/src/ansi/manip.test.ts`
- Create: `packages/diff/src/word-diff.test.ts`

**What to implement:**

1. **`packages/diff/src/ansi/width.test.ts`** — test `width.ts`:
   - `graphemeWidth`: ASCII letter = 1, CJK (e.g. `中`) = 2, emoji (e.g. `✅`) = 2, zero-width (combining marks) = 0, tab = 2
   - `tokenize`: plain text produces single tokens, SGR sequence produces ansi+text pairs, bare ESC without `m` terminator handled gracefully, mixed ANSI + text
   - `visibleWidth`: plain ASCII length matches, wide chars counted correctly, ANSI escapes don't add width, empty string = 0

2. **`packages/diff/src/ansi/manip.test.ts`** — test `manip.ts`:
   - `strip`: removes SGR sequences, empty string stays empty
   - `tabs`: replaces `\t` with 2 spaces
   - `fit`: truncates to width (ASCII), truncates to width (wide chars — never splits grapheme), pads short strings, width 0 returns empty, wide grapheme wider than budget is dropped
   - `ansiState`: extracts last fg code, extracts last bg code, `\x1b[0m` resets both, truecolor fg/bg
   - `isLowContrastShikiFg`: "30" = true, "90" = true, "38;5;0" = true, "38;5;8" = true, "38;2;0;0;0" = true, "38;2;255;255;255" = false, non-fg params = false
   - `normalizeShikiContrast`: replaces low-contrast codes, leaves high-contrast alone
   - `lnum`: formats number right-padded, null produces spaces
   - `shortPath`: relative to cwd returns relative, outside cwd with home returns ~, empty returns empty
   - `summarize`: +N -M format, zero changes returns "no changes"

3. **`packages/diff/src/word-diff.test.ts`** — test `word-diff.ts`:
   - `wordDiffAnalysis`: identical strings → similarity 1, empty ranges; completely different → similarity 0, full ranges; partial overlap → correct similarity and ranges
   - `injectBg`: no ranges returns baseBg + line, single range highlights correctly, overlapping ranges merged, `\x1b[0m` triggers bg re-injection
   - `plainWordDiff`: removed text gets del bg, added text gets add bg, unchanged passed through

**Steps:**
- [ ] Write `width.test.ts` with all test cases
- [ ] Run `pnpm test -- packages/diff/src/ansi/width.test.ts` — verify all pass
- [ ] Write `manip.test.ts` with all test cases
- [ ] Run `pnpm test -- packages/diff/src/ansi/manip.test.ts` — verify all pass
- [ ] Write `word-diff.test.ts` with all test cases
- [ ] Run `pnpm test -- packages/diff/src/word-diff.test.ts` — verify all pass
- [ ] Run `pnpm -r exec -- tsc --noEmit` — ensure type-check still passes
- [ ] Commit with message: "test: add diff package tests (ansi, word-diff)"

**Acceptance criteria:**
- [ ] All 3 test files pass with `pnpm test`
- [ ] Width tests cover CJK, emoji, and zero-width graphemes
- [ ] `tsc --noEmit` still passes across all packages

---

### Task 4: Footer + Subagent Tests (format, cost-accumulator)

**Context:**
Test the formatting utilities in footer and the cost accumulator. These depend on core/bus (for CostAccumulator) and have interface dependencies (ColorFn for format functions) that need trivial mocks.

**Files:**
- Create: `packages/footer/src/utils/format.test.ts`
- Create: `packages/footer/src/cost-accumulator.test.ts`

**What to implement:**

1. **`packages/footer/src/utils/format.test.ts`** — test `format.ts`:
   - Mock `ColorFn` as `(token, text) => text` (passthrough — we test structure, not coloring)
   - `formatTokenCount`: 0 → "0", 500 → "500", 1024 → "1.0k", 10240 → "10k", 1048576 → "1.0M", 10485760 → "10M"
   - `formatContextBar`: 0% produces empty bar, 50% produces half-filled, 100% produces full bar, small availableSpace (≤2) returns empty
   - `formatGitStatusIndicators`: zero counts returns empty, staged > 0 shows indicator, multiple counts shows all
   - `formatThinkingIndicator`: "off" returns empty, other levels return indicator

2. **`packages/footer/src/cost-accumulator.test.ts`** — test `cost-accumulator.ts`:
   - **CRITICAL:** Reset `globalThis[Symbol.for("archimedes:bus")]` and `globalThis[Symbol.for("archimedes:busQueue")]` in `afterEach`
   - Create accumulator → subscribe → emit cost events → verify accumulated values
   - `reset()` zeroes all counters
   - `dispose()` unsubscribes (subsequent events not accumulated)
   - Multiple cost updates accumulate correctly
   - Missing fields in payload default to 0

**Steps:**
- [ ] Write `format.test.ts` with mock ColorFn and all test cases
- [ ] Run `pnpm test -- packages/footer/src/utils/format.test.ts` — verify all pass
- [ ] Write `cost-accumulator.test.ts` with bus cleanup and all test cases
- [ ] Run `pnpm test -- packages/footer/src/cost-accumulator.test.ts` — verify all pass
- [ ] Run `pnpm -r exec -- tsc --noEmit` — ensure type-check still passes
- [ ] Commit with message: "test: add footer and subagent tests (format, cost-accumulator)"

**Acceptance criteria:**
- [ ] Both test files pass with `pnpm test`
- [ ] CostAccumulator tests properly clean up bus globalThis state
- [ ] `tsc --noEmit` still passes across all packages

---

### Task 5: CI Integration

**Context:**
Add the test step to the existing CI workflow so tests run on every push and PR. This ensures regressions are caught before merge.

**Files:**
- Modify: `.github/workflows/ci.yml`

**What to implement:**

Add a test step after the type-check step in `ci.yml`:

```yaml
      - name: Test
        run: pnpm test
```

Insert this step after the "Type-check all packages" step. The test step uses `pnpm test` which runs `vitest run` (non-watch, exits with code 0 on success, non-zero on failure).

Do NOT modify any other parts of the workflow.

**Steps:**
- [ ] Add the test step to `.github/workflows/ci.yml` after the typecheck step
- [ ] Run `pnpm test` locally to verify full test suite passes
- [ ] Run `pnpm -r exec -- tsc --noEmit` to verify type-check still passes
- [ ] Commit with message: "ci: add test step to CI workflow"

**Acceptance criteria:**
- [ ] `pnpm test` passes locally (all tests across all packages)
- [ ] CI workflow file is valid YAML
- [ ] Test step is positioned after typecheck in the workflow
