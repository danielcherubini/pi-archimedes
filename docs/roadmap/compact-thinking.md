---
status: committed
done-when: compactThinking setting ("Off" | "1 line" | "3 lines" | "5 lines") renders compact thinking blocks with styled text tail, toggles between Compact and Full on click, integrates with autoCollapseThinking, and passes all tests and typechecks.
---

# Compact Thinking Blocks Plan

**Goal:** Provide a `compactThinking` setting in `@pi-archimedes/core` that renders thinking blocks showing only the tail (last 1, 3, or 5 lines) instead of full markdown or hiding entirely, with click-to-expand/collapse support.
**Architecture:** Add `compactThinking` to `CoreConfig`, wire it through settings and pass it to `patchThinkingRenderer`. In `AssistantMessageComponent.prototype.updateContent`, manage a 3-state machine (`hidden`, `compact`, `full`) per run index using an Archimedes symbol key, slicing the last N lines into styled `Text` components with proper header formatting and click handlers. Existing `thinkingVisibilityOverrides` behavior is preserved when `compactThinking` is `"Off"`.
**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui` (`Text`, `MouseRegion`, `Spacer`, `Markdown`), Vitest.

---

### Task 1: Core Configuration & Settings Wiring

**Context:**
`CoreConfig` needs a new setting `compactThinking` with type `"Off" | "1 line" | "3 lines" | "5 lines"`. Following the pattern used for `editorSpinStyle` / `normalizeSpinnerStyle`, we define `normalizeCompactThinking` in `config.ts` and use it at the projection site in `getCoreSettingsItems` (and registration in `packages/core/src/index.ts`). It must be included in `CoreConfig` with a default of `"Off"`, handled by `meta/src/settings.ts` with strongly-typed casting, and passed to `patchThinkingRenderer` in `packages/core/src/index.ts:275`.

**Files:**
- Modify: `packages/core/src/config.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `meta/src/settings.ts`
- Test: `packages/core/src/config.test.ts`
- Test: `packages/core/src/index.test.ts`

**What to implement:**
1. In `packages/core/src/config.ts`:
   - Export type `CompactThinking = "Off" | "1 line" | "3 lines" | "5 lines";`
   - Export constant `COMPACT_THINKING_VALUES: readonly CompactThinking[] = ["Off", "1 line", "3 lines", "5 lines"] as const;`
   - Export helper function `normalizeCompactThinking(value: unknown): CompactThinking` that returns `value` if it is an element of `COMPACT_THINKING_VALUES`, otherwise returns `"Off"`.
   - Add `compactThinking: CompactThinking;` to `CoreConfig` interface.
   - Set `compactThinking: "Off"` in `DEFAULT_CORE_CONFIG`.
2. In `packages/core/src/index.ts`:
   - In `getCoreSettingsItems`:
     Add setting item (using `normalizeCompactThinking(config.compactThinking)` for `currentValue`, mirroring `normalizeSpinnerStyle`):
     ```ts
     {
       id: "compactThinking",
       label: "Compact thinking",
       currentValue: normalizeCompactThinking(config.compactThinking),
       values: ["Off", "1 line", "3 lines", "5 lines"],
       description: "Display only the last N lines of thinking (expands to full on click)",
     }
     ```
   - In `register(pi)`: add `compactThinking: normalizeCompactThinking(config.compactThinking)` to the options object passed to `patchThinkingRenderer(() => ctx.ui.theme, { ... })` at line ~275.
3. In `meta/src/settings.ts`:
   - Handle `"compactThinking"` case with precise typing matching sibling cases:
     ```ts
     case "compactThinking": coreConfig.compactThinking = newValue as CoreConfig["compactThinking"]; break;
     ```
4. Tests:
   - In `packages/core/src/config.test.ts`: verify `normalizeCompactThinking` returns valid values as-is and falls back to `"Off"` for undefined, empty string, or invalid inputs. Verify `DEFAULT_CORE_CONFIG.compactThinking === "Off"`.
   - In `packages/core/src/index.test.ts`: verify `getCoreSettingsItems` exposes `compactThinking` with expected options and values, and `register` passes `compactThinking` to `patchThinkingRenderer`.

**Steps:**
- [ ] Add failing tests for `normalizeCompactThinking` and `compactThinking` setting in `packages/core/src/config.test.ts` and `packages/core/src/index.test.ts`.
- [ ] From repo root, run `npx vitest run packages/core/src/config.test.ts packages/core/src/index.test.ts`
  - Verify tests fail with expected missing export / property errors.
- [ ] Implement changes in `packages/core/src/config.ts`, `packages/core/src/index.ts`, and `meta/src/settings.ts`.
- [ ] From repo root, run `npx vitest run packages/core/src/config.test.ts packages/core/src/index.test.ts`
  - Verify all tests pass.
- [ ] Run `cd packages/core && npx tsc --noEmit && cd ../../meta && npx tsc --noEmit && cd ..`
  - Verify typechecks succeed.
