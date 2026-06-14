<div align="center">
  <img src="docs/splash-screen.png" width="600" alt="pi-archimedes splash (art originally from pi-ui-hephaestus)">

# pi-archimedes

*Visual polish and useful context for the Pi coding agent TUI — composable but complete*

[![npm version](https://img.shields.io/npm/v/pi-archimedes?style=flat-square)](https://www.npmjs.com/package/pi-archimedes)
[![TypeScript](https://img.shields.io/badge/TypeScript-%3E%3D5.0-blue?style=flat-square)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

</div>

## Why pi-archimedes?

You spend hours in this terminal. The agent is brilliant, but the default UI is functional, not friendly — abrupt startup, invisible context, plain-text diffs, and you never quite know where the cost is going.

pi-archimedes is the polish layer that makes the TUI feel like a real tool. Smooth splash on launch, a framed editor that won't quit on you by accident, syntax-highlighted diffs you can actually read, and a footer that always shows the things that matter — model, tokens, context, cost. It also ships two tools that change the daily workflow: a **subagent** that dispatches background tasks with live progress and a unified cost rollup, and a **`/agents` command** for managing your agent files without leaving the terminal.

Because it's a monorepo, you stay in control. Grab the full bundle with `pi install pi-archimedes` and the components share state — subagent costs flow into the footer, the agent manager reuses Core's chrome. Or install only what you actually want: `pi install @pi-archimedes/footer` if that's all you need today, and add the rest later.

## Features

### 🎬 Core (`@pi-archimedes/core`)

- Animated splash screen with configurable styles
- Framed editor with double-press quit guard
- Muted thinking blocks

### 📊 Footer (`@pi-archimedes/footer`)

- Compact status bar with directory, git branch (clean/dirty indicator), model, thinking level, worktree
- Token stats (↑input ↓output + cost)
- Color-coded context window bar

### 🔍 Diff (`@pi-archimedes/diff`)

- Shiki-powered split and unified views
- Word-level emphasis on changed characters
- Auto-derived theme colors
- Graceful fallback to plain text

### 🖼️ Image-paste (`@pi-archimedes/image-paste`)

- Paste images from clipboard (Ctrl+V on Linux, Alt+V on Windows) with inline preview

### 🤖 Subagent (`@pi-archimedes/subagent`)

- Dispatch sub-agents with live TUI streaming
- Parallel execution mode
- Per-subagent tool counts and token usage
- Unified cost summary

### 📝 Agents (`/agents` command, new in 0.9.0)

- Full CRUD TUI for `.pi/agents/*.md` files — searchable list, model picker, tool picker, dirty-tracking, cross-scope collision warnings
- *Note: available when installed via `pi-archimedes` (the meta package), not as a standalone `@pi-archimedes/subagent` install.*

> When installed via the meta package, the six components share state and cooperate. For example, `@pi-archimedes/subagent` emits cost events through `@pi-archimedes/core/bus`; the footer subscribes via `CostAccumulator` and merges subagent tokens and cost into the main status bar. The agent manager reuses Core's chrome and color palette. Install pieces individually and these integrations are unavailable.

## Quick Start

```bash
pi install pi-archimedes
```

That's it. Restart Pi and the components load automatically.

### Or install selectively

- `pi install @pi-archimedes/core`
- `pi install @pi-archimedes/footer`
- `pi install @pi-archimedes/diff`
- `pi install @pi-archimedes/image-paste`
- `pi install @pi-archimedes/subagent`

Run `/archimedes` to open the interactive settings panel and configure components.

## Settings

Run `/archimedes` to open the interactive settings panel. Navigate with arrow keys, press Enter to toggle or edit, Save to persist, ESC to cancel.

### Per-package configuration

Each package reads from its own namespace in `~/.pi/agent/settings.json`. For example, `@pi-archimedes/footer` reads from `archimedes.footer`.

### @pi-archimedes/core

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `mutedTheme` | bool | `false` | Use subdued colors for thinking blocks |
| `codeUnindent` | bool | `true` | Remove common indentation from code blocks inside thinking sections |
| `labelText` | string | `Thinking...` | Custom prefix shown before thinking blocks |
| `labelColor` | string | `255,215,0` | RGB color for the thinking label |
| `animationStyle` | string | `vertical-up` | Splash animation style (9 options) |

### @pi-archimedes/footer

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `splitThreshold` | number | `150` | Minimum terminal columns for full footer (below this, simplified layout) |

### @pi-archimedes/diff

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `diffTheme` | string | `github-dark` | Shiki syntax-highlighting theme |
| `diffSplitMinWidth` | number | `150` | Minimum terminal columns to show split diff view (≥ 100) |
| `diffSplitMinCodeWidth` | number | `60` | Minimum code columns per side in split view (≥ 30) |

### @pi-archimedes/image-paste

Uses Pi's core `terminal.showImages` setting to control inline previews. No package-specific settings.

### @pi-archimedes/subagent

TBD — no settings yet. Tool/cost events flow through `@pi-archimedes/core/bus` for the footer to consume.

## Architecture

### Monorepo layout

```
pi-archimedes/
├── packages/
│   ├── core/         # @pi-archimedes/core — editor, message, startup, thinking
│   ├── footer/       # @pi-archimedes/footer — status bar
│   ├── diff/         # @pi-archimedes/diff — Shiki-powered diff rendering
│   ├── image-paste/  # @pi-archimedes/image-paste — clipboard images
│   └── subagent/     # @pi-archimedes/subagent — sub-agent dispatch
└── meta/             # pi-archimedes — meta-package bundling all five
```

Each package is a focused TypeScript ESM module with its own `src/index.ts` entry point.

See [AGENTS.md](AGENTS.md) for import conventions, config namespaces, and contribution workflow.

### Requirements

- Pi TUI with extension support
- Node.js >= 24
