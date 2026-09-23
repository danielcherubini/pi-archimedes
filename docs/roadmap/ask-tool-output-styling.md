---
status: committed
done-when: The ask tool renders a compact two-line output in the TUI (bold blue header "ask" and status-labelled choice in muted grey) matching Archimedes tool styling, with a clean Q&A breakdown on expand, verified by unit tests.
---

# Ask Tool Output Styling Plan

**Goal:** Implement Archimedes standard 2-line styling (`ask` header and status-labelled choice in muted grey) for the `ask` tool in Pi TUI, with a clean Q&A breakdown when expanded.
**Architecture:** Add a dedicated, pure renderer module `packages/ask/src/renderer.ts` using `@pi-archimedes/core/tool-render` helpers (`renderToolHeader`, `renderStatusLabel`), and register `renderCall` and `renderResult` hooks on the `ask` tool definition in `packages/ask/src/tool.ts`.
**Tech Stack:** TypeScript (`verbatimModuleSyntax`, `noUncheckedIndexedAccess`), `@pi-archimedes/core/tool-render`, `@earendil-works/pi-tui`, Vitest.

---

### Task 1: Implement pure renderer module and unit tests

**Context:**
Currently, `ask` has no tool renderer, so Pi dumps raw multi-line LLM session text directly into the transcript. In Archimedes, tools like `mcp`, `bash`, and `todo` use standardized 2-part row renderers (`renderToolHeader` and `renderStatusLabel`). This task exports `formatSelectionForSummary` from `tool.ts` and creates `packages/ask/src/renderer.ts` with pure rendering and extraction logic, tested comprehensively in `packages/ask/src/renderer.test.ts`.

**Files:**
- Modify: `packages/ask/src/tool.ts` (export `formatSelectionForSummary`)
- Create: `packages/ask/src/renderer.ts`
- Test: `packages/ask/src/renderer.test.ts`

**What to implement:**
- In `packages/ask/src/tool.ts`:
  - Export `formatSelectionForSummary(result: QuestionResult): string` so the renderer can reuse the canonical selection formatting logic (which already handles quotes `"${customInput}"`, multi-select `[A, B]`, and combo selections under `noUncheckedIndexedAccess`).

- In `packages/ask/src/renderer.ts`:
  - Imports (strictly following `verbatimModuleSyntax`):
    ```ts
    import { Text } from "@earendil-works/pi-tui";
    import type { Component } from "@earendil-works/pi-tui";
    import type { Theme } from "@earendil-works/pi-coding-agent";
    import { renderToolHeader, renderStatusLabel } from "@pi-archimedes/core/tool-render";
    import { formatSelectionForSummary, type QuestionResult } from "./tool.js";
    ```
  - Types:
    ```ts
    export type RenderContext = {
      lastComponent?: Component;
      isError?: boolean;
      expanded?: boolean;
      isPartial?: boolean;
    };

    export type RenderOptions = {
      expanded?: boolean;
      isPartial?: boolean;
    };
    ```
  - Helpers:
    - `reuseText(context?: RenderContext): Text`:
      ```ts
      function reuseText(context?: RenderContext): Text {
        return (context?.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0)) as Text;
      }
      ```
    - `extractQuestionResults(result: unknown, context?: RenderContext): { results: QuestionResult[]; isCancelled: boolean; isError: boolean; errorMessage?: string }`:
      - Safely casts `result` as `{ content?: Array<{ type: string; text?: string }>; details?: Record<string, unknown> }`.
      - If `result.details?.results` is an array with length > 0, extract as `QuestionResult[]`.
      - Else if legacy single fields exist (`id`, `question` in `result.details`), synthesize `[{ id, question, description, options: details.options ?? [], multi: Boolean(details.multi), selectedOptions: details.selectedOptions ?? [], customInput: details.customInput }]`.
      - Cancellation detection:
        - True if `results` is non-empty and all items have `selectedOptions.length === 0` and `!customInput`.
        - True if `result.content` has any text matching `/user cancelled the question/i`.
      - Error detection:
        - True if `context?.isError === true`.
        - True if `results.length === 0` (e.g. execution failure / schema rejection / empty result).
        - Error message: if error detected, read `result.content[0]?.text` or fall back to `"failed"`.
    - `formatExpandedBreakdown(results: QuestionResult[], isCancelled: boolean, theme: Theme): string`:
      - If `isCancelled`: returns `theme.fg("error", "✗ (cancelled)")`.
      - If `results.length === 0`: returns `theme.fg("muted", "(no details)")`.
      - For each `QuestionResult`:
        - Prompt line: `theme.fg("dim", q.question)`
        - Answer line: `  ` + `theme.fg("success", "✓")` + ` ` + `theme.fg("toolOutput", formatSelectionForSummary(q))`
        - Blocks joined with `\n\n`.
  - Main Render Functions:
    - `renderAskCall(args: unknown, theme: Theme, context?: unknown): Text`:
      - `const text = reuseText(context as RenderContext | undefined);`
      - Inside try block: `text.setText(renderToolHeader("ask", undefined, theme));`
      - Inside catch block: `text.setText("ask");`
      - Returns `text`.
    - `renderAskResult(result: unknown, options: RenderOptions, theme: Theme, context?: unknown): Text`:
      - `const text = reuseText(context as RenderContext | undefined);`
      - `const ctx = context as RenderContext | undefined;`
      - `const expanded = options.expanded ?? ctx?.expanded ?? false;`
      - `const isPartial = options.isPartial ?? ctx?.isPartial ?? false;`
      - `const { results, isCancelled, isError, errorMessage } = extractQuestionResults(result, ctx);`
      - If `expanded`:
        - If `isError`: `text.setText(theme.fg("error", errorMessage ?? "failed"));`
        - Else: `text.setText(formatExpandedBreakdown(results, isCancelled, theme));`
        - Return `text`.
      - Collapsed (`!expanded`):
        - If `isPartial`: `text.setText(renderStatusLabel("running", "waiting for input...", theme));`
        - Else if `isCancelled`: `text.setText(renderStatusLabel("error", "(cancelled)", theme));`
        - Else if `isError`: `text.setText(renderStatusLabel("error", errorMessage ?? "failed", theme));`
        - Else if `results.length === 1`:
          - `const first = results[0];`
          - `text.setText(renderStatusLabel("success", first ? formatSelectionForSummary(first) : "(unknown)", theme));`
        - Else if `results.length > 1`:
          - `const summary = results.map((r) => `${r.id}: ${formatSelectionForSummary(r)}`).join(", ");`
          - `text.setText(renderStatusLabel("success", summary, theme));`
        - Else:
          - `text.setText(renderStatusLabel("error", "failed", theme));`
      - Wrap in try/catch block; on catch, `text.setText("")` without throwing.
      - Returns `text`.

