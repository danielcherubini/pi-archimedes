---
status: committed
done-when: All packages type-check cleanly against Pi 0.87.0, all unit test suites pass, macOS clipboard image reading uses @earendil-works/pi-tui's getNativeClipboard with convertToPng fallback for BMPs, core's thinking renderer restores interactive mouse click toggling while retaining custom styling, footer correctly accounts for cache warming and tool token usage with anchor verification, and session-name uses ctx.modelRegistry.streamSimple().
---

# Upstream Pi 0.87.0 Compatibility & Modernization Plan

**Goal:** Upgrade `pi-archimedes` dependencies to Pi `0.87.0`, restore broken native clipboard and thinking block click-to-expand capabilities, update footer token cost accounting to capture all four Pi 0.86+ usage sources with branch-safe anchor verification, and modernize LLM invocation in `session-name`.

**Architecture:** Monorepo package devDependencies are aligned to `^0.87.0` while preserving peerDependency ranges. `@pi-archimedes/image-paste` uses in-tree `@earendil-works/pi-tui` native clipboard bindings instead of the defunct `@mariozechner/clipboard`, converting Windows BMPs via `convertToPng()`. `@pi-archimedes/core` wraps the thinking component in `MouseRegion` and tracks `thinkingVisibilityOverrides` to match Pi 0.85+ interactive toggling while preserving Archimedes' custom header label and muted theme. `@pi-archimedes/footer` implements multi-source usage extraction and anchor-verified incremental scanning with tail-entry staleness checking. `@pi-archimedes/session-name` drops deprecated `@earendil-works/pi-ai/compat` in favor of `ctx.modelRegistry.streamSimple()`.

**Tech Stack:** TypeScript 6 / 7, `@earendil-works/pi-coding-agent` 0.87.0, `@earendil-works/pi-tui` 0.87.0, `@earendil-works/pi-ai` 0.87.0, pnpm workspaces, vitest.

---

### Task 1: Bump Pi dependencies to `^0.87.0` across monorepo and verify baseline

**Context:**
All monorepo packages currently specify `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `@earendil-works/pi-ai` as `^0.85.1` in `devDependencies`. We need to bump all packages to `^0.87.0`, run `pnpm install` to update `pnpm-lock.yaml`, and verify that the monorepo builds and existing tests pass before applying behavioral fixes. Note: `peerDependencies` ranges (`>=0.1.0` or `>=0.84.4`) already permit 0.87.0 and remain unchanged.

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/ask/package.json`
- Modify: `packages/footer/package.json`
- Modify: `packages/diff/package.json`
- Modify: `packages/image-paste/package.json`
- Modify: `packages/subagent/package.json`
- Modify: `packages/todo/package.json`
- Modify: `packages/notify/package.json`
- Modify: `packages/session-name/package.json`
- Modify: `packages/mcp/package.json`
- Modify: `packages/sudo/package.json`
- Modify: `meta/package.json`
- Modify: `pnpm-lock.yaml`

**What to implement:**
- In the 12 `package.json` files listed above, bump any occurrence of `"@earendil-works/pi-coding-agent": "^0.85.1"`, `"@earendil-works/pi-tui": "^0.85.1"`, and `"@earendil-works/pi-ai": "^0.85.1"` under `devDependencies` to `"^0.87.0"`. Do NOT modify `peerDependencies`.
- Run `pnpm install` to update lockfile and dependencies.
- Run `pnpm test` and `npx tsc --noEmit` across packages to establish the green baseline.

**Steps:**
- [ ] Edit the 12 `package.json` files to update `@earendil-works/*` devDependencies to `^0.87.0`
- [ ] Run `pnpm install`
  - Did `pnpm install` succeed and update `pnpm-lock.yaml`? If not, investigate package conflicts.
- [ ] Run `pnpm test`
  - Did all existing tests pass?
- [ ] Run `npx tsc --noEmit` in `packages/core` and `meta`
  - Did typecheck succeed?
- [ ] Commit with message: "chore: bump pi dependencies to ^0.87.0"

**Acceptance criteria:**
- [ ] All 12 packages specify `^0.87.0` for `@earendil-works/*` in devDependencies.
- [ ] `pnpm-lock.yaml` resolves Pi packages at `0.87.0`.
- [ ] All existing vitest test suites pass (green baseline established before behavioral changes).

---

### Task 2: Fix `@pi-archimedes/image-paste` native clipboard integration