- [ ] Commit with message: `feat(core): add compactThinking configuration and settings item`

**Acceptance criteria:**
- [ ] `CoreConfig` includes `compactThinking: CompactThinking`.
- [ ] `normalizeCompactThinking` normalizes unknown/invalid values to `"Off"`.
- [ ] `getCoreSettingsItems` exposes the `compactThinking` setting item.
- [ ] `meta/src/settings.ts` updates `coreConfig.compactThinking` with `CoreConfig["compactThinking"]` cast.
- [ ] All config and index unit tests pass.

---

### Task 2: Compact Thinking Rendering & State Transitions in Patch

**Context:**
`patchThinkingRenderer` in `packages/core/src/thinking/patch.ts` monkey-patches `AssistantMessageComponent.prototype.updateContent`. Currently, it either shows full `Markdown` or a static hidden `Text` label. We need to implement compact rendering (last 1, 3, or 5 lines styled as `Text`) and manage a 3-state state machine (`"hidden" | "compact" | "full"`) keyed by run index, with click toggling between compact and full (and expanding from hidden to full).
To keep existing tests green, when `compactThinking` is `"Off"` (or omitted), `thinkingVisibilityOverrides` is preserved verbatim as a boolean map (`true` = hidden, `false` = full). When `compactThinking` is active (`compactLines > 0`), the Archimedes state map `Symbol.for("archimedes:thinkingStateOverrides")` is consulted and updated, and `thinkingVisibilityOverrides` is kept in sync (`true` when hidden, `false` when compact or full) so external listeners/assertions remain consistent. Note that hidden state intentionally uses `this.hiddenThinkingLabel` (native collapsed label), while compact mode uses `buildThinkingLabel()` (Archimedes styled header).

**Files:**
- Modify: `packages/core/src/thinking/patch.ts`
- Test: `packages/core/src/thinking/patch.test.ts`

**What to implement:**
1. In `packages/core/src/thinking/patch.ts`:
   - Extend `config` parameter type in `patchThinkingRenderer`:
     `config?: { labelText?: string; labelColor?: string; autoCollapseThinking?: boolean; compactThinking?: CompactThinking }`
   - Define Symbol key for Archimedes thinking state overrides:
     `const THINKING_STATES_KEY = Symbol.for("archimedes:thinkingStateOverrides");`
   - In `updateContent`:
     Initialize `(this as any)[THINKING_STATES_KEY] = (this as any)[THINKING_STATES_KEY] ?? new Map<number, "hidden" | "compact" | "full">();`
     Parse line count $N$:
     `const compactLines = config?.compactThinking === "1 line" ? 1 : config?.compactThinking === "3 lines" ? 3 : config?.compactThinking === "5 lines" ? 5 : 0;`
   - Inside the thinking run block (after `const hasVisibleContentAfter = ...`):
     - When `compactLines === 0`:
       Retain existing boolean resolution:
       ```ts
       const userOverride = this.thinkingVisibilityOverrides.get(runIndex);
       let hidden: boolean;
       if (userOverride !== undefined) {
         hidden = userOverride;
       } else if (config?.autoCollapseThinking) {
         const isThinkingActive = Boolean(this.isStreaming) && !hasVisibleContentAfter;
         hidden = !isThinkingActive;
       } else {
         hidden = this.hideThinkingBlock;
       }
       ```
       Render either `Text` (hidden) or `Markdown` (full), with existing click handler updating `this.thinkingVisibilityOverrides.set(runIndex, !hidden);`.
     - When `compactLines > 0`:
       Resolve 3-state:
       ```ts
       const userState = (this as any)[THINKING_STATES_KEY].get(runIndex);
       let state: "hidden" | "compact" | "full";
       if (userState !== undefined) {
         state = userState;
       } else if (config?.autoCollapseThinking && (!Boolean(this.isStreaming) || hasVisibleContentAfter)) {
         state = "hidden";
       } else {
         state = "compact";
       }
       ```
       Render component based on `state`:
       - If `state === "hidden"`:
         Render standard hidden `Text` using `this.hiddenThinkingLabel`:
         ```ts
         const t = ensureTheme();
         if (!t) continue;
         thinkingComponent = new Text(
           t.italic(t.fg("thinkingText", this.hiddenThinkingLabel)),
           this.outputPad ?? 1,
           0,
         );
         ```
       - If `state === "compact"`:
         Extract last $N$ lines, and format each line individually to preserve ANSI escape boundaries:
         ```ts
         const t = ensureTheme();
         if (!t) continue;
         const combined = thinkBlocks.join("\n\n").trimEnd();
         const allLines = combined.split("\n");
         const tailLines = allLines.slice(-compactLines);
         const label = buildThinkingLabel();
         let textContent: string;
         if (compactLines === 1) {
           const line = tailLines[0] ?? "";
           textContent = `${label} ${t.italic(t.fg("thinkingText", line))}`;
         } else {
           const formattedLines = tailLines.map((l) => t.italic(t.fg("thinkingText", l))).join("\n");
           textContent = `${label}\n${formattedLines}`;
         }
         thinkingComponent = new Text(textContent, this.outputPad ?? 1, 0);
         ```
       - If `state === "full"`:
         Render standard `Markdown` component with muted theme and transform.
       - MouseRegion click handler for `compactLines > 0`:
         ```ts
         this.contentContainer.addChild(
           new MouseRegion(thinkingComponent, (event) => {
             if (event.type !== "click" || event.button !== "left") return undefined;
             let nextState: "hidden" | "compact" | "full";
             if (state === "compact") {
               nextState = "full";
             } else if (state === "full") {
               nextState = "compact";
             } else {
               // From hidden -> expand to full
               nextState = "full";
             }
             (this as any)[THINKING_STATES_KEY].set(runIndex, nextState);
             this.thinkingVisibilityOverrides.set(runIndex, nextState === "hidden");
             if (this.lastMessage) this.updateContent(this.lastMessage);
             return { handled: true };
           }),
         );
         ```
