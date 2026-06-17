# Fork + IPC Subagent Communication

**Goal:** Replace `spawn()` + Unix domain socket + JSON stdout with `fork()` + SDK-based child + single IPC channel for all parent↔child communication.

**Architecture:** A forked child script imports `createAgentSession` from the pi SDK, subscribes to all `AgentSessionEvent`s, and forwards them to the parent via `process.send()`. The parent sends ask responses and abort signals back via `child.send()`. One bidirectional IPC channel replaces two unidirectional channels (stdout pipe + unix socket).

**Tech Stack:** Node.js `child_process.fork()`, pi SDK `createAgentSession()`, `AgentSession.subscribe()`, built-in IPC (`process.send`/`process.on('message')`)

---

## Message Protocol

All IPC messages use a discriminated union keyed by `type`:

```typescript
// Parent → Child
interface ParentToChild {
  type: "ask_response";
  requestId: string;
  cancelled: boolean;
  results: Array<{ id: string; selectedOptions: string[]; customInput?: string }>;
} | {
  type: "abort";
} | {
  type: "init_ack";  // parent acknowledges child is ready
};

// Child → Parent
interface ChildToParent {
  type: "event";
  event: AgentSessionEvent;  // forwarded from session.subscribe()
} | {
  type: "ask_request";
  requestId: string;
  questions: Array<{ id: string; question: string; description?: string; options: Array<{ label: string }>; multi?: boolean; recommended?: number }>;
} | {
  type: "ready";  // child signals it has started the session
} | {
  type: "error";
  message: string;
};
```

---

### Task 1: Create the IPC message types and child entry point

**Context:**
The foundation of the new architecture. Defines the shared message protocol and creates the forked child script that will run the subagent's AgentSession. This script replaces the current pattern of `spawn("pi", ["--mode", "json", "-p", ...])` with a self-contained Node.js process that uses the pi SDK directly.

**Files:**
- Create: `packages/subagent/src/ipc-types.ts`
- Create: `packages/subagent/src/child.ts`

**What to implement:**

1. **`ipc-types.ts`** — Shared type definitions for IPC messages:
   - `ParentToChild` union type (`ask_response` | `abort`)
   - `ChildToParent` union type (`event` | `ask_request` | `ready` | `error`)
   - `ChildInitParams` interface (task, model, cwd, agent config, system prompt) — passed via `fork()` second argument or first IPC message

2. **`child.ts`** — The forked child entry point (~150 lines):
   - Parse `process.argv` or first received message for init params (task, model, agent config, system prompt path, cwd)
   - Import `createAgentSession` from `@earendil-works/pi-coding-agent`
   - Create an `AgentSession` with:
     - `model` resolved from params
     - `cwd` from params
     - `excludedToolNames: ["subagent"]` to prevent recursive spawning
     - `customTools` that includes an IPC-based ask tool (see Task 2)
     - `sessionManager: SessionManager.inMemory()` (no session file for subagents)
     - If agent has a custom system prompt, write to temp file and use `--append-system-prompt` equivalent (or pass via session config if SDK supports it)
   - Call `session.bindExtensions()` with minimal bindings (no UI, no command context)
   - Subscribe to events: `session.subscribe(event => process.send?.({ type: "event", event }))`
   - Send `{ type: "ready" }` to parent when session is initialized
   - Listen for parent messages: `process.on("message", handleParentMessage)`
     - `ask_response` → resolve the pending ask promise
     - `abort` → call `session.abort()`
   - Call `session.prompt(task)` to start the agent loop
   - On `agent_end` event, exit the process with code 0 (or 1 on error)
   - Handle `SIGTERM`/`SIGINT` → graceful shutdown (abort session, exit)

**Steps:**
- [ ] Create `packages/subagent/src/ipc-types.ts` with all IPC message types
- [ ] Create `packages/subagent/src/child.ts` with the child entry point
- [ ] Verify child script can be forked and receives/sends messages (manual test with a simple parent script)
- [ ] Run `npx tsc --noEmit` in `packages/subagent/`
- [ ] Commit with message: "feat: add IPC child process entry point for subagent"

