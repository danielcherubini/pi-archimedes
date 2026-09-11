# @pi-archimedes/footer

**Adaptive status bar with live token accounting, real-dollar costs, and subagent aggregation for the [Pi coding agent](https://github.com/earendil-works/pi).**

Your terminal is already full of information. The footer gives you exactly what you need to know about your session — where you are, what model you're using, how many tokens you've burned, and how close you are to the context limit — laid out at the bottom of your terminal, adapting dynamically to viewport width without ever clipping. When subagents run, their costs merge seamlessly into the same view.

## Quick Start

### 1. Install Pi (if needed)

```bash
npm install -g @earendil-works/pi-coding-agent
```

### 2. Install

Install standalone:

```bash
pi install npm:@pi-archimedes/footer
```

Or install the complete [pi-archimedes](https://github.com/danielcherubini/pi-archimedes) development cockpit:

```bash
pi install npm:pi-archimedes
```

---

## What You Get

- **Session Context at a Glance** — Directory, active git branch (with clean/dirty indicators), active model, and thinking level. Automatically switches the branch icon from `⎇` to `🌲` when inside a linked git worktree.
- **Token & Cost Counter** — Real-time tracking of input tokens (↑), output tokens (↓), cache read/write, and live accumulated dollar cost.
- **Dynamic Context Window Bar** — Color-coded progress bar (green → yellow → red) indicating context window consumption.
- **Adaptive Non-Clipping Layout** — Renders as a single compact line on wide viewports; dynamically wraps to two or three lines on narrower viewports instead of truncating or clipping essential data.
- **Unified Subagent Cost Aggregation** — When subagents run, their token usage and dollar expenses stream through the core bus and accumulate into the footer automatically.

---

## Settings

Settings are stored in `~/.pi/agent/settings.json` under the `archimedes.footer` namespace (or configured interactively via `/archimedes`):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `splitThreshold` | number | `150` | Minimum terminal columns where a single-line layout is allowed. Below this threshold, the footer uses a structured multi-line layout; above it, it stays single-line and wraps only when content exceeds width. |

---

## Part of the Archimedes Suite

When installed as part of [pi-archimedes](https://github.com/danielcherubini/pi-archimedes), `@pi-archimedes/footer` listens to cost and token events emitted by `@pi-archimedes/subagent` via the core event bus, giving you an honest, complete overview of your entire agent swarm's burn rate.

← Back to [pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
