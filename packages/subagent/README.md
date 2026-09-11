# @pi-archimedes/subagent

**Give your agent some backup.**

Big thinking and multi-file refactors are expensive to do in the main line. Subagent lets your agent delegate that work: it dispatches child agents — singly or in parallel — with a model and tool set of your choice per role, streams their progress live, and books their tokens and costs into the same status bar. You watch the whole team at once.

## Install

Standalone:

```bash
pi install npm:@pi-archimedes/subagent
```

Or the full suite instead:

```bash
pi install npm:pi-archimedes
```

New to Pi? Pi itself is a one-time global install and needs Node.js ≥ 22.19.0:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

Then `pi install npm:pi-archimedes`, `cd` into the project you want to work on and run `pi`. Inside the session, `/login` signs you in and `/model` picks a model — the [setup section](https://github.com/danielcherubini/pi-archimedes#setup) covers the first run. `/reload` picks the dispatch tool up in a running session.

<div align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/subagents-main-view.png" width="750" alt="Subagents parallel streaming view">
</div>

## Dispatching

### Config-less — the default

The `agent` field is optional. Omit it and the task runs with the **parent's model and all tools**:

```jsonc
{
  "task": "review the uncommitted changes and list the risks",
  "model": "openrouter/anthropic/claude-sonnet-4",  // optional per-call override
  "cwd": "/path/to/project"                        // optional working directory
}
```

### Named agents

With an `agent` name, the dispatch runs under a defined agent file (format below). Unknown names are refused and list the available agents, so a typo fails cheap:

```jsonc
{
  "agent": "reviewer",
  "task": "review the PR diff"
}
```

### Parallel work

Independent tasks go in a `tasks` array — distinct agents, distinct models, one call:

```jsonc
{
  "tasks": [
    { "agent": "researcher", "task": "find all usages of the deprecated API" },
    { "agent": "reviewer",   "task": "review the proposed migration plan" }
  ]
}
```

**The dispatch waits.** A call — single or parallel — blocks until every task completes and returns the combined results, each optionally carrying the child's `childSessionId`. There is an `async` field in the schema; the implementation ignores it, so don't plan on fire-and-forget: batch the work into `tasks` and let the call block on all of it.

### Model resolution

Per dispatch, in order: **the agent config's `model`, then the per-call `model`, then the parent's model.** The same rule holds for thinking level, except there is no per-call thinking field — agent config or parent.

## Agent files

Custom agents are `.md` files with YAML frontmatter:

```markdown
---
name: reviewer
description: Reviews diffs and flags risks before code lands
model: openrouter/anthropic/claude-sonnet-4
tools: read, bash
thinking: medium
---
You are a meticulous code reviewer. Read the diff, flag real risks,
and name the lines you checked.
```

- `name` and `description` are **required** — a file without them is skipped. `tools` is a **comma-separated string**. The markdown body is the agent's system prompt.
- **Scopes, in precedence order:** project (`<repo>/.pi/agents/`), user (`~/.pi/agent/agents/`), and global — the repository's `.agents/agents/` or, falling back, `~/.agents/agents/`.
- Unknown frontmatter fields are preserved on edit, not interpreted.
- Model and thinking picked in the `/agents` TUI are saved to `~/.pi/agent/agents.local.json` (machine-local, not committed), take precedence over the frontmatter, and are stripped from the `.md` on save. Hand-written `model:`/`thinking:` in frontmatter remain the fallback.
- At runtime, the subagent tool is excluded from a child's tool set, so a worker can't spawn workers.

## The `/agents` command

Available with the suite (and subagent enabled), `/agents` opens the interactive manager: a searchable list, model and tool pickers, cross-scope collision warnings, and dirty-tracking on save.

<p align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/subagents-agent-view.png" width="650" alt="Subagents agent details view">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/subagents-model-selection.png" width="48%" alt="Model selection">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/subagents-tool-selection.png" width="48%" alt="Tool selection">
</p>

## Part of the suite

The full suite is the supported connected setup. With the relevant components loaded together, subagent token and cost events flow over core's bus into the footer, subagent tasks get their own columns on the todo board, and subagent `ask` questions surface in your terminal. On/off is managed by the suite: toggle via `/plugins` (`archimedes.subagent.enabled`, default on).

← [Back to pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
