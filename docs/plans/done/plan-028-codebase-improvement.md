# Codebase Improvement Plan

**Goal:** Address confirmed code quality findings from the 2026-08-25 audit — dead public API, DRY violations, inconsistent config patterns, and oversized files with too many responsibilities. Plan has been reviewed and baselined against the actual codebase.

**Architecture:** Each task is an independent, commitable cleanup with no behaviour change. Tasks 1–4 are quick wins. Tasks 5–7 are the large file splits. All tasks must pass `npx tsc --noEmit` and `npx vitest run` in their respective package before committing.

**Tech Stack:** TypeScript ESM, pnpm workspace, vitest, TypeBox for tool schemas.

---

### Task 1: Footer — export SEP_W + SEPARATOR from layout.ts; move measureChunks into test file

**Context:**
Three confirmed findings, all in `packages/footer`:

**Finding 3 (DRY):** `SEP_W = 3` is defined independently as a local const in `packages/footer/src/index.ts:22` and in `packages/footer/src/utils/render-smoke.test.ts:25`. `layout.test.ts` also hardcodes the literal `3` in several places. The separator string `" · "` appears raw in `render-smoke.test.ts`. If the separator ever changes, at least 3 files drift silently.

**Finding 4 (Dead API):** `measureChunks` is exported from `layout.ts` but no production code calls it — `layout.test.ts` is its only consumer. It should not be a public export.

**Files:**
- Modify: `packages/footer/src/utils/layout.ts`
- Modify: `packages/footer/src/index.ts`
- Modify: `packages/footer/src/utils/render-smoke.test.ts`
- Modify: `packages/footer/src/utils/layout.test.ts`

**What to implement:**

In `layout.ts`:
1. Add two named exports near the top (before `measureChunks`):
   ```ts
   /** Visible width of the " · " footer separator. */
   export const SEP_W = 3;
   /** The footer section separator string (without ANSI colouring — colour it at the call site). */
   export const SEPARATOR = " · ";
   ```
2. Remove the `export` keyword from `measureChunks` — change `export function measureChunks(...)` to `function measureChunks(...)`. The function body is unchanged.

In `index.ts`:
1. Add `SEP_W, SEPARATOR` to the import from `"./utils/layout.js"` (it already imports `packFooterLines`).
2. Delete the local `const SEP_W = 3;` at the top of the file (currently line 22).
3. The separator is created as `theme.fg("dim", " · ")` — change the string literal `" · "` to `SEPARATOR` (the theme colouring wraps it, as before).

In `render-smoke.test.ts`:
1. Add `SEP_W, SEPARATOR` to the import from `"./layout.js"`.
2. Delete the local `const SEP_W = 3;`.
3. Replace all raw `" · "` string literals in `buildLines` with `SEPARATOR`.

