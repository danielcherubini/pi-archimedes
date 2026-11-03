---
status: live
last-verified: 2026-11-03
verified-by: reading `packages/todo/src` (tool.ts, state-manager.ts, index.ts, prepare-args.ts, ui/todo-widget.ts) against pi 1.2.0's shipped `examples/extensions/todo.ts`, claim by claim, on 2026-10-14; the suite's own tests (`npx vitest run` — 2430 tests / 145 files) and `tsc --noEmit` clean in all 13 workspace projects. Not re-checked against a live terminal in this pass: the exact frame on which the widget disappears after auto-clear (see "Auto-clear" — the 2 s timer and the widget refresh are separate). On 2026-11-03 the schema-symbol sourcing below and `packages/todo/package.json`'s dependencies were re-read against pi 1.5.0 (both CI jobs green: the pinned-1.4.0 `typecheck` and the floating `pi-latest`); everything else above stands as recorded on 2026-10-14.
---

# Todo board (`@pi-archimedes/todo`)

A task board pinned above the editor: the main agent's list in the first column, and a named column for each subagent that keeps its own list. The model maintains it through one tool, `manage_todo_list`; the user sees it without asking.

## The `manage_todo_list` contract

Two operations only (`packages/todo/src/tool.ts`, `ManageTodoListParams`):

- `read` — returns the list as it stands.
- `write` — **replaces the whole list**. Every write must carry every item; there is no partial update, no `add`, no `toggle`, no `clear` action, and no per-item id. Display numbering is array position (the tool description says so explicitly: "do NOT assign ids (numbering is order)").

Each item is `{ content, status, description? }` with `status` in `pending | in_progress | completed`. `state.validate()` rejects an item with a missing/blank `content` or an out-of-set status, and the tool returns `isError` with the specific complaint (`packages/todo/src/state-manager.ts`).

Two things sit around that schema:

- **Argument repair before validation.** `prepareArguments: prepareTodoArguments` (`packages/todo/src/prepare-args.ts`) runs before pi validates, and normalises the recoverable mistakes seen in practice — a stringified `todoList`, the list sent under `todo_list`/`todos`, items keyed `title`/`step` instead of `content`, dashed or plain-English statuses, bare-string items, and an invented `id` (stripped, not repaired). Unrecoverable input passes through so the real validation error still surfaces.
- **A declared output schema.** `outputSchema: ManageTodoListOutput` (`{ operation, todos }`) mirrors `details` on success, so a codemode script gets the list as data; failure results carry none of it. `packages/todo/src/tool.output-schema.test.ts` runs the handler and validates the payload against the declaration, because pi does not.

Both schemas are built from `Type` / `Static`, which `packages/todo/src/tool.ts` imports from `typebox` directly — the same source the suite's other schema-bearing packages (`ask`, `sudo`, `subagent`, `web`) use. `StringEnum` is a module-local helper in that file for the same reason it is a one-off: it was a `pi-ai` helper, `typebox` has no equivalent, and it emits the identical `{ type: "string", enum: [...] }`. `todo` therefore declares no `@earendil-works/pi-ai` dependency at all — its peers are `pi-coding-agent`, `pi-tui` and `typebox` (`>=1.1.0`); taking schema symbols from a host re-export is a never-do rule (`AGENTS.md` → Conventions → Imports, ADR 0026), because pi 1.5.0 deleted pi-ai's typebox re-exports and only the direct `typebox` importers survived it.

Successful writes announce the new list on the host's event handle (`Events.TODOS_UPDATE` → `archimedes:todos_update`, `packages/todo/src/tool.ts`). That is the outward path — the suite's desktop bridge forwards it as a `todos_update` frame (`packages/core/src/bridge/events.ts`) — and is separate from `onUpdate()`, which refreshes the local widget.

## The board

`packages/todo/src/ui/todo-widget.ts` draws the widget through pi's `ctx.ui.setWidget("todo-list", …)`:

- Main column first, unlabelled; subagent columns after it, sorted by source name, headed `subagent (<agent>)`. A source of the form `subagent:<agent>:<uuid>` renders as just the agent name.
- Column widths are computed from the terminal width and split with a ` │ ` divider; cells are truncated to the column, never allowed to reflow the row.
- A header row is reserved only when at least one column has a subagent header, so `todo[0]` is never painted over.
- Completed items are struck through, `in_progress` items use the warning colour, `pending` items are muted (`STATUS_ICONS` in `packages/todo/src/types.ts`).
- The widget is removed when both the main list and every subagent column are empty.

