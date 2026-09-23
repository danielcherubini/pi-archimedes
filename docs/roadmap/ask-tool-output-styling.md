---
status: approved
done-when: The ask tool renders a compact two-line output in the TUI (bold blue header "ask" and status-labelled choice in muted grey) matching Archimedes tool styling, with a clean Q&A breakdown on expand, verified by unit tests.
---

# Ask Tool Output Styling

## Summary
Style the visual presentation of the `ask` tool in the Pi TUI. Currently, `ask` does not define custom tool renderers, resulting in verbose multiline session text dumps in the chat transcript. This feature adds `renderCall` and `renderResult` implementations inspired by `mcp` and `bash` styling in Archimedes, providing a clean 2-line representation:

```
ask
✓ <choice taken in grey>
```

## Approved Behavior

### Line 1: Tool Header (`renderCall`)
- Rendered via `renderToolHeader("ask", undefined, theme)` from `@pi-archimedes/core/tool-render`.
- Shows `ask` in bold `toolTitle` (blue), with no extra accent text.

### Line 2: Tool Result (`renderResult` - Collapsed)
1. **In-Flight** (`options.isPartial === true`):
   - Rendered via `renderStatusLabel("running", "waiting for input...", theme)`
   - Visual: `▸ waiting for input...` (muted)
2. **Cancelled**:
   - Rendered via `renderStatusLabel("error", "(cancelled)", theme)`
   - Visual: `✗ (cancelled)` (red `✗`, muted label)
3. **Execution / Validation Error**:
   - Rendered via `renderStatusLabel("error", errorMessage, theme)`
   - Visual: `✗ <error message>` (red `✗`, muted label)
4. **Completed Single Question**:
   - Rendered via `renderStatusLabel("success", choice, theme)`
   - Visual: `✓ <choice taken>` (green `✓`, muted grey text)
   - Choice formatting:
     - Standard single select: `<selected option>`
     - Multi-select: `[<option 1>, <option 2>]`
     - Custom input ("Other"): `"<custom input>"`
     - Selected option + custom input: `<selected> + Other: "<custom input>"`
5. **Completed Multiple Questions (Tabbed)**:
   - Formatted as comma-separated key-value pairs of question ID and chosen selection:
     `✓ <id1>: <choice1>, <id2>: <choice2>` (e.g. `✓ auth: OAuth, cache: Redis`)
   - Rendered via `renderStatusLabel("success", summary, theme)` (green `✓`, muted grey text)

### Expanded View (`options.expanded === true`)
When expanded in the TUI (pressing Enter/Right on the tool call):
- Shows a clean Question & Answer breakdown for each question:
  ```
  <prompt text> (dim / muted)
    ✓ <selected answer> (green check, toolOutput text)
  ```
- If custom input: `  ✓ "<custom input>"` or `  ✓ <selected> + Other: "<custom input>"`
- If cancelled: `  ✗ (cancelled)`
- Multiple questions are separated by blank lines (`\n\n`).
- If execution/validation error, displays the error message.

## Architecture & Code Changes

### 1. `packages/ask/src/renderer.ts` (New File)
- Implements `renderAskCall(args: unknown, theme: Theme, context?: unknown): Component`
- Implements `renderAskResult(result: unknown, options: { expanded?: boolean; isPartial?: boolean }, theme: Theme, context?: unknown): Component`
- Pure helpers:
  - `extractQuestionResults(result: unknown): { results: QuestionResult[]; isCancelled: boolean; error?: string }`
  - `formatSelectionSummary(result: QuestionResult): string`
  - `formatExpandedBreakdown(results: QuestionResult[], theme: Theme): string`
- Uses `renderToolHeader` and `renderStatusLabel` from `@pi-archimedes/core/tool-render`
- Defensive try/catch wrapping around all rendering so exceptions never crash the TUI.

### 2. `packages/ask/src/tool.ts`
- Import `renderAskCall` and `renderAskResult` from `./renderer.js`
- Pass `renderCall: renderAskCall` and `renderResult: renderAskResult` to `pi.registerTool({ ... })`

### 3. `packages/ask/src/renderer.test.ts` (New File)
- Unit tests verifying:
  - `renderAskCall` renders bold `ask` header
  - `renderAskResult` in-flight renders `▸ waiting for input...`
  - `renderAskResult` cancelled renders `✗ (cancelled)`
  - `renderAskResult` single selection renders `✓ <choice>`
  - `renderAskResult` multi selection renders `✓ [A, B]`
  - `renderAskResult` custom input renders `✓ "custom note"`
  - `renderAskResult` tabbed multiple questions renders `✓ q1: A, q2: B`
  - `renderAskResult` error renders `✗ <error>`
  - `renderAskResult` expanded renders clean Q&A breakdown
  - Error resilience when theme methods throw
