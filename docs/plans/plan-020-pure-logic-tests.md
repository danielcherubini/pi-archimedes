# Pure Logic Tests Plan

**Goal:** Add unit tests + property-based tests for 21 untested pure-logic files across 6 packages, growing from 223 to ~400 tests.
**Architecture:** Co-located `*.test.ts` files alongside source, using Vitest (already configured per-package) and fast-check for property-based testing.
**Tech Stack:** Vitest 3.x, fast-check, TypeScript

---

## Task 1: Add fast-check dependency + Phase 1 easy wins (5 files)

**Context:** fast-check enables property-based testing — instead of hand-writing examples, you declare invariants and the library generates thousands of random inputs (including edge cases like unicode, empty strings, control chars). This task adds the dependency and covers the 5 smallest untested files to build momentum.

**Files:**
- Modify: `package.json` (root — add devDependencies)
- Create: `packages/core/src/thinking/transform.test.ts`
- Create: `packages/core/src/thinking/unindent.test.ts`
- Create: `packages/core/src/settings-io.test.ts`
- Create: `packages/core/src/config.test.ts`
- Create: `packages/subagent/src/cost.test.ts`

**What to implement:**

1. **Root `package.json`:** Add to `devDependencies`:
   ```json
   "fast-check": "^4.0.0"
   ```
   Run `pnpm install` to resolve. Use `fc.assert(fc.property(...))` directly inside `it()` blocks — no `@fast-check/vitest` wrapper needed.

2. **`thinking/transform.test.ts`** — Test `transformThinkingContent`:
   - Modifies thinking content on assistant messages
   - Skips non-assistant messages
   - Skips empty thinking
   - Calls `unindentCodeBlocks` on thinking content
   - Property: after transform, thinking is trimmed

3. **`thinking/unindent.test.ts`** — Test `unindentCodeBlocks`:
   - Strips common leading whitespace from fenced code blocks
   - Preserves empty lines structure
   - Leaves whitespace-only blocks untouched
   - Handles CRLF → LF normalization
   - Handles blocks with 0 indent on some lines (no stripping)
   - Property (fast-check): `unindentCodeBlocks(unindentCodeBlocks(x)) === unindentCodeBlocks(x)` (idempotence)
   - Property: output never contains `\r\n` (CRLF normalized to LF). Use `fc.fullString()` but filter out lone `\r` from generator to avoid false positives (lone `\r` passes through by design).

4. **`settings-io.test.ts`** — Test `loadConfig` and `saveConfig`:
   - **CRITICAL:** `SETTINGS_PATH` is computed at module load via `getAgentDir()`, and `node:fs` bindings are captured at import. Use `vi.hoisted` to set `process.env.PI_CODING_AGENT_DIR` before module evaluation, `vi.mock("@earendil-works/pi-coding-agent", ...)` to return a temp dir from `getAgentDir`, and `vi.mock("node:fs")` for all fs operations. Both `vi.mock` calls are hoisted automatically.
   - `loadConfig` returns defaults when settings missing
   - `loadConfig` merges settings over defaults
   - `loadConfig` returns defaults on corrupt JSON
   - `saveConfig` writes atomically (tmp + rename)
   - `saveConfig` falls back to direct write on rename failure

5. **`config.test.ts`** — Test `loadCoreConfig` and `saveCoreConfig`:
   - Mock `loadConfig`/`saveConfig` from settings-io using `vi.mock("../settings-io.js", ...)`
   - Verifies correct namespace (`archimedes.core`)
   - Verifies default config shape

6. **`cost.test.ts`** — Test `emitCostUpdate`:
   - Mock the Bus
   - Verifies `COST_UPDATE` event emitted with correct source prefix
   - Verifies usage fields passed through

**Steps:**
- [ ] Add `fast-check` to root `package.json` devDependencies
- [ ] Run `pnpm install`
- [ ] Create `thinking/transform.test.ts` with 4-5 example tests
- [ ] Create `thinking/unindent.test.ts` with 6-8 example tests + 2 property tests
- [ ] Create `settings-io.test.ts` with 6-8 tests (mock fs + getAgentDir)
- [ ] Create `config.test.ts` with 3-4 tests (mock settings-io)
- [ ] Create `cost.test.ts` with 3-4 tests (mock Bus)
- [ ] Run `pnpm test` — all tests pass
- [ ] Run `npx tsc --noEmit` in each modified package — type-check passes
- [ ] Commit with message: "test: add fast-check + Phase 1 easy wins (5 files)"