**Acceptance criteria:**
- [ ] `child.ts` can be forked and sends a `{ type: "ready" }` message
- [ ] `child.ts` forwards `AgentSessionEvent`s to parent via `process.send()`
- [ ] `child.ts` handles `abort` messages from parent
- [ ] TypeScript check passes with no errors

---

### Task 2: Create the IPC-based ask tool for the child

**Context:**
The current ask tool (`packages/ask/src/index.ts`) has two modes: with UI (TUI dialog) and headless (Unix socket connect). In the SDK-based child, there's no TUI and no socket — communication is purely IPC. We need a lightweight ask tool that sends questions to the parent via `process.send()` and awaits the response via `process.on('message')`.

This tool is registered as a `customTool` when creating the AgentSession in the child. It replaces the socket-based headless ask flow entirely.

**Files:**
- Create: `packages/subagent/src/ipc-ask-tool.ts`

**What to implement:**

1. **`ipc-ask-tool.ts`** — A minimal ask tool definition (~80 lines):
   - Export `createIpcAskTool(): ToolDefinition`
   - Parameters schema matches the existing ask tool (`AskParamsSchema` from ask package)
   - `execute()` implementation:
     - Generate `requestId` via `crypto.randomUUID()`
     - Send `{ type: "ask_request", requestId, questions: params.questions }` via `process.send()`
     - `Promise` that resolves when parent sends `{ type: "ask_response", requestId }`
     - Wire `process.on("message")` listener (one-time, removed after response)
     - 5-minute timeout → resolve with cancelled
     - Build `QuestionResult[]` from response, return content matching existing ask tool's session text format
   - No `renderCall` or `renderResult` needed (child has no UI)

**Key design decisions:**
- The listener for `ask_response` is registered per-execution (not global), matched by `requestId`
- If `process.send` is null (IPC channel closed), resolve immediately with cancelled
- Reuse the `buildAskSessionContent()` and sanitization logic from the existing ask tool (import from `@pi-archimedes/ask` or inline the minimal needed functions)

**Steps:**
- [ ] Create `packages/subagent/src/ipc-ask-tool.ts`
- [ ] Implement `createIpcAskTool()` with IPC-based execute
- [ ] Handle timeout and channel-close edge cases
- [ ] Run `npx tsc --noEmit` in `packages/subagent/`
- [ ] Commit with message: "feat: add IPC-based ask tool for subagent child"

**Acceptance criteria:**
- [ ] Tool sends `ask_request` via `process.send()` and awaits `ask_response`
- [ ] Timeout after 5 minutes resolves with cancelled
- [ ] Channel close resolves with cancelled
- [ ] Returned content matches the format expected by the parent's session text

---

### Task 3: Replace spawnSubagent with fork-based spawning

**Context:**
The current `spawnSubagent()` in `spawn.ts` does: resolve pi command → create Unix socket server → spawn `pi --mode json` → wire socket for ask round-trip → wire stdout for JSON events. All of this is replaced by: fork child script → listen for IPC messages.

This is the core change that eliminates the socket entirely. The function signature stays the same (`spawnSubagent(options)`) but returns a `ChildProcess` from `fork()` instead of `spawn()`.

**Files:**
- Modify: `packages/subagent/src/spawn.ts`

**What to implement:**