**Context:**
Upstream Pi PR #9163 removed `@mariozechner/clipboard` from Pi entirely, causing clipboard image pasting to fail on macOS. `@earendil-works/pi-tui` exports `getNativeClipboard(): NativeClipboard | undefined` with bundled N-API binaries for macOS, Linux X11, and Windows. In addition, `@earendil-works/pi-coding-agent` exports `convertToPng(base64Data: string, mimeType: string): Promise<{ data: string; mimeType: string } | null>` for converting raw Windows BMP clipboard data to standard PNG. The contract for `ClipboardImage` is `{ bytes: Uint8Array; mimeType: string; }`.

**Files:**
- Modify: `packages/image-paste/src/clipboard.ts`
- Create: `packages/image-paste/src/clipboard.test.ts`

**What to implement:**
- In `packages/image-paste/src/clipboard.ts`:
  - Delete `loadClipboardModule`, `cachedClipboardModule`, `resetClipboardModuleCache`, and `ClipboardModule` interface.
  - Import `getNativeClipboard` from `@earendil-works/pi-tui`.
  - Import `convertToPng` from `@earendil-works/pi-coding-agent`.
  - Rewrite `readClipboardImageViaNativeModule(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv): Promise<ClipboardReadResult>`:
    - If `environment.TERMUX_VERSION || !hasGraphicalSession(platform, environment)`: return `{ available: false, image: null }`.
    - In a try/catch block:
      - Call `const native = getNativeClipboard();`.
      - If `!native`: return `{ available: false, image: null }`.
      - Call `const bytes = await native.getImage();`.
      - If `!bytes || bytes.length === 0`: return `{ available: true, image: null }`.
      - Ensure `bytes` is a `Uint8Array` (`const rawBytes = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);`).
      - On Windows (`platform === "win32"`):
        - Check if starts with BMP magic bytes `BM` (`rawBytes.length >= 2 && rawBytes[0] === 0x42 && rawBytes[1] === 0x4d`):
          - Convert: `const png = await convertToPng(Buffer.from(rawBytes).toString("base64"), "image/bmp");`
          - If `png`: return `{ available: true, image: { bytes: Uint8Array.from(Buffer.from(png.data, "base64")), mimeType: png.mimeType } }`.
          - If `!png`: return `{ available: false, image: null }` (allowing fallback to `readClipboardImageViaPowerShell`).
      - Return `{ available: true, image: { bytes: rawBytes, mimeType: "image/png" } }`.
      - Catch block: on any native rejection or error, log/catch and return `{ available: false, image: null }` so caller falls back to CLI tools.
  - In `getUnavailableReaderMessage`, update the error messages that previously referenced `@mariozechner/clipboard` to reference `@earendil-works/pi-tui native clipboard or CLI tools`.
- In `packages/image-paste/src/clipboard.test.ts`:
  - Unit tests for `readClipboardImage`:
    - Tests macOS path when `getNativeClipboard()` returns PNG bytes (verifies `{ bytes: Uint8Array, mimeType: "image/png" }`).
    - Tests macOS path when `getNativeClipboard()` returns empty.
    - Tests Windows path when `getNativeClipboard()` returns BMP bytes (verifying `convertToPng` is called, destructuring `{ data, mimeType }` and decoding base64 back into `Uint8Array`).
    - Tests Windows path when `convertToPng` returns `null` or native throws (verifying fallback).

**Steps:**
- [ ] Create failing tests in `packages/image-paste/src/clipboard.test.ts` mocking `getNativeClipboard` and `convertToPng`
- [ ] Run `npx vitest run packages/image-paste/src/clipboard.test.ts`
  - Did it fail as expected?
- [ ] Implement `getNativeClipboard()` and `convertToPng()` in `packages/image-paste/src/clipboard.ts`
- [ ] Run `npx vitest run packages/image-paste/src/clipboard.test.ts`
  - Did all tests pass?
- [ ] Run `npx tsc --noEmit` in `packages/image-paste`
  - Did typecheck succeed?
- [ ] Commit with message: "fix(image-paste): migrate from @mariozechner/clipboard to pi-tui getNativeClipboard"

**Acceptance criteria:**
- [ ] `@mariozechner/clipboard` is no longer imported or referenced anywhere in `packages/image-paste`.
- [ ] macOS clipboard image pasting works via `getNativeClipboard()`.
- [ ] Windows BMP clipboard images are converted to PNG via `convertToPng()`, returning `{ bytes: Uint8Array, mimeType }`.
- [ ] Rejections from `native.getImage()` are caught and fall through gracefully to CLI fallbacks.