Subagent columns are fed from the parent side: `packages/subagent/src/stream.ts` watches the child's JSON stream and, on a successful `manage_todo_list` tool result, re-emits the child's list on the **parent's** handle as `archimedes:todos_update` with a per-child source (`subagent:<agent>`, or `subagent:<agent>:<session id>` once the child reports one, so two children sharing an agent name do not clobber each other). `packages/todo/src/index.ts` mirrors that into its column map, ignores `source === "main"` (handled locally), normalises the payload, and drops the column on `archimedes:todos_clear` (emitted when the child exits, `stream.ts`).

## Auto-clear

`TodoStateManager.write()` schedules a 2-second timer when the list is non-empty and every item is `completed`; when it fires, the list is empty (`packages/todo/src/state-manager.ts`). Any further write cancels it, and `session_shutdown` cancels it too.

The timer empties the state; the widget goes away at the next widget refresh (`updateWidget` calls `setWidget(..., undefined)` once everything is empty), which happens on `turn_end` or on the next tool call. So the board does not vanish on a timer alone — it empties on the timer and is taken off screen on the following refresh.

## State across sessions

The board survives `/reload`, resume and fork because it is reconstructed rather than cached: `TodoStateManager.loadFromSession()` walks `ctx.sessionManager.getBranch()` for this tool's `toolResult` entries and replays `details.todos` through the same normaliser, so legacy persisted shapes (ids, `title`, dashed statuses) read correctly. `session_start` and `session_tree` both trigger the replay (`packages/todo/src/index.ts`).

## Commands and settings

- `/todos` — refreshes the widget and notifies `N/M todos completed.` It is not a visibility toggle.
- `/todos clear` — clears the list and removes the widget.
- No settings of its own. On/off in the suite is `archimedes.todo.enabled`, toggled via `/plugins` (`meta/src/plugins.ts`); per ADR 0012 (`docs/decisions/0012-plugin-gate-in-package-namespace.md`) the package never reads it.

## vs pi's own (`examples/extensions/todo.ts`)

pi ships a todo example in its own `examples/extensions/`. It is the same *idea* — a tool the model calls plus state reconstructed from the session — and a different *shape*. That file was read in full.

**What pi's example provides.** Tool `todo` with four actions — `list`, `add`, `toggle`, `clear` — over items of `{ id, text, done }`, an incrementing `nextId`, and `details: TodoDetails` carrying `{ action, todos, nextId, error? }`. State is rebuilt by `reconstructState(ctx)`, which scans `ctx.sessionManager.getBranch()` for this tool's `toolResult` messages and takes the last `details`; it is re-run on `session_start` and `session_tree`. Its `/todos` command opens a custom component (`ctx.ui.custom` → `TodoListComponent`) that takes the editor's slot and lists every item with a `done/total completed` count, closing on Escape. Both `renderCall` and `renderResult` are implemented, and the collapsed result shows the first five items followed by `... N more`.

**What ours adds on top, and what differs:**

| | pi's `todo.ts` | `@pi-archimedes/todo` |
|---|---|---|
| Tool shape | `action: list/add/toggle/clear`, ids from `nextId` | `operation: write/read`, whole-list replacement, no ids |
| States | `done: boolean` | `pending` / `in_progress` / `completed` |
| Where it is shown | on demand, as a `ctx.ui.custom` component in the editor's slot | persistent `ctx.ui.setWidget` board, above the editor |
| Other agents | not represented | one column per subagent, fed from the child's tool results (`stream.ts`) |
| Finishing | the list stays until the model calls `clear` | a 2 s timer empties an all-completed list |
| Argument tolerance | none (schema validation is the only gate) | `prepareArguments` repair pass |
| Machine-readable result | `details` only | `details` **plus** a declared `outputSchema` |
| User command | `/todos` = open the list | `/todos` = refresh + stats, `/todos clear` = clear |

**What pi's example has that ours does not.** The model can act on single items — `toggle` one id, `add` one item, `clear` the list — which is cheaper to call for a one-item change than a whole-list rewrite. Its `/todos` view renders the entire list on demand; ours only reports counts and relies on the always-visible widget. Neither of those is a gap in behaviour the suite claims, and a future "is this still earning its place" call should weigh them as real.

## Not verified in this pass

- Whether the widget's own render loop can remove the board between `turn_end`s (i.e. whether the 2 s auto-clear is ever visible on its own). pi calls a widget factory once per `setWidget` call (`interactive-mode.js`, `setExtensionWidget` → `component = content(this.ui, theme)`), which is why the doc says "next refresh" rather than "immediately".
- Live TUI captures of the multi-column board in this pass. Nothing in this package renders the widget to a screen: `packages/todo/src/ui/todo-widget.ts` has no test file, and the tests around it (`index.test.ts`, `host-bus.test.ts`) assert what reaches the column map over the event handle, not how it is drawn. So column widths, the header row and the divider are read from the source only.