In `layout.test.ts`:
1. `measureChunks` is no longer exported. Its import will break — fix by:
   - **Moving `measureChunks` into `layout.test.ts` itself** as a local function (copy the implementation from `layout.ts` verbatim — it's a short function that just sums `visibleWidth` of each chunk).
   - The `describe("measureChunks")` block then tests the local copy, which is correct (it's the same implementation).
   - Import `visibleWidth` from `"@earendil-works/pi-tui"` in `layout.test.ts` (it may already be imported; check first).
2. Find every place `layout.test.ts` hardcodes the literal `3` as a separator width — replace with `SEP_W` (import `SEP_W` from `"./layout.js"`).

**Steps:**
- [ ] Read `layout.ts`, `index.ts`, `render-smoke.test.ts`, `layout.test.ts` before editing
- [ ] Add `SEP_W`, `SEPARATOR` exports to `layout.ts`; remove `export` from `measureChunks`
- [ ] Update `index.ts`: import `SEP_W, SEPARATOR`, delete local `const SEP_W = 3`, update separator string
- [ ] Update `render-smoke.test.ts`: import `SEP_W, SEPARATOR`, delete local `SEP_W`, replace raw `" · "` strings
- [ ] Update `layout.test.ts`: remove `measureChunks` from import, paste the implementation as a local function, add `visibleWidth` import if not present, replace literal `3` with `SEP_W`
- [ ] Run `npx tsc --noEmit` from `packages/footer` — must pass with zero errors
- [ ] Run `npx vitest run` from `packages/footer` — all tests must pass
- [ ] Commit: `fix(footer): export SEP_W/SEPARATOR constants, move measureChunks into test`

**Acceptance criteria:**
- [ ] `SEP_W` and `SEPARATOR` are exported from `layout.ts` and imported (never redefined) in `index.ts`, `render-smoke.test.ts`, and `layout.test.ts`
- [ ] `measureChunks` has no `export` keyword in `layout.ts`
- [ ] `tsc --noEmit` passes in `packages/footer`
- [ ] All vitest tests pass in `packages/footer`

---

### Task 2: Core — unexport clampLines; inline in smoke test

**Context:**
Finding 5 (Dead API): `clampLines` is exported from `packages/core/src/text.ts` but its only consumer is `packages/footer/src/utils/render-smoke.test.ts`. No production code calls it.

Note: `clampLine` (singular, no 's') IS used in production (`footer/src/index.ts`) — do NOT touch it.

**Files:**
- Modify: `packages/core/src/text.ts`
- Modify: `packages/footer/src/utils/render-smoke.test.ts`

**What to implement:**

In `packages/core/src/text.ts`:
- Change `export function clampLines(lines: string[], maxW: number): string[]` → `function clampLines(...)` (remove only the `export` keyword). Body unchanged.

In `packages/footer/src/utils/render-smoke.test.ts`:
- Remove `clampLines` from the import: `import { stripAnsi, clampLines } from "@pi-archimedes/core/text"` → `import { stripAnsi } from "@pi-archimedes/core/text"`.
- Find the usage: `const [clamped] = clampLines(lines, 200);` — replace with `const clamped = lines[0];`. The variable is only used on the next two lines for assertions on `lines[0]`, and `buildLines` already applies `clampLine` internally, so `lines[0]` is already clamped. The `!` non-null assertion on `clamped` becomes unnecessary since `clamped` is now `string | undefined` — keep the `!` as `lines[0]!` or guard with `lines[0] ?? ""`.

**Steps:**
- [ ] Edit `packages/core/src/text.ts`: remove `export` from `clampLines` only (not `clampLine`)
- [ ] Edit `packages/footer/src/utils/render-smoke.test.ts`: remove `clampLines` import, replace usage
- [ ] Run `npx tsc --noEmit` from `packages/core` — must pass
- [ ] Run `npx tsc --noEmit` from `packages/footer` — must pass
- [ ] Run `npx vitest run` from `packages/footer` — all tests must pass
- [ ] Commit: `fix(core): unexport clampLines (no production callers)`

**Acceptance criteria:**
- [ ] `clampLines` has no `export` keyword in `text.ts`
- [ ] `clampLine` (singular) is NOT touched
- [ ] `render-smoke.test.ts` does not import `clampLines`
- [ ] `tsc --noEmit` passes in both `packages/core` and `packages/footer`
- [ ] All vitest tests pass in `packages/footer`

---

### Task 3: Notify — add TRIGGER constants

**Context:**
Finding 13 (DRY): `packages/notify/src/index.ts` uses the raw strings `"agent_end"` and `"ask_request"` as trigger names 6+ times. A typo is a silent runtime bug with no compile-time guard. Note: the config helper functions (`loadNotifyConfig`, `getNotifySettingsItems`, etc.) already exist inline in `index.ts` — that part of the audit finding was already resolved. Only the trigger string constants remain to fix.

**Files:**
- Modify: `packages/notify/src/index.ts`

**What to implement:**

Read `packages/notify/src/index.ts` first to find the exact sites.

Add near the top of the file (after imports, before the config section):
```ts
const TRIGGER = {
  AGENT_END: "agent_end",
  ASK_REQUEST: "ask_request",
} as const;
type TriggerType = typeof TRIGGER[keyof typeof TRIGGER];
```

Then update every occurrence:
- The `pendingTrigger` variable declaration's type annotation: `"agent_end" | "ask_request" | null` → `TriggerType | null`
- The `scheduleNotify(trigger: "agent_end" | "ask_request")` parameter → `trigger: TriggerType`
- The `fireNotification(trigger: "agent_end" | "ask_request" | null)` parameter → `trigger: TriggerType | null`
- All call sites: `scheduleNotify("agent_end")` → `scheduleNotify(TRIGGER.AGENT_END)`, etc.
- All `if (trigger === "agent_end")` guards → `if (trigger === TRIGGER.AGENT_END)`, etc.

Do NOT change any logic — only replace string literals and update type annotations.

**Steps:**
- [ ] Read `packages/notify/src/index.ts` in full; catalog every `"agent_end"` and `"ask_request"` occurrence and every type annotation referencing the union
- [ ] Add `TRIGGER` const and `TriggerType` type
- [ ] Replace all string literals and update all type annotations
- [ ] Run `npx tsc --noEmit` from `packages/notify` — must pass
- [ ] Commit: `fix(notify): TRIGGER constants for agent_end/ask_request strings`

**Acceptance criteria:**
- [ ] No raw `"agent_end"` or `"ask_request"` string literals remain in `notify/src/index.ts`
- [ ] All type annotations that referenced the union type are updated to `TriggerType` (or `TriggerType | null`)
- [ ] `tsc --noEmit` passes in `packages/notify`

---

### Task 4: Subagent — extract TypeBox tool schema into tool-schema.ts

**Context:**
Finding 12 (Inconsistent Patterns): The `subagent` tool's TypeBox schema is defined inline in `packages/subagent/src/index.ts`, inconsistent with other packages that separate schema from registration logic.

**Files:**
- Create: `packages/subagent/src/tool-schema.ts`
- Modify: `packages/subagent/src/index.ts`

**What to implement:**

Read `packages/subagent/src/index.ts` first to find the exact definitions. The schema is built with TypeBox (`import { Type } from "typebox"`). There are two relevant definitions to move:

1. `TaskItem` — a `Type.Object(...)` describing a single task (fields: `agent`, `task`, `model`, `cwd`, etc.)
2. `SUBAGENT_PARAMS_SCHEMA` (or whatever the actual constant name is) — the full tool parameter schema using `TaskItem`

Create `packages/subagent/src/tool-schema.ts`:
```ts
import { Type } from "typebox";

// [paste TaskItem definition here]
export const TaskItem = Type.Object({ ... });

// [paste SUBAGENT_PARAMS_SCHEMA definition here]
export const SUBAGENT_PARAMS_SCHEMA = Type.Object({ ... });
```

In `index.ts`:
- Remove the `TaskItem` and `SUBAGENT_PARAMS_SCHEMA` (or equivalent) definitions
- Add `import { TaskItem, SUBAGENT_PARAMS_SCHEMA } from "./tool-schema.js";`
- The `Type` import in `index.ts` can be removed if it's no longer used there (check carefully — the `list_agents` tool also has an inline `Type.Object({})` which should be left in place)

**Steps:**
- [ ] Read `packages/subagent/src/index.ts` to find the exact constant names and TypeBox expressions
- [ ] Create `packages/subagent/src/tool-schema.ts` with the extracted definitions
- [ ] Edit `packages/subagent/src/index.ts`: import from `tool-schema.ts`, remove inline definitions, remove `Type` import only if unused
- [ ] Run `npx tsc --noEmit` from `packages/subagent` — must pass
- [ ] Run `npx vitest run` from `packages/subagent` — all tests must pass
- [ ] Commit: `refactor(subagent): extract TypeBox tool schema into tool-schema.ts`

**Acceptance criteria:**
- [ ] `packages/subagent/src/tool-schema.ts` exists and exports the schema constants
- [ ] `index.ts` imports them rather than defining them inline
- [ ] All tests pass in `packages/subagent`

---

### Task 5: Ask — extract IPC relay and tool registration from index.ts

**Context:**
Finding 7 (File Length): `packages/ask/src/index.ts` (450 lines) mixes tool registration, the subagent IPC relay channel, session-text helpers, and dialog orchestration. Extracting the IPC relay and tool registration makes each concern independently readable.

Note: `dialog.ts` (664 lines) is intentionally left for a later plan — its UI state is deeply intertwined.

**Files:**
- Create: `packages/ask/src/ipc-relay.ts`
- Create: `packages/ask/src/tool.ts`
- Modify: `packages/ask/src/index.ts`

**What to implement:**

Read `packages/ask/src/index.ts` carefully in full before making changes. There are three separable sections:

1. **IPC relay** — the bus listener for `ASK_REQUEST` events from subagents, the `handleAskRequest` function, and the relay back to the subagent via the bus. Extract to `ipc-relay.ts`. Export `registerIpcRelay(pi, ctx, deps)` where `deps` provides access to the dialog-show function.

2. **Tool registration + session-text helpers** — `pi.registerTool({ name: "ask", ... })` and the helper functions that build the session-text representation of an ask result (`sanitizeForSessionText`, `buildAskSessionContent`, etc. — check the actual names). These helpers are used only by the tool path. Extract to `tool.ts`. Export `registerAskTool(pi, ctx, deps)` where `deps` provides access to the dialog-show function.

3. **Dialog orchestration** (session lifecycle, dialog factory) — stays in `index.ts`. `index.ts` becomes the thin entry that calls `registerIpcRelay` and `registerAskTool`.

The exact function/type names must match what `index.ts` actually uses — do not invent names. Use the real names from the file.

No behaviour change — pure extraction.

**Steps:**
- [ ] Read `packages/ask/src/index.ts` in full (450 lines)
- [ ] Identify the IPC relay section boundary and the tool registration section boundary precisely
- [ ] Create `ipc-relay.ts` with the relay logic; export the registration function
- [ ] Create `tool.ts` with the tool registration + session-text helpers; export the registration function
- [ ] Edit `index.ts`: import from the two new files, call them, remove the inlined code
- [ ] Run `npx tsc --noEmit` from `packages/ask` — must pass
- [ ] Run `npx vitest run` from `packages/ask` — all tests must pass
- [ ] Commit: `refactor(ask): extract IPC relay and tool registration from index.ts`

**Acceptance criteria:**
- [ ] `packages/ask/src/ipc-relay.ts` exists with the relay logic
- [ ] `packages/ask/src/tool.ts` exists with the tool registration and session-text helpers
- [ ] `packages/ask/src/index.ts` is the thin wiring entry
- [ ] All tests pass in `packages/ask`

---

### Task 6: MCP — extract proxy tool execute handler from index.ts

**Context:**
Finding 2 (File Length): `packages/mcp/src/index.ts` is 597 lines. Most of the command and direct-tool logic is already extracted (`commands.ts`, `direct-tools.ts`). What remains large is the inline `mcp` proxy tool's `execute` function — the action-dispatch block that handles `search`, `describe`, `call`, `connect`, `status`, `list`. This is the one remaining extraction that makes index.ts substantially smaller.

**Files:**
- Create: `packages/mcp/src/proxy-tool.ts`
- Modify: `packages/mcp/src/index.ts`

**What to implement:**

Read `packages/mcp/src/index.ts` in full. Identify the proxy tool section: the `execute` function registered with `pi.registerTool({ name: "mcp", ... })`, plus any helper functions scoped to it (`resolveToolRef`, `renderCall`, `renderResult`, or similar — check the actual names).

Create `packages/mcp/src/proxy-tool.ts`:
- Export a factory `createMcpProxyTool(serverManager: ServerManager, metadataCache: MetadataCache, config: McpConfig, colorize: ColorFn): ToolDefinition` (use the actual types from the file)
- Move the entire `execute` implementation + helper functions into this factory

In `index.ts`:
- Import `createMcpProxyTool` from `"./proxy-tool.js"`
- Replace the inline `registerTool({ name: "mcp", ... execute: ... })` with `pi.registerTool(createMcpProxyTool(...))`
- The module-level state (`serverManager`, `lifecycle`, the test-seam exports) stays in `index.ts`

Use the actual type names from `types.ts`, `server-manager.ts`, `metadata-cache.ts` — do not invent types.

**Steps:**
- [ ] Read `packages/mcp/src/index.ts` in full
- [ ] Read `packages/mcp/src/types.ts` and `packages/mcp/src/server-manager.ts` for types
- [ ] Create `proxy-tool.ts` with the extracted execute handler
- [ ] Edit `index.ts`: import from `proxy-tool.ts`, replace inline definition
- [ ] Run `npx tsc --noEmit` from `packages/mcp` — must pass
- [ ] Run `npx vitest run` from `packages/mcp` — all tests must pass
- [ ] Commit: `refactor(mcp): extract proxy tool execute handler into proxy-tool.ts`

**Acceptance criteria:**
- [ ] `packages/mcp/src/proxy-tool.ts` exists with the proxy tool handler
- [ ] `packages/mcp/src/index.ts` is substantially smaller (target: under 200 lines)
- [ ] All tests pass in `packages/mcp`

---

### Task 7: MCP — extract pure row helpers from panel.ts into panel-rows.ts

**Context:**
Finding 9 (File Length): `packages/mcp/src/panel.ts` (925 lines). The state is a single mutable object held in a closure (no reducer, no action union), and the OAuth flow closures are too tightly coupled to the local state to extract cleanly without a non-trivial refactor. However, a set of pure, stateless helper functions at module scope **can** be extracted cleanly.

These are the genuinely movable parts: pure functions that take state/data as arguments and return values with no side effects. Read the file to find them — examples include row-building helpers, filter helpers, age/status formatting, and type definitions for the row shapes. Use the real function names from the file.

**Files:**
- Create: `packages/mcp/src/panel-rows.ts`
- Modify: `packages/mcp/src/panel.ts`

**What to implement:**

Read `packages/mcp/src/panel.ts` in full. Find all pure module-scope functions and type definitions that:
- Take explicit arguments (no closure over local state)
- Return a value without side effects
- Are used only to build or filter the visible row list, format status/age labels, or define row shapes

Examples of what likely fits (verify against the real file): `buildVisibleRows`, `filterRows`, `buildRow`, `firstLine`, `formatAge`, `ageSuffix`, `isVerifiedStatus`, `toggleTool`, `computeSelection`, and the `ServerRow`/`ToolRow`/`VisibleRow` type definitions.

Move all of them to `panel-rows.ts` and export them. Import them back into `panel.ts`. Do NOT touch the mutable state closures, the keyboard handler, the OAuth closures, or the `makeMcpPanel` factory.

No behaviour change — pure extraction of stateless helpers.

**Steps:**
- [ ] Read `packages/mcp/src/panel.ts` IN FULL (925 lines) — list every pure module-scope function and type
- [ ] Create `panel-rows.ts` with the extracted pure functions and types
- [ ] Edit `panel.ts`: import from `panel-rows.ts`, remove the extracted definitions
- [ ] Run `npx tsc --noEmit` from `packages/mcp` — must pass
- [ ] Run `npx vitest run` from `packages/mcp` — all tests must pass
- [ ] Commit: `refactor(mcp): extract pure row helpers from panel.ts into panel-rows.ts`

**Acceptance criteria:**
- [ ] `panel-rows.ts` contains only pure functions and type definitions (no side effects, no closure over mutable state)
- [ ] `panel.ts` is meaningfully shorter (target: lose 150+ lines)
- [ ] All tests pass in `packages/mcp`

---

### Task 8: Subagent — split agent-manager.ts into store + panel

**Context:**
Finding 1 (File Length): `packages/subagent/src/agent-manager.ts` (1730 lines).

The file has a clear structural split: **file I/O** (`saveAgent`, filesystem scanning, YAML frontmatter parsing, `agents.local.json` load/save) vs **TUI panel** (all rendering, keyboard handling, state). The model and tool pickers are NOT self-contained sub-panels — their state lives in the shared `ManagerState` and their input handling is embedded in the main `handleEditInput` function alongside the other screens. The picker **render** functions are separable; the picker input branches require refactoring `handleEditInput`, which is out of scope here.

**Critical constraint:** `packages/subagent/src/index.ts` lazy-imports `agent-manager.ts`:
```ts
const { createAgentManager } = await import("./agent-manager.js")
```
Both `createAgentManager` AND `saveAgent` **must remain exported from `agent-manager.ts`** so the lazy import and any existing callers continue to resolve.

**Files:**
- Create: `packages/subagent/src/agent-store.ts`
- Create: `packages/subagent/src/agent-panel.ts`
- Modify: `packages/subagent/src/agent-manager.ts` (becomes thin orchestrator)

**What to implement:**

Read `packages/subagent/src/agent-manager.ts` IN FULL (1730 lines) before making any changes. Also read `packages/subagent/src/index.ts` to confirm the lazy import.

**`agent-store.ts`** — extract all file I/O:
- The `saveAgent(...)` function (currently exported from `agent-manager.ts`)
- All filesystem scanning functions: discovering `.md` agent files from project/user/global scope
- YAML frontmatter parsing/writing helpers
- `agents.local.json` load/save functions
- Import and re-export from `agent-manager.ts` so existing callers of `saveAgent` are unaffected

**`agent-panel.ts`** — extract the full TUI panel:
- All 5 screens: List, Detail, Edit, Name Input, Confirm Delete
- `ManagerState` interface and initial state construction
- Render functions: `renderList`, `renderDetail`, `renderEdit`, `renderModelPicker`, `renderToolPicker`, and any others at module scope
- Keyboard handlers: `handleListInput`, `handleEditInput` (including the embedded picker branches)
- Search/filter helpers for agents, models, tools
- Dirty-tracking logic
- The panel creation function (the main export used by `createAgentManager`)
- Imports from `agent-store.ts` for any file I/O operations

**`agent-manager.ts`** — thin orchestrator:
- Imports `createAgentPanel` from `agent-panel.ts`
- Imports `saveAgent` from `agent-store.ts` and **re-exports it** (lazy import in `index.ts` destructures `{ createAgentManager }` but other code may reference `saveAgent` from this module too)
- Exports `createAgentManager` (wires panel + store + pi/ctx)
- Target: under 80 lines

Use the real type and function names from the file — do not invent any.

**Steps:**
- [ ] Read `packages/subagent/src/agent-manager.ts` IN FULL (read every line)
- [ ] Read `packages/subagent/src/index.ts` to confirm the lazy import contract
- [ ] Create `agent-store.ts` with all file I/O
- [ ] Create `agent-panel.ts` with the full TUI panel
- [ ] Edit `agent-manager.ts`: thin orchestrator, re-export `saveAgent`, export `createAgentManager`, under 80 lines
- [ ] Run `npx tsc --noEmit` from `packages/subagent` — must pass
- [ ] Run `npx vitest run` from `packages/subagent` — all tests must pass
- [ ] Commit: `refactor(subagent): split agent-manager.ts into agent-store and agent-panel`

**Acceptance criteria:**
- [ ] `agent-store.ts` contains all file I/O, no TUI code
- [ ] `agent-panel.ts` contains all TUI panel code
- [ ] `agent-manager.ts` is under 80 lines and still exports both `createAgentManager` and `saveAgent`
- [ ] The lazy import `await import("./agent-manager.js")` in `index.ts` still resolves correctly
- [ ] `/agents` command behaviour is unchanged
- [ ] All tests pass in `packages/subagent`

---

## Execution Order

Tasks 1–4 are independent — do in any order or in parallel.
Task 5 (ask) is independent.
Task 6 (mcp proxy tool) should come before Task 7 (mcp panel split) — same package, easier to verify incrementally.
Task 8 (agent-manager split) is the largest and most risk — do it last.

**Recommended order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8