---

### Task 3: Restore mouse click-to-toggle in `@pi-archimedes/core` thinking patch

**Context:**
Pi 0.85.0+ wrapped thinking blocks inside `MouseRegion` on `AssistantMessageComponent.prototype.updateContent` and maintained `this.thinkingVisibilityOverrides: Map<number, boolean>` so users can click on thinking blocks in the terminal to expand/collapse them. Archimedes monkey-patches `updateContent` in `packages/core/src/thinking/patch.ts` to apply custom header labels and a muted Markdown theme, but our patch was based on 0.84.3 and completely omitted `MouseRegion` and `thinkingVisibilityOverrides`, breaking click-to-expand.

**Files:**
- Modify: `packages/core/src/thinking/patch.ts`
- Modify: `packages/core/src/thinking/patch.test.ts`

**What to implement:**
- In `packages/core/src/thinking/patch.ts`:
  - Import `MouseRegion` from `@earendil-works/pi-tui`.
  - In `(proto as any).updateContent`:
    - Ensure `this.thinkingVisibilityOverrides = this.thinkingVisibilityOverrides ?? new Map<number, boolean>();`.
    - Initialize `let thinkingRunIndex = 0;` before looping through `message.content`.
    - Preserve the entire batched thinking loop verbatim (`thinkBlocks` collection, `i--`, zero-length guard).
    - Immediately after the `if (thinkBlocks.length === 0) continue;` check for the run:
      - Assign `const runIndex = thinkingRunIndex++;`.
      - Determine visibility: `const hidden = this.thinkingVisibilityOverrides.get(runIndex) ?? this.hideThinkingBlock;`.
      - Build the single `thinkingComponent`:
        - If `hidden`:
          `const t = ensureTheme(); if (!t) continue;`
          `const thinkingComponent = new Text(t.italic(t.fg("thinkingText", this.hiddenThinkingLabel)), this.outputPad ?? 1, 0);`
        - If `!hidden`:
          `let thinkingContent = thinkBlocks.join("\n\n");`
          `const label = buildThinkingLabel();`
          `if (!thinkingContent.startsWith(label)) { thinkingContent = `${label}\n\n${thinkingContent}`; }`
          `const t = ensureTheme(); if (!t) continue;`
          `const muted = ensureMuted();`
          `const thinkingComponent = new Markdown(thinkingContent, this.outputPad ?? 1, 0, muted ?? this.markdownTheme, { color: (text: string) => t.fg("thinkingText", text), italic: true }, { transform: transformFor("assistant-thinking") } as MarkdownOptionsWithTransform);`
      - Wrap `thinkingComponent` in `MouseRegion`:
        ```typescript
        this.contentContainer.addChild(
          new MouseRegion(thinkingComponent, (event) => {
            if (event.type !== "click" || event.button !== "left") return undefined;
            this.thinkingVisibilityOverrides.set(runIndex, !hidden);
            if (this.lastMessage) this.updateContent(this.lastMessage);
            return { handled: true };
          }),
        );
        ```
      - Follow with the existing spacer logic: `if (hasVisibleContentAfter) this.contentContainer.addChild(new Spacer(1));`.
- In `packages/core/src/thinking/patch.test.ts`:
  - Add test asserting that `MouseRegion` wraps the thinking component (whether hidden or expanded).
  - Add test asserting that dispatching a left-click event (`type: "click"`, `button: "left"`) to `MouseRegion` sets `thinkingVisibilityOverrides` and re-invokes `updateContent`.
  - Verify that existing custom label and muted theme tests continue to pass.

**Steps:**
- [ ] Add failing test in `packages/core/src/thinking/patch.test.ts` verifying `MouseRegion` wrapping and click handler
- [ ] Run `npx vitest run packages/core/src/thinking/patch.test.ts`
  - Did it fail with missing `MouseRegion`?
- [ ] Implement `MouseRegion` wrapping and `thinkingVisibilityOverrides` handling in `packages/core/src/thinking/patch.ts`
- [ ] Run `npx vitest run packages/core/src/thinking/patch.test.ts`
  - Did all tests pass?
- [ ] Run `npx tsc --noEmit` in `packages/core`
  - Did typecheck succeed?
