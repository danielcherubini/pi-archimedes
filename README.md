<div align="center">
  <img src="docs/images/splash-screen.png" width="600" alt="pi-archimedes splash (art originally from pi-ui-hephaestus)">

# pi-archimedes

*A small, cohesive set of extensions for the Pi coding agent — built to be lived in*

[![npm version](https://img.shields.io/npm/v/pi-archimedes?style=flat-square)](https://www.npmjs.com/package/pi-archimedes)
[![TypeScript](https://img.shields.io/badge/TypeScript-%3E%3D5.0-blue?style=flat-square)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

</div>

## Why pi-archimedes?

Pi's extension ecosystem is powerful, but extensions don't talk to each other. Install one and it has no idea another exists.

pi-archimedes is a set of extensions that actually cooperate. Subagent costs flow into the footer. Subagent todos appear alongside yours. When a subagent needs to ask you a question, the prompt surfaces in your TUI and the answer routes back. The diff renderer matches your theme. The splash screen sets the tone.

Everything shares a single point of view: minimal, but designed. Install once, stop thinking about it.

Want only one piece? Each package works standalone. Want only the footer? `pi install npm:@pi-archimedes/footer`. Only the diff renderer? `pi install npm:@pi-archimedes/diff`. Mix and match.

→ [Open an issue](https://github.com/danielcherubini/pi-archimedes/issues) · [Start a discussion](https://github.com/danielcherubini/pi-archimedes/discussions)

## Features

**When installed via the meta package, the nine components share state and cooperate.** For example, `@pi-archimedes/subagent` emits cost events through `@pi-archimedes/core/bus`; the footer picks them up via `CostAccumulator` and merges subagent tokens and cost into the main status bar. The agent manager reuses Core's chrome and color palette. Install pieces individually and these integrations disappear.

### 🎬 Core ([`@pi-archimedes/core`](packages/core/README.md))

The visual chrome you see on every Pi session.

- Animated splash screen with configurable styles
- Framed editor with double-press quit guard
- Muted thinking blocks

### 📊 Footer ([`@pi-archimedes/footer`](packages/footer/README.md))

A status bar that surfaces what matters without getting in the way.

- Directory, git branch (with clean/dirty indicator), model, thinking level, worktree
- Token stats (↑input ↓output + cost)
- Color-coded context window bar

### 🔍 Diff ([`@pi-archimedes/diff`](packages/diff/README.md))

Syntax-highlighted diffs that read at a glance.

- Shiki-powered split and unified views
- Word-level emphasis on changed characters
- Auto-derived theme colors
- Graceful fallback to plain text

![diff edit](docs/images/diff-edit.png)

### 🖼️ Image-paste ([`@pi-archimedes/image-paste`](packages/image-paste/README.md))

Paste screenshots straight into the chat.

- Paste images from clipboard (Ctrl+V on Linux, Alt+V on Windows) with inline preview

> **⚠️ Shortcut conflict:** On Linux, `ctrl+v` is also Pi's built-in shortcut for `app.clipboard.pasteImage`. To resolve the conflict, clear the built-in binding in `~/.pi/agent/keybindings.json`:
> ```json
> { "app.clipboard.pasteImage": [] }
> ```
> This lets archimedes' handler (which adds inline previews) take over without the warning.

### 🤖 Subagent ([`@pi-archimedes/subagent`](packages/subagent/README.md))

Dispatch work to other agents and watch them work in real time.

- Sub-agent dispatch with live TUI streaming
- Parallel execution mode
- Per-subagent tool counts and token usage
- Unified cost summary
- Color-coded tool calls — grey while running, green/red on completion
- Readable argument previews (no raw JSON)

![subagents main view](docs/images/subagents-main-view.png)

#### `/agents` command

Full CRUD TUI for `.pi/agents/*.md` files — searchable list, model picker, tool picker, dirty-tracking, cross-scope collision warnings.

*Available when installed via `pi-archimedes` (the meta package), not as a standalone `@pi-archimedes/subagent` install.*

### 📋 Todo ([`@pi-archimedes/todo`](packages/todo/README.md))

Track work without leaving the session — including what your subagents are doing.

- `manage_todo_list` tool with read/write operations
- Auto-clear when all todos are completed
- Multi-column widget — main agent + per-subagent todos side by side
- `/todos` and `/todos clear` commands

![todos and subagent](docs/images/todos-and-subagent.png)

### 💬 Ask ([`@pi-archimedes/ask`](packages/ask/README.md))

Ask structured questions and let the agent act on the answer — from the main agent **or** from inside a subagent.

Most question tools only work when the main agent calls them. Ask works everywhere: call it directly and you get the full interactive prompt; spawn a subagent that needs a decision, and its `ask` call surfaces in your TUI — the subagent blocks until you answer, then carries on with your choice. No temp files, no pipes — just a bidirectional IPC channel that feels instant.

**From the main agent:**
- Tabbed multi-question flow with submit review
- Single-question picker with instant submit
- Inline note editing per option
- Markdown context descriptions
- Multi-select support
- Automatic "Other (type your own)" handling

**From a subagent:**
- The same rich UI appears in the parent TUI, even mid-stream
- The subagent blocks on the call and receives your answer over IPC
- Works alongside live subagent streaming and cost tracking

![ask from a subagent](docs/images/ask-subagent.png)

### 🔔 Notify ([`@pi-archimedes/notify`](packages/notify/README.md))

Desktop notifications when you've stepped away — with a circuit breaker that cancels if you interact.

- Delayed notification on task complete or unanswered questions
- Terminal-aware dispatch: Ghostty, WezTerm, iTerm2, Kitty, Windows Terminal
- tmux passthrough for all OSC sequences
- Configurable delay and per-trigger toggles

### 🏷️ Session-name ([`@pi-archimedes/session-name`](packages/session-name/README.md))

Automatic session titles generated by AI after the first exchange in each session.

- Generates concise 3-8 word titles from the first user/assistant exchange
- Smart model resolution with provider/id, bare id, and thinking-suffix tolerance
- Respects manual names set via `--name` or `/name`
- Skips ephemeral sessions and handles errors silently

## Quick Start

```bash
pi install npm:pi-archimedes
```

That's it. Reload Pi and you're set.

### Or install selectively

- `pi install npm:@pi-archimedes/core`
- `pi install npm:@pi-archimedes/footer`
- `pi install npm:@pi-archimedes/diff`
- `pi install npm:@pi-archimedes/image-paste`
- `pi install npm:@pi-archimedes/subagent`
- `pi install npm:@pi-archimedes/todo`
- `pi install npm:@pi-archimedes/ask`
- `pi install npm:@pi-archimedes/notify`
- `pi install npm:@pi-archimedes/session-name`

## Settings

Run `/archimedes` to open the interactive settings panel. Navigate with arrow keys, press Enter to toggle or edit, Save to persist, ESC to cancel.

Each package reads from its own namespace in `~/.pi/agent/settings.json` — for example, `@pi-archimedes/footer` reads from `archimedes.footer`.

### [`@pi-archimedes/core`](packages/core/README.md)

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `mutedTheme` | bool | `false` | Use subdued colors for thinking blocks |
| `codeUnindent` | bool | `true` | Remove common indentation from code blocks inside thinking sections |
| `labelText` | string | `Thinking...` | Custom prefix shown before thinking blocks |
| `labelColor` | string | `255,215,0` | RGB color for the thinking label |
| `animationStyle` | string | `vertical-up` | Splash animation style (9 options) |

### [`@pi-archimedes/footer`](packages/footer/README.md)

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `splitThreshold` | number | `150` | Minimum terminal columns for full footer (below this, simplified layout) |

### [`@pi-archimedes/diff`](packages/diff/README.md)

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `diffTheme` | string | `github-dark` | Shiki syntax-highlighting theme |
| `diffSplitMinWidth` | number | `150` | Minimum terminal columns to show split diff view (≥ 100) |
| `diffSplitMinCodeWidth` | number | `60` | Minimum code columns per side in split view (≥ 30) |

### [`@pi-archimedes/image-paste`](packages/image-paste/README.md)

Uses Pi's core `terminal.showImages` setting to control inline previews. No package-specific settings.

### [`@pi-archimedes/subagent`](packages/subagent/README.md)

No settings yet. Tool/cost events flow through `@pi-archimedes/core/bus` for the footer to consume.

### [`@pi-archimedes/ask`](packages/ask/README.md)

No settings yet.

### [`@pi-archimedes/notify`](packages/notify/README.md)

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabled` | bool | `true` | Enable desktop notifications |
| `notifyOnAgentEnd` | bool | `true` | Notify when agent finishes a task |
| `notifyOnQuestion` | bool | `true` | Notify when a question needs your answer |
| `delayMs` | number | `30000` | Milliseconds to wait before sending notification (default 30 seconds) |

### [`@pi-archimedes/session-name`](packages/session-name/README.md)

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabled` | bool | `true` | Enable automatic session naming |
| `model` | string | _(current model)_ | Override model for title generation |

## Architecture

### Monorepo layout

```
pi-archimedes/
├── packages/
│   ├── core/         # @pi-archimedes/core — editor, message, startup, thinking
│   ├── ask/          # @pi-archimedes/ask — structured question tool
│   ├── footer/       # @pi-archimedes/footer — status bar
│   ├── diff/         # @pi-archimedes/diff — Shiki-powered diff rendering
│   ├── image-paste/  # @pi-archimedes/image-paste — clipboard images
│   ├── subagent/     # @pi-archimedes/subagent — sub-agent dispatch
│   ├── todo/         # @pi-archimedes/todo — todo list with auto-clear
│   ├── notify/       # @pi-archimedes/notify — delayed desktop notifications
│   └── session-name/ # @pi-archimedes/session-name — auto session naming
└── meta/             # pi-archimedes — meta-package bundling all nine
```

Each package is a focused TypeScript ESM module with its own `src/index.ts` entry point.

See [AGENTS.md](AGENTS.md) for import conventions, config namespaces, and contribution workflow.

### Requirements

- Pi TUI with extension support
- Node.js >= 24
- pnpm >= 10 (for development — `npm install` is not supported; `packageManager` field pins pnpm via Corepack)

## Development

This is a pnpm workspace. To work on the source:

```bash
git clone https://github.com/danielcherubini/pi-archimedes
cd pi-archimedes
pnpm install
pnpm -r exec -- tsc --noEmit   # type-check all packages
```

Symlink into your Pi extensions to test:

```bash
ln -s $(pwd) ~/.pi/agent/extensions/pi-archimedes
```

Root `package.json` declares `"extensions": ["meta/src/index.ts"]` — Pi loads it from the symlink.

See [AGENTS.md](AGENTS.md) for import conventions, config namespaces, and the release workflow.
