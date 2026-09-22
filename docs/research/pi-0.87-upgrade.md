---
status: current
last-verified: 2026-09-22
verified-by: code research — git repo /home/daniel/Coding/AI/pi (v0.85.1..v0.87.0) and installed packages, 2026-09-22
---

# Research Report: Upstream Pi Updates (v0.85.1 → v0.87.0)

## Executive Summary

Our monorepo packages currently pin `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `@earendil-works/pi-ai` at **`^0.85.1`** (with peer dependencies `>=0.1.0` or `>=0.84.4`). The latest published version of Pi is **`0.87.0`** (released 2026-09-21), with `0.86.0` (2026-09-19) and `0.86.1` (2026-09-20) released in between.

The test suite across all 12 Archimedes packages currently passes (86 test files, 1748 tests) and type-checking succeeds without emit errors. However, an in-depth investigation of upstream commits, changelog entries, and source files reveals several **critical impacts** and **modernization opportunities** for `pi-archimedes`:

1. **`@pi-archimedes/image-paste` is broken on macOS**: Upstream eliminated `@mariozechner/clipboard` in PR #9163, replacing it with bundled native helpers in `@earendil-works/pi-tui`. Because `image-paste` relied solely on `@mariozechner/clipboard` for macOS clipboard image reads, macOS clipboard pasting fails.
2. **`@pi-archimedes/core` thinking patch breaks upstream click-to-expand**: Upstream added interactive mouse click toggling (`MouseRegion`) to thinking blocks in `AssistantMessageComponent`. Archimedes' monkey patch in `packages/core/src/thinking/patch.ts` overrides `updateContent` with an older 0.84.x implementation, discarding `MouseRegion` and breaking click-to-expand.
3. **`@pi-archimedes/footer` ignores cache-warming and tool token costs**: Pi 0.86+ introduced `UsageEntry` (`type: "usage"`) for cache warming, plus tool result usage, and compaction/branch summary usage. Archimedes' footer only counts assistant messages, omitting cache warming and tool LLM costs from the status bar.
4. **`@pi-archimedes/session-name` can be simplified**: `ctx.modelRegistry.streamSimple()` provides unified provider-neutral model streaming with resolved authentication, eliminating ~25 lines of manual auth boilerplate and supporting extension-registered providers.
5. **Event unsubscription**: `pi.on()` now returns an `unsubscribe: () => void` function, easing lifecycle management.

---

## 1. Upstream Release Highlights (v0.85.1 → v0.87.0)

### 1.1 Pi 0.86.0 (2026-09-19)

- **Native Clipboard Overhaul & Dependency Removal ([#9163](https://github.com/earendil-works/pi/pull/9163))**:
  - Completely removed `@mariozechner/clipboard`.
  - Bundled asynchronous macOS, Windows, and X11 native helpers inside `@earendil-works/pi-tui` (`darwin-platform.node`, `linux-platform-x11.node`, `win32-platform.node`).
  - Added native clipboard exports in `@earendil-works/pi-tui`: `getNativeClipboard`, `type NativeClipboard`.
- **Prompt Cache Warming ([#9668](https://github.com/earendil-works/pi/pull/9668))**:
  - Cost-aware prompt cache warming during long tool runs and idle periods.
  - Appends `UsageEntry` (`type: "usage"`) to session entries to account for background warming costs.
  - Added `cache_warming_decision` extension event.
- **TUI & UI Enhancements**:
  - Interactive click-to-toggle on thinking blocks (`MouseRegion` on `AssistantMessageComponent`), compaction summaries, and branch summaries.
  - **Zero-row footer collapse ([#8919](https://github.com/earendil-works/pi/issues/8919))**: Fullscreen chat viewport no longer reserves a blank row for custom footers that render zero rows (`minSize: 0`).
  - Moved compaction, branch summarization, and retry spinners into the editor border.
- **Extension API Additions**:
  - `pi.on()` returns `unsubscribe: () => void` ([#9630](https://github.com/earendil-works/pi/issues/9630)).
  - `ctx.modelRegistry.stream()` and `ctx.modelRegistry.streamSimple()` for extension-level model calls with resolved auth and provider abstraction ([#8964](https://github.com/earendil-works/pi/issues/8964)).
  - Strict-prefer JSON-schema sampling enabled by default on built-in tools.
  - Tool duration formatting shows hours/minutes/seconds for runs $> 1$ min ([#9628](https://github.com/earendil-works/pi/issues/9628)).

### 1.2 Pi 0.86.1 (2026-09-20)

- Added Meta Muse subscription provider (`/login meta`, `META_API_KEY`).
- Enabled Node's persistent compile cache before loading bundled CLI runtime.
- Restored OSC 52 fallback when running headless in containers or WSL without WSLg.

### 1.3 Pi 0.87.0 (2026-09-21)

- **Canonical Session Context & Boundaries ([commit `466db0fec`](https://github.com/earendil-works/pi/commit/466db0fec))**:
  - `SessionManager` projections are canonical for LLM context (`buildSessionProjection()`, `buildSessionContext()`).
  - **`ContextEditEntry`**: Append-only model-context edits (`sessionManager.appendContextEdit(targetId, replacement)`). Can omit messages (`replacement: null`) or replace content without deleting raw transcript history.
  - **Actionable Boundaries**: `turn_end` and `agent_before_settle` handlers can return `{ entries: [...event.entries, draft], continue: true }` to inject structural entries and ensure a follow-up LLM request without breaking queue scheduling.
  - Breaking change: `shouldStopAfterTurn` removed in favor of `finishTurn` returning `{ action: "end" }`.
- **Context Extensions**:
  - `context_with_system`: New extension event that runs after standard `context` handlers on the full transcript including system messages and tool declarations.
  - `context` handlers no longer see system messages (Pi strips them and restores prompt/tool declarations afterwards to prevent accidental drops).
- **Per-model Image Limits ([#9631](https://github.com/earendil-works/pi/issues/9631))**:
  - Cache-safe image resizing per model in `models.json` (`inputLimits.images.resize`) applied to file attachments, `read`, and tool results.
- **Settled Handlers Non-Reentrancy**:
  - Runs requested from `agent_settled` handlers are deferred until all settled handlers finish.
- **Crash Diagnostics**:
  - Crash reports identify loaded extensions that appear in stack traces.

---

## 2. Deep-Dive Findings & Architecture

### Angle 1: Clipboard API Integration (`@pi-archimedes/image-paste`)

- **Root Cause**: Pi PR #9163 completely removed the `@mariozechner/clipboard` dependency.
- **Export Inspection**:
  - `@earendil-works/pi-tui` exports `getNativeClipboard(): NativeClipboard | undefined`.
  - `NativeClipboard.getImage(): Promise<Uint8Array | null | undefined>`.
    - macOS: Cocoa pasteboard integration returning PNG bytes.
    - Windows: Win32 clipboard integration returning PNG bytes or standard BMP bytes (with synthesized 14-byte `BITMAPFILEHEADER`).
    - Linux: XCB X11 clipboard integration reading image atoms.
  - `@earendil-works/pi-coding-agent` **does not** export `readClipboardImage` (internal to `dist/utils/clipboard-image.js`), but **does** export `convertToPng(base64Data, mimeType)` for BMP to PNG conversion via Photon WASM.
- **Recommended Implementation for `packages/image-paste/src/clipboard.ts`**:
  1. Remove all `@mariozechner/clipboard` references and cache helpers.
  2. Query `getNativeClipboard()` from `@earendil-works/pi-tui`.
  3. On macOS: Await `getNativeClipboard()?.getImage()` directly (returns PNG).
  4. On Windows: Await `getNativeClipboard()?.getImage()`. Sniff MIME type; if BMP, convert to PNG with `convertToPng()`. Fallback to PowerShell.
  5. On Linux: Try `wl-paste` on Wayland; try `xclip`; fall back to `getNativeClipboard()?.getImage()` (X11 XCB); fall back to WSL host PowerShell screenshot bridge.

### Angle 2: Thinking Block Mouse Click-Toggle (`@pi-archimedes/core`)

- **Root Cause**: Pi 0.85.0+ wrapped thinking widgets inside a `MouseRegion` and tracked per-run overrides in `this.thinkingVisibilityOverrides: Map<number, boolean>`. Archimedes' `packages/core/src/thinking/patch.ts` replaced `updateContent` with an older 0.84.3 implementation lacking `MouseRegion`.
- **Recommended Implementation for `packages/core/src/thinking/patch.ts`**:
  1. Import `MouseRegion` from `@earendil-works/pi-tui`.
  2. Ensure `this.thinkingVisibilityOverrides = this.thinkingVisibilityOverrides ?? new Map<number, boolean>()`.
  3. Track `thinkingRunIndex++` before looping message content.
  4. Query `const hidden = overrides.get(runIndex) ?? this.hideThinkingBlock`.
  5. Wrap the thinking component (`Text` when hidden, muted `Markdown` with Archimedes header when expanded) in `MouseRegion`:
     ```typescript
     this.contentContainer.addChild(
       new MouseRegion(thinkingComponent, (event) => {
         if (event.type !== "click" || event.button !== "left") return undefined;
         overrides.set(runIndex, !hidden);
         if (this.lastMessage) this.updateContent(this.lastMessage);
         return { handled: true };
       })
     );
     ```

### Angle 3: Usage Accounting & Cost Calculation (`@pi-archimedes/footer`)

- **Root Cause**: Upstream Pi (`usage-totals.ts`, `footer.ts`, `session-manager.ts`) aggregates four usage sources:
  1. `UsageEntry` (`type: "usage"`) — background cache warming.
  2. `AssistantMessage.usage` — standard assistant responses.
  3. `ToolResultMessage.usage` — tool executions reporting internal LLM usage.
  4. `CompactionEntry.usage` and `BranchSummaryEntry.usage` — LLM compaction and branch summaries.
- **Archimedes Issue**: `packages/footer/src/utils/stats.ts` only reads assistant messages. Furthermore, its incremental scanner has a boundary flaw that re-scans all entries every 500ms once entry additions stop, and lacks branch-switch safety checks.
- **Recommended Implementation for `packages/footer/src/utils/stats.ts`**:
  1. Add `extractEntryUsage(entry)` to aggregate all 4 entry types.
  2. Verify anchor continuity (`lastAnchorEntryId === entries[runningTotalEntryCount - 1]?.id`) to detect session tree branch switches and trigger clean re-scans.
  3. Ensure $O(1)$ steady-state performance when entry count remains constant across render ticks.

### Angle 4: Streamlined LLM Calling (`@pi-archimedes/session-name`)

- **Root Cause**: `packages/session-name/src/index.ts` manually inspects `ctx.modelRegistry.hasConfiguredAuth(model)`, retrieves API keys and headers via `ctx.modelRegistry.getApiKeyAndHeaders(model)`, and calls `complete()` from `@earendil-works/pi-ai/compat`.
- **Upstream Solution**: `ctx.modelRegistry.streamSimple(model, context, options)` handles auth resolution automatically, supports custom extension-registered providers (`pi.registerProvider`), and removes deprecated `compat` imports:
  ```typescript
  const stream = ctx.modelRegistry.streamSimple(
    model,
    { messages: [{ role: "user", content: titlePrompt, timestamp: Date.now() }] },
    { reasoning: "minimal", cacheRetention: "none", sessionId: crypto.randomUUID() },
  );
  const response = await stream.result();
  if (response.stopReason === "error") {
    onFailure();
    return;
  }
  ```

---

## 3. Recommended Implementation Roadmap

1. **Phase 1: Dependency & Peer Bump**:
   - Update `devDependencies` in all packages from `^0.85.1` to `^0.87.0`.
2. **Phase 2: Fix `@pi-archimedes/image-paste`**:
   - Replace `@mariozechner/clipboard` with `@earendil-works/pi-tui/native-platform` and `convertToPng`.
3. **Phase 3: Upgrade `@pi-archimedes/core` Thinking Patch**:
   - Integrate `MouseRegion` and `thinkingVisibilityOverrides` into `patchThinkingRenderer`.
4. **Phase 4: Upgrade `@pi-archimedes/footer` Usage Accounting**:
   - Incorporate `UsageEntry`, tool result usage, and compaction usage into `stats.ts` with anchor-verified incremental scanning.
5. **Phase 5: Refactor `@pi-archimedes/session-name`**:
   - Adopt `ctx.modelRegistry.streamSimple()`.