1. Replace `spawnSubagent()` implementation:
   - Import `fork` from `node:child_process`
   - Resolve the child script path: `import.meta.url` → `../subagent/src/child.ts` (use `import { fileURLToPath } from "node:url"` to compute path)
   - Use `fork(childScriptPath, [], { env, cwd, stdio: ["ignore", "ignore", "ignore", "ipc"] })`
     - `stdio: ["ignore", "ignore", "ignore", "ipc"]` — no stdout/stderr, only IPC
     - `env` includes all current env vars (for API keys, etc.)
     - Remove `PI_SUBAGENT_SOCKET` env var (no longer needed)
   - Remove all socket server code (`createServer`, `server.listen`, `pendingAsks` Map, socket event handlers)
   - Remove `resolvePiCommand()` (no longer spawning `pi` CLI)
   - Remove `writePromptToFile()` / `cleanupTempFiles()` — system prompt is passed via IPC or SDK config instead
   - Wire `child.on("message", ...)` to handle `ChildToParent` messages:
     - `{ type: "event" }` → forward to the existing JSON event handler (or refactor streamEvents to listen for IPC messages instead of stdout lines)
     - `{ type: "ask_request" }` → emit `Events.ASK_REQUEST` on the bus
     - `{ type: "ready" }` → clear startup timer
     - `{ type: "error" }` → log error
   - Keep `ASK_RESPONSE` bus listener → send response via `child.send({ type: "ask_response", ... })` instead of `socket.write()`
   - Keep abort signal handler → send `child.send({ type: "abort" })` before `child.kill("SIGTERM")`
   - Keep startup timeout (2 minutes) → clear on first `ready` or `event` message

2. Update return type: `fork()` returns `ChildProcess` (same as `spawn()`), so the return type is compatible. However, `streamEvents()` currently reads from `child.stdout` — this needs to change (see Task 4).

**Steps:**
- [ ] Replace `spawn()` call with `fork()` in `spawnSubagent()`
- [ ] Remove Unix socket server code (createServer, listen, pendingAsks, socket handlers)
- [ ] Remove `resolvePiCommand()`, `writePromptToFile()`, `cleanupTempFiles()`
- [ ] Add `child.on("message")` handler for ChildToParent messages
- [ ] Update `ASK_RESPONSE` bus handler to use `child.send()` instead of socket.write()
- [ ] Update abort handler to send IPC abort message
- [ ] Run `npx tsc --noEmit` in `packages/subagent/`
- [ ] Commit with message: "feat: replace spawn+socket with fork+IPC in spawnSubagent"

**Acceptance criteria:**
- [ ] `spawnSubagent()` uses `fork()` instead of `spawn()`
- [ ] No Unix socket is created or used
- [ ] No `PI_SUBAGENT_SOCKET` env var
- [ ] `child.on("message")` handles all ChildToParent message types
- [ ] `ASK_RESPONSE` bus events are sent via `child.send()`
- [ ] TypeScript check passes

---

### Task 4: Replace streamEvents to read from IPC instead of stdout

**Context:**
`streamEvents()` currently creates a `readline.Interface` on `child.stdout` and parses JSON lines. With `fork()` + IPC, events come through `child.on("message")` as structured objects. The streaming logic (state machine, progress building, cost tracking) stays the same — only the input source changes.

**Files:**
- Modify: `packages/subagent/src/stream.ts`
- Modify: `packages/subagent/src/spawn.ts` (pass message handler or refactor)

**What to implement:**

Two approaches — pick one:

**Approach A (recommended): Move event handling into spawn.ts, simplify streamEvents**
- `spawnSubagent()` returns both the `ChildProcess` and a `Promise<SubagentResult>` (or an event emitter)
- `streamEvents()` takes a message source (callback or async iterator) instead of `child.stdout`
- The `child.on("message")` handler in spawn.ts extracts `{ type: "event", event }` messages and feeds them to streamEvents

**Approach B: streamEvents attaches its own message listener**
- `streamEvents(child)` does `child.on("message", handler)` instead of `createInterface({ input: child.stdout })`
- Filter messages by `type === "event"` and extract `event` field
- Rest of the state machine stays identical

**Recommended: Approach B** — minimal changes to the existing state machine.

Changes to `stream.ts`:
- Replace `createInterface({ input: child.stdout! })` with `child.on("message", (msg) => { ... })`
- Cast message to `ChildToParent`, check `msg.type === "event"`, extract `msg.event as JsonEvent`
- Remove JSON.parse (events are already parsed objects)
- Remove `rl.on("line", ...)` → use direct `child.on("message", ...)`
- Keep `child.stderr?.on("data", ...)` → remove (no stderr with `stdio: ["ignore", ...]`)
  - Instead, handle `{ type: "error", message }` from IPC
