# @pi-archimedes/todo

**Real-time multi-column task board with auto-clear and subagent synchronization for the [Pi coding agent](https://github.com/earendil-works/pi).**

Keep complex multi-step refactors and feature builds organized. `@pi-archimedes/todo` provides a structured task widget rendered directly in the terminal, giving both you and the LLM clear visibility into current tasks, pending items, and completed steps. When subagents run, their tasks appear side by side in dedicated columns.

<div align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/todos-and-subagent.png" width="750" alt="Main agent and subagent todos side by side">
</div>

## Quick Start

### 1. Install Pi (if needed)

```bash
npm install -g @earendil-works/pi-coding-agent
```

### 2. Install

Install standalone:

```bash
pi install npm:@pi-archimedes/todo
```

Or install the complete [pi-archimedes](https://github.com/danielcherubini/pi-archimedes) development cockpit:

```bash
pi install npm:pi-archimedes
```

---

## What You Get

- **`manage_todo_list` Tool** — First-class tool allowing agents to plan, update, and read structured task lists with `pending`, `in_progress`, and `completed` states.
- **Side-by-Side Multi-Column Display** — Main agent todos appear in the primary column; spawned subagents dynamically get their own named column to the right.
- **Automatic Cleanup** — When all tasks reach `completed`, the widget displays a brief confirmation and auto-clears after 2 seconds to free up screen real estate.
- **Interactive Commands** — Toggle visibility with `/todos` or manually reset with `/todos clear`.
- **Session Persistence** — Todos survive `/reload` commands via session state reconstruction.

---

## Screenshots

### Progress Tracking

Visual status indicators with strikethrough for finished items and highlights for current work:

<div align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/todos-multiple-todos.png" width="600" alt="Multiple todos tracking progress">
</div>

---

## Tool Usage

The `manage_todo_list` tool accepts `read` and `write` operations:

### Read Current Tasks

```jsonc
{
  "operation": "read"
}
```

### Write / Update Tasks

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

---

## Part of the Archimedes Suite

When installed as part of [pi-archimedes](https://github.com/danielcherubini/pi-archimedes), `@pi-archimedes/todo` listens to `@pi-archimedes/subagent` events over the core bus to dynamically spawn and dismiss subagent columns as workers start and finish.

← Back to [pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
