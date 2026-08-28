# Todo schema alignment + subagent-visibility fix Plan

**Goal:** Make the `manage_todo_list` item shape match what agentic models were actually trained to emit (Claude Code prior: `{content, status: pending|in_progress|completed, description?}`, no `id`), and make the parent todo widget mirror only *accepted* subagent todo state (fixing the `undefined`-title column and phantom lists).

**Architecture:** The repair layer in `packages/todo/src/prepare-args.ts` (wired via the tool's `prepareArguments`) becomes the single authority for normalizing whatever shape a model emits — canonical form is Claude Code's. The subagent package (`packages/subagent/src/stream.ts`) stops mirroring raw `tool_execution_start` args (which pi emits *before* repair/validation) and instead mirrors the child's accepted state from `tool_execution_end` (`result.details.todos`, `isError`-checked). The todo package's bus consumer additionally normalizes all incoming `TODOS_UPDATE` payloads. Rendering is index-based (no model-invented ids) with `?? ""` guards.

**Tech Stack:** TypeScript, pi extension API (`TypeBox` via `@earendil-works/pi-ai`, `ExtensionAPI`), pi pub/sub bus (`@pi-archimedes/core/bus`), vitest, pnpm workspace. No new runtime deps; one new workspace dep edge (`subagent → todo`).

**Decisions on record:** `docs/adr/0009-todo-schema-cc-alignment.md` (schema choice + why). Out of scope (explicit): parent-enforced todo validation with an ask-style socket error relay; renaming the tool or `operation`; adopting `activeForm` into the schema; `cancelled`/`blocked` statuses.

**Verification commands (used throughout):**
- `npx tsc --noEmit` in the package directory (AGENTS.md: run independently, wait for each)
- `npx vitest run` in `packages/todo` and `packages/subagent` (both have `vitest.config.ts`)

---

### Task 1: New item schema — types, repair layer, state, tool, widget (todo + core)

**Context:**
Frozen open-weight models (Qwen3.x — RL-trained on Claude-Code-style agentic environments) systematically deviate from our old strict 4-field schema `{id: number, title, description, status: not-started|in-progress|completed}`: they omit/null the invented `id`, put text under `content`/`step` instead of `title`, and emit `pending`/`in_progress` statuses. Research (2026-08, on file in ADR 0009) shows every mainstream harness avoids asking the model for an id (Claude Code `TodoWrite` = `{content, status, activeForm?}`; Codex `update_plan` = `{step, status}`; Gemini CLI `write_todos` = `{description, status}`). This task rewrites the todo package's core layer to the new canonical shape `{content: string, status: "pending"|"in_progress"|"completed", description?: string}` in ONE commit so `tsc --noEmit` stays green across `packages/todo` and `packages/core`. The repair module (`prepare-args.ts`) stays, but `content` becomes canonical and it gains a `normalizeTodoItems()` export used by Tasks 2 and 3.

**Files:**
- Modify: `packages/todo/src/types.ts`
- Modify: `packages/todo/src/prepare-args.ts`
- Modify: `packages/todo/src/state-manager.ts`
- Modify: `packages/todo/src/tool.ts`
- Modify: `packages/todo/src/ui/todo-widget.ts`
- Modify: `packages/core/src/bus.ts`
- Test: `packages/todo/src/prepare-args.test.ts` (rewrite cases)
- Test: `packages/todo/src/state-manager.test.ts` (rewrite cases)
- Test: `packages/todo/src/tool.test.ts` (update existing cases to new shape; read it first)

**What to implement:**

`packages/todo/src/types.ts` — replace with:
```ts
/** Status of a single todo item (Claude Code aligned). */
export type TodoStatus = "pending" | "in_progress" | "completed";

/** A single todo item. No `id` — display numbering is array position. */
export interface TodoItem {
  /** Short imperative label of the task (3-10 words). Displayed in UI. */
  content: string;
  /** Optional detailed context: file paths, methods, acceptance criteria. */
  description?: string;
  /** Current status. */
  status: TodoStatus;
}

/** Stored in tool result details for session persistence. */
export interface TodoDetails {
  operation: "read" | "write";
  todos: TodoItem[];
  error?: string;
}

/** Stats about the current todo list. */
export interface TodoStats {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
}

/** Validation result. */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Status icons for each todo state. */
export const STATUS_ICONS: Record<TodoStatus, string> = {
  completed: "✓",
  in_progress: "◉ ",
  pending: "○",
};
```

`packages/todo/src/prepare-args.ts` — rewrite the module (keep its exports `prepareTodoArguments`, `deriveTitleFromDescription`, `normalizeTodoItem`; ADD export `normalizeTodoItems`). Keep the file's purpose comment but update the scenario list (canonical is now `content`; `id` is stripped, not repaired). Concretely:

- `VALID_STATUSES: ReadonlySet<string> = new Set(["pending", "in_progress", "completed"])`.
- `STATUS_ALIASES: ReadonlyMap<string, TodoStatus>` keyed by the *collapsed* form (lowercase, all `[\s_-]+` separators removed), mapping:
  - → `"completed"`: `done`, `complete`, `finished`, `closed`, `success`, `passed`
  - → `"in_progress"`: `doing`, `started`, `working`, `active`, `wip`, `ongoing`, `inprogress`
  - → `"pending"`: `pending`, `todo`, `planned`, `untouched`, `notstarted`, `unstarted`, `open`
  (The canonical values themselves match `VALID_STATUSES` directly before alias lookup.)
- `normalizeStatus(raw: unknown): TodoStatus` (export it so future bus consumers can reuse it — but do NOT import it in `state-manager.ts`; `validate()` uses a local `validStatuses` set and `loadFromSession` only needs `normalizeTodoItems`): non-string → `"pending"`; else `s = raw.trim().toLowerCase()`; if `VALID_STATUSES.has(s)` return `s as TodoStatus`; else `collapsed = s.replace(/[\s_-]+/g, "")`; return `STATUS_ALIASES.get(collapsed) ?? "pending"`. Note: `validate()` in `state-manager.ts` must stay canonical-strict — it rejects `"in-progress"` (dashed); only `normalizeStatus` accepts dashed/aliased forms. Test 1.2 in `state-manager.test.ts` depends on exactly that split.
- `CONTENT_FALLBACK_KEYS = ["title", "step", "task", "text", "name", "label", "activeForm"] as const` (checked only when `content` itself is missing/empty).
- `DESCRIPTION_FALLBACK_KEYS = ["details", "notes", "summary", "context"] as const` (unchanged).
- `deriveTitleFromDescription(text: string): string` — unchanged (60-char word-boundary cut with trailing `…`); still used to derive a short `content` from long source text.
- `normalizeTodoItem(raw: unknown, index: number): unknown` — returns a FRESH object with only canonical keys `{content, description?, status}`:
  - `typeof raw === "string"`: trim; empty → return `raw` (schema error stands); else return `{ content: deriveTitleFromDescription(text), status: "pending" }`.
  - `!isRecord(raw)` (null/number/nested array) → return `raw` (schema error stands).
  - `description = (typeof raw.description === "string" ? raw.description.trim() : "") || firstStringOf(raw, DESCRIPTION_FALLBACK_KEYS)`.
  - `content = (typeof raw.content === "string" ? raw.content.trim() : "") || firstStringOf(raw, CONTENT_FALLBACK_KEYS)`.
  - if `content === "" && description !== ""` → `content = deriveTitleFromDescription(description)`.
  - if still `content === ""` → last-resort scan: first entry of `Object.entries(raw)` where the key is NOT in `["content", ...CONTENT_FALLBACK_KEYS, "description", ...DESCRIPTION_FALLBACK_KEYS, "status", "id"]` AND the value is a non-empty string → use the full value (untrimmed-of-length, as-is). This is the only catch-all; it must NOT match `status`/`id` values.
  - Return `{ content, ...(description !== "" ? { description } : {}), status: normalizeStatus(raw.status) }`. When both are empty this is `{ content: "", status: <normalized> }` — deliberately keeps an empty (valid-string) field so `state-manager.validate()` reports the missing `content` rather than the schema masking it.
  - `id` is ALWAYS dropped from the output (input key simply never read for output).
- `looksLikeTodoItem(value)` — a record containing any of `"content" | "title" | "step" | "description" | "status"`.
- `parseStringifiedList` / `ID_QUOTE_FIX` (`"id": 1"` mangled-quote repair) — keep unchanged.
- `normalizeTodoList(raw: unknown): { value: unknown; kept: boolean }` — same control flow as today: string → `parseStringifiedList`; `null` → `{value: undefined, kept: true}`; `undefined` → `{value: undefined, kept: false}`; array → map `normalizeTodoItem`; single `looksLikeTodoItem` object → wrap `[normalizeTodoItem(value, 0)]`; else pass through.
- `normalizeOperation(raw, listPresent)` — unchanged.
- `prepareTodoArguments(args: unknown): ManageTodoListInput` — unchanged structure/semantics (returns `args` as-is when not a record; always emits `operation`; emits `todoList` only when present), delegating to the updated normalizers.
- NEW export:
```ts
/**
 * Normalize a raw todo list (e.g. from bus payloads) into canonical TodoItems.
 * Returns [] for an empty input array, undefined for anything unrecoverable.
 * Used by the bus consumer (index.ts) and the subagent stream — where
 * prepareArguments is NOT in the call path.
 */
export function normalizeTodoItems(raw: unknown): TodoItem[] | undefined
```
  Behavior: `raw == null` → `undefined`. Input array → map `normalizeTodoItem` then keep only canonical items (`isRecord(item) && typeof item.content === "string" && item.content.trim() !== "" && typeof item.status === "string" && VALID_STATUSES.has(item.status)`); return the surviving list when non-empty, `[]` when the input array was empty, `undefined` when the input had items but none survived. Single `looksLikeTodoItem` object → same logic over `[raw]`. Anything else → `undefined`.

`packages/todo/src/state-manager.ts`:
- Import `{ normalizeTodoItems }` from `./prepare-args.js` (runtime-safe: `prepare-args.ts` has no runtime imports, no cycle; do NOT import `normalizeStatus` — `validate()` uses a local `validStatuses` set and `loadFromSession` only needs `normalizeTodoItems`).
- `validate(todos)`: per item — `!item` → `"Item N: undefined item"`; `(typeof item.content !== "string" || item.content.trim() === "")` → `"Item N: missing or invalid 'content'"`; `typeof item.status !== "string" || !validStatuses.has(...)` → `"Item N: 'status' must be one of: pending, in_progress, completed"` (with `validStatuses = new Set(["pending","in_progress","completed"])`); `item.description !== undefined && typeof item.description !== "string"` → `"Item N: 'description' must be a string"`. No `id`/`title` checks.
- `getStats()`: `pending` replaces `notStarted`.
- `loadFromSession(ctx)`: per `toolResult` entry for `manage_todo_list`, `const items = normalizeTodoItems(details?.todos); if (items) this.todos = items.map(t => ({ ...t }));` — this IS the legacy-pass: old persisted items (`title`, `not-started`, `id`) are normalized by the same normalizer; unrecoverable entries are dropped; `normalizeTodoItems` returning `undefined` (e.g. old entry was a string) leaves state untouched for that entry.
- `write()`/`clear()`/auto-clear — unchanged.

`packages/todo/src/tool.ts`:
- `TodoItemSchema`:
```ts
const TodoItemSchema = Type.Object({
  content: Type.String({
    description: "Short imperative label for the task (3-10 words). Displayed in UI. Example: \"Fix the auth middleware\".",
  }),
  status: StringEnum(["pending", "in_progress", "completed"] as const, {
    description: "pending: Not begun | in_progress: Currently working (multiple allowed for parallel work/subagents) | completed: Fully finished with no blockers",
  }),
  description: Type.Optional(Type.String({
    description: "Optional detailed context: file paths, specific methods, or acceptance criteria.",
  })),
});
```
  No `id` field. `ManageTodoListParams` otherwise unchanged (keep its `todoList` description wording).
- `TOOL_DESCRIPTION`: REWRITE the model-facing status vocabulary to the canonical tokens — find every dashed form in the current text (the `Todo states:` list: `not-started`/`in-progress`, and the prose lines `mark todo(s) as in-progress` / `mark as in-progress` / `mark todo IN PROGRESS` if present) and replace with `pending`/`in_progress`/`completed` (e.g. `in_progress: Currently working (multiple allowed for parallel work/subagents)`, `Mark todo(s) as in_progress before starting work`). After this task, `packages/todo/src/tool.ts` must contain ZERO occurrences of the dashed strings `not-started` or `in-progress` (Task 4 greps for this). In addition: add a short "Todo item shape" section after the CRITICAL workflow section showing the exact expected JSON item (`{"content": "Fix the auth middleware", "status": "pending", "description": "optional: file paths, acceptance criteria"}`). Keep all other bullets and the "mark IMMEDIATELY / don't batch" wording.
- `execute()`: logic unchanged (`state.validate` → `state.write` → bus emit with `source: "main"`). No status-string literals change.
- `renderResult` expanded loop: iterate with index (`for (let i = 0; i < todos.length; i++)`); number = `i + 1` (replaces `todo.id`); text = `todo.content ?? ""` (completed → `theme.fg("dim", theme.strikethrough(...))`; in_progress → `theme.fg("warning", ...)`; else → `theme.fg("muted", ...)`); icon still from `STATUS_ICONS[todo.status] ?? "?"` with the existing per-status colors. Keep everything else (header label logic, error/empty branches).
- `renderCall` — unchanged.

`packages/todo/src/ui/todo-widget.ts`:
- `getStatusIcon` / `formatTodoTitle`: switch on new statuses — `completed`/`in_progress`/`pending` (same glyphs/colors as today: success dim-strikethrough for completed, warning for in_progress, muted for pending).
- Row rendering in `render(width)`: replace `${todo.id}.` with `${todoIndex + 1}.` (`todoIndex = row - headerRows` is already computed); title rendered via `formatTodoTitle` reading `todo.content ?? ""`.
- Everything else (column layout, headers, truncation) unchanged.

`packages/core/src/bus.ts`:
- `TodoUpdatePayload.todos` type → `Array<{ content: string; description?: string; status: "pending" | "in_progress" | "completed" }>`. Nothing else in `bus.ts` changes (the bus `emit`/`on` signatures are untyped payloads).

**Tests (write failing tests FIRST):**
- `packages/todo/src/prepare-args.test.ts` — rewrite/move to cover at least:
  1. canonical `{content:"Fix auth", status:"pending"}` → unchanged `{content:"Fix auth", status:"pending"}` (output has NO `id`, NO `title`, NO `description` keys).
  2. legacy `{id:1, title:"X", description:"Y", status:"not-started"}` → `{content:"X", description:"Y", status:"pending"}`.
  3. Codex `{step:"X", status:"in_progress"}` → `{content:"X", status:"in_progress"}`.
  4. `{id:null, content:"X", status:"in progress"}` → `{content:"X", status:"in_progress"}` (id stripped, space folded).
  5. `{activeForm:"Adding tests"}` alone → `{content:"Adding tests", status:"pending"}`.
  6. bare string `"write tests"` item → `{content:"write tests", status:"pending"}`.
  7. stringified list `"[{\"id\": 1\\\", \"title\": \"X\", \"status\": \"pending\"}]"` (the `"id": 1"` mangled-quote shape) → parses and normalizes.
  8. last-resort scan: `{instruction:"do X", status:"pending"}` → `{content:"do X", status:"pending"}`; but `{id: 42, status:"bad"} ` does NOT pick up the number 42.
  9. `description` fallback: `{title:"X", notes:"n"}` → `{content:"X", description:"n"}`.
  10. `prepareTodoArguments({operation:"write", todoList:[...]})` end-to-end; missing `operation` with a list present → `"write"`; missing `operation` without a list → `"read"`.
  11. `normalizeTodoItems`: canonical array → as-is (`{content,status}`); legacy array → normalized; `[]` → `[]`; `null` → `undefined`; `[{content:"", status:"pending"}]` → `undefined` (no surviving items).
- `packages/todo/src/state-manager.test.ts`:
  1. `validate` accepts `{content, status}` (description optional); rejects empty `content`; rejects `"in-progress"` (hyphen) as status; rejects non-string `description`.
  2. `loadFromSession` with fake `ctx = { sessionManager: { getBranch: () => [{ type: "message", message: { role: "toolResult", toolName: "manage_todo_list", details: { todos: [{ id: 1, title: "Old", status: "not-started" }] } } }] } }` → `read()` = `[{ content: "Old", status: "pending" }]` (no `id`).
  3. `getStats()` counts `pending`.
- `packages/todo/src/tool.test.ts` — read the existing file first; update fixtures to the new shape; assert `parameters` no longer declares `id`, declares `content` + required `status` with the new enum, and `description` optional; update any `execute()` fixture lists.

**Steps:**
- [ ] Verify plan provenance is recorded (done in the spec session — commit `docs(plans): track plan-029 (todo schema alignment) + record ADR 0009`): `git log --oneline --diff-filter=A -- docs/plans/plan-029-todo-schema-alignment.md` should show that commit, and `docs/plans/README.md` should already contain the plan-029 row (IN PROGRESS) with Quick Stats Total 29 / In Progress 1. If ANY of that is missing (file untracked, row absent, stale stats), fix it now and commit `docs(plans): track plan-029 (todo schema alignment) + record ADR 0009` (per repo precedent plan/ADR tracking commits use the `docs:` prefix) before proceeding.
- [ ] Read `packages/todo/src/prepare-args.test.ts`, `state-manager.test.ts`, `tool.test.ts` to learn existing test style/helpers before rewriting.
- [ ] Write the new/updated failing tests listed above.
- [ ] Run `cd packages/todo && npx vitest run`
  - Did it FAIL (old behavior, e.g. `id` present / `title` keys / old statuses)? If anything passed unexpectedly, investigate before continuing.
- [ ] Implement `types.ts`, `prepare-args.ts`, `state-manager.ts`, `tool.ts`, `ui/todo-widget.ts`, and the `packages/core/src/bus.ts` payload type.
- [ ] Run `cd packages/todo && npx vitest run`
  - Did all tests pass? If not, fix and re-run before continuing.
- [ ] Run `cd packages/todo && npx tsc --noEmit`
  - Did it succeed? If not, read the error, fix, re-run.
- [ ] Run `cd packages/core && npx tsc --noEmit`
  - Did it succeed? If not, fix and re-run.
- [ ] Commit with message: `feat(todo): align item schema to Claude Code prior — content/status, drop id (ADR 0009)`

**Acceptance criteria:**
- [ ] `npx vitest run` in `packages/todo` green, including the new canonical/legacy/Codex/last-resort/mangled-JSON cases.
- [ ] `npx tsc --noEmit` green in `packages/todo` AND `packages/core`.
- [ ] No `id` or `title` field exists in `TodoItem`, the tool schema, or the bus payload type.
- [ ] `normalizeTodoItems` is exported from `prepare-args.ts` and behaves as specified (including `[]` and `undefined` cases).
- [ ] Widget renders `${index+1}.` numbering and `content` text (old `todo.id` references gone from the file).
- [ ] Single commit touching only the files listed above.

**Do NOT change:** `prepareArguments` wiring in `tool.ts` (keep the `prepareArguments: prepareTodoArguments` field); `ManageTodoListParams.operation`; the tool name `manage_todo_list`; `packages/subagent/*` (Task 3); `packages/todo/src/index.ts` (Task 2); auto-clear timing; the `"id": 1"` quote-repair regex behavior.

---

### Task 2: Normalize subagent todos at the bus consumer + rendering guards

**Context:**
The parent todo widget receives subagent todo state ONLY via the bus event `TODOS_UPDATE` (`events.TODOS_UPDATE` from `@pi-archimedes/core/bus`). Until Task 3, the *producer* still emits raw model args (and after Task 3 it emits accepted-but-possibly-legacy state, e.g. when a child session was recorded with an older schema). The consumer therefore must normalize every incoming payload itself. `packages/todo/src/index.ts` currently does `subagentTodos.set(data.source, data.todos)` verbatim — this is where `undefined` titles could still reach the widget. This task makes the consumer the guarantee: stored subagent todos are always canonical, and the widget can never print the string "undefined".

**Files:**
- Modify: `packages/todo/src/index.ts`
- Create: `packages/todo/src/index.test.ts`

**What to implement:**

`packages/todo/src/index.ts`:
- Import `{ normalizeTodoItems }` from `./prepare-args.js`.
- In the `TODOS_UPDATE` subscription (the `data.source === "main" return` branch stays first):
```ts
const normalized = normalizeTodoItems(data.todos);
if (normalized && normalized.length > 0) {
  subagentTodos.set(data.source, normalized);
  refreshWidget();
}
```
  (Unrecoverable payloads — `normalizeTodoItems` returns `undefined` — and empty lists are simply not mirrored; the widget hides empty subagent columns, and `TODOS_CLEAR`/child-exit remain the lifecycle ends.)
- No other changes in `index.ts`.

`packages/todo/src/index.test.ts` (new file):
- Minimal mocks:
  - `captured: Record<string, unknown>` for `setWidget(id, component)`.
  - `handlers: Record<string, Function>` filled by `pi.on(evt, fn)`.
  - `registered: { tool?: any; commands: Record<string, unknown> }` filled by `pi.registerTool`/`pi.registerCommand`.
  - `pi` = `{ on, registerTool, registerCommand }` cast `as unknown as ExtensionAPI`; `ctx` = `{ ui: { setWidget }, sessionManager: { getBranch: () => [] } }` cast `as any`.
  - Call `registerTodo(pi as any)` from `./index.js`.
- Real bus: use the actual `getBus()`/`Events` from `@pi-archimedes/core/bus` (it's a global singleton; the other todo test files don't touch the bus).
- Widget access: the widget is stored under the key `"todo-list"` (`WIDGET_ID` in `ui/todo-widget.ts`); capture `ctx.ui.setWidget(id, component)` into `captured: Record<string, unknown>` and read `captured["todo-list"]` fresh on EVERY render step (the factory can be replaced, or self-cleared to `undefined`, between steps). The widget factory is `(_tui, theme) => ({ render(width), invalidate() })`.
- Theme stub for invoking the captured widget factory: `const theme: any = { fg: (_c: unknown, s: unknown) => String(s), strikethrough: (s: unknown) => String(s) };` (the widget only calls `theme.fg` and `theme.strikethrough` — no other members are needed). Call `factory(null, theme)`, then `lines = comp.render(200)`.
- **Test ordering rule (critical)**: `session_start` → `reconstructState(ctx)` → `state.loadFromSession(ctx)`, which **resets the list** from `ctx.sessionManager.getBranch()` (the mock returns `[]`, i.e. empty). So `session_start` MUST fire BEFORE any `registered.tool.execute(...)` seed — in the reverse order the seed is wiped and no main column ever exists: `const anyP = handlers.session_start(undefined, ctx as any); await anyP;` (the handler is async; awaiting its promise is sufficient since the body is synchronous).
- Tests:
  1. **Legacy subagent payload is normalized, never "undefined"**: `await handlers.session_start(undefined, ctx as any)` FIRST; then seed main state by calling `registered.tool.execute("c1", { operation: "write", todoList: [{ content: "Main task", status: "pending" }] }, undefined, undefined, ctx as any)` (widget main column now exists); then `getBus().emit(Events.TODOS_UPDATE, { source: "subagent:fake1", todos: [{ id: 1, title: "Old shape task", status: "not-started" }] })`; render; assert joined lines contain `"Old shape task"` AND `"Main task"` and do NOT contain the substring `"undefined"`.
  2. **Unrecoverable payload is ignored without crashing**: (state from test 1 persists) emit `{ source: "subagent:fake2", todos: "garbage" }` and `{ source: "subagent:fake2", todos: [{ status: "pending" }] }`; no throw; render again → main column still intact (still contains `"Main task"`), no `subagent (fake2)` header.
  3. **TODOS_CLEAR removes the subagent column**: `getBus().emit(Events.TODOS_CLEAR, { source: "subagent:fake1" })`, render → no `subagent (fake1)` header line, `"Main task"` still present.
- Cleanup: call `handlers.session_shutdown?.(undefined, ctx as any)` in `afterAll` and unsubscribe any bus listeners you added directly (the registerTodo subscriptions unsubscribe on `session_shutdown`). Avoid emitting/creating lists where every item is `completed` in the tool `execute` fixture (that schedules a 2s auto-clear timer); the fixtures above use a pending item.

**Steps:**
- [ ] Read `packages/todo/src/index.ts` and `packages/todo/src/ui/todo-widget.ts` (the latter to confirm the widget factory shape used by the tests).
- [ ] Create `packages/todo/src/index.test.ts` with the tests above.
- [ ] Run `cd packages/todo && npx vitest run`
  - Expected pre-implementation: tests 1–2 FAIL (under the current unguarded consumer the legacy `title`-only payload renders `undefined`/`undefined.` in the subagent column, and the phantom `subagent (fake2)` header appears); test 3 (TODOS_CLEAR) already passes — regression guard. If tests 1–2 unexpectedly pass, stop and investigate why.
- [ ] Implement the `index.ts` change.
- [ ] Run `cd packages/todo && npx vitest run`
  - Did all tests pass? If not, fix and re-run before continuing.
- [ ] Run `cd packages/todo && npx tsc --noEmit`
  - Did it succeed? If not, fix and re-run.
- [ ] Commit with message: `fix(todo): normalize subagent todos at the bus consumer; guard rendering`

**Acceptance criteria:**
- [ ] `subagentTodos` only ever receives canonical, non-empty lists from the bus.
- [ ] The new index test proves a legacy payload renders as real text and the string "undefined" never appears.
- [ ] `npx vitest run` + `npx tsc --noEmit` green in `packages/todo`; single commit touching only `index.ts` + `index.test.ts`.

**Do NOT change:** the main-agent write flow (`source: "main"` returns early, state handled locally); `TODOS_CLEAR` handler; `reconstructState`/session lifecycle; the widget file (finished in Task 1); `stream.ts` (Task 3).

---

### Task 3: Subagent mirrors only accepted todo state

**Context:**
`packages/subagent/src/stream.ts` currently forwards `args.todoList` from the child's `tool_execution_start` event onto `TODOS_UPDATE` immediately. Pi emits that event with the **raw** `toolCall.arguments` — `prepareToolCall(...)` (which runs `prepareArguments` + schema validation) executes only AFTER the emit (verified in pi's agent loop: `executeToolCallsSequential` emits `tool_execution_start` before calling `prepareToolCall`). Result: the parent widget shows un-repaired items (the `undefined` titles) and shows lists the child then rejects (phantom lists). The fix: correlate by `toolCallId`, and on `tool_execution_end` mirror the child's *accepted* state: prefer `event.result.details.todos` (the child ran its own repair+validate — a child is a full pi process that self-holds the entire extension, so todo errors already reach the subagent's model); fall back to the stowed raw start args passed through `normalizeTodoItems`. On `isError !== false`, mirror nothing. This needs a new workspace dep edge `subagent → todo` (publish order already places `todo` before `subagent` in `.github/workflows/release.yml` — no workflow change), an `exports` field on the todo package (it currently has none; `@pi-archimedes/core` sets the pattern), and nothing else.