- Keep state machine, progress building, heartbeat, startup timer — all identical
- Update `buildProgress()` and event handlers — they work with `JsonEvent` which matches `AgentSessionEvent`

**Steps:**
- [ ] Refactor `streamEvents()` to use `child.on("message")` instead of stdout readline
- [ ] Remove JSON.parse — events are structured objects from IPC
- [ ] Remove stderr collection — use IPC error messages instead
- [ ] Keep all state machine logic, progress building, cost tracking
- [ ] Update types: `JsonEvent` → use `AgentSessionEvent` from SDK types where possible
- [ ] Run `npx tsc --noEmit` in `packages/subagent/`
- [ ] Commit with message: "feat: update streamEvents to read from IPC messages"

**Acceptance criteria:**
- [ ] `streamEvents()` reads events from `child.on("message")` instead of stdout
- [ ] No JSON.parse needed (events are structured objects)
- [ ] State machine and progress tracking work unchanged
- [ ] Startup timer clears on first event
- [ ] TypeScript check passes

---

### Task 5: Handle system prompts and agent config in the child

**Context:**
The current approach writes the agent's system prompt to a temp file and passes `--append-system-prompt <path>` to the pi CLI. With the SDK-based child, system prompts need to be handled differently. Options:

1. Pass the system prompt text via the initial IPC message (simple, no temp files)
2. Use the SDK's system prompt configuration (check if `createAgentSession` supports custom system prompts)
3. Write to temp file in the child and use SDK's resource loading

**Files:**
- Modify: `packages/subagent/src/child.ts`
- Modify: `packages/subagent/src/spawn.ts`

**What to implement:**

1. In `spawn.ts` — pass agent config to child via `fork()` args or first message:
   - Send `ChildInitParams` with: task, model, agent name, agent system prompt text, agent tools, agent thinking, cwd
   - No temp files needed — pass prompt text directly

2. In `child.ts` — apply agent config:
   - After `createAgentSession()`, if agent has a system prompt, use the session's system prompt API
   - If agent has custom tools, pass `allowedToolNames` to `createAgentSession()`
   - If agent has custom model, resolve and set model
   - If agent has thinking level, set via `session.setThinkingLevel()`

**Steps:**
- [ ] Define `ChildInitParams` interface in `ipc-types.ts`
- [ ] Update `spawn.ts` to send init params via first IPC message (or fork args)
- [ ] Update `child.ts` to receive and apply init params
- [ ] Remove temp file creation/cleanup from spawn.ts
- [ ] Run `npx tsc --noEmit` in `packages/subagent/`
- [ ] Commit with message: "feat: pass agent config via IPC instead of temp files"

**Acceptance criteria:**
- [ ] Agent system prompt is passed via IPC (no temp files)
- [ ] Agent model, tools, thinking are applied in the child
- [ ] No temp file creation or cleanup needed
- [ ] TypeScript check passes

---

### Task 6: Update the ask package for IPC compatibility

**Context:**
The current `packages/ask/src/index.ts` has headless mode that connects to `PI_SUBAGENT_SOCKET`. With the new architecture, the child uses the IPC ask tool (Task 2) and the parent never needs to connect to a socket. The headless socket code in the ask package becomes dead code.

**Files:**
- Modify: `packages/ask/src/index.ts`

**What to implement:**

1. In `handleAskRequest` (parent-side, listens for `ASK_REQUEST` bus events):
   - No changes needed — this already works. It receives bus events from the subagent package and shows the TUI dialog.

2. In the ask tool's `execute()` method:
   - The headless branch (`if (!ctx.hasUI)`) that connects to `PI_SUBAGENT_SOCKET` is no longer needed for the fork-based architecture
   - **Keep it for backward compatibility** — if someone runs the subagent in spawn mode (during transition), it should still work
   - Add a comment noting this code path is deprecated in favor of the IPC ask tool

3. No functional changes required — the ask package works as-is. The IPC ask tool (Task 2) is used by the child, and the parent's ask dialog works through the bus as before.