**Acceptance criteria:**
- [ ] All 5 test files pass with `pnpm test`
- [ ] fast-check property tests run without errors
- [ ] Type-check passes in all modified packages
- [ ] Total test count increases by ~25+ tests

---

## Task 2: Phase 2 medium files — thinking/patch, thinking/theme, diff/ansi (4 files)

**Context:** These files contain the core text processing and ANSI manipulation logic. They are the most bug-prone area (text transforms, color parsing) and benefit most from property-based testing.

**Files:**
- Create: `packages/core/src/thinking/patch.test.ts`
- Create: `packages/core/src/thinking/theme.test.ts`
- Create: `packages/diff/src/ansi/codes.test.ts`
- Create: `packages/diff/src/ansi/colors.test.ts`

**What to implement:**

1. **`thinking/patch.test.ts`** — Test `patchThinkingRenderer`:
   - This function patches `AssistantMessageComponent.prototype.updateContent` — heavily depends on Pi runtime
   - Test the guard conditions: returns early when proto is null, updateContent not a function, name mismatch
   - Test signature detection: skips patch when source lacks expected strings
   - Test version tracking: re-patches on version change
   - **CRITICAL:** `patch.ts` marks the prototype via `Symbol.for("archimedes:thinkingPatched")` (global-registry symbol). Each test must use a **fresh mock class** (not a shared one) or delete the symbol keys in `afterEach` to avoid state leaking between tests.
   - Mock `AssistantMessageComponent` and `VERSION` from pi-coding-agent using `vi.mock("@earendil-works/pi-coding-agent", ...)`

2. **`thinking/theme.test.ts`** — Test `dimAnsiLine` and `buildMutedMarkdownTheme`:
   - `dimAnsiLine`: rewrites ANSI fg color escapes to dimmed versions
   - Tests: single escape, multiple escapes, no escapes, non-fg escapes preserved
   - Tests: cache hit returns same result
   - Tests: unrecognized escape passed through unchanged
   - `buildMutedMarkdownTheme`: returns MarkdownTheme with all required fields
   - Tests: all theme fields are functions
   - Tests: heading/bold use gold color
   - Tests: codeBlock uses thinkingText
   - Property (fast-check): `dimAnsiLine` preserves non-ANSI text content (strip ANSI from both sides and compare)
   - Property: `dimAnsiLine` never introduces `38;5;` escapes (only produces truecolor `38;2;` output)

3. **`diff/ansi/codes.test.ts`** — Test ANSI code constants and theme resolution:
   - All exported constants are non-empty strings
   - `ANSI_RE` matches standard ANSI escapes
   - `ANSI_CAPTURE_RE` captures parameters
   - `ANSI_PARAM_CAPTURE_RE` captures numeric params
   - `themeCacheKey` returns deterministic string for same theme
   - `themeCacheKey` returns "no-theme" for null/undefined theme
   - `resolveDiffColors` returns DEFAULT_DIFF_COLORS when no theme
   - `resolveDiffColors` returns theme-derived colors when theme available
   - `resetDiffColors` clears cache (subsequent call re-derives)
   - Property: `themeCacheKey(a) === themeCacheKey(a)` (deterministic)

4. **`diff/ansi/colors.test.ts`** — Test `deriveBgFromTheme`:
   - `parseAnsiRgb` and `mixBg` are **not exported** — test only through `deriveBgFromTheme`'s public output.
   - `deriveBgFromTheme` returns DEFAULT_DIFF_BG when no theme (null, undefined, missing getFgAnsi)
   - `deriveBgFromTheme` derives colors from theme with getFgAnsi
   - `deriveBgFromTheme` uses bgBase from theme when available (getBgAnsi)
   - `deriveBgFromTheme` returns DiffBg with all required fields (bgAdd, bgDel, etc.)
   - Verify that bg colors are ANSI truecolor escapes (`\x1b[48;2;r;g;bm` format)
   - Verify that divider contains `FG_RULE` character
   - Property (fast-check): `deriveBgFromTheme` output `rst` always contains `\x1b[0m` (reset)

**Steps:**
- [ ] Create `thinking/patch.test.ts` with 5-6 tests (mock Pi runtime)
- [ ] Create `thinking/theme.test.ts` with 8-10 tests + 2 property tests
- [ ] Create `diff/ansi/codes.test.ts` with 8-10 tests + 1 property test
- [ ] Create `diff/ansi/colors.test.ts` with 8-10 tests + 3 property tests
- [ ] Run `pnpm test` — all tests pass
- [ ] Run `npx tsc --noEmit` in core and diff packages
- [ ] Commit with message: "test: Phase 2 — thinking/patch, theme, diff/ansi (4 files)"

