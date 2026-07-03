# Fix All Code Review Issues Plan

**Goal:** Systematically resolve all 17 issues identified in the pi-archimedes code review, grouped by severity and file proximity.
**Architecture:** Targeted bug fixes, security hardening, and code quality improvements across 8 packages. No architectural changes.
**Tech Stack:** TypeScript, ESM, Node.js built-in modules.

---

## Execution Order

Tasks are ordered by severity (🔴 critical → 🟡 medium → 🟢 low) and grouped by file proximity to minimize context switching. Each task is independently commitable.

| Priority | Task | Issues | Package(s) | Risk |
|----------|------|--------|------------|------|
| 🔴 P0 | Task 1: Bus double-delivery + re-emit ordering | #1, #5 | core | High |
| 🟡 P1 | Task 2: Notify OSC sanitization | #6 | notify | Medium |
| 🟡 P1 | Task 3: Git status parsing fix | #9 | footer | Medium |
| 🟡 P1 | Task 4: Secure subagent socket path | #10 | subagent | Medium |
| 🟡 P1 | Task 5: Agent-manager atomicity + cleanup | #7, #12, #13 | subagent | Low |
| 🟡 P1 | Task 6: Frontmatter regex + ask timeout | #3, #11 | subagent, ask | Low |
| 🟡 P1 | Task 7: Core utility fixes | #4, #8, #14, #15 | core | Low |
| 🟢 P2 | Task 8: Todo optimization + indentation | #16, #17 | todo, multi | Low |
| 🟢 P2 | Task 9: Add node:test harness | #2 | repo-wide | Low |

---

### Task 1: Fix Core Bus Double-Delivery and Re-Emit Ordering (Critical)

**Context:**
`packages/core/src/bus.ts` has a double-delivery bug: when a subscriber registers via `on()`, it drains queued events for that event type but does NOT remove them from the global queue. Later, when `initBus()` flushes the queue, the same events are emitted again, causing existing subscribers to receive duplicates. Additionally, `initBus()` should ensure events are delivered in FIFO order and that events without listeners during flush are re-queued for future subscribers.

This is the highest-priority fix because double-delivery causes incorrect behavior in all packages that consume bus events (footer, notify, ask, todo).

**Root cause:** In `on()`, the drain loop iterates the queue and delivers matching events to the new listener, but never removes them from `QUEUE_KEY`. When `initBus()` later snapshots and flushes the queue, those same events are emitted again.

**Files:**
- Modify: `packages/core/src/bus.ts`

**What to implement:**

1. **In `on()` — remove drained events from the queue:**
   Replace the current drain loop (lines ~49-59) with a filter that removes delivered events:
   ```ts
   const queue = getGlobal<Array<{ event: string; payload: unknown }>>(QUEUE_KEY);
   if (queue) {
     const remaining: Array<{ event: string; payload: unknown }> = [];
     for (const { event: queuedEvent, payload } of queue) {
       if (queuedEvent === event) {
         try {
           Promise.resolve(listener(payload)).catch((err) =>
             console.error(`[archimedes:bus] Async error in listener for "${event}":`, err));
         } catch (err) {
           console.error(`[archimedes:bus] Error in listener for "${event}":`, err);
         }
       } else {
         remaining.push({ event: queuedEvent, payload });
       }
     }
     setGlobal(QUEUE_KEY, remaining);
   }
   ```

2. **In `initBus()` — keep existing snapshot-and-clear pattern.** No changes needed. The fix in `on()` prevents double-delivery because events are removed from the queue when first delivered.

3. **In `emit()` — keep existing queue-on-no-listeners pattern.** No changes needed. Events without listeners during `initBus()` flush are correctly re-queued.

**Steps:**
- [ ] Modify the `on()` method in `packages/core/src/bus.ts` to filter drained events from the global queue.
- [ ] Run `npx tsc --noEmit` in `packages/core/`.
  - Did it pass? If not, fix type errors and re-run.
- [ ] Run `npx tsc --noEmit` in `packages/footer/`, `packages/notify/`, `packages/ask/`, `packages/todo/`, `packages/subagent/`, and `meta/` to verify downstream packages still compile.
- [ ] Commit with message: "fix(core): prevent bus double-delivery by removing drained events from queue"