**Steps:**
- [ ] Add deprecation comment to the headless socket code path in `ask/index.ts`
- [ ] Verify the parent-side `ASK_REQUEST` / `ASK_RESPONSE` bus flow works with the new IPC messages
- [ ] Run `npx tsc --noEmit` in `packages/ask/`
- [ ] Commit with message: "chore: deprecate socket-based headless ask in favor of IPC"

**Acceptance criteria:**
- [ ] Headless socket code path is marked deprecated
- [ ] Parent-side ask dialog works with IPC-based ask requests from child
- [ ] TypeScript check passes

---

### Task 7: Clean up, verify, and integrate

**Context:**
Final integration task — ensure all pieces work together, clean up dead code, and verify the full flow.

**Files:**
- Modify: `packages/subagent/src/index.ts`
- Modify: `packages/subagent/src/execute.ts`
- Modify: `packages/core/src/bus.ts` (if needed)
- Modify: `packages/subagent/package.json` (add child.ts to exports if needed)

**What to implement:**

1. **Integration verification:**
   - Full flow: parent calls `subagent` tool → `executeSubagent()` → `spawnSubagent()` (fork) → child creates AgentSession → child sends events via IPC → parent streams events → parent shows progress → child calls ask tool → parent shows dialog → parent sends response via IPC → child receives response → child continues → child finishes → parent gets result

2. **Dead code cleanup:**
   - Remove `resolvePiCommand()` if not used elsewhere
   - Remove socket-related imports from `spawn.ts`
   - Remove `PI_SUBAGENT_SOCKET` references
   - Remove temp file cleanup code

3. **Error handling:**
   - Child crashes → parent detects via `child.on("close", code !== 0)`
   - IPC channel broken → parent detects via `child.on("error")`
   - Child startup fails → parent's startup timeout kills process

4. **TypeScript verification:**
   - Run `npx tsc --noEmit` in all affected packages

**Steps:**
- [ ] Verify full end-to-end flow works (manual test)
- [ ] Clean up dead code and unused imports
- [ ] Verify error handling for child crash, IPC break, startup failure
- [ ] Run `npx tsc --noEmit` in `packages/subagent/`, `packages/ask/`, `packages/core/`
- [ ] Commit with message: "feat: integrate fork+IPC subagent, clean up socket code"

**Acceptance criteria:**
- [ ] Full subagent flow works with fork + IPC
- [ ] Ask tool round-trip works through IPC
- [ ] Error handling covers child crash, IPC break, startup failure
- [ ] No dead code or unused imports
- [ ] TypeScript checks pass in all affected packages
- [ ] No regression in existing functionality (parallel subagents, cost tracking, todo updates)

---

## Migration Strategy

**Phase 1 (Tasks 1-3):** Core infrastructure — child script, IPC types, fork-based spawning. Not functional yet (streamEvents still reads stdout).

**Phase 2 (Tasks 4-5):** Wire up event streaming and agent config. Functional but ask tool uses old socket path.

**Phase 3 (Tasks 6-7):** Ask tool migration and cleanup. Full migration complete.

**Rollback:** At any phase, the old `spawn()` + socket code can be restored by reverting the relevant commits. The bus events (`ASK_REQUEST`, `ASK_RESPONSE`, `COST_UPDATE`, etc.) are unchanged, so other packages (footer, todo, ask) are unaffected during transition.

---

## What Does NOT Change

- **Bus events** — `COST_UPDATE`, `TODOS_UPDATE`, `TODOS_CLEAR`, `ASK_REQUEST`, `ASK_RESPONSE` stay the same
- **Footer cost accumulation** — reads from bus, no changes needed
- **Todo widget** — reads from bus, no changes needed
- **Ask dialog UI** — shows on `ASK_REQUEST` bus event, emits `ASK_RESPONSE`, no changes needed
- **`executeSubagent()` / `executeParallel()`** — call `spawnSubagent()` + `streamEvents()`, signatures unchanged
- **Agent discovery** — `discoverAgents()`, `findAgent()` unchanged
- **Agent Manager TUI** — unchanged
