# Stacked, Flicker-Free Parallel Subagent Rendering Plan

**Goal:** Make parallel subagents render stacked (one line per subagent) and stably from the moment they start, instead of flickering on a single line and only stacking at completion.

**Architecture:** The root cause is in `executeParallel` (`packages/subagent/src/execute.ts`), which collects live progress in a `Map<string, SubagentProgress>` keyed by **agent name**. When N parallel subagents share an agent (e.g. 8 × `general`), they collide into one map key, so only the most-recent updater survives — the renderer gets a 1-element array and renders one flickering line. At completion, `Promise.all` resolves and `results` (array-indexed) finally has all N, producing the stacked view "at the end." The fix replaces the name-keyed Map with an **index-keyed array pre-filled with pending placeholders**, so every update carries all N entries in stable task order. A new shared `buildAgentLabel(agent, task, theme)` helper then labels each row as `agent: <truncated task>` (compact) or puts an agent-label header line above each expanded block, so multiple same-named subagents are distinguishable.

**Tech Stack:** TypeScript (no build step — pi's jiti loader runs `.ts` directly), TypeBox schemas, `@earendil-works/pi-tui` `Text` component. Verification is `npx tsc --noEmit` per the monorepo's `AGENTS.md` ("Verification is `tsc --noEmit`, not a build or test command"). There is no test framework for packages, so each task's verification gate is a type-check, not a failing-test-then-pass cycle.

---

### Task 1: Index-keyed progress array with pending placeholders in executeParallel

**Context:**
`packages/subagent/src/execute.ts` exports `executeParallel`, which runs all subagents via `Promise.all` and reports aggregated progress through an `onUpdate` callback. Today it stores per-subagent progress in `const latestProgress = new Map<string, SubagentProgress>()` keyed by `progress.agent` (the agent name). When several parallel subagents share the same agent name (the common case — the LLM often dispatches many `general` subagents), they all write to the same map key, so only the most-recently-updated subagent survives. The downstream renderer therefore receives a 1-element array and renders a single line that flickers between subagents. Only at completion does `Promise.all` resolve into a full `results` array (indexed by task position), which is why the stacked view appears "at the end."

This task replaces the name-keyed Map with an **index-keyed array**, pre-filled with synthesized "pending" `SubagentProgress` objects, so that every `onUpdate` emission carries all N entries in stable task order from the very first event. This is the foundational change that eliminates the flicker; it must land before the rendering-label changes (Tasks 2 and 3), because without stable N-entry arrays the renderer cannot stack reliably.

The pending placeholder objects must be valid `SubagentProgress` values with `status: "running"` and zeroed stats, because the existing `buildActivityLine` helper in `compact.ts` already renders `↳ Starting...` for a `running` status with no `currentTool` and no `toolCalls` — so placeholders need no special-case rendering. The placeholder's `agent` field must match what `executeSubagent` would assign to that same task, so the pending label is identical to the label that will appear once streaming begins. `executeSubagent` (in the same file) uses `const agentName = options.agent ?? "subagent";`, so the placeholder must use `taskDef.agent ?? "subagent"`.

**Files:**
- Modify: `packages/subagent/src/execute.ts`

**What to implement:**
Replace the body of `executeParallel` (the `const latestProgress = new Map<string, SubagentProgress>();` … `options.onUpdate?.([...latestProgress.values()]);` block) with an index-keyed array. Concretely:

1. Delete `const latestProgress = new Map<string, SubagentProgress>();`
2. Insert before the `Promise.all` call a pre-filled array:
   ```ts
   // Pre-fill one pending slot per task, keyed by task index (NOT agent name).
   // This keeps all N lines stacked from t=0 in stable task order, with no
   // collisions when multiple subagents share an agent name (e.g. 8 × "general").
   const latestProgress: SubagentProgress[] = options.tasks.map((taskDef) => ({
     agent: taskDef.agent ?? "subagent",
     status: "running" as const,
     task: taskDef.task,
     currentTool: undefined,
     currentToolArgs: undefined,
     currentToolStartedAt: undefined,
     toolCount: 0,
     inputTokens: 0,
     outputTokens: 0,
     tokens: 0,
     cost: 0,
     durationMs: 0,
     error: undefined,
     output: undefined,
     recentOutput: undefined,
     toolCalls: undefined,
     // Match the model executeSubagent will report for this task, so the
     // pending placeholder's model label matches the streaming label exactly.
     model: taskDef.model,
   }));
   ```
3. Inside the `options.tasks.map((taskDef) => executeSubagent({ ... }))` callback, the second argument to `map` is the index. Capture it: change `options.tasks.map((taskDef) =>` to `options.tasks.map((taskDef, index) =>`.
4. Replace the `onUpdate` body:
   ```ts
   onUpdate: (progress: SubagentProgress) => {
     // Store latest progress in this task's stable slot (by index).
     latestProgress[index] = progress;
     // Emit all N entries in stable task order.
     options.onUpdate?.([...latestProgress]);
   },
   ```
5. Do NOT change anything else in the file: leave `executeSubagent`, the `AgentConfig` import, the `ExecuteOptions` interface, and the function's return type/signature untouched.

Note on the `as const` for `status`: `SubagentProgress.status` is typed as `"running" | "completed" | "failed"`. The `as const` narrows the literal `"running"` so it satisfies the union without widening to `string`. If `tsc` complains, drop `as const` and rely on the contextual type from `SubagentProgress[]` — but include it initially since it is the safer spelling.

**Steps:**
- [ ] Read `packages/subagent/src/execute.ts` and locate `executeParallel`.
- [ ] Make the edit described above (delete the Map, add the pre-filled array, capture `index`, rewrite the `onUpdate` body).
- [ ] Run `npx tsc --noEmit` from `packages/subagent`
  - Did it succeed with no errors? If there are errors, read them, fix (most likely a `status` literal-typing complaint or an unused-import warning for the removed `Map`), and re-run before continuing.
- [ ] Commit with message: `fix(subagent): key parallel progress by task index, not agent name`

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` passes in `packages/subagent`.
- [ ] `executeParallel` no longer contains `new Map`.
- [ ] `latestProgress` is declared as `SubagentProgress[]` and is written via `latestProgress[index] = progress;`.
- [ ] The `onUpdate` emission is `[...latestProgress]` (a fresh array copy, preserving stable order).
- [ ] No other behavior in `execute.ts` changes (the function still returns `Promise<SubagentResult[]>` and still uses `Promise.all`).

---

### Task 2: buildAgentLabel helper + compact rendering labels

**Context:**
With Task 1 landed, parallel subagents now stack stably — but each compact line is labeled only with the bare agent name (e.g. `general`), so when several subagents share a name the user cannot tell which line is which. The `task` text is already present on both `SubagentProgress` (the `task` field, populated by `stream.ts`) and `SubagentResult` (the `task` field), but the compact renderers never put it in the label.

This task adds a single shared label helper, `buildAgentLabel`, to `packages/subagent/src/format.ts` (the existing home of `buildStatsLine`, `truncLine`, etc.), then uses it in the two compact parallel renderers and the two compact single renderers in `compact.ts`. The compact single renderers currently show no agent name at all (just `model · stats · (ctrl+o)` then the activity line); this task adds an agent-label header line to them for consistency with the parallel views.

The helper signature is `buildAgentLabel(agent: string, task: string | undefined, theme: { fg, bold })` returning `theme.bold(agent)` plus, when `task` is non-empty, `theme.fg("dim", ": " + truncLine(task, 60))`. When `task` is undefined/empty, return only the bold agent name (no trailing `:`). `truncLine` already exists in `format.ts` with signature `truncLine(text: string, width: number): string` and clamps to width.

**Files:**
- Modify: `packages/subagent/src/format.ts` (add `buildAgentLabel`)
- Modify: `packages/subagent/src/compact.ts` (import and use it in 4 functions)

**What to implement:**

In `format.ts`, after the existing `buildStatsLine` function, add:
```ts
export function buildAgentLabel(
  agent: string,
  task: string | undefined,
  theme: { fg: (token: string, text: string) => string; bold: (text: string) => string },
): string {
  const name = theme.bold(agent);
  if (task) {
    return name + theme.fg("dim", ": " + truncLine(task, 60));
  }
  return name;
}
```
(`truncLine` is already defined in the same file, so no new import is needed there.)

In `compact.ts`:
1. Add `buildAgentLabel` to the import from `"./format.js"` (the file already imports `formatTokens, formatDuration, formatCost, truncLine, buildStatsLine`).
2. In `renderCompactParallel` — for each result line, replace the line construction so the agent name is labeled. Currently the line begins as:
   ```ts
   let line = `${glyphColored} ${agentName}${statsPart}`;
   ```
   Change it to:
   ```ts
   let line = `${glyphColored} ${buildAgentLabel(agentName, result.task, theme)}${statsPart}`;
   ```
   (`result.task` is `SubagentResult.task`, a `string` — always defined.)
3. In `renderCompactParallelProgress` — similarly, currently:
   ```ts
   let line = `${glyphColored} ${agentName}${statsPart}`;
   ```
   Change to:
   ```ts
   let line = `${glyphColored} ${buildAgentLabel(agentName, progress.task, theme)}${statsPart}`;
   ```
   (`progress.task` is `SubagentProgress.task`, a `string`.)
4. In `renderCompactSingle` — currently the output is built as:
   ```ts
   let output = [modelLabel, statsPart, expandHint].filter(Boolean).join(" ");
   output += "\n" + activityLine;
   ```
   Insert an agent-label header line above it:
   ```ts
   const agentLabel = buildAgentLabel(agentName, result.task, theme);
   let output = agentLabel + "\n" + [modelLabel, statsPart, expandHint].filter(Boolean).join(" ");
   output += "\n" + activityLine;
   ```
   (`agentName` is already declared in this function as `const agentName = result.agent ?? "subagent";`.)
5. In `renderCompactProgress` — currently:
   ```ts
   let output = [modelLabel, statsPart, expandHint].filter(Boolean).join(" ");
   output += "\n" + activityLine;
   ```
   Insert the agent-label header:
   ```ts
   const agentLabel = buildAgentLabel(agentName, progress.task, theme);
   let output = agentLabel + "\n" + [modelLabel, statsPart, expandHint].filter(Boolean).join(" ");
   output += "\n" + activityLine;
   ```
   (`agentName` is already declared in this function as `const agentName = progress.agent ?? "subagent";`.)
6. Note: edits 4 and 5 intentionally change the compact single views from a 2-line format (`model · stats · (ctrl+o)` / activity) to a 3-line format (`agent: task` / `model · stats · (ctrl+o)` / activity). This multi-line layout is the desired outcome — it makes single subagent rows consistent with the parallel rows, which already span multiple lines. Do not "fix" the extra line.
7. Do NOT change `buildActivityLine`, `statusGlyph`, the `RenderContext` type, or any function's signature. Do NOT touch the expanded renderers (Task 3 handles those).

**Steps:**
- [ ] Read `packages/subagent/src/format.ts` and `packages/subagent/src/compact.ts`.
- [ ] Add `buildAgentLabel` to `format.ts` (after `buildStatsLine`).
- [ ] Import `buildAgentLabel` in `compact.ts` and apply the 4 edits above.
- [ ] Run `npx tsc --noEmit` from `packages/subagent`
  - Did it succeed? If not, read errors, fix, re-run before continuing. The most likely issue is a typo in the import list or passing `result.task` where `progress.task` is needed — both are `string` so types should align.
- [ ] Commit with message: `feat(subagent): label compact subagent rows with agent: task`

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` passes in `packages/subagent`.
- [ ] `format.ts` exports `buildAgentLabel` with the signature above.
- [ ] `compact.ts` imports `buildAgentLabel` from `"./format.js"`.
- [ ] The two compact parallel renderers label each line as `agent: <truncated task>`.
- [ ] The two compact single renderers show an `agent: <task>` header line above the model/stats line.
- [ ] `buildActivityLine` and `statusGlyph` are unchanged.

---

### Task 3: Agent-label header on expanded renderers

**Context:**
The expanded renderers in `packages/subagent/src/expanded.ts` already render a `Task:` line (full, untruncated), so an expanded row is technically distinguishable — but the header is only `model · stats · (ctrl+o)` with **no agent name**, so with parallel subagents all named `general` the reader has no quick visual cue which subagent an expanded block belongs to until they drop their eye to the Task line. This task adds the same `buildAgentLabel` helper (landed in Task 2) as a header line at the top of each expanded block, for consistency with the compact views.

There are three builder functions to update: `buildExpandedText` (completed single/parallel), `renderProgressExpanded` (streaming single), and `buildProgressExpandedText` (streaming parallel). Each currently begins by pushing the stats line. The change is to push an `agent: task` label line first, then a blank line, then the existing stats line.

Note: `buildExpandedText` receives `(result, progress, theme)` — it has `result.agent` and `result.task`, with `progress` possibly `undefined`. Use `result.agent` and `result.task` there (do not dereference `progress`). `renderProgressExpanded` and `buildProgressExpandedText` receive `(progress, theme)` / `(progress, theme)` — use `progress.agent` and `progress.task`.

**Files:**
- Modify: `packages/subagent/src/expanded.ts`

**What to implement:**
1. Update the existing import from `"./format.js"` in `expanded.ts`. The current import line is:
   ```ts
   import { formatTokens, formatDuration, truncLine, buildStatsLine } from "./format.js";
   ```
   Change it to:
   ```ts
   import { formatTokens, formatDuration, truncLine, buildStatsLine, buildAgentLabel } from "./format.js";
   ```
2. In `buildExpandedText(result, progress, theme)`: at the very top of the function, before the existing `const lines: string[] = [];` content begins pushing the stats line, push the agent label and a blank line. Concretely, insert immediately after `const lines: string[] = [];`:
   ```ts
   lines.push(buildAgentLabel(result.agent, result.task, theme));
   lines.push("");
   ```
   Leave the rest of the function (stats line, Task line, tool calls, output, status) untouched. The existing `Task:` line stays — it shows the full untruncated task, while the new header shows the truncated form; both are intentional.
3. In `renderProgressExpanded(progress, theme)`: after `const lines: string[] = [];`, insert:
   ```ts
   lines.push(buildAgentLabel(progress.agent, progress.task, theme));
   lines.push("");
   ```
4. In `buildProgressExpandedText(progress, theme)`: after `const lines: string[] = [];`, insert:
   ```ts
   lines.push(buildAgentLabel(progress.agent, progress.task, theme));
   lines.push("");
   ```
5. Do NOT change `renderExpanded` (it just calls `buildExpandedText`), do NOT change the stats-line construction, the `Task:` line, the tool-call rendering, the activity block, or the status block. Do NOT remove the existing `Task:` line — it shows the full task text, which the truncated header does not.

**Steps:**
- [ ] Read `packages/subagent/src/expanded.ts`.
- [ ] Add `buildAgentLabel` to the import from `"./format.js"`.
- [ ] Apply the three header-insertion edits.
- [ ] Run `npx tsc --noEmit` from `packages/subagent`
  - Did it succeed? If not, read errors, fix, re-run before continuing.
- [ ] Commit with message: `feat(subagent): add agent-label header to expanded subagent blocks`

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` passes in `packages/subagent`.
- [ ] `expanded.ts` imports `buildAgentLabel` from `"./format.js"`.
- [ ] All three builders (`buildExpandedText`, `renderProgressExpanded`, `buildProgressExpandedText`) push an `agent: <truncated task>` header line (or just the bold agent name when task is empty) as their first content, followed by a blank line, before the stats line.
- [ ] The existing `Task:` line in each builder is preserved.
- [ ] `renderExpanded` is unchanged.

---

### Final verification (after all three tasks)

- [ ] Run `npx tsc --noEmit` from `packages/subagent` — must pass.
- [ ] Manually verify in the TUI: symlink the monorepo root into pi extensions (`ln -s $(pwd) ~/.pi/agent/extensions/pi-archimedes`), start pi, and dispatch a `subagent` call with 6+ parallel `general` tasks of distinct descriptions. Confirm:
  - All N lines stack from the very first update (no waiting for completion).
  - Each line is labeled `↳ general: <truncated task>`.
  - Lines do not flicker or collapse to one while running.
  - Pending (not-yet-started) lines show `↳ Starting...` under their label.
  - On completion, the stacked view remains (now with `✓`/`✗` glyphs and final stats).
  - Expanding a row (ctrl+o) shows the `agent: <task>` header on top, then stats, then the full `Task:` line.