**Steps:**
- [ ] Export `formatSelectionForSummary` in `packages/ask/src/tool.ts`.
- [ ] Write failing unit tests in `packages/ask/src/renderer.test.ts` covering:
  - `renderAskCall` renders bold `toolTitle` header `ask` with no accent, reuses `lastComponent`
  - `renderAskResult` with `isPartial: true` renders `▸ waiting for input...`
  - `renderAskResult` completed single question renders `✓ <choice>`
  - `renderAskResult` completed multi-select renders `✓ [A, B]`
  - `renderAskResult` completed custom input renders `✓ "custom note"`
  - `renderAskResult` completed combo choice + custom input renders `✓ A + Other: "custom note"`
  - `renderAskResult` completed multiple questions renders `✓ auth: OAuth, cache: Redis`
  - `renderAskResult` cancelled renders `✗ (cancelled)`
  - `renderAskResult` error renders `✗ <error message>`
  - `renderAskResult` expanded renders clean Q&A breakdown
  - Error resilience: handles throwing theme fg gracefully without crashing
- [ ] Run `pnpm vitest run packages/ask/src/renderer.test.ts`
  - Did it fail because `renderer.ts` does not exist?
- [ ] Implement `packages/ask/src/renderer.ts`
- [ ] Run `pnpm vitest run packages/ask/src/renderer.test.ts`
  - Did all tests pass? If not, fix and re-run.
- [ ] Run `cd packages/ask && npx tsc --noEmit`
  - Did typecheck succeed?
- [ ] Commit with message: `feat(ask): implement tool call and result renderer`

**Acceptance criteria:**
- [ ] `renderAskCall` returns `Text` component displaying `ask` header.
- [ ] `renderAskResult` collapsed produces single-line `✓` or `✗` or `▸` status matching specification.
- [ ] `renderAskResult` expanded produces clean Q&A breakdown.
- [ ] Vitest test suite passes with 100% test coverage of rendering paths.

---

### Task 2: Wire renderer into ask tool registration and export

**Context:**
Now that the renderer is implemented and unit-tested, hook it up to the tool registration in `packages/ask/src/tool.ts` and re-export the renderer functions from `packages/ask/src/index.ts`. Add integration test coverage in `packages/ask/src/tool.test.ts`.

**Files:**
- Modify: `packages/ask/src/tool.ts`
- Modify: `packages/ask/src/index.ts`
- Modify: `packages/ask/src/tool.test.ts`

**What to implement:**
- In `packages/ask/src/tool.ts`:
  - Import `renderAskCall` and `renderAskResult` from `./renderer.js`.
  - In `registerAskTool(pi: ExtensionAPI)`:
    - Pass `renderCall: renderAskCall` and `renderResult: renderAskResult` inside the `pi.registerTool({ ... })` argument object.
- In `packages/ask/src/index.ts`:
  - Export `renderAskCall` and `renderAskResult` from `./renderer.js` so external consumers or tests can import them directly from `@pi-archimedes/ask`.
- In `packages/ask/src/tool.test.ts`:
  - Widen captured tool or cast `(capturedTool as unknown as { renderCall?: unknown; renderResult?: unknown })`.
  - Add test asserting that `capturedTool.renderCall === renderAskCall` and `capturedTool.renderResult === renderAskResult`.

**Steps:**
- [ ] Update `packages/ask/src/tool.test.ts` to assert that `registerAskTool` registers `renderCall` and `renderResult`.
- [ ] Run `pnpm vitest run packages/ask/src/tool.test.ts`
  - Verify it fails because `renderCall` is not yet registered.
- [ ] Update `packages/ask/src/tool.ts` to pass `renderCall: renderAskCall` and `renderResult: renderAskResult`.
- [ ] Update `packages/ask/src/index.ts` to re-export `renderAskCall` and `renderAskResult`.
- [ ] Run `pnpm vitest run packages/ask`
  - Verify all ask tests pass.
- [ ] Run `cd packages/ask && npx tsc --noEmit`
  - Verify typecheck passes with no errors.
- [ ] Commit with message: `feat(ask): wire custom renderer into ask tool registration`

**Acceptance criteria:**
- [ ] `pi.registerTool` receives `renderCall` and `renderResult` functions.
- [ ] `renderAskCall` and `renderAskResult` are exported from `@pi-archimedes/ask`.
- [ ] All tests in `packages/ask` pass.
- [ ] `tsc --noEmit` passes cleanly.
