# @pi-archimedes/todo

**Keep the plan in view.**

A live task board in the terminal: your agent's plan in the main column, and a named column for each subagent running alongside — so what's asked, what's in flight, and what's finished never leaves the screen. When everything is done, the board clears itself.

## Install

Standalone:

```bash
pi install npm:@pi-archimedes/todo
```

Or the full suite instead:

```bash
pi install npm:pi-archimedes
```

New to Pi? Pi itself is a one-time global install and needs Node.js ≥ 22.19.0:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

After installing Pi, choose one installation command above, then `cd` into your project and run `pi`. Inside the session, `/login` signs you in and `/model` picks a model — the [setup section](https://github.com/danielcherubini/pi-archimedes#setup) covers the first run. `/reload` works two ways here: it picks the extension up, **and** it restores the todo list, which survives `/reload` through session state reconstruction.

<div align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/todos-and-subagent.png" width="750" alt="Main agent and subagent todos side by side">
</div>

## The `manage_todo_list` tool

Two operations, `write` and `read`:

```jsonc
{ "operation": "read" }
```

```jsonc
{
  "operation": "write",
  "todoList": [
    { "content": "Parse config files", "description": "Read and validate settings", "status": "completed" },
    { "content": "Build state manager", "description": "Implement reactive store", "status": "in_progress" },
    { "content": "Connect UI widget", "description": "Bind to core bus events", "status": "pending" }
  ]
}
```

**Writes replace the whole list.** There is no partial update: every `write` must carry the complete list — existing items included — or they are replaced and gone.

States are `pending`, `in_progress`, and `completed`. Finished items render struck through; the current one stays highlighted.

<p align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/todos-multiple-todos.png" width="600" alt="Multiple todos tracking progress">
</p>

## Commands

- `/todos` — refreshes the todo widget and reports its status (e.g. `3/7 todos completed.`). It is **not** a visibility toggle; the board shows while there is content.
- `/todos clear` — clears the list.

## Auto-clear

When every task reaches `completed`, the widget shows a brief confirmation, then clears itself after 2 seconds to give the screen back.

## Part of the suite

With subagents running alongside in the [full suite](https://github.com/danielcherubini/pi-archimedes), each child gets its own named column to the right of yours — it appears on the child's first non-empty todo update over core's bus (empty updates are ignored; it does not appear when the worker merely starts), and it is removed when the child exits. The 2-second auto-clear is local to whatever list completed — a child clearing its own list does not dismiss the column in your session. On/off is managed by the suite: toggle via `/plugins` (`archimedes.todo.enabled`, default on).

← [Back to pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
