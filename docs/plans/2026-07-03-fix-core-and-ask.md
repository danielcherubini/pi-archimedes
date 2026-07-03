# Fix Core Bus Bug and Standardize Ask Package Plan (V4)

**Goal:** Resolve the event queueing defect in the core bus, standardize imports in the `ask` package, and fix misleading documentation in `ask`.
**Architecture:** Minimal changes to the core pub/sub mechanism and package import patterns.
**Tech Stack:** TypeScript, ESM.

---

### Task 1: Fix Event Bus Queueing and Async Rejections (Critical)

**Context:**
`packages/core/src/bus.ts` has two defects:
1.  **Queueing Defect:** Events emitted before initialization are lost because `emit` does not populate the `QUEUE_KEY`.
2.  **Async Rejection Defect:** If a listener is `async`, any error thrown after its first `await` escapes the bus's `try/catch` as an unhandled promise rejection.
Additionally, the existing `initBus()` implementation must be hardened against infinite loops that could occur if `emit` is used to re-populate a queue during the flush process. A subscriber that registers *after* `initBus()` flushes (e.g., the footer) must still receive queued events.

**Files:**
- Modify: `packages/core/src/bus.ts`

**What to implement:**
- In `emit(event: string, payload: unknown)`:
    - If `!listeners.has(event)` (the event has never been subscribed to), retrieve the current queue from `getGlobal<Array<{ event: string; payload: unknown }>>(QUEUE_KEY) ?? []`, append `{ event, payload }`, and update the global state with `setGlobal(QUEUE_KEY, queue)`.
    - Keep the existing `try/catch` around the listener call for synchronous errors, AND wrap the return value in `Promise.resolve(...).catch(...)` for async rejections:
      ```ts
      try {
        Promise.resolve(fn(payload)).catch((err) =>
          console.error(`[archimedes:bus] Async error in listener for "${event}":`, err));
      } catch (err) {
        console.error(`[archimedes:bus] Error in listener for "${event}":`, err);
      }
      ```
- In `initBus()`:
    - Snapshot and clear the queue *before* iterating to prevent infinite loops:
      ```ts
      const queue = getGlobal<Array<{ event: string; payload: unknown }>>(QUEUE_KEY) ?? [];
      setGlobal(QUEUE_KEY, []);
      for (const { event, payload } of queue) {
        bus.emit(event, payload);
      }
      ```
- In `on(event: string, listener: (payload: unknown) => void)`:
    - After adding the listener, drain any queued events for this specific event:
      ```ts
      const queue = getGlobal<Array<{ event: string; payload: unknown }>>(QUEUE_KEY);
      if (queue) {
        for (const { event: queuedEvent, payload } of queue) {
          if (queuedEvent === event) {
            try {
              Promise.resolve(listener(payload)).catch((err) =>
                console.error(`[archimedes:bus] Async error in listener for "${event}":`, err));
            } catch (err) {
              console.error(`[archimedes:bus] Error in listener for "${event}":`, err);
            }
          }
        }
      }
      ```

**Steps:**
- [ ] Implement the queueing, async error handling, robust flush logic, and subscription-time drain in `packages/core/src/bus.ts`.
- [ ] Run `pnpm -F @pi-archimedes/core exec tsc --noEmit`.
- [ ] Commit with message: "fix(core): implement event queueing and handle async listener rejections"

**Acceptance criteria:**
- [ ] Events emitted before any subscribers exist are buffered and flushed on `initBus()`.
- [ ] Subscribers that register after `initBus()` (e.g., footer) still receive previously queued events.
- [ ] Async errors in bus listeners are caught and logged.
- [ ] Synchronous errors remain caught by the existing `try/catch`.
- [ ] `tsc --noEmit` passes for `@pi-archimedes/core`.

---

### Task 2: Standardize Imports in `ask` Package (Major)

**Context:**
The `@pi-archimedes/ask` package uses extensionless relative imports (e.g., `./selection`), which violates the monorepo's explicit convention of using `.js` suffixes for all relative imports. This is a consistency alignment — all other packages already comply. Note: `tsc --noEmit` passes regardless due to `bundler` module resolution; the value is runtime consistency with Pi's jiti loader.

**Files:**
- Modify: `packages/ask/src/index.ts`
- Modify: `packages/ask/src/dialog.ts`
- Modify: `packages/ask/src/picker.ts`

**What to implement:**
- Update all internal relative imports in these three files to include the `.js` extension.
- Exact imports to update:
    - `index.ts:6-8`: `./selection`, `./picker`, `./dialog`
    - `dialog.ts:19-22`: `./selection`, `./cursor`, `./note`, `./wrap`
    - `picker.ts:18-21`: `./selection`, `./cursor`, `./note`, `./wrap`

**Steps:**
- [ ] Append `.js` to all relative imports in the listed files.
- [ ] Run type check: `pnpm -F @pi-archimedes/ask exec tsc --noEmit`.
- [ ] If type check fails, fix import paths.
- [ ] Commit with message: "refactor(ask): add .js extensions to internal relative imports"

**Acceptance criteria:**
- [ ] All internal relative imports in `packages/ask/src/` end with `.js`.
- [ ] `pnpm -F @pi-archimedes/ask exec tsc --noEmit` passes.

---

### Task 3: Fix Misleading Documentation in `ask` (Minor)

**Context:**
`packages/ask/src/index.ts` contains a `DEPRECATED` comment block (around lines 290-293) claiming the socket-based headless path is replaced by IPC. This is incorrect — the socket path is the **live mechanism** used by subagents to communicate via `PI_SUBAGENT_SOCKET`. The misleading comment could lead a developer to delete the active bridge.

**Files:**
- Modify: `packages/ask/src/index.ts`

**What to implement:**
- Remove or rewrite only the inaccurate comment block at `index.ts:290-293` (the `// DEPRECATED …` lines claiming IPC replacement).
- Replace it with accurate description matching the wording in `subagent/spawn.ts:69`, e.g.: "Headless/subagent path: the child's ask tool connects to the parent's `PI_SUBAGENT_SOCKET` bridge (created in `subagent/spawn.ts:startAskSocketServer`) and exchanges `ask_request`/`ask_response` JSON lines."
- **Do NOT remove** the `!ctx.hasUI` branch or the `import { connect } from "node:net"` — they are load-bearing.

**Steps:**
- [ ] Fix the misleading comment in `packages/ask/src/index.ts`.
- [ ] Run type check: `pnpm -F @pi-archimedes/ask exec tsc --noEmit`.
- [ ] Commit with message: "chore(ask): fix misleading documentation for active socket-based path"

**Acceptance criteria:**
- [ ] The inaccurate `DEPRECATED` comment is replaced with accurate documentation.
- [ ] The `!ctx.hasUI` branch and `node:net` import remain intact.
- [ ] `pnpm -F @pi-archimedes/ask exec tsc --noEmit` passes.