**Acceptance criteria:**
- [ ] All 4 test files pass with `pnpm test`
- [ ] Property tests exercise edge cases (unicode, empty, huge inputs)
- [ ] Type-check passes in core and diff packages
- [ ] Total test count increases by ~40+ tests

---

## Task 3: Phase 2 medium files — footer, todo, subagent, ask (6 files)

**Context:** These cover the remaining medium-complexity files across packages. Mix of pure computation (stats, git parsing) and state management (todo, frontmatter).

**Files:**
- Create: `packages/footer/src/utils/stats.test.ts`
- Create: `packages/footer/src/utils/git.test.ts`
- Create: `packages/todo/src/state-manager.test.ts`
- Create: `packages/subagent/src/frontmatter-io.test.ts`
- Create: `packages/ask/src/cursor.test.ts`
- Create: `packages/ask/src/wrap.test.ts`

**What to implement:**

1. **`stats.test.ts`** — Test `getTokenUsageStats`, `invalidateStatsCache`, `getContextWindowInfo`:
   - Mock `ExtensionContext` with `sessionManager.getEntries()` and `getContextUsage()`
   - **CRITICAL:** Module-level `runningTotal` and `runningTotalEntryCount` persist across tests. Use strictly increasing entry counts per test (e.g., test 1: 0 entries, test 2: 1 entry, test 3: 2 entries) so the incremental-scan branch triggers correctly. Alternatively, use `vi.resetModules()` + dynamic import per test.
   - Empty entries returns zero stats
   - Single assistant message accumulates correctly
   - Multiple messages sum correctly
   - Non-assistant messages ignored
   - Cache returns same result within TTL
   - Cache invalidated by entry count change
   - `invalidateStatsCache` clears cache
   - `getContextWindowInfo` computes percentage correctly
   - `getContextWindowInfo` handles missing context window
   - Property: stats are monotonic (adding entries never decreases totals)

2. **`git.test.ts`** — Test `getGitStatus` via mocking `execSync`:
   - `parseGitOutput` is **not exported** — test through `getGitStatus` by mocking `child_process.execSync`
   - Use `vi.mock("child_process", ...)` to intercept `execSync`
   - **CRITICAL:** Module-level `gitStatusCache` and `gitRefreshTimer` persist. Use `vi.useFakeTimers()` and clear timers between tests, or use `vi.resetModules()` + dynamic import.
   - Parse scored format lines (via mocked execSync output)
   - Parse unscored format lines
   - Parse untracked lines
   - Parse branch summary (ahead/behind)
   - Empty output returns zero status
   - Malformed lines ignored gracefully
   - `getWorktreeBranch` returns null when not in worktree
   - Property: `getGitStatus` never throws (catches execSync errors gracefully)