**Acceptance criteria:**
- [ ] Events emitted before any subscriber exists are buffered and delivered exactly once when a subscriber registers.
- [ ] `initBus()` flush does not cause duplicate deliveries for events already delivered by `on()`.
- [ ] Events without listeners during `initBus()` flush are re-queued and delivered when a subscriber later registers.
- [ ] `npx tsc --noEmit` passes for `@pi-archimedes/core` and all dependent packages.

**Time estimate:** 15 minutes

---

### Task 2: Sanitize Notify OSC Sequences (Security)

**Context:**
`packages/notify/src/index.ts` writes user-provided `title` and `body` strings directly into OSC (Operating System Command) terminal sequences. If these strings contain escape characters (`\x1b`, `\x07`, `\x1b\\`), they can break the OSC sequence boundary or inject arbitrary terminal commands. This is a security issue because the notify package receives input from AI-generated content.

**Files:**
- Modify: `packages/notify/src/index.ts`

**What to implement:**

1. **Add a sanitization function** that strips OSC-breaking characters from strings before embedding them in sequences:
   ```ts
   /** Remove characters that would break OSC sequence boundaries. */
   function sanitizeOSC(value: string): string {
     return value
       .replace(/\x1b/g, "")    // Strip ESC (0x1B) — breaks OSC
       .replace(/\x07/g, "")    // Strip BEL (0x07) — terminates OSC
       .replace(/\x9d/g, "");   // Strip OSC intro (0x9D) — alternate OSC start
   }
   ```