2. In `packages/core/src/thinking/patch.test.ts`:
   - Keep all existing tests green (they test `compactThinking` unspecified / `"Off"`).
   - Add new `describe("compactThinking", ...)` test suite:
     - Renders single inline `Text` containing label and last line for `"1 line"` (streaming and finished).
     - Renders multi-line `Text` containing label on line 1 and last 3 lines formatted line-by-line for `"3 lines"`.
     - Renders multi-line `Text` containing label on line 1 and last 5 lines for `"5 lines"`.
     - Displays all available lines when thinking text has fewer lines than compact limit.
     - Auto-collapse integration: when both `compactThinking: "3 lines"` and `autoCollapseThinking: true` are enabled, renders compact while streaming, but collapses to hidden `Text` once streaming concludes.
     - Click transitions with compact active:
       - Clicking compact component transitions to `MockMarkdown` (full).
       - Clicking full component transitions back to compact component (`MockText`).
       - Clicking auto-collapsed hidden component transitions to `MockMarkdown` (full), and next click transitions to compact component (`MockText`).
     - State synchronization: verifies `thinkingVisibilityOverrides` is synchronized (`false` for compact/full, `true` for hidden).

**Steps:**
- [ ] Add failing tests for `compactThinking` in `packages/core/src/thinking/patch.test.ts`.
- [ ] From repo root, run `npx vitest run packages/core/src/thinking/patch.test.ts`
  - Verify new tests fail with expected assertions and existing tests pass.
- [ ] Implement compact rendering and state machine in `packages/core/src/thinking/patch.ts`.
- [ ] From repo root, run `npx vitest run packages/core/src/thinking/patch.test.ts`
  - Verify all patch tests pass.
- [ ] Run `cd packages/core && npx tsc --noEmit && cd ../..`
  - Verify typecheck passes.
- [ ] Commit with message: `feat(core): implement compact thinking rendering and click state transitions`

**Acceptance criteria:**
- [ ] Compact thinking renders last 1, 3, or 5 lines as styled `Text`.
- [ ] 1-line mode formats header and line on a single line.
- [ ] 3-line and 5-line modes format header on line 1 and tail lines individually formatted below.
- [ ] Clicking compact toggles to full; clicking full toggles back to compact.
- [ ] Clicking hidden (when compact is active) transitions to full, then subsequent click returns to compact.
- [ ] `autoCollapseThinking` properly auto-collapses finished blocks to hidden even when compact is enabled.
- [ ] All existing tests and new tests in `patch.test.ts` pass cleanly.

---

### Task 3: Documentation Updates

**Context:**
Keep `packages/core/README.md` in sync with the new `compactThinking` setting. Note that the root `README.md` explicitly delegates per-component settings documentation to each component's README, so only `packages/core/README.md` needs the new setting row.

**Files:**
- Modify: `packages/core/README.md`

**What to implement:**
1. In `packages/core/README.md`:
   - Add `compactThinking` to the Core settings table (matching existing row formatting):
     `| \`compactThinking\` | string | \`Off\` | Display only the last N lines of thinking blocks (\`Off\`, \`1 line\`, \`3 lines\`, \`5 lines\`; expands to full on click) |`

**Steps:**
- [ ] Update `packages/core/README.md` settings table.
- [ ] From repo root, run `pnpm test`.
  - Verify test suite passes across the repo.
- [ ] Run `cd packages/core && npx tsc --noEmit && cd ../../meta && npx tsc --noEmit && cd ..`
  - Verify all package typechecks pass.
- [ ] Commit with message: `docs(core): document compactThinking setting in README`

**Acceptance criteria:**
- [ ] `packages/core/README.md` documents `compactThinking`.
- [ ] `pnpm test` and workspace typechecks pass cleanly.