3. **`state-manager.test.ts`** — Test `TodoStateManager`:
   - `read` returns copy (mutations don't affect internal state)
   - `write` stores todos correctly
   - `write` with all completed schedules auto-clear
   - `clear` empties todos
   - `getStats` computes correct counts
   - `validate` catches missing fields
   - `validate` catches invalid status values
   - `validate` catches non-array input
   - `validate` accepts valid input
   - Use `vi.useFakeTimers()` for auto-clear timer tests
   - Property: `validate(write(x)).valid === true` after write (round-trip)

4. **`frontmatter-io.test.ts`** — Test `validateAgentName`, `serializeAgent`:
   - `validateAgentName` accepts valid names (3-50 chars, lowercase alnum + hyphens)
   - `validateAgentName` accepts single char names
   - `validateAgentName` rejects empty, uppercase, special chars
   - `serializeAgent` produces valid YAML frontmatter
   - `serializeAgent` quotes values that need quoting
   - `serializeAgent` includes optional fields when present
   - `serializeAgent` omits optional fields when absent
   - Property: `serializeAgent` output starts with `---\n` and contains a closing `\n---\n` delimiter (output ends with systemPrompt, not `---`)

5. **`cursor.test.ts`** — Test `getLinearCursorIndexFromEditor`:
   - Single line, cursor at start → 0
   - Single line, cursor at end → line length
   - Multi-line, cursor on second line → first line length + 1 + col
   - Empty editor → 0
   - Cursor beyond bounds clamped correctly
   - Property: linear index always >= 0
   - Property: linear index <= total character count

6. **`wrap.test.ts`** — Test `appendWrappedTextLines`:
   - Mock `wrapTextWithAnsi` and `truncateToWidth` from pi-tui
   - Single line within width → no wrapping
   - Long line → wrapped to specified width
   - Multiline input → each line wrapped independently
   - Indent reduces effective wrap width
   - `formatLine` applied to each wrapped line
   - Empty text → single empty line added
   - Property: output lines never exceed `safeWidth` chars

**Steps:**
- [ ] Create `stats.test.ts` with 8-10 tests (mock ExtensionContext)
- [ ] Create `git.test.ts` with 6-8 tests (test parseGitOutput directly)
- [ ] Create `state-manager.test.ts` with 9-10 tests (fake timers for auto-clear)
- [ ] Create `frontmatter-io.test.ts` with 8-9 tests + 1 property test
- [ ] Create `cursor.test.ts` with 5-6 tests + 2 property tests
- [ ] Create `wrap.test.ts` with 6-7 tests + 1 property test
- [ ] Run `pnpm test` — all tests pass
- [ ] Run `npx tsc --noEmit` in footer, todo, ask, subagent packages
- [ ] Commit with message: "test: Phase 2 — footer, todo, subagent, ask (6 files)"

**Acceptance criteria:**
- [ ] All 6 test files pass with `pnpm test`
- [ ] Type-check passes in all modified packages
- [ ] Total test count increases by ~55+ tests

---

## Task 4: Phase 2 medium files — subagent/compact (1 file)

**Context:** `compact.ts` contains the rendering logic for compact subagent display. It has pure functions (`buildActivityLine`, `statusGlyph`) mixed with rendering functions that depend on pi-tui's `Text` component.

**Files:**
- Create: `packages/subagent/src/compact.test.ts`

**What to implement:**

1. **`compact.test.ts`** — Test `buildActivityLine` and rendering functions:
   - `buildActivityLine` with error → shows error prefix
   - `buildActivityLine` with completed status → "✓ Done"
   - `buildActivityLine` with failed status → "✗ Failed"
   - `buildActivityLine` with running + current tool → tool name + args
   - `buildActivityLine` with running + no tool → last tool call
   - `buildActivityLine` with running + no info → "↳ Starting..."
   - `buildActivityLine` with final output → first line of output
   - Mock `Text` component for `renderCompactSingle`, `renderCompactParallel` etc.
   - Verify `setText` called with expected output structure
   - Property (fast-check): truncated fields (error, argsPreview, finalOutput first line) never exceed their `truncLine` limits (80 or 60 chars). Use bounded generators (`fc.string({ maxLength: 20 })`) for non-truncated fields like `currentTool` and `lastCall.name` (which are NOT truncated by `buildActivityLine`).

**Steps:**
- [ ] Create `compact.test.ts` with 10-12 tests + 1 property test
- [ ] Run `pnpm test` — all tests pass
- [ ] Run `npx tsc --noEmit` in subagent package
- [ ] Commit with message: "test: Phase 2 — subagent/compact (1 file)"

**Acceptance criteria:**
- [ ] Test file passes with `pnpm test`
- [ ] Type-check passes in subagent package
- [ ] Total test count increases by ~12+ tests

---

## Task 5: Phase 3 tricky files — startup, diff render/shiki (5 files)

**Context:** These files depend on Pi runtime, Shiki, or TUI components. Use snapshot tests for rendering output and mocks for external dependencies.

**Files:**
- Create: `packages/core/src/startup/sections.test.ts`
- Create: `packages/core/src/startup/logo.test.ts`
- Create: `packages/core/src/startup/version.test.ts`
- Create: `packages/diff/src/core/diff.test.ts`
- Create: `packages/diff/src/shiki.test.ts`

**What to implement:**

1. **`sections.test.ts`** — Test section parsing and formatting:
   - `detectSection` finds section key in text
   - `detectSection` returns undefined for non-section text
   - `parseSectionText` extracts items correctly
   - `parseSectionText` deduplicates items
   - `parseSectionText` prefers prefixed over bare names
   - `parseModelScope` extracts model names
   - `extractName` with various section types
   - `formatColumns` produces expected output structure
   - `buildItemWrapper` with revealed/unrevealed states
   - **CRITICAL:** `sections.ts` imports `TRUECOLOR` from `./logo.js` (computed at module load). Use `vi.mock("./logo.js", () => ({ TRUECOLOR: false }))` to force deterministic output for `formatColumns` tests. Without this, snapshot output differs between local (TRUECOLOR=true) and CI (TRUECOLOR=false).
   - Mock `Theme` and `visibleWidth` from pi-tui
   - **NOTE:** `formatColumns` takes `RenderSection[]` (not exported). Use `as const` on the `name` field or cast to satisfy the string-literal union type.

2. **`logo.test.ts`** — Test logo rendering:
   - `LOGO` is 8 rows × 16 chars each (e.g. `"████████████    "` = 12 blocks + 4 spaces)
   - **CRITICAL:** `TRUECOLOR` is computed at module load from `process.env`. Use `vi.mock("./logo.js", ...)` to force a fixed `TRUECOLOR` value per test, or use `vi.hoisted` env setup + `vi.resetModules()` + dynamic import. Tests asserting both branches (true/false) must isolate the env value.
   - `getShinedLogo` returns plain LOGO when TRUECOLOR is false
   - `getShinedLogo` returns animated frames when TRUECOLOR is true
   - `computeRevealAt` produces different values per animation style
   - Test all 9 animation styles produce valid reveal times
   - Property: `getShinedLogo` output always 8 rows
   - Property: each row's **visible width** === 16 (strip ANSI escapes before measuring, using `stripAnsi` from `../text.js`)

3. **`version.test.ts`** — Test `compareVersions`:
   - `compareVersions("1.0.0", "1.0.0")` → 0
   - `compareVersions("2.0.0", "1.9.9")` → 1
   - `compareVersions("1.0.0", "2.0.0")` → -1
   - Handles `v` prefix
   - Handles partial versions ("1.0" vs "1.0.0")
   - Property: `compareVersions(a, a) === 0` (reflexive)
   - Property: `compareVersions(a, b) === -compareVersions(b, a)` (antisymmetric)
   - Property: transitivity — if a<b and b<c then a<c
   - **NOTE:** Generate versions via `fc.tuple(fc.nat(), fc.nat(), fc.nat()).map(t => t.join("."))` — not arbitrary strings — to avoid `NaN` from `Number("x")` muddying the properties.

4. **`diff.test.ts`** — Test `parseDiff`:
   - Identical content → empty lines, zero counts
   - Single line addition
   - Single line deletion
   - Mixed add/delete/context
   - Multiple hunks with separator
   - Context lines have both oldNum and newNum
   - Added lines have only newNum
   - Deleted lines have only oldNum
   - Property: `parseDiff(x, x).lines.length === 0` (reflexive)
   - Property: `parseDiff(a, b).added >= 0 && removed >= 0` (non-negative)

5. **`shiki.test.ts`** — Test `lang` function and cache behavior:
   - `lang` resolves common extensions correctly
   - `lang` returns undefined for unknown extensions
   - `lang` is case-insensitive for extensions
   - Mock `codeToANSI` to avoid actual Shiki initialization
   - Test `setConfigGetter` changes theme
   - Property: `lang(x)` returns consistent result for same extension

**Steps:**
- [ ] Create `sections.test.ts` with 8-10 tests + snapshot for formatColumns
- [ ] Create `logo.test.ts` with 6-8 tests + 2 property tests
- [ ] Create `version.test.ts` with 5-6 tests + 3 property tests
- [ ] Create `diff.test.ts` with 8-9 tests + 2 property tests
- [ ] Create `shiki.test.ts` with 5-6 tests + 1 property test
- [ ] Run `pnpm test` — all tests pass
- [ ] Run `npx tsc --noEmit` in core and diff packages
- [ ] Commit with message: "test: Phase 3 — startup, diff render/shiki (5 files)"

**Acceptance criteria:**
- [ ] All 5 test files pass with `pnpm test`
- [ ] Snapshot tests capture expected rendering output
- [ ] Type-check passes in core and diff packages
- [ ] Total test count increases by ~45+ tests

---

## Summary

| Phase | Files | Estimated Tests | Property Tests |
|-------|-------|----------------|----------------|
| 1 (easy) | 5 | ~25 | ~3 |
| 2 (medium) | 11 | ~110 | ~12 |
| 3 (tricky) | 5 | ~45 | ~9 |
| **Total** | **21** | **~180** | **~24** |

Plus existing 223 tests = **~400 total** (conservative estimate; could be higher with thorough property tests).

Each task is independently commitable. Run `pnpm test` after each task to verify.