2. **Apply sanitization** in all OSC notification functions:
   - `notifyOSC777(title, body)` — sanitize both `title` and `body` before embedding
   - `notifyOSC9(message)` — sanitize `message` before embedding
   - `notifyOSC99(title, body)` — sanitize both before embedding
   - `notifyWindows(title, body)` — already uses PowerShell escaping; no change needed (but add a comment noting it's safe)

3. **Do NOT change** `wrapForTmux()` — it operates on already-formed sequences and is not affected.

**Steps:**
- [ ] Add the `sanitizeOSC()` function to `packages/notify/src/index.ts` (place it near the other helper functions, before the OSC dispatchers).
- [ ] Apply `sanitizeOSC()` to all string arguments in `notifyOSC777()`, `notifyOSC9()`, and `notifyOSC99()`.
- [ ] Run `npx tsc --noEmit` in `packages/notify/`.
- [ ] Run `npx tsc --noEmit` in `meta/` to verify dependent packages compile.
- [ ] Commit with message: "fix(notify): sanitize OSC sequences to prevent terminal escape injection"

**Acceptance criteria:**
- [ ] `sanitizeOSC()` strips `\x1b`, `\x07`, and `\x9d` from input strings.
- [ ] All OSC notification functions apply sanitization before embedding user strings.
- [ ] `notifyWindows()` is unchanged (PowerShell escaping is sufficient).
- [ ] `npx tsc --noEmit` passes for `@pi-archimedes/notify` and `meta`.

**Time estimate:** 15 minutes

---

### Task 3: Fix Footer Git Status Parsing (Correctness)

**Context:**
`packages/footer/src/utils/git.ts` has a broken regex for parsing untracked files in `parseGitStatusLine()`. The untracked regex `/^(.) (.)/` expects a space between the two status characters (e.g., `? ?`), but git uses `??` with no space (e.g., `?? untracked.txt`). This means untracked files are never counted — the regex never matches, `parseGitStatusLine()` returns `null`, and `status.untracked` stays at 0.

The unscored format regex `/^(..) /` already correctly handles `?? filepath` (capturing `??` as the two status chars). The broken untracked-specific regex is dead code that should be removed.

**Files:**
- Modify: `packages/footer/src/utils/git.ts`

**What to implement:**

1. **Remove the broken untracked regex** (the third regex branch in `parseGitStatusLine()`):
   ```ts
   // DELETE THIS BLOCK entirely:
   // Untracked format: "? ..."
   const untrackedMatch = line.match(/^(.) (.)/);
   if (!untrackedMatch) return null;
   return { indexField: untrackedMatch[1]!, workTreeField: untrackedMatch[2]! };
   ```

2. **The remaining regexes are correct and sufficient:**
   - Scored: `/^\d+ (..) /` — matches `1 XY filepath`
   - Unscored: `/^(..) /` — matches `XY filepath` including `?? filepath`

3. **The `parseGitOutput()` logic is correct as-is.** When `parseGitStatusLine("?? file.txt")` returns `{ indexField: "?", workTreeField: "?" }`, the check `if (fileStates.indexField === "?")` correctly increments `status.untracked`.

**Steps:**
- [ ] Remove the broken untracked regex block from `parseGitStatusLine()` in `packages/footer/src/utils/git.ts`.
- [ ] Verify the function now has exactly two regex branches (scored and unscored), with `return null` only if neither matches.
- [ ] Run `npx tsc --noEmit` in `packages/footer/`.
- [ ] Run `npx tsc --noEmit` in `meta/` to verify dependent packages compile.
- [ ] Commit with message: "fix(footer): remove broken untracked file regex — unscored format already handles ??"

**Acceptance criteria:**
- [ ] `parseGitStatusLine("?? file.txt")` returns `{ indexField: "?", workTreeField: "?" }`.
- [ ] `parseGitStatusLine("1 AM filepath")` returns `{ indexField: "A", workTreeField: "M" }`.
- [ ] `parseGitStatusLine("M  filepath")` returns `{ indexField: "M", workTreeField: " " }`.
- [ ] `npx tsc --noEmit` passes for `@pi-archimedes/footer` and `meta`.

**Time estimate:** 10 minutes

---

### Task 4: Secure Subagent Socket Path (Security)

**Context:**
`packages/subagent/src/spawn.ts` creates Unix domain sockets for parent-child ask bridging. The socket path uses `randomUUID().slice(0, 8)` — only 8 hex characters (32 bits of entropy). This is predictable enough for collision attacks where a malicious process could create a socket at the same path and intercept ask requests/responses.

**Files:**
- Modify: `packages/subagent/src/spawn.ts`

**What to implement:**

1. **Increase socket path randomness** from 8 hex chars to 16 hex chars (64 bits):
   ```ts
   // 16 hex chars = 64 bits of entropy; prevents socket path collision attacks
   const id = randomUUID().slice(0, 16);
   ```

2. **Restrict socket permissions** by setting mode after the socket is created. After `server.listen(socketPath)`, add:
   ```ts
   if (process.platform !== "win32") {
     try {
       fs.chmodSync(socketPath, 0o600); // Owner read/write only
     } catch {
       // chmod may fail if socket file isn't created yet; not critical
     }
   }
   ```

3. **Add a comment** explaining the security rationale above the `id` variable.

**Steps:**
- [ ] Change `randomUUID().slice(0, 8)` to `randomUUID().slice(0, 16)` in `startAskSocketServer()`.
- [ ] Add `fs.chmodSync(socketPath, 0o600)` after `server.listen(socketPath)` (Unix only, wrapped in try/catch).
- [ ] Add security rationale comment.
- [ ] Run `npx tsc --noEmit` in `packages/subagent/`.
- [ ] Run `npx tsc --noEmit` in `meta/` to verify dependent packages compile.
- [ ] Commit with message: "fix(subagent): secure socket path with 64-bit entropy and restricted permissions"

**Acceptance criteria:**
- [ ] Socket path uses 16 hex characters (64 bits of entropy).
- [ ] Unix sockets are created with `0o600` permissions (owner read/write only).
- [ ] Windows named pipes are unchanged (already secure by default).
- [ ] `npx tsc --noEmit` passes for `@pi-archimedes/subagent` and `meta`.

**Time estimate:** 10 minutes

---

### Task 5: Agent-Manager Rename Atomicity + Dead Params + visibleWidth (Medium)

**Context:**
`packages/subagent/src/agent-manager.ts` has three related issues:
1. **Rename atomicity (#7):** `saveAgent()` writes the new file first, then deletes the old file. If the process crashes between write and delete, both files exist. Should use atomic rename (write to temp, rename).
2. **Dead helper params (#12):** Some helper functions have unused parameters that should be removed.
3. **Duplicate visibleWidth (#13):** A local `visibleWidth()` function duplicates the one imported from `@earendil-works/pi-tui`. Should use the imported version.

**Files:**
- Modify: `packages/subagent/src/agent-manager.ts`

**What to implement:**

1. **Fix rename atomicity in `saveAgent()`:**
   Replace the current write-then-delete pattern with atomic rename:
   ```ts
   // Write to temp file, then atomically rename
   const tmpPath = newPath + ".tmp";
   fs.writeFileSync(tmpPath, content, "utf-8");
   fs.renameSync(tmpPath, newPath); // Atomic on same filesystem

   // Handle rename if name changed
   if (oldPath && oldPath !== newPath) {
     try {
       fs.unlinkSync(oldPath);
     } catch {
       // Old file may not exist (e.g., new agent)
     }
   }
   ```

2. **Remove dead helper params:**
   - Search for functions where a parameter is declared but never referenced in the function body.
   - Remove the unused parameters and update all call sites.
   - Check all helper functions: `fuzzyFilter`, `wrapText`, `padEnd`, `visibleWidth` (local), `row`, `renderHeader`, `renderFooter`, `scopeLabel`, `agentModel`, `filterModels`, `hardTruncate`, `wrapWithBorder`.
   - Specifically check: does `row()` use `theme`? Does `renderHeader()` use all params?

3. **Consolidate visibleWidth:**
   - The local `visibleWidth()` function duplicates `visibleWidth` imported from `@earendil-works/pi-tui` (line ~7).
   - The local version strips ANSI codes with a simple regex; the imported version may handle wide characters.
   - Remove the local `visibleWidth()` function entirely.
   - Verify all call sites now use the imported `visibleWidth` (the import already exists, so removing the local version will make the import active).

**Steps:**
- [ ] Modify `saveAgent()` to use atomic rename (write to `.tmp`, then `fs.renameSync`).
- [ ] Identify and remove unused parameters from helper functions. For each function, verify every parameter is used in the body.
- [ ] Remove the local `visibleWidth()` function. Verify the imported `visibleWidth` from `@earendil-works/pi-tui` is used everywhere.
- [ ] Run `npx tsc --noEmit` in `packages/subagent/`.
- [ ] Run `npx tsc --noEmit` in `meta/` to verify dependent packages compile.
- [ ] Commit with message: "fix(subagent): atomic rename in saveAgent, remove dead params, consolidate visibleWidth"

**Acceptance criteria:**
- [ ] `saveAgent()` uses `fs.renameSync()` for atomic file replacement.
- [ ] No helper functions have unused parameters.
- [ ] Only one `visibleWidth` function exists (imported from `@earendil-works/pi-tui`).
- [ ] `npx tsc --noEmit` passes for `@pi-archimedes/subagent` and `meta`.

**Time estimate:** 30 minutes

---

### Task 6: Fix Frontmatter Regex + Add Parent-Side Ask Timeout (Medium)

**Context:**
Two related fixes in different packages:

1. **AGENT_NAME_REGEX (#3):** The regex `/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/` requires a minimum of 3 characters (1 start + 1 middle + 1 end). However, 2-character names are valid agent names and should be allowed. The `{1,48}` middle quantifier should be `{0,48}` to allow 2-char names (1 + 0 + 1 = 2). Single-char names are already handled by `SINGLE_CHAR_NAME_REGEX`.

2. **Parent-side ask timeout (#11):** The `ask` package listens for `ASK_REQUEST` events from subagents via the bus. When a subagent sends an ask request, the parent shows a TUI dialog. If the parent TUI hangs or the dialog is never dismissed, the subagent waits indefinitely (the subagent-side has a 5-minute timeout, but the parent-side has no timeout). Add a timeout to the parent-side `handleAskRequest()` so that if the TUI dialog doesn't complete within a reasonable time, the request is cancelled.

**Files:**
- Modify: `packages/subagent/src/frontmatter-io.ts`
- Modify: `packages/ask/src/index.ts`

**What to implement:**

1. **In `packages/subagent/src/frontmatter-io.ts`:**
   - Change `AGENT_NAME_REGEX` from `/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/` to `/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/`.
   - Update the error message in `validateAgentName()` from "3-50" to "2-50":
     ```ts
     return "Name must be 2-50 lowercase alphanumeric characters or hyphens, starting and ending with alphanumeric";
     ```

2. **In `packages/ask/src/index.ts`:**
   - Add a timeout constant near the top of the file:
     ```ts
   const ASK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
     ```
   - In `handleAskRequest()`, wrap the TUI dialog calls with `Promise.race`:
     ```ts
     const timeoutPromise = new Promise<AskSelection[]>((_, reject) => {
       const timer = setTimeout(() => reject(new Error("Ask timeout")), ASK_TIMEOUT_MS);
       timer.unref();
     });

     try {
       let dialogPromise: Promise<AskSelection[]>;
       if (questions.length === 1) {
         // ... existing single/multi logic, but return selections as array
         // Wrap each dialog call in a Promise that resolves to selections
       } else {
         // ... existing multi-question logic
       }
       selections = await Promise.race([dialogPromise, timeoutPromise]);
       cancelled = /* existing cancelled logic */;
     } catch (err) {
       cancelled = true;
       selections = questions.map(() => ({ selectedOptions: [] }));
     }
     ```
   - The key change: wrap the existing `try` block's dialog calls with `Promise.race([dialogCall, timeoutPromise])`.

**Steps:**
- [ ] Change `{1,48}` to `{0,48}` in `AGENT_NAME_REGEX` in `packages/subagent/src/frontmatter-io.ts`.
- [ ] Update the error message from "3-50" to "2-50".
- [ ] Run `npx tsc --noEmit` in `packages/subagent/`.
- [ ] Add `ASK_TIMEOUT_MS` constant and `Promise.race` timeout wrapper in `packages/ask/src/index.ts` `handleAskRequest()`.
- [ ] Run `npx tsc --noEmit` in `packages/ask/`.
- [ ] Run `npx tsc --noEmit` in `meta/` to verify dependent packages compile.
- [ ] Commit with message: "fix(subagent): allow 2-char agent names; fix(ask): add parent-side ask timeout"

**Acceptance criteria:**
- [ ] `validateAgentName("ab")` returns `null` (valid).
- [ ] `validateAgentName("a")` returns `null` (valid, via single-char regex).
- [ ] `validateAgentName("")` returns error message.
- [ ] Error message says "2-50" not "3-50".
- [ ] Parent-side ask dialog times out after 5 minutes if not dismissed.
- [ ] `npx tsc --noEmit` passes for both packages and `meta`.

**Time estimate:** 25 minutes

---

### Task 7: Core Utility Fixes — Interval Leak, No-Op Patch, Unindent, Version Docs (Low)

**Context:**
Four fixes in `packages/core/src/`:

1. **Startup interval leak (#4):** `patchStartupListing()` creates a `setInterval` that increments `ref.frame` every 16ms. The interval self-clears when `settled` is true and `frame >= LOGO_SETTLE_FRAME`. However, if the session ends before the interval self-clears (e.g., user types before animations complete), the interval continues running, consuming CPU. Fix: add a maximum frame count as a safety net.

2. **No-op patch (#14):** `patchStartupListing()` patches `chat.clear()` but the patch is a no-op — it just calls `origClear()` with no additional logic. Remove the dead patch and the associated `PATCHED_CLEAR` symbol.

3. **Unindent edge cases (#8):** `unindentCodeBlocks()` has known limitations with tabs. The function explicitly only handles space-based indentation. Add documentation comments for edge cases and ensure the existing behavior is correct.

4. **Comment compareVersions (#15):** The `compareVersions()` function in `version.ts` has no JSDoc. Add documentation.

**Files:**
- Modify: `packages/core/src/startup/index.ts`
- Modify: `packages/core/src/thinking/unindent.ts`
- Modify: `packages/core/src/startup/version.ts`

**What to implement:**

1. **In `packages/core/src/startup/index.ts`:**
   - **Interval leak fix:** Add a maximum frame count as a safety net in the interval callback:
     ```ts
     const MAX_ANIM_FRAMES = 1000; // ~16 seconds safety net
     // In interval callback, add after current.frame++:
     if (current.frame > MAX_ANIM_FRAMES) {
       clearInterval(interval);
       cc[ANIM_INTERVAL] = null;
       return;
     }
     ```
   - **No-op patch removal:** Remove the `chat.clear` patch block (lines ~214-220):
     ```ts
     // DELETE THIS BLOCK:
     if (!cc[PATCHED_CLEAR]) {
       cc[PATCHED_CLEAR] = true;
       const origClear = chat.clear.bind(chat);
       chat.clear = () => { return origClear(); };
     }
     ```
     Also remove the `PATCHED_CLEAR` symbol declaration from the top of the file.

2. **In `packages/core/src/thinking/unindent.ts`:**
   - Add a comment block at the top of the function documenting edge case behavior:
     ```ts
     // Edge case behavior:
     // - Blocks with only whitespace: left untouched (allWhitespace check)
     // - Blocks with mixed indent (some lines at 0, others at N): nothing stripped
     //   (minIndent === 0). This matches textwrap.dedent behavior.
     // - Single-line blocks: indentation stripped if the line has leading spaces.
     // - Tab-based indentation: NOT handled. Tabs are treated as literal characters
     //   and will not be stripped. Use space-based indentation for best results.
     // - CRLF line endings: normalized to LF before processing.
     ```

3. **In `packages/core/src/startup/version.ts`:**
   - Add JSDoc to `compareVersions()`:
     ```ts
     /**
      * Compare two semver version strings.
      * Strips leading `v` prefix. Compares major, minor, patch numerically.
      * @param a - First version string (e.g., "1.2.3" or "v1.2.3")
      * @param b - Second version string
      * @returns Positive if `a` > `b`, negative if `a` < `b`, 0 if equal.
      */
     export function compareVersions(a: string, b: string): number {
     ```

**Steps:**
- [ ] Add `MAX_ANIM_FRAMES` safety net to the animation interval in `packages/core/src/startup/index.ts`.
- [ ] Remove the no-op `chat.clear` patch and the `PATCHED_CLEAR` symbol from `packages/core/src/startup/index.ts`.
- [ ] Add edge case documentation comments to `packages/core/src/thinking/unindent.ts`.
- [ ] Add JSDoc to `compareVersions()` in `packages/core/src/startup/version.ts`.
- [ ] Run `npx tsc --noEmit` in `packages/core/`.
- [ ] Run `npx tsc --noEmit` in `meta/` to verify dependent packages compile.
- [ ] Commit with message: "fix(core): add interval safety net, remove no-op clear patch, document unindent edge cases and compareVersions"

**Acceptance criteria:**
- [ ] Animation interval has a maximum frame count safety net (1000 frames ≈ 16 seconds).
- [ ] No `PATCHED_CLEAR` symbol or no-op `chat.clear` patch exists in the file.
- [ ] `unindentCodeBlocks()` has documentation comments for edge cases.
- [ ] `compareVersions()` has JSDoc documentation.
- [ ] `npx tsc --noEmit` passes for `@pi-archimedes/core` and `meta`.

**Time estimate:** 25 minutes

---

### Task 8: Todo Widget Optimization + Standardize Indentation (Low)

**Context:**
Two housekeeping improvements:

1. **Todo widget re-render optimization (#16):** `packages/todo/src/index.ts` calls `updateWidget()` on every `turn_end` event, even when the todo list hasn't changed. This causes unnecessary TUI re-renders. Add a dirty flag that tracks whether the todo state has changed since the last render.

2. **Standardize indentation (#17):** Some packages use tabs (`ask/`, `diff/`, `core/src/thinking/`) while others use spaces (`subagent/`, `footer/`, `notify/`, `todo/`). Standardize to 2-space indentation (the majority convention) across all packages.

**Files:**
- Modify: `packages/todo/src/index.ts`
- Modify (indentation only): `packages/ask/src/*.ts` (7 files), `packages/diff/src/**/*.ts` (18 files), `packages/core/src/thinking/*.ts` (2 files)

**What to implement:**

1. **In `packages/todo/src/index.ts`:**
   - Add a `widgetDirty` flag initialized to `true`.
   - Set `widgetDirty = true` in `refreshWidget()` and in bus event handlers.
   - In the `turn_end` handler, only call `updateWidget()` if `widgetDirty` is true:
     ```ts
     let widgetDirty = true;

     const refreshWidget = () => {
       widgetDirty = true;
       if (currentCtx) {
         updateWidget(state, currentCtx, subagentTodos);
       }
     };

     // In turn_end handler:
     pi.on("turn_end", async (_event, ctx) => {
       currentCtx = ctx;
       if (widgetDirty) {
         updateWidget(state, ctx, subagentTodos);
         widgetDirty = false;
       }
     });
     ```

2. **Standardize indentation:**
   - Convert all tab-indented files to 2-space indentation.
   - Affected files (identified by `grep -rl $'\t'`):
     - `packages/ask/src/cursor.ts`, `dialog.ts`, `index.ts`, `note.ts`, `picker.ts`, `selection.ts`, `wrap.ts`
     - `packages/diff/src/` — all 18 files
     - `packages/core/src/thinking/transform.ts`, `unindent.ts`
   - Use sed or a find/replace to convert tabs to 2 spaces: `sed -i 's/\t/  /g' file.ts`
   - Verify with `grep -rl $'\t' packages/*/src/*.ts packages/*/src/**/*.ts` that no tabs remain in source files.

**Steps:**
- [ ] Add `widgetDirty` flag and conditional render logic in `packages/todo/src/index.ts`.
- [ ] Run `npx tsc --noEmit` in `packages/todo/`.
- [ ] Convert tabs to 2 spaces in `packages/ask/src/*.ts` (7 files).
- [ ] Convert tabs to 2 spaces in `packages/diff/src/**/*.ts` (18 files).
- [ ] Convert tabs to 2 spaces in `packages/core/src/thinking/*.ts` (2 files).
- [ ] Verify no tabs remain: `grep -rl $'\t' packages/*/src/*.ts packages/*/src/**/*.ts` should return nothing.
- [ ] Run `npx tsc --noEmit` in `packages/ask/`, `packages/diff/`, and `packages/core/`.
- [ ] Run `npx tsc --noEmit` in `meta/` to verify dependent packages compile.
- [ ] Commit with message: "perf(todo): add dirty flag to skip unnecessary widget re-renders; chore: standardize 2-space indentation across all packages"

**Acceptance criteria:**
- [ ] Todo widget only re-renders when `widgetDirty` is true.
- [ ] `widgetDirty` is set to true by `refreshWidget()` and bus event handlers.
- [ ] No tab characters remain in any `packages/*/src/*.ts` file.
- [ ] `npx tsc --noEmit` passes for all packages and `meta`.

**Time estimate:** 30 minutes

---

### Task 9: Add node:test Harness (Infrastructure)

**Context:**
The monorepo has no test infrastructure. Adding `node:test` (Node.js built-in test runner) provides a lightweight, zero-dependency testing framework. This enables writing unit tests for the fixes in Tasks 1-8 and establishes a testing pattern for future development.

**Files:**
- Create: `packages/core/src/__tests__/bus.test.ts`
- Create: `packages/footer/src/__tests__/git.test.ts`
- Create: `packages/subagent/src/__tests__/frontmatter-io.test.ts`
- Modify: `packages/core/package.json` (add test script)
- Modify: `packages/footer/package.json` (add test script)
- Modify: `packages/subagent/package.json` (add test script)
- Modify: Root `package.json` (add `tsx` devDependency)

**What to implement:**

1. **Add `tsx` as a devDependency** in the root `package.json`:
   ```json
   "devDependencies": {
     "tsx": "^4.0.0"
   }
   ```
   Run `pnpm install` to install it.

2. **Add test scripts to package.json files:**
   In each of `packages/core/package.json`, `packages/footer/package.json`, and `packages/subagent/package.json`:
   ```json
   "scripts": {
     "test": "node --import tsx --test src/__tests__/*.test.ts"
   }
   ```

3. **Write unit tests for the critical fixes:**

   - **Bus tests (`packages/core/src/__tests__/bus.test.ts`):**
     ```ts
     import { describe, it } from "node:test";
     import { strict as assert } from "node:assert";
     import { getBus, initBus, Events } from "../bus.js";

     describe("Bus", () => {
       it("delivers queued events exactly once on subscribe", () => {
         const bus = getBus();
         const received: unknown[] = [];
         bus.on(Events.COST_UPDATE, (payload) => received.push(payload));
         // ... assert received.length === 1
       });

       it("initBus flush does not cause double delivery", () => {
         // ... emit before init, subscribe, initBus, assert no duplicates
       });

       it("async listener errors are caught", () => {
         // ... async listener that throws, assert no unhandled rejection
       });
     });
     ```

   - **Git parsing tests (`packages/footer/src/__tests__/git.test.ts`):**
     ```ts
     import { describe, it } from "node:test";
     import { strict as assert } from "node:assert";
     // Import parseGitStatusLine (may need to export it or test via parseGitOutput)

     describe("parseGitStatusLine", () => {
       it("parses untracked files (?? format)", () => {
         // ... assert parseGitStatusLine("?? file.txt") returns { indexField: "?", workTreeField: "?" }
       });

       it("parses scored format", () => {
         // ... assert parseGitStatusLine("1 AM filepath") returns correct fields
       });

       it("parses unscored format", () => {
         // ... assert parseGitStatusLine("M  filepath") returns correct fields
       });
     });
     ```

   - **Frontmatter tests (`packages/subagent/src/__tests__/frontmatter-io.test.ts`):**
     ```ts
     import { describe, it } from "node:test";
     import { strict as assert } from "node:assert";
     import { validateAgentName } from "../frontmatter-io.js";

     describe("validateAgentName", () => {
       it("accepts 2-char names", () => {
         assert.strictEqual(validateAgentName("ab"), null);
       });

       it("accepts 1-char names", () => {
         assert.strictEqual(validateAgentName("a"), null);
       });

       it("rejects empty names", () => {
         assert.ok(validateAgentName(""));
       });

       it("rejects uppercase names", () => {
         assert.ok(validateAgentName("A"));
       });

       it("rejects names starting with hyphen", () => {
         assert.ok(validateAgentName("-name"));
       });
     });
     ```

**Steps:**
- [ ] Add `tsx` devDependency to root `package.json` and run `pnpm install`.
- [ ] Add `"test"` script to `packages/core/package.json`, `packages/footer/package.json`, and `packages/subagent/package.json`.
- [ ] Create `packages/core/src/__tests__/bus.test.ts` with bus tests.
- [ ] Create `packages/footer/src/__tests__/git.test.ts` with git parsing tests.
- [ ] Create `packages/subagent/src/__tests__/frontmatter-io.test.ts` with frontmatter tests.
- [ ] Run `pnpm -F @pi-archimedes/core test` — did all tests pass?
- [ ] Run `pnpm -F @pi-archimedes/footer test` — did all tests pass?
- [ ] Run `pnpm -F @pi-archimedes/subagent test` — did all tests pass?
- [ ] Commit with message: "test: add node:test harness with bus, git parsing, and frontmatter tests"

**Acceptance criteria:**
- [ ] `pnpm -F @pi-archimedes/core test` passes with bus tests.
- [ ] `pnpm -F @pi-archimedes/footer test` passes with git parsing tests.
- [ ] `pnpm -F @pi-archimedes/subagent test` passes with frontmatter tests.
- [ ] Tests cover the critical fixes from Tasks 1, 3, and 6.
- [ ] Tests are runnable independently of the Pi agent runtime.

**Time estimate:** 45 minutes

---

## Success Criteria (Overall)

All 17 issues are resolved when:

- [ ] **🔴 Bus double-delivery** is fixed — events delivered exactly once.
- [ ] **🟡 node:test harness** is in place with tests for critical fixes.
- [ ] **🟡 AGENT_NAME_REGEX** allows 2-char names.
- [ ] **🟡 Startup interval** has a safety net against leaks.
- [ ] **🟡 initBus re-emit ordering** is correct (no duplicates).
- [ ] **🟡 Notify OSC sequences** are sanitized.
- [ ] **🟡 saveAgent rename** is atomic.
- [ ] **🟡 unindentCodeBlocks** edge cases are documented.
- [ ] **🟡 parseGitStatusLine** correctly parses untracked files.
- [ ] **🟡 Subagent socket path** uses 64-bit entropy + restricted permissions.
- [ ] **🟡 Parent-side ask** has a timeout.
- [ ] **🟢 Dead helper params** are removed.
- [ ] **🟢 visibleWidth** is consolidated.
- [ ] **🟢 No-op patch** is removed.
- [ ] **🟢 compareVersions** is documented.
- [ ] **🟢 Todo widget** skips unnecessary re-renders.
- [ ] **🟢 Indentation** is standardized to 2 spaces across all packages.

## Total Time Estimate

| Task | Estimate |
|------|----------|
| Task 1: Bus fix | 15 min |
| Task 2: Notify sanitization | 15 min |
| Task 3: Git parsing | 10 min |
| Task 4: Socket security | 10 min |
| Task 5: Agent-manager | 30 min |
| Task 6: Regex + timeout | 25 min |
| Task 7: Core utilities | 25 min |
| Task 8: Todo + indentation | 30 min |
| Task 9: Test harness | 45 min |
| **Total** | **~3 hours 5 minutes** |
