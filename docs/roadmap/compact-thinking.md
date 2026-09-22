---
status: approved
done-when: compactThinking setting ("Off" | "1 line" | "3 lines" | "5 lines") renders compact thinking blocks with styled text tail, toggles between Compact and Full on click, integrates with autoCollapseThinking, and passes all tests and typechecks.
---

# Spec: Compact Thinking Blocks

## Summary
Add a `compactThinking` setting to `@pi-archimedes/core` that renders thinking blocks showing only the tail (last 1, 3, or 5 lines) instead of full markdown or hiding entirely. Sliced lines render as clean styled text. Clicking toggles between Compact and Full (or expands to Full from Hidden).

---

## 1. Configuration & Settings UI

### Config Schema (`packages/core/src/config.ts`)
```ts
export type CompactThinking = "Off" | "1 line" | "3 lines" | "5 lines";

export interface CoreConfig {
  // ... existing fields
  compactThinking: CompactThinking;
}

export const DEFAULT_CORE_CONFIG: CoreConfig = {
  // ...
  compactThinking: "Off",
};
```

### Config Normalization (`packages/core/src/config.ts`)
- `compactThinking`: if not one of `"Off"`, `"1 line"`, `"3 lines"`, `"5 lines"`, normalize to `"Off"`.

### Settings Item (`packages/core/src/index.ts` & `meta/src/settings.ts`)
- Menu item under Thinking:
  - **ID**: `"compactThinking"`
  - **Label**: `"Compact thinking"`
  - **Current value**: `config.compactThinking`
  - **Values**: `["Off", "1 line", "3 lines", "5 lines"]`
  - **Description**: `"Display only the last N lines of thinking (expands to full on click)"`
- Wire in `meta/src/settings.ts` setting handler to update `coreConfig.compactThinking`.

---

## 2. Rendering Mechanics & Slicing

### Line Slicing
- Combine consecutive thinking parts into a single string `thinkBlocks.join("\n\n")`.
- Trim trailing whitespace.
- Split by `\n`.
- Extract last $N$ lines where $N \in \{1, 3, 5\}$.
- If total line count $\le N$, display all available lines.

### Visual Layout via Pi-TUI `Text`
- **1 line ($N = 1$)**:
  - Format: `${label} ${theme.italic(theme.fg("thinkingText", line))}`
- **3 or 5 lines ($N > 1$)**:
  - Line 1: `${label}`
  - Subsequent lines: `${theme.italic(theme.fg("thinkingText", tailLines.join("\n")))}`
- Sliced plain lines avoid Markdown parser errors from cut code fences or formatting mid-stream.
- Wrapped in `MouseRegion` for click handling.

---

## 3. State Machine & Click Transitions

### States
Each thinking block run index has one of three states:
- `"hidden"`: Static label `Text(hiddenThinkingLabel)` (e.g. `(thinking...)`).
- `"compact"`: Sliced tail `Text(header + lines)`.
- `"full"`: Full `Markdown(thinkingContent)`.

### Default State Resolution (no user override)
1. If `config.autoCollapseThinking` is `true` AND thinking has concluded (streaming finished or subsequent text/tool arrives):
   $\rightarrow$ `"hidden"`.
2. Else if `config.compactThinking !== "Off"`:
   $\rightarrow$ `"compact"`.
3. Else:
   $\rightarrow$ `this.hideThinkingBlock ? "hidden" : "full"`.

### Click Transitions
- From `"compact"` $\rightarrow$ `"full"`.
- From `"full"`:
  - If `config.compactThinking !== "Off"` $\rightarrow$ `"compact"`.
  - Else $\rightarrow$ `"hidden"`.
- From `"hidden"` $\rightarrow$ `"full"`.

State is stored per thinking block on the component via a Symbol key `Symbol.for("archimedes:thinkingStateOverrides")` mapping `runIndex -> "hidden" | "compact" | "full"`.

---

## 4. Verification & Testing
- Unit tests in `packages/core/src/config.test.ts` for parsing, default, and normalization.
- Unit tests in `packages/core/src/thinking/patch.test.ts`:
  - Renders compact inline for 1 line streaming and finished.
  - Renders compact multi-line for 3 lines and 5 lines.
  - Auto-collapses from compact to hidden when `autoCollapseThinking` is enabled and streaming concludes.
  - Click transitions: Compact $\rightarrow$ Full $\rightarrow$ Compact.
  - Click transitions: Hidden $\rightarrow$ Full $\rightarrow$ Compact (when `compactThinking` is active).
  - Preserves standard toggle when `compactThinking` is `"Off"`.
- Type checking: `npx tsc --noEmit` across all workspace packages.