- [ ] Commit with message: "fix(core): restore mouse click-to-toggle on thinking blocks"

**Acceptance criteria:**
- [ ] Thinking blocks are wrapped in a single `MouseRegion` whether collapsed or expanded.
- [ ] Clicking on a thinking block flips its entry in `this.thinkingVisibilityOverrides` and re-renders via `updateContent`.
- [ ] Archimedes custom thinking label, muted markdown theme, and mermaid/extension markdown transforms continue to be applied.

---

### Task 4: Upgrade token usage accounting & cost tracking in `@pi-archimedes/footer`

**Context:**
Pi 0.86+ logs background cache warming to `UsageEntry` (`type: "usage"`), tools emit internal LLM usage via `ToolResultMessage.usage`, and compaction entries contain `CompactionEntry.usage`. `packages/footer/src/utils/stats.ts` only looks at assistant messages, omitting background warming and tool execution costs from the footer. Furthermore, the incremental scanner in `stats.ts` needs branch-switch anchor verification and must check for in-place tail-entry usage mutations during streaming.

**Files:**
- Modify: `packages/footer/src/utils/stats.ts`
- Modify: `packages/footer/src/utils/stats.test.ts`

**What to implement:**
- In `packages/footer/src/utils/stats.ts`:
  - Define `function extractEntryUsage(sessionEntry: any): MessageUsage | null`:
    - Checks `sessionEntry?.type === "usage"` -> returns `sessionEntry.usage`.
    - Checks `sessionEntry?.type === "message" && sessionEntry.message?.role === "assistant"` -> returns `sessionEntry.message.usage`.
    - Checks `sessionEntry?.type === "message" && sessionEntry.message?.role === "toolResult" && sessionEntry.message.usage` -> returns `sessionEntry.message.usage`.
    - Checks `(sessionEntry?.type === "compaction" || sessionEntry?.type === "branch_summary") && sessionEntry.usage` -> returns `sessionEntry.usage`.
    - Else returns `null`.
  - Fix state machine with anchor verification and tail-entry re-checking:
    - Track `lastAnchorEntryId: string | undefined`.
    - Track `lastTailUsage: MessageUsage | undefined`.
    - When `entries.length === 0`: return zeroes, reset running totals.
    - Check anchor continuity:
      ```typescript
      const anchorMatch = runningTotal !== undefined && runningTotalEntryCount > 0 &&
        entries[runningTotalEntryCount - 1]?.id === lastAnchorEntryId;
      ```
    - If `anchorMatch`:
      - If `entries.length === runningTotalEntryCount`:
        - Re-check the tail entry `extractEntryUsage(entries[entries.length - 1])` against `lastTailUsage`.
        - If tail usage changed (finalizing after streaming): update `runningTotal` by the delta and update `lastTailUsage`.
        - Return `runningTotal` ($O(1)$ steady-state check).
      - If `entries.length > runningTotalEntryCount`:
        - Re-check previous tail entry for any final delta if applicable.
        - Incrementally scan new entries from `runningTotalEntryCount` to `entries.length`, accumulating onto `runningTotal`.
    - Else (first run, entries truncated, or branch switch where anchor id mismatched):
      - Re-scan from index 0 across all entries.
    - Update `runningTotalEntryCount = entries.length;`, `lastAnchorEntryId = entries[entries.length - 1]?.id;`, `lastTailUsage = extractEntryUsage(entries[entries.length - 1]) ?? undefined;`.
  - Export `resetStatsState(): void` to clear module-level running totals, anchor id, and cache for clean test isolation.
- In `packages/footer/src/utils/stats.test.ts`:
  - Update test `SessionEntry` interface and mock helpers (`makeAssistantEntry`, `makeUserEntry`) to include `id: string`.
  - Add helper builders: `makeUsageEntry(id, usage)`, `makeToolResultEntry(id, usage)`, `makeCompactionEntry(id, usage)`.
  - Test `UsageEntry` (`type: "usage"`) tokens and cost accumulation.
  - Test `ToolResultMessage` (`type: "message", role: "toolResult"`) usage accumulation.
  - Test `CompactionEntry` (`type: "compaction"`) usage accumulation.
  - Test branch switch detection: changing entry IDs at the anchor position triggers clean re-scan.
  - Test tail entry usage mutation: when entry count is unchanged, modifying the tail entry's usage updates the total.

