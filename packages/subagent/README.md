# @pi-archimedes/subagent

**Subagent dispatch with live TUI streaming, parallel execution, and unified cost tracking for the [Pi coding agent](https://github.com/earendil-works/pi).**

Don't let complex reasoning or multi-file refactors block your main agent. `@pi-archimedes/subagent` enables you to dispatch specialized subagents to offload research, code reviews, and implementation tasks with live TUI streaming, parallel execution, independent model overrides, and real-time cost accounting.

<div align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/subagents-main-view.png" width="750" alt="Subagents parallel streaming view">
</div>

## Quick Start

### 1. Install Pi (if needed)

```bash
npm install -g @earendil-works/pi-coding-agent
```

### 2. Install

Install standalone:

```bash
pi install npm:@pi-archimedes/subagent
```

Or install the complete [pi-archimedes](https://github.com/danielcherubini/pi-archimedes) development cockpit:

```bash
pi install npm:pi-archimedes
```

---

## What You Get

- **Single & Parallel Execution** — Dispatch one targeted subtask or fan out multiple tasks across distinct agents simultaneously.
- **Live TUI Streaming** — Watch subagents think and execute tools in real time with color-coded status chips (grey while running, green on success, red on failure) and readable argument previews.
- **Visual `/agents` Manager** — Interactive full-screen TUI to create, configure, and inspect custom subagent personas with model and tool pickers.
- **Per-Agent Model Selection** — Assign different models per subagent (e.g. fast cheap models for research, high-reasoning models for code review).
- **Comprehensive Cost Accounting** — Real-time tracking of input tokens, output tokens, cache read/write, and dollar cost per subagent, flowing into the footer.
- **Multi-Scope Agent Discovery** — Reads agent definitions from project (`<repo>/.pi/agents/`), user (`~/.pi/agent/agents/`), and cross-agent (`~/.agents/agents/`) scopes with collision detection.

---

## Screenshots

### Agent Details & Persona View

Inspect agent prompts, assigned models, and tool configurations:

<div align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/subagents-agent-view.png" width="650" alt="Subagents agent details view">
</div>

### Model & Tool Pickers

Assign specific models and toggle allowed tools directly from the TUI:

<div align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/subagents-model-selection.png" width="48%" alt="Model selection">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/subagents-tool-selection.png" width="48%" alt="Tool selection">
</div>

---

## Usage

### The `subagent` Tool

Single task dispatch:

```jsonc
{
  "agent": "reviewer",                     // optional persona name (defaults to "general")
  "task": "review the PR diff",            // task description
  "model": "openrouter/anthropic/claude-4",// optional model override
  "cwd": "/path/to/project"                // optional working directory
}
```

Parallel swarm dispatch:

```jsonc
{
  "tasks": [
    { "agent": "researcher", "task": "find all usages of the deprecated API" },
    { "agent": "reviewer", "task": "review the proposed migration plan" }
  ]
}
```

### The `/agents` Command

Run `/agents` to launch the interactive persona manager. Browse existing agents, create new ones, configure system prompts, and toggle available tools.

---

## Part of the Archimedes Suite

When installed via [pi-archimedes](https://github.com/danielcherubini/pi-archimedes), subagent tokens and expenses automatically accumulate in the `@pi-archimedes/footer` status bar, subagent tasks display in side-by-side columns on the `@pi-archimedes/todo` board, and subagents can ask you interactive questions via `@pi-archimedes/ask` IPC.

← Back to [pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