**Files:**
- Modify: `packages/subagent/src/stream.ts`
- Test: `packages/subagent/src/stream.test.ts`
- Modify: `packages/todo/package.json` (add `exports`)
- Modify: `packages/subagent/package.json` (add dep)

**What to implement:**

`packages/todo/package.json` — add (alongside the existing `"main": "./src/index.ts"`), mirroring the `core` package pattern with `.ts` targets:
```json
"exports": {
  ".": "./src/index.ts",
  "./prepare-args": "./src/prepare-args.ts"
}
```

`packages/subagent/package.json` — `dependencies` becomes:
```json
"dependencies": {
  "@pi-archimedes/core": "workspace:*",
  "@pi-archimedes/todo": "workspace:*"
}
```
Then run `pnpm install` at the repo root to link the workspace edge.

`packages/subagent/src/stream.ts`:
- `import { normalizeTodoItems } from "@pi-archimedes/todo/prepare-args";`
- Inside `streamEvents`, before the `rl.on("line", ...)` handler: `const pendingTodoArgs = new Map<string, unknown[]>();` and `const subagentSource = \`subagent:${callbacks.agent ?? "general"}\`;`
- `tool_execution_start` case — replace the existing inline `TODOS_UPDATE` block with stow-only:
```ts
case "tool_execution_start": {
  handleToolStart(state, event);
  emitProgress();
  if (event.toolName === "manage_todo_list" && typeof event.toolCallId === "string") {
    const args = event.args as Record<string, unknown> | undefined;
    const todoList = args?.todoList;
    if (Array.isArray(todoList)) {
      pendingTodoArgs.set(event.toolCallId, todoList);
    }
  }
  break;
}
```
- `tool_execution_end` case — add the mirror BEFORE the existing `handleToolEnd`/`emitProgress`/`handleToolResult` lines (which stay unchanged — note the existing code calls `handleToolEnd(state)` with ONE argument):
```ts
case "tool_execution_end": {
  if (event.toolName === "manage_todo_list") {
    const id = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
    const stowed = id ? pendingTodoArgs.get(id) : undefined;
    if (id) pendingTodoArgs.delete(id);
    const result = event.result as Record<string, unknown> | undefined;
    // Tool-level failure (todo's execute() RETURNS {isError:true} on validation
    // rejection — it does not throw) arrives as event.isError=false with
    // result.isError=true. Harness failures (abort, not-found, block, throw)
    // arrive as event.isError=true. Check BOTH — the same convention
    // handleToolResult in handlers.ts already uses.
    const failed = event.isError === true || result?.isError === true;
    if (!failed) {
      const detailsTodos = (result?.details as Record<string, unknown> | undefined)?.todos;
      const todos = normalizeTodoItems(Array.isArray(detailsTodos) ? detailsTodos : stowed);
      if (todos) {
        getBus().emit(Events.TODOS_UPDATE, { source: subagentSource, todos });
      }
    }
  }
  handleToolEnd(state);
  emitProgress();
  handleToolResult(state, event);
  emitProgress();
  break;
}
```
  Notes: `event` is `JsonEvent` (`[key: string]: unknown`) — keep the casts as written. An accepted-but-empty list (`todos = []`) IS emitted and is consumed-but-ignored by the Task 2 consumer (it stores nothing and clears nothing — the guard is `normalized.length > 0`, with no else branch); the subagent column drops ONLY via `TODOS_CLEAR` at child exit (or via the child's next non-empty list). A child's auto-clear itself emits no tool event, so no other path drops the column. Rejected writes — in EITHER error encoding — emit nothing. `detailsTodos` is normalized too — it is defense-in-depth for child sessions recorded by an older extension version (legacy `title`/`not-started` shapes normalize cleanly).
- `close` handler: replace the inline `subagent:` source string with `subagentSource`.
- Do not touch `handleToolStart`/`handleToolEnd`/`handleToolResult` in `handlers.ts`, the heartbeat, the startup watchdog, or the ask-socket code in `spawn.ts`.

**Tests — `packages/subagent/src/stream.test.ts`:**
- Follow the existing `fakeChild()`/`finishWith(events)` harness (read the file first) and EXTEND it: `async function finishWith(events: Array<Record<string, unknown>>, callbacks: StreamCallbacks = {})` — pass `callbacks` through to `streamEvents(child, callbacks)`. The current harness calls `streamEvents(child)` with no callbacks, which would make every source `subagent:general` and break the per-test source assertions below. All other harness behavior (synchronous per-line processing before `close`, 1s heartbeat, startup watchdog cleared on first JSON event) is unchanged and sufficient. Bus capture pattern per test block:
  ```ts
  const updates: Array<{ source: string; todos: unknown[] }> = [];
  const off = getBus().on(Events.TODOS_UPDATE, (p: unknown) => updates.push(p as (typeof updates)[number]));
  // ... run streamEvents with callbacks { agent: "<unique-per-test>" } ...
  off();
  ```
  Use a DIFFERENT `callbacks.agent` per test (e.g. `"t-acc"`, `"t-rej"`, `"t-nodetails"`) so sources don't collide across tests. Remember `finishWith` ends with `child.emit("close", 0)` which fires `TODOS_CLEAR` — assert on `updates` AFTER the `await finishWith(...)`; the `TODOS_UPDATE` entries are what we assert (ignore clears).
1. **Accepted write mirrors child-accepted state**: events `[{ type:"tool_execution_start", toolCallId:"t1", toolName:"manage_todo_list", args:{ operation:"write", todoList:[{ id:1, title:"Fix auth", status:"not-started" }] } }, { type:"tool_execution_end", toolCallId:"t1", toolName:"manage_todo_list", isError:false, result:{ content:[{type:"text",text:"ok"}], details:{ operation:"write", todos:[{ content:"Fix auth", status:"pending" }] } } }]` → exactly one `TODOS_UPDATE`, `source === "subagent:t-acc"`, `todos` deep-equals `[{ content: "Fix auth", status: "pending" }]` (NOT the raw stowed list).
2. **Rejected write mirrors nothing — REAL shape**: same start event; end event with event-level `isError: false` and `result: { content: [{type:"text",text:"Validation failed"}], details: { operation: "write", todos: [{ content: "Old item", status: "completed" }], error: "Item 1: missing or invalid 'content'" }, isError: true }` (this is how todo's `execute()` returns a validation rejection — `result.isError: true`, NOT an event-level error) → zero `TODOS_UPDATE`. Add a second fixture for the harness/abort shape: same start, end event-level `isError: true` with `result: { content: [{type:"text",text:"Aborted"}], details: {} }` → zero `TODOS_UPDATE`.
3. **Accepted without details falls back to normalized raw args**: same start event; end `isError: false`, `result: { content: [{type:"text",text:"ok"}] }` (no `details`) → one update, `todos` deep-equals `[{ content: "Fix auth", status: "pending" }]` (normalized from raw).
4. **End without a matching start does not crash and does not emit**: only the end event (build it with `result: { content: [{type:"text",text:"ok"}] }` — NO `details`, mirroring test 3's no-details shape; do NOT reuse test 1's end fixture, which carries `details.todos` and would mirror) → zero updates, promise resolves.
5. **Non-todo tools do not emit**: start+end for `toolName:"bash"` with a `todoList`-shaped args → zero updates.

**Steps:**
- [ ] Read `packages/subagent/src/stream.ts`, `stream.test.ts`, and `handlers.ts` (the `JsonEvent` shape) first.
- [ ] Apply the two `package.json` changes; run `pnpm install` at the repo root.
- [ ] Extend the `finishWith` harness (callbacks parameter) and write the five test fixtures in `stream.test.ts` (test 2 has two fixtures — real rejection shape + abort shape — for six scenarios total).
- [ ] Run `cd packages/subagent && npx vitest run`
  - Expected pre-implementation: tests 1–3 FAIL (old code emits on `tool_execution_start`: test 1 gets one update carrying the RAW stowed list, so the deep-equal against canonical state fails; tests 2–3 get a non-zero update count / raw-payload mismatch). Tests 4 and 5 (the no-emit cases) are regression guards that PASS under the old code as well — do not treat their passing as a bug to investigate. If tests 1–3 unexpectedly pass, stop and investigate why.
- [ ] Implement the `stream.ts` change.
- [ ] Run `cd packages/subagent && npx vitest run`
  - Did all tests pass? If not, fix and re-run before continuing.
- [ ] Run `cd packages/subagent && npx tsc --noEmit`
  - Did it succeed? If not, fix and re-run. (A tsc failure about the `@pi-archimedes/todo/prepare-args` subpath means the `exports` entry or the `pnpm install` link is wrong — check both.)
- [ ] Commit with message: `fix(subagent): mirror only accepted todo state from child tool results` — the commit must include `stream.ts`, `stream.test.ts`, the two `package.json` files, AND `pnpm-lock.yaml` (regenerated by the `pnpm install` step).

**Acceptance criteria:**
- [ ] `TODOS_UPDATE` is emitted from `stream.ts` in EXACTLY ONE place (the `tool_execution_end` case); `tool_execution_start` only stows.
- [ ] All five stream tests pass; `npx tsc --noEmit` green in `packages/subagent`.
- [ ] `pnpm --filter @pi-archimedes/subagent exec tsc --noEmit` also resolves the new import (i.e. the exports map works under pnpm filtering, not just workspace linking).
- [ ] No changes to `.github/workflows/release.yml` (todo already publishes before subagent).
- [ ] Single commit covering `stream.ts`, `stream.test.ts`, the two `package.json` files, and `pnpm-lock.yaml`.

**Do NOT change:** the ask-socket bridge in `spawn.ts`; `handleToolResult`'s recentOutput behavior; `SubagentResult` shape; the startup timeout or heartbeat; `Events` in `core/bus.ts`.

---

### Task 4: Docs, stale references, full-gate verification

**Context:**
After Tasks 1–3 the code is consistent, but prose (README) and possibly stray code comments/docs may still reference the old field names (`id`, `title`, `not-started`, `in-progress`). This task sweeps and fixes every live reference (historical plan files under `docs/plans/done/` are NOT touched — they record what was done at the time), then runs the full repo gate (every package type-checks, all test suites run) to prove nothing else regressed. This is the task that makes the change releasable.

**Files:**
- Modify: `README.md` (the todo feature section — read it first; update any mention of item fields/statuses)
- Modify: `docs/plans/README.md` (flip the plan-029 row to `✅ COMPLETED`; Quick Stats: Completed 29, In Progress 0)
- Modify: any other file flagged by the grep below (expected candidates: none in `packages/*/src` after Task 1–3, but check `packages/todo/README*`, `meta/` docs, `packages/core/src/bus.ts` comments)
- Do NOT modify: `docs/plans/done/**`, any file whose only old reference is inside a historical plan

**What to do:**
1. Sweep: `grep -rn "not-started\|in-progress\|TodoItem\|todoList\|title:" packages meta README.md --include="*.ts" --include="*.md" | grep -v node_modules | grep -v "\.test\.ts"` — review each hit; fix any that describe the CURRENT schema (i.e. everything except test files, which were rewritten in Task 1).
   - Re-run the same grep scoped to `packages/todo/src/prepare-args.ts` and expect **zero** `not-started`/`in-progress` hits after Task 1: legacy shapes are absorbed by the `/[\s_-]+/g` (separator collapse — strip whitespace/hyphen/underscore to `""`) before alias lookup, so the alias table is keyed by collapsed forms (`notstarted`, `inprogress`, …) and no dashed literals remain. Do NOT "fix" this by re-adding dashed alias keys — they would be dead code (never matched after the collapse). (The sweep pattern `TodoItem` also substring-matches the new `normalizeTodoItems` import in `packages/subagent/src/stream.ts` — expected; skip that hit.)
2. README: update the todo section's item-shape wording (if it documents the shape at all) to `content` + `status` (`pending`/`in_progress`/`completed`), no `id`.
3. Full gate — run each independently and wait (AGENTS.md verification order):
   - `npx tsc --noEmit` in EVERY directory under `packages/` (core, ask, footer, diff, image-paste, notify, subagent, todo, session-name, mcp) AND in `meta/`.
   - `npx vitest run` in every package that has `vitest.config.ts` (at minimum `packages/todo` and `packages/subagent`; if others have configs, run them too).
4. Update `docs/plans/README.md`: the plan-029 row MOVES from the Backlog table to the `## Done` table with status `✅ COMPLETED` (link it `plan-029-todo-schema-alignment.md`, relative path — same precedent as plan-028's row, no `done/` prefix since the file lives at the plans root), and set Quick Stats (Completed 29, In Progress 0, Backlog 0).
5. Confirm `git status` shows only the doc edits for this commit (no code drift from the sweep).

**Steps:**
- [ ] Run both greps; fix live references (code comments, README, any package README).
- [ ] Run the full tsc loop over all 11 directories listed above.
  - Did every one succeed? If any fails, read the error, fix, re-run.
- [ ] Run `npx vitest run` in each package with `vitest.config.ts`, starting with `packages/todo` and `packages/subagent`.
  - Did all suites pass? If not, fix and re-run before continuing.
- [ ] Commit with message: `docs(todo): schema-alignment docs and stale reference cleanup`

**Acceptance criteria:**
- [ ] Zero non-historical occurrences of `not-started`/`in-progress`/`title:`-as-todo-field in live code or docs (the alias table legitimately contains only collapsed keys like `notstarted`).
- [ ] All 11 type-checks green; all test suites green.
- [ ] Commit touches documentation/comments only, plus the `docs/plans/README.md` status flip.

**Do NOT change:** the alias tables in `prepare-args.ts` (they keep legacy keys on purpose); `docs/plans/done/**`; `docs/adr/0009-todo-schema-cc-alignment.md` (already correct); any version numbers (bumped at release time per AGENTS.md, not here).

---

## Out of scope (carried from the approved spec — do NOT build)

- Parent-enforced todo validation with an ask-style socket error relay from parent to child.
- Renaming the `manage_todo_list` tool or its `operation` parameter.
- Adopting `activeForm` into the schema / spinner integration; `cancelled`/`blocked` statuses.
- Version bumps or release workflow changes (todo already publishes before subagent).

## Cross-task notes for the executing agent

- The monorepo has NO build step — verification is `tsc --noEmit` + vitest only (AGENTS.md).
- Cross-package imports use package subpath exports (`@pi-archimedes/todo/prepare-args`), relative imports stay package-internal.
- Each task MUST end with a green `tsc --noEmit` in every package it touched (plus `core` for Task 1) and vitest green where tests exist — intermediate commits must not leave the repo red.
- If a check fails twice in a row without edits between runs, stop and report BLOCKED (AGENTS.md loop-break rule).
