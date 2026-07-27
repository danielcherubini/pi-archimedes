# Todo List Plan

**Goal:** Add a `manage_todo_list` tool with auto-clear on completion and live subagent todo visibility via a multi-column widget.

**Architecture:** A new `packages/todo` package provides the tool, state manager, and widget. The bus (core) gains `TODOS_UPDATE` and `TODOS_CLEAR` events. The subagent stream handler intercepts `manage_todo_list` tool results from child processes and forwards them via the bus. The widget displays main agent todos and per-subagent columns side by side.

**Tech Stack:** TypeScript, ESM, pi extension API (`pi.registerTool`, `pi.registerCommand`, `ctx.ui.setWidget`), archimedes eventbus.

---

### Task 1: Add bus events for todo communication

**Context:**
The eventbus in `packages/core` is the shared communication channel between packages. Two new events are needed: `TODOS_UPDATE` (carries a todo list from a source) and `TODOS_CLEAR` (signals a source's todos should be removed, e.g., subagent exited). These mirror the existing `COST_UPDATE` pattern.

**Files:**
- Modify: `packages/core/src/bus.ts`

**What to implement:**
- Add `TODOS_UPDATE: "archimedes:todos_update"` and `TODOS_CLEAR: "archimedes:todos_clear"` to the `Events` object
- Add a `TodoUpdatePayload` interface:
  ```ts
  interface TodoUpdatePayload {
    source: string;       // "main" or "subagent:<agent-name>"
    todos: Array<{ id: number; title: string; description: string; status: "not-started" | "in-progress" | "completed" }>;
  }
  ```
- Add a `TodoClearPayload` interface:
  ```ts
  interface TodoClearPayload {
    source: string;
  }
  ```
- Export both types from the module

**Steps:**
- [ ] Add `TODOS_UPDATE` and `TODOS_CLEAR` to the `Events` object in `packages/core/src/bus.ts`
- [ ] Add `TodoUpdatePayload` and `TodoClearPayload` interfaces
- [ ] Export the new types alongside existing exports
- [ ] Run `npx tsc --noEmit` in `packages/core/`
  - Did it succeed? If not, fix and re-run.
- [ ] Commit with message: "feat: add TODOS_UPDATE and TODOS_CLEAR bus events"

**Acceptance criteria:**
- [ ] `Events.TODOS_UPDATE` and `Events.TODOS_CLEAR` are defined and exported
- [ ] `TodoUpdatePayload` and `TodoClearPayload` types are exported
- [ ] `npx tsc --noEmit` passes in `packages/core/`

---

### Task 2: Scaffold the todo package with types

**Context:**
Create the new `packages/todo` package following the monorepo conventions: ESM TypeScript, no build step, relative imports within package, subpath exports via package.json. This task creates the skeleton — package.json, tsconfig.json, and the types file.

**Files:**
- Create: `packages/todo/package.json`
- Create: `packages/todo/tsconfig.json`
- Create: `packages/todo/src/types.ts`

**What to implement:**

`packages/todo/package.json`:
```json
{
  "name": "@pi-archimedes/todo",
  "version": "0.0.0",
  "description": "Todo list tool with auto-clear and subagent visibility",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./types": "./src/types.ts"
  },
  "files": ["src"],
  "dependencies": {
    "@pi-archimedes/core": "workspace:*"
  },
  "peerDependencies": {
    "@earendil-works/pi-ai": ">=0.74.0",
    "@earendil-works/pi-coding-agent": ">=0.74.0",
    "@earendil-works/pi-tui": ">=0.74.0"
  },
  "devDependencies": {
    "typescript": "^6.0.3"
  }
}
```

`packages/todo/tsconfig.json` — copy from any existing package (e.g., `packages/footer/tsconfig.json`).

`packages/todo/src/types.ts`:
```ts
export type TodoStatus = "not-started" | "in-progress" | "completed";

export interface TodoItem {
  id: number;
  title: string;
  description: string;
  status: TodoStatus;
}

export interface TodoDetails {
  operation: "read" | "write";
  todos: TodoItem[];
  error?: string;
}

export interface TodoStats {
  total: number;
  completed: number;
  inProgress: number;
  notStarted: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
```

**Steps:**
- [ ] Create `packages/todo/package.json` with the content above
- [ ] Copy `packages/footer/tsconfig.json` to `packages/todo/tsconfig.json` (adjust if needed)
- [ ] Create `packages/todo/src/types.ts` with the types above
- [ ] Run `npx tsc --noEmit` in `packages/todo/`
  - Did it succeed? If not, fix and re-run.
- [ ] Commit with message: "feat: scaffold packages/todo with types"

**Acceptance criteria:**
- [ ] `packages/todo/package.json` exists with correct name, exports, and peerDependencies
- [ ] `packages/todo/src/types.ts` exports `TodoStatus`, `TodoItem`, `TodoDetails`, `TodoStats`, `ValidationResult`
- [ ] `npx tsc --noEmit` passes in `packages/todo/`

---

### Task 3: Implement the state manager with auto-clear

**Context:**
The `TodoStateManager` manages the in-memory todo list. It handles read/write/clear, validation, session reconstruction, and the auto-clear feature (2-second delay after all todos are completed). The auto-clear timer must be cancellable so that new writes don't trigger stale clears.

**Files:**
- Create: `packages/todo/src/state-manager.ts`

**What to implement:**

A class `TodoStateManager` with these methods:

- `read(): TodoItem[]` — returns a defensive copy of the current todos
- `write(todos: TodoItem[]): void` — replaces the entire list. Validates first. Cancels any pending auto-clear timer. If all items in the new list have `status === "completed"` and the list is non-empty, calls `scheduleAutoClear()`.
- `clear(): void` — sets todos to empty array, cancels any pending timer
- `getStats(): TodoStats` — computes `{ total, completed, inProgress, notStarted }`
- `validate(todos: TodoItem[]): ValidationResult` — checks: array type, each item has `id` (number), `title` (non-empty string), `description` (non-empty string), `status` (valid enum value). Returns `{ valid, errors }`.
- `loadFromSession(ctx: ExtensionContext): void` — scans `ctx.sessionManager.getBranch()` for messages with `role === "toolResult"` and `toolName === "manage_todo_list"`. Extracts `details.todos` from the last such message found. Replaces internal state.
- `scheduleAutoClear(callback: () => void): void` — if a timer is already pending, clears it first (idempotent). Sets a 2000ms `setTimeout` that calls `callback`. Stores the timer reference.
- `cancelAutoClear(): void` — if a timer is pending, `clearTimeout` on it.

The class has a private field `private todos: TodoItem[] = []` and `private autoClearTimer: ReturnType<typeof setTimeout> | undefined`.

**Steps:**
- [ ] Create `packages/todo/src/state-manager.ts` with the `TodoStateManager` class
- [ ] Implement `read()`, `write()`, `clear()`, `getStats()`, `validate()`
- [ ] Implement `loadFromSession(ctx)` — iterate branch, find last `manage_todo_list` tool result, extract todos
- [ ] Implement `scheduleAutoClear(callback)` and `cancelAutoClear()` with timer management
- [ ] In `write()`: after validation and setting todos, check if all completed → call `scheduleAutoClear(() => this.clear())`
- [ ] Run `npx tsc --noEmit` in `packages/todo/`
  - Did it succeed? If not, fix and re-run.
- [ ] Commit with message: "feat: implement TodoStateManager with auto-clear timer"

**Acceptance criteria:**
- [ ] `TodoStateManager` class with all methods implemented
- [ ] `write()` triggers auto-clear (2s delay) when all todos are completed
- [ ] `write()` cancels any pending auto-clear timer before writing new state
- [ ] `loadFromSession()` reconstructs from the last `manage_todo_list` tool result in the session branch
- [ ] `npx tsc --noEmit` passes in `packages/todo/`

---

### Task 4: Implement the manage_todo_list tool

**Context:**
The core tool that the agent calls. Supports `read` (return current list) and `write` (replace entire list). On write, emits a `TODOS_UPDATE` bus event so the widget can update. Includes `renderCall` and `renderResult` for inline display in the chat.

**Files:**
- Create: `packages/todo/src/tool.ts`

**What to implement:**

A `createManageTodoListTool(state: TodoStateManager, onUpdate: () => void)` factory that returns a tool object:

```ts
{
  name: "manage_todo_list",
  label: "Todo List",
  description: TOOL_DESCRIPTION,
  parameters: ManageTodoListParams,
  execute(...),
  renderCall(args, theme),
  renderResult(result, options, theme),
}
```

**Schema (TypeBox):**
```ts
const TodoItemSchema = Type.Object({
  id: Type.Number({ description: "Unique identifier for the todo. Use sequential numbers starting from 1." }),
  title: Type.String({ description: "Concise action-oriented todo label (3-7 words). Displayed in UI." }),
  description: Type.String({ description: "Detailed context, requirements, or implementation notes." }),
  status: StringEnum(["not-started", "in-progress", "completed"] as const, { description: "..." }),
});

const ManageTodoListParams = Type.Object({
  operation: StringEnum(["write", "read"] as const, { description: "..." }),
  todoList: Type.Optional(Type.Array(TodoItemSchema, { description: "..." })),
});
```

**execute handler:**
- `read` operation: return `{ content: [{ type: "text", text: JSON.stringify(todos) or "No todos..." }], details: { operation: "read", todos } }`
- `write` operation:
  1. Validate `todoList` is present and is an array
  2. Call `state.validate(todoList)` — return error if invalid
  3. Call `state.write(todoList)`
  4. Call `onUpdate()` callback (triggers widget update)
  5. Emit bus event (only in parent process — check `if (typeof globalThis !== 'undefined')`):
     ```ts
     import { getBus, Events } from "@pi-archimedes/core/bus";
     getBus().emit(Events.TODOS_UPDATE, { source: "main", todos: state.read() });
     ```
  6. Build stats message: `Todos have been modified successfully. X/Y completed. ...`
  7. If list has < 3 items, append warning: `Warning: Small todo list (<3 items). ...`
  8. Return `{ content: [{ type: "text", text: message }], details: { operation: "write", todos } }`

**renderCall:** `manage_todo_list <operation>` with optional `(N items)` for write. Use theme tokens: `toolTitle`, `muted`, `dim`.

**renderResult:** Show `✓ X/Y completed`. If expanded, list each todo with status icon and colored title. Same icon set: `✓` (completed/success), `◉` (in-progress/warning), `○` (not-started/dim).

**TOOL_DESCRIPTION:** Include the standard description text plus: "When all todos are completed, the list auto-clears after a brief delay."

**Steps:**
- [ ] Create `packages/todo/src/tool.ts` with the factory function
- [ ] Define TypeBox schema (`TodoItemSchema`, `ManageTodoListParams`)
- [ ] Implement `execute` handler for both `read` and `write` operations
- [ ] In `write`: after `state.write()`, call `onUpdate()`, emit `TODOS_UPDATE` bus event with source "main"
- [ ] Implement `renderCall` — show operation and item count
- [ ] Implement `renderResult` — show stats, expanded list with icons
- [ ] Write `TOOL_DESCRIPTION` constant
- [ ] Export `STATUS_ICONS` const: `{ "completed": "✓", "in-progress": "◉ ", "not-started": "○" }`
- [ ] Run `npx tsc --noEmit` in `packages/todo/`
  - Did it succeed? If not, fix and re-run.
- [ ] Commit with message: "feat: implement manage_todo_list tool with auto-clear and bus emission"

**Acceptance criteria:**
- [ ] Tool registered as `manage_todo_list` with read/write operations
- [ ] `write` emits `TODOS_UPDATE` bus event with `{ source: "main", todos }`
- [ ] `renderCall` shows operation and item count
- [ ] `renderResult` shows completion stats and optional expanded list
- [ ] `npx tsc --noEmit` passes in `packages/todo/`

---

### Task 5: Implement the multi-column widget

**Context:**
The widget displays todos above the text input using `ctx.ui.setWidget("todo-list", ...)`. It shows the main agent's todos in the leftmost column and each subagent's todos in separate columns to the right, separated by vertical dividers. The widget subscribes to local state changes and bus events to stay in sync.

**Files:**
- Create: `packages/todo/src/ui/todo-widget.ts`

**What to implement:**

**Exported functions:**

`updateWidget(state: TodoStateManager, ctx: ExtensionContext, subagentTodos: Map<string, TodoItem[]>): void`
- If main todos are empty AND subagentTodos is empty → `ctx.ui.setWidget("todo-list", undefined)` (hide widget)
- Otherwise, set widget with a render function that:
  1. Builds columns: main column + one per subagent source (sorted by source name)
  2. Calculates column width: `(width - (numColumns - 1) * 3) / numColumns` (3 chars per divider ` │ `)
  3. If column width < 20, wrap: split columns into rows of columns
  4. Renders header: ` Todo List — X/Y completed` (main agent stats only)
  5. Renders subagent column headers on first data row: `  subagent (<name>)`
  6. Renders each todo row across columns, truncating titles to column width
  7. Uses `truncateToWidth` from `@earendil-works/pi-tui` for line truncation

**Column rendering details:**
- Main column has no header label
- Subagent columns have header: `subagent (<agent-name>)` derived from source (strip `subagent:` prefix)
- Status icons and colors: completed=`✓`/dim/strikethrough, in-progress=`◉ `/warning, not-started=`○`/normal
- Divider: `theme.fg("dim", " │ ")`

**`clearWidget(ctx: ExtensionContext): void`**
- `ctx.ui.setWidget("todo-list", undefined)`

**`export const STATUS_ICONS`** — `{ completed: "✓", "in-progress": "◉ ", "not-started": "○" }`

**Steps:**
- [ ] Create `packages/todo/src/ui/todo-widget.ts`
- [ ] Implement `updateWidget` — accept state, ctx, and subagentTodos map
- [ ] Build column layout: main + subagent columns, calculate widths
- [ ] Handle wrapping when columns are too narrow (< 20 chars each)
- [ ] Render header with main agent stats
- [ ] Render subagent column headers
- [ ] Render todo rows with status icons, colored titles, truncation
- [ ] Implement `clearWidget`
- [ ] Export `STATUS_ICONS`
- [ ] Run `npx tsc --noEmit` in `packages/todo/`
  - Did it succeed? If not, fix and re-run.
- [ ] Commit with message: "feat: implement multi-column todo widget"

**Acceptance criteria:**
- [ ] Widget renders main agent todos in leftmost column
- [ ] Subagent todos rendered in separate columns with `subagent (<name>)` headers
- [ ] Columns separated by `│` divider
- [ ] Widget hides when all columns are empty
- [ ] Titles truncated to fit column width
- [ ] `npx tsc --noEmit` passes in `packages/todo/`

---

### Task 6: Wire up the extension entry (index.ts)

**Context:**
The extension entry point registers the tool, commands, bus subscriptions, and manages the widget lifecycle. It holds the subagent todos map and updates the widget on bus events.

**Files:**
- Create: `packages/todo/src/index.ts`

**What to implement:**

```ts
export default function (pi: ExtensionAPI): void { ... }
export function registerTodo(pi: ExtensionAPI): void { ... }
```

**Module-level state:**
- `state: TodoStateManager` — single instance
- `subagentTodos: Map<string, TodoItem[]>` — keyed by source (e.g., `"subagent:general"`)
- `currentCtx: ExtensionContext | undefined` — current context reference
- `unsubscribes: Array<() => void>` — bus subscription cleanup

**Bus subscriptions (inside `registerTodo`):**
- Subscribe to `Events.TODOS_UPDATE`: on receipt, update `subagentTodos.set(payload.source, payload.todos)`, then `updateWidget(state, currentCtx, subagentTodos)`
- Subscribe to `Events.TODOS_CLEAR`: on receipt, `subagentTodos.delete(payload.source)`, then `updateWidget(state, currentCtx, subagentTodos)`

**pi event handlers:**
- `session_start`: reconstruct state from session, call `updateWidget`, set up widget
- `session_tree`: same as session_start
- `turn_start`: update `currentCtx` reference
- `turn_end`: update `currentCtx`, call `updateWidget` (in case tool was called during turn)
- `session_shutdown`: dispose bus subscriptions, clear `subagentTodos`, call `clearWidget`

**Tool registration:**
- `const tool = createManageTodoListTool(state, () => updateWidget(state, currentCtx, subagentTodos))`
- `pi.registerTool(tool)`

**Command registration:**
- `/todos`: if args === "clear" → `state.clear()`, `clearWidget(ctx)`, notify. Else → if todos exist, `updateWidget`, notify stats. If empty, notify "No todos."

**Steps:**
- [ ] Create `packages/todo/src/index.ts`
- [ ] Create `TodoStateManager` instance and `subagentTodos` map at module level
- [ ] Subscribe to `TODOS_UPDATE` and `TODOS_CLEAR` bus events
- [ ] Register `session_start`, `session_tree`, `turn_start`, `turn_end`, `session_shutdown` handlers
- [ ] Register `manage_todo_list` tool with update callback
- [ ] Register `/todos` command with clear subcommand
- [ ] Export `registerTodo` function and default export
- [ ] Run `npx tsc --noEmit` in `packages/todo/`
  - Did it succeed? If not, fix and re-run.
- [ ] Commit with message: "feat: wire up todo extension entry with tool, widget, commands, bus"

**Acceptance criteria:**
- [ ] Tool registered as `manage_todo_list`
- [ ] `/todos` and `/todos clear` commands work
- [ ] Bus subscriptions update subagent todos map and refresh widget
- [ ] Session lifecycle handlers reconstruct state and clean up
- [ ] `npx tsc --noEmit` passes in `packages/todo/`

---

### Task 7: Integrate subagent stream handler

**Context:**
When a subagent child process uses the `manage_todo_list` tool, the result comes through the JSON stdout stream as a `tool_result_end` event. The stream handler in `packages/subagent/src/stream.ts` needs to detect these events and forward the todo list to the parent's eventbus. When the subagent process exits, emit a `TODOS_CLEAR` event to remove its column.

**Files:**
- Modify: `packages/subagent/src/stream.ts`
**What to implement:**

> Note: `packages/subagent` already depends on `@pi-archimedes/core` — no package.json changes needed.

In `stream.ts`, inside the `rl.on("line", ...)` handler, add a new case or extend the existing `tool_result_end` handling:

After the existing `tool_result_end` switch case (which calls `handleToolResult`), add:

```ts
case "tool_result_end": {
  handleToolResult(state, event);
  emitProgress();

  // Forward manage_todo_list results to the bus
  const toolMessage = event.message as Record<string, unknown> | undefined;
  if (toolMessage?.toolName === "manage_todo_list") {
    const details = (toolMessage as any).details;
    if (details?.todos && Array.isArray(details.todos)) {
      const { getBus, Events } = require("@pi-archimedes/core/bus");
      getBus().emit(Events.TODOS_UPDATE, {
        source: `subagent:${callbacks.agent ?? "general"}`,
        todos: details.todos,
      });
    }
  }
  break;
}
```

Use proper ESM imports instead of require:
```ts
import { getBus, Events } from "@pi-archimedes/core/bus";
```

In the `child.on("close", ...)` handler, after the existing cleanup:

```ts
// Clear subagent todos from the bus
getBus().emit(Events.TODOS_CLEAR, {
  source: `subagent:${callbacks.agent ?? "general"}`,
});
```

**Add `@pi-archimedes/core` to `packages/subagent/package.json` dependencies.**

**Steps:**
- [ ] Add `@pi-archimedes/core` to `packages/subagent/package.json` peerDependencies
- [ ] In `stream.ts`, import `getBus` and `Events` from `@pi-archimedes/core/bus`
- [ ] In the `tool_result_end` case, after `handleToolResult`, check for `manage_todo_list` and emit `TODOS_UPDATE`
- [ ] In the `child.on("close", ...)` handler, emit `TODOS_CLEAR` with the subagent's source
- [ ] Run `npx tsc --noEmit` in `packages/subagent/`
  - Did it succeed? If not, fix and re-run.
- [ ] Commit with message: "feat: forward subagent todo updates via bus in stream handler"

**Acceptance criteria:**
- [ ] `manage_todo_list` tool results from subagents are forwarded as `TODOS_UPDATE` events
- [ ] Subagent process exit triggers `TODOS_CLEAR` event
- [ ] Source includes agent name: `subagent:<agent-name>`
- [ ] `npx tsc --noEmit` passes in `packages/subagent/`

---

### Task 8: Register todo in meta and finalize

**Context:**
The meta package orchestrates all packages. The todo package must be registered here so it loads as part of the archimedes extension. Also update the meta package's dependencies.

**Files:**
- Modify: `meta/src/index.ts`
- Modify: `meta/package.json`

**What to implement:**

In `meta/src/index.ts`:
```ts
import { registerTodo } from "@pi-archimedes/todo";
// ...
registerTodo(pi);
```
Add the import and call in the default export function, alongside the other `register*` calls.

In `meta/package.json`:
- Add `"@pi-archimedes/todo": "workspace:*"` or the appropriate version reference to dependencies (match the pattern used for other packages).

**Steps:**
- [ ] Add `import { registerTodo } from "@pi-archimedes/todo"` to `meta/src/index.ts`
- [ ] Add `registerTodo(pi)` call in the default export function
- [ ] Add `@pi-archimedes/todo` to `meta/package.json` dependencies
- [ ] Run `npx tsc --noEmit` in `meta/`
  - Did it succeed? If not, fix and re-run.
- [ ] Run `npx tsc --noEmit` in `packages/todo/` (final check)
- [ ] Commit with message: "feat: register todo package in meta orchestrator"

**Acceptance criteria:**
- [ ] `registerTodo(pi)` called in meta's default export
- [ ] `@pi-archimedes/todo` listed in meta's dependencies
- [ ] `npx tsc --noEmit` passes in `meta/` and `packages/todo/`

---

### Task 9: End-to-end verification

**Context:**
Final verification pass — type-check all affected packages and verify the feature works locally with pi.

**Files:**
- All packages: `packages/core`, `packages/todo`, `packages/subagent`, `meta`

**Steps:**
- [ ] Run `npx tsc --noEmit` in `packages/core/`
- [ ] Run `npx tsc --noEmit` in `packages/todo/`
- [ ] Run `npx tsc --noEmit` in `packages/subagent/`
- [ ] Run `npx tsc --noEmit` in `meta/`
- [ ] Test locally: ensure the symlink is set up (`ln -s $(pwd) ~/.pi/agent/extensions/pi-archimedes`)
- [ ] In pi, verify `manage_todo_list` tool is available
- [ ] Write a todo list → verify widget appears above text input
- [ ] Complete all todos → verify widget shows all-completed state, then auto-clears after ~2 seconds
- [ ] Spawn a subagent with a task that uses `manage_todo_list` → verify subagent column appears
- [ ] Verify subagent column disappears when subagent finishes
- [ ] Verify `/todos clear` clears main agent todos
- [ ] Commit any fixes with message: "fix: e2e verification fixes" (if any)

**Acceptance criteria:**
- [ ] All `npx tsc --noEmit` checks pass across all affected packages
- [ ] Widget renders correctly with main agent todos
- [ ] Auto-clear fires after 2 seconds when all todos completed
- [ ] Subagent todo columns appear and disappear correctly
- [ ] `/todos clear` works