**Steps:**
- [ ] Update `packages/footer/src/utils/stats.test.ts` mock interfaces and add failing tests for `UsageEntry`, tool usage, compaction usage, tail mutation, and branch switching
- [ ] Run `npx vitest run packages/footer/src/utils/stats.test.ts`
  - Did it fail as expected?
- [ ] Implement `extractEntryUsage`, anchor verification, and tail checking in `packages/footer/src/utils/stats.ts`
- [ ] Run `npx vitest run packages/footer/src/utils/stats.test.ts`
  - Did all tests pass?
- [ ] Run `npx tsc --noEmit` in `packages/footer`
  - Did typecheck succeed?
- [ ] Commit with message: "fix(footer): account for cache warming, tool usage, and compaction in token stats"

**Acceptance criteria:**
- [ ] Token usage and cost include `UsageEntry`, assistant messages, tool result usage, and compactions.
- [ ] Branch switching (re-anchoring) correctly triggers a full re-scan rather than corrupting cumulative totals.
- [ ] In-place mutation of the tail entry's usage on equal counts is reflected in totals.
- [ ] Unchanged steady state operates in $O(1)$ tail check.

---

### Task 5: Streamline LLM calling in `@pi-archimedes/session-name` with `ctx.modelRegistry.streamSimple()`

**Context:**
`packages/session-name/src/index.ts` currently imports deprecated `complete` from `@earendil-works/pi-ai/compat` and `ProviderHeaders` from `@earendil-works/pi-ai`, performing manual auth resolution and options mapping (~25 lines of boilerplate). In Pi 0.86+, `ctx.modelRegistry.streamSimple()` provides provider-neutral model streaming with built-in auth resolution (handling env vars, `/login` OAuth, and custom extension-registered providers).

**Files:**
- Modify: `packages/session-name/src/index.ts`
- Create: `packages/session-name/src/index.test.ts`

**What to implement:**
- In `packages/session-name/src/index.ts`:
  - Remove imports of `complete` from `@earendil-works/pi-ai/compat` and `ProviderHeaders` from `@earendil-works/pi-ai`.
  - In `generateTitle()`:
    - Replace steps 4–6 (manual `hasConfiguredAuth`, `getApiKeyAndHeaders`, and `complete()`) with:
      ```typescript
      const stream = ctx.modelRegistry.streamSimple(
        model,
        {
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: titlePrompt }],
              timestamp: Date.now(),
            },
          ],
        },
        {
          reasoning: "minimal",
          cacheRetention: "none",
          sessionId: crypto.randomUUID(),
        },
      );

      const response = await stream.result();
      if (response.stopReason === "error") {
        onFailure();
        return;
      }
      ```
    - Preserve steps 7–9 (`response.content` extraction, quote/whitespace trimming, `pi.getSessionName()` race guard, `pi.setSessionName()`) unchanged.
- In `packages/session-name/package.json`:
  - Note: Keep `@earendil-works/pi-ai` in `devDependencies` and `peerDependencies` bumped to `^0.87.0` (or `>=0.1.0`) so all re-exported types from `pi-coding-agent` continue to resolve cleanly under `tsc`.
- In `packages/session-name/src/index.test.ts`:
  - Unit tests for `generateTitle`:
    - Successful title generation sets session name and trims quotes/newlines.
    - Response with `stopReason === "error"` triggers `onFailure`.
    - Session name already set race condition aborts without calling `pi.setSessionName`.

**Steps:**
- [ ] Create failing test in `packages/session-name/src/index.test.ts` mocking `ctx.modelRegistry.streamSimple()`
- [ ] Run `npx vitest run packages/session-name/src/index.test.ts`
  - Did it fail as expected?
- [ ] Update `packages/session-name/src/index.ts` to use `streamSimple()` and remove `compat` imports
- [ ] Run `npx vitest run packages/session-name/src/index.test.ts`
  - Did tests pass?
- [ ] Run `npx tsc --noEmit` in `packages/session-name`
  - Did typecheck succeed?
- [ ] Commit with message: "refactor(session-name): use modelRegistry.streamSimple for title generation"

**Acceptance criteria:**
- [ ] `packages/session-name` no longer imports `@earendil-works/pi-ai/compat`.
- [ ] `generateTitle` uses `ctx.modelRegistry.streamSimple()`.
- [ ] Extension-registered models and OAuth providers are supported for session naming.
- [ ] Steps 7–9 are preserved and unit tests verify happy path, error stop reason, and race guard.
