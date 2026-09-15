---
status: committed
done-when: Parallel `subagent` dispatch returns each child's full `finalOutput` in the tool result `content` sent to the parent model (metrics header line + output per task, blank-line separated), covered by unit tests in `packages/subagent/src/format.test.ts`, `tsc --noEmit` and `vitest` green; GitHub issue #55 can be answered and closed.
---

# Subagent Parallel Output Plan

**Goal:** Make parallel `subagent` dispatch return each child's full output to the parent model, matching single mode and the README's "returns the combined results" promise.
**Architecture:** The parallel result formatter moves from `packages/subagent/src/index.ts` (private) into `packages/subagent/src/format.ts` (exported, testable) and is extended to include each task's `finalOutput` beneath the existing metrics header line. The tool's parallel return path is rewired to call the new function. No TUI changes — the TUI renders from `details`, which is untouched.
**Tech Stack:** TypeScript (no build step — pi's jiti loader runs `.ts` directly), vitest for tests, pi extension API.

## Background (for the executing agent)

Today, the `subagent` tool has two return paths in `packages/subagent/src/index.ts`:

- **Single mode** (line 178): `content: [{ type: "text", text: result.finalOutput ?? result.error ?? "completed" }]` — the child's full final text.
- **Parallel mode** (line 113): `content: [{ type: "text", text: formatResultsSummary(results) }]` — a private function (line 284) that produces one metrics line per task: `✓ agent 31 tools · 12k tok · 153s`. The children's text is captured in `details.results[].finalOutput` and rendered by the TUI, but never reaches the model.

This plan makes the parallel path return the children's output too. Decisions already made (recorded in `docs/decisions/0020-subagent-parallel-full-output.md`):

- Output is **untruncated** — deliberately, for consistency with single mode. Do NOT add any cap, truncation, or opt-in field.
- Thinking blocks stay in `finalOutput` (no capture change in `handlers.ts`).
- `isError` is NOT set on the parallel result when tasks fail (pre-existing; out of scope).
- The ignored `async` schema parameter is out of scope.

---

### Task 1: Add `formatParallelResults` to `format.ts`

**Context:**
The parallel result text is built by a private `formatResultsSummary` in `index.ts`. To make the new output format testable and to follow the package convention (formatting helpers live in `format.ts`, tested in `format.test.ts`), the function is moved to `format.ts` under the new name `formatParallelResults` and extended to include each task's output body. This task is self-contained: it adds a pure function and its tests; nothing else in the package uses it yet.

**Files:**
- Modify: `packages/subagent/src/format.ts`
- Test: `packages/subagent/src/format.test.ts`

**What to implement:**

1. In `packages/subagent/src/format.ts`, add this import at the top (the file currently has no imports):

   ```ts
   import type { SubagentResult } from "./types.js";
   ```

2. Add this exported function (place it after `truncLine`, before `StatsData`):

   ```ts
   export function formatParallelResults(results: SubagentResult[]): string {
     const sections = results.map((r) => {
       const status = r.exitCode === 0 ? "✓" : "✗";
       const summary = r.progressSummary
         ? `${r.progressSummary.toolCount} tools · ${Math.round(r.progressSummary.tokens / 1000)}k tok · ${Math.round(r.progressSummary.durationMs / 1000)}s`
         : "";
       const header = `${status} ${r.agent}${summary ? " " + summary : ""}`;
       const body = (r.finalOutput ?? r.error ?? "completed").trimEnd();
       return `${header}\n${body}`;
     });
     return sections.join("\n\n");
   }
   ```

   Notes:
   - The header line is byte-identical to the current `formatResultsSummary` header logic (same glyph, same `Math.round` rounding, same spacing). Keep it exactly as written.
   - The body is `r.finalOutput ?? r.error ?? "completed"` — the exact single-mode fallback chain — with `trimEnd()` so blocks are separated by exactly one blank line even when a body ends in a newline.
   - Do NOT modify any other function in `format.ts`.

3. In `packages/subagent/src/format.test.ts`:
   - Add `formatParallelResults` to the import from `./format.js` (line 2 becomes `import { truncLine, formatParallelResults } from "./format.js";`).
   - Add `import type { SubagentResult } from "./types.js";`.
   - Add this fixture helper (same pattern as `makeResult` in `compact.test.ts`):

     ```ts
     function makeResult(overrides: Partial<SubagentResult> = {}): SubagentResult {
       return {
         agent: "test-agent",
         task: "do something",
         exitCode: 0,
         usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.01, turns: 3 },
         model: "gpt-4",
         finalOutput: undefined,
         error: undefined,
         progress: undefined,
         progressSummary: { toolCount: 5, tokens: 150, durationMs: 3000 },
         ...overrides,
       };
     }
     ```

   - Add this describe block (exact expected strings are given — use `toBe` with these exact strings):

     ```ts
     describe("formatParallelResults", () => {
       it("renders header + body per task with exactly one blank line between sections", () => {
         const r1 = makeResult({
           agent: "researcher",
           progressSummary: { toolCount: 31, tokens: 12345, durationMs: 153000 },
           finalOutput: "Found the bug.\n", // trailing newline: pins trimEnd
         });
         const r2 = makeResult({
           agent: "reviewer",
           progressSummary: { toolCount: 4, tokens: 2000, durationMs: 12000 },
           finalOutput: "Looks good.",
         });
         expect(formatParallelResults([r1, r2])).toBe(
           "✓ researcher 31 tools · 12k tok · 153s\nFound the bug.\n\n✓ reviewer 4 tools · 2k tok · 12s\nLooks good.",
         );
       });

       it("rounds tokens and duration with Math.round", () => {
         const r = makeResult({
           progressSummary: { toolCount: 1, tokens: 12500, durationMs: 154000 },
           finalOutput: "x",
         });
         expect(formatParallelResults([r])).toBe("✓ test-agent 1 tools · 13k tok · 154s\nx");
       });

       it("renders header only when progressSummary is absent (synthetic case)", () => {
         const r = makeResult({ progressSummary: undefined });
         expect(formatParallelResults([r])).toBe("✓ test-agent\ncompleted");
       });

       it("uses the ✗ glyph for non-zero exit codes", () => {
         const r = makeResult({ exitCode: 1, finalOutput: "done" });
         expect(formatParallelResults([r])).toBe("✗ test-agent 5 tools · 0k tok · 3s\ndone");
       });

       it("falls back to 'completed' when there is no finalOutput and no error", () => {
         const r = makeResult();
         expect(formatParallelResults([r])).toBe("✓ test-agent 5 tools · 0k tok · 3s\ncompleted");
       });

       it("uses the error text as the body when there is no finalOutput", () => {
         const r = makeResult({ exitCode: 1, error: "spawn failed" });
         expect(formatParallelResults([r])).toBe("✗ test-agent 5 tools · 0k tok · 3s\nspawn failed");
       });

       it("prefers finalOutput over error when both are set", () => {
         const r = makeResult({ finalOutput: "out", error: "boom" });
         expect(formatParallelResults([r])).toBe("✓ test-agent 5 tools · 0k tok · 3s\nout");
       });

       it("keeps duplicate agent names distinguishable by position and body", () => {
         const a = makeResult({ agent: "researcher", finalOutput: "first" });
         const b = makeResult({ agent: "researcher", finalOutput: "second" });
         expect(formatParallelResults([a, b])).toBe(
           "✓ researcher 5 tools · 0k tok · 3s\nfirst\n\n✓ researcher 5 tools · 0k tok · 3s\nsecond",
         );
       });
     });
     ```

**Steps:**
- [ ] Add the failing tests to `packages/subagent/src/format.test.ts` (import changes + `makeResult` helper + the describe block above)
- [ ] Run `npx vitest run src/format.test.ts` in `packages/subagent`
  - Did it fail with an import error (`formatParallelResults` not exported from `./format.js`)? If it passed unexpectedly, stop and investigate why.
- [ ] Implement the function + import in `packages/subagent/src/format.ts`
- [ ] Run `npx vitest run src/format.test.ts` in `packages/subagent`
  - Did all tests pass? If not, fix the failures and re-run before continuing.
- [ ] Run `npx tsc --noEmit` in `packages/subagent`
  - Did it succeed? If not, fix and re-run before continuing.
- [ ] Commit with message: `feat(subagent): add formatParallelResults formatter`

**Acceptance criteria:**
- [ ] `formatParallelResults` is exported from `format.ts` and produces the exact strings in the tests
- [ ] `npx tsc --noEmit` passes in `packages/subagent`
- [ ] `npx vitest run src/format.test.ts` passes (all 8 new tests)
- [ ] `index.ts` still contains the old `formatResultsSummary` (untouched in this task)

---

### Task 2: Rewire the tool's parallel path + README

**Context:**
Task 1 added the new formatter but nothing calls it yet. This task switches the parallel return path in the tool to use it, deletes the now-dead `formatResultsSummary`, and adds a one-sentence README clarification so the behavior is documented. After this task, the parent model receives the children's output in parallel mode, which is the fix for GitHub issue #55.

**Files:**
- Modify: `packages/subagent/src/index.ts`
- Modify: `packages/subagent/README.md`

**What to implement:**

1. In `packages/subagent/src/index.ts`:
   - Add `formatParallelResults` to the imports from `./format.js`. There is currently no import from `./format.js` in `index.ts` — add a new import line next to the other relative imports (e.g. after the `./execute.js` import):

     ```ts
     import { formatParallelResults } from "./format.js";
     ```

   - In the parallel return (around line 113), replace:

     ```ts
     content: [{ type: "text", text: formatResultsSummary(results) }],
     ```

     with:

     ```ts
     content: [{ type: "text", text: formatParallelResults(results) }],
     ```

   - Delete the entire private `formatResultsSummary` function (lines ~284–294, from `function formatResultsSummary(results: SubagentResult[]): string {` through its closing `}`).
   - Do NOT touch the single-mode return path (line 178), the `details` object in the parallel return, or anything else in the file.

2. In `packages/subagent/README.md`, line 47 currently reads:

   > **The dispatch waits.** A call — single or parallel — blocks until every task completes and returns the combined results, each optionally carrying the child's `childSessionId`. ...

   Append one sentence to that paragraph: "In parallel mode each result section carries the child's final output beneath its metrics line."

**Steps:**
- [ ] Make the three edits in `packages/subagent/src/index.ts` (import, call site, delete old function)
- [ ] Run `npx tsc --noEmit` in `packages/subagent`
  - Did it succeed? If not, fix and re-run before continuing. (A leftover reference to `formatResultsSummary` is the likely failure.)
- [ ] Run `npx vitest run` in `packages/subagent`
  - Did all tests pass (including the 8 new ones from Task 1 and all pre-existing tests)? If not, fix and re-run before continuing.
- [ ] Make the README edit
- [ ] Run `pnpm test` from the repo root (full workspace test suite, as CI does)
  - Did it pass? If not, fix and re-run before continuing.
- [ ] Commit with message: `fix(subagent): parallel dispatch returns child output to parent model`

**Acceptance criteria:**
- [ ] `grep -rn "formatResultsSummary" packages/subagent/src/` returns nothing
- [ ] The parallel return in `index.ts` uses `formatParallelResults(results)`
- [ ] `npx tsc --noEmit` passes in `packages/subagent`
- [ ] `pnpm test` (repo root) passes
- [ ] README documents that parallel results include each child's final output
