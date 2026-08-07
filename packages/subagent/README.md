# @pi-archimedes/subagent

Subagent dispatch with live TUI streaming and cost tracking for the [Pi coding agent](https://github.com/earendil-works/pi).

## Features

- **Single & parallel execution** — dispatch one task or fan out multiple tasks across different agents simultaneously
- **Live TUI streaming** — watch subagent progress in real-time with color-coded tool calls (grey while running, green/red on completion), readable argument previews, token counts, and cost updates
- **Agent discovery** — auto-discovers agents from `.pi/agents/*.md` files at project, user, and global scope
- **Per-agent model override** — each subagent can use its own model, falling back to the parent's selection
- **Cost tracking** — detailed token usage (input, output, cache read/write) and cost per subagent, emitted through the core bus for the footer to consume
- **Trace correlation** — results expose the ephemeral child's logical Pi session UUID as optional `childSessionId` when Pi emits a valid session event
- **`/agents` command** — full CRUD TUI for managing agent definitions with model picker, tool picker, and cross-scope collision warnings (available via the meta package)

## Screenshots

### Main view — parallel execution

Live progress panel showing two parallel subagents with token stats, cost, and recent output:

![subagents main view](../../docs/images/subagents-main-view.png)

### Agent details view

Browse and inspect agent configurations — name, model, tools, system prompt, and more:

![subagents agent view](../../docs/images/subagents-agent-view.png)

### Model selection

Pick from all available models registered in Pi's model registry:

![subagents model selection](../../docs/images/subagents-model-selection.png)

### Tool selection

Toggle which tools are available to an agent from Pi's full toolset:

![subagents tool selection](../../docs/images/subagents-tool-selection.png)

## Installation

```bash
pi install @pi-archimedes/subagent
```

Or install the full [pi-archimedes](../..) meta package for the integrated experience (cost tracking in footer, shared chrome, etc.):

```bash
pi install pi-archimedes
```

## Usage

### As a tool

The `subagent` tool accepts either a single `task` or an array of `tasks` for parallel execution:

```jsonc
{
  "agent": "reviewer",     // optional, defaults to "general"
  "task": "review the PR", // single task
  "model": "openrouter/anthropic/claude-4", // optional override
  "cwd": "/path/to/dir"    // optional working directory
}
```

Parallel mode:

```jsonc
{
  "tasks": [
    { "agent": "researcher", "task": "find all usages of foo" },
    { "agent": "reviewer", "task": "review the implementation plan" }
  ]
}
```

### As a command

Run `/agents` to open the interactive Agents Manager for creating, editing, and deleting agent definitions.

## Agent files

Agents are defined as `.md` files with YAML frontmatter, placed in one of:

- **Project scope:** `<cwd>/.pi/agents/` — available only in this project
- **User scope:** `~/.pi/agents/` — available across all projects
- **Global scope:** installed via packages or extensions

Frontmatter supports: `name`, `model`, `tools`, `thinking`, `inheritProjectContext`, `inheritSkills`, `systemPromptMode`, and `systemPrompt`.

## Integration

When installed via `pi-archimedes` (the meta package), subagent cost events flow through `@pi-archimedes/core/bus` and are consumed by `@pi-archimedes/footer`'s `CostAccumulator`. This merges subagent tokens and cost into the main status bar for a unified view.

The `/agents` command is also only registered by the meta package (not by standalone `@pi-archimedes/subagent`).
