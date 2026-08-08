# @pi-archimedes/footer

A status bar that shows what matters — at a glance, without getting in the way.

Your terminal is already full of information. The footer gives you exactly what you need to know about your session — where you are, what model you're using, how many tokens you've burned, and how close you are to the context limit — all in one clean line at the bottom. When subagents run, their costs merge seamlessly into the same view.

## What You Get

- **Session context at a glance** — directory, git branch (with clean/dirty indicator), active model, thinking level, and worktree
- **Token stats** — input ↑, output ↓, cache read/write, and real-dollar cost, all in one compact display
- **Context window bar** — color-coded progress bar (green → yellow → red) showing how much of your context window is used
- **Smart layout** — single line on wide terminals, auto-splits to two lines when space is tight (threshold configurable)
- **Unified subagent costs** — when subagents run, their token usage and cost merge into the main footer automatically

## Installation

```bash
pi install npm:@pi-archimedes/footer
```

Or install full meta package:

```bash
pi install npm:pi-archimedes
```

## Usage

Footer renders automatically at the bottom of the Pi TUI. No commands to run.

On wide terminals, the footer displays as a single clean line containing all session context, token usage, cost, and context window progress. When the terminal width falls below the configured split threshold, the footer automatically splits into two lines to keep all information clear and readable without clipping.

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `splitThreshold` | number | `150` | Minimum terminal width (columns) to display footer on a single line. Below this width, the footer splits into two lines. |

Settings are stored in `~/.pi/agent/settings.json` under the `archimedes.footer` namespace.

## Integration

When installed via meta package, footer consumes cost events from subagents through the core bus, giving a unified token/cost view. Standalone install shows only the main agent's stats.

---

← Back to [pi-archimedes](../../README.md)
