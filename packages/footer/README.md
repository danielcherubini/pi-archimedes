# @pi-archimedes/footer

A status bar that shows what matters — at a glance, without getting in the way.

Your terminal is already full of information. The footer gives you exactly what you need to know about your session — where you are, what model you're using, how many tokens you've burned, and how close you are to the context limit — laid out at the bottom of the terminal, adapting to its width without ever clipping. When subagents run, their costs merge seamlessly into the same view.

## What you get

- **Session context at a glance** — directory, git branch (with clean/dirty indicator), worktree (when inside a linked one), active model, thinking level
- **Token stats** — input ↑, output ↓, cache read/write, and real-dollar cost, all in one compact display
- **Context window bar** — color-coded progress bar (green → yellow → red) showing how much of your context window is used
- **Adaptive layout** — everything on one line when it fits; otherwise it wraps to additional lines (two or three) instead of clipping. Width at which it switches is configurable
- **Unified subagent costs** — when subagents run, their token usage and cost merge into the main footer automatically

## Install

```bash
pi install npm:@pi-archimedes/footer
```

Or install full meta package:

```bash
pi install npm:pi-archimedes
```

## Usage

Footer renders automatically at the bottom of the Pi TUI. No commands to run.

On wide terminals, the footer displays as one compact line with all session context, token usage, cost, and a context window progress bar that fills the remaining space. When that no longer fits on one line, the footer wraps — usage moves to a second line, and sections themselves overflow to a third line if the terminal is truly narrow — so nothing ever gets clipped. Below the configured split threshold, it always uses at least the two-line layout (system info above, stats below).

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `splitThreshold` | number | `150` | Minimum terminal width (columns) where a single-line footer is still allowed. Below it, the footer always uses at least the two-line layout; above it, it stays on one line as long as the content fits and wraps otherwise — never clipping. |

Settings are stored in `~/.pi/agent/settings.json` under the `archimedes.footer` namespace.

## Integration

When installed via meta package, footer consumes cost events from subagents through the core bus, giving a unified token/cost view. Standalone install shows only the main agent's stats.


← Back to [pi-archimedes](../../README.md)
