<div align="center">
  <img src="docs/images/splash-screen.png" width="600" alt="pi-archimedes splash (art originally from pi-ui-hephaestus)">

# pi-archimedes

*A small, cohesive set of extensions for the Pi coding agent — built to be lived in*

[![npm version](https://img.shields.io/npm/v/pi-archimedes?style=flat-square)](https://www.npmjs.com/package/pi-archimedes)
[![TypeScript](https://img.shields.io/badge/TypeScript-%3E%3D5.0-blue?style=flat-square)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

</div>

## Why pi-archimedes?

Pi's plugin ecosystem is great, and none of this is a criticism of the people who built pieces of it. But there's a gap: on Pi, plugins don't talk to each other. Install one and it has no idea another exists. That was the problem that started this.

I was using the subagent plugin and wanted one thing — the cost of a subagent to show in my footer, tracked across the whole session. To get that I had to build both the footer and the subagent, and a bus for them to share. Once they were connected, the rest followed: subagent todos that flow back into the main agent. And the hardest one — a subagent asking the user a question, and the parent hearing the answer and routing it back. All of that is solved now.

So pi-archimedes is the set of extensions that actually cooperate — and because I was building them together, I also gave them a single point of view: minimal, but designed. Matching chrome, a footer that says what matters, diffs that fit the theme. Install once, stop thinking about it.

It's also a door. Want only the footer? `pi install @pi-archimedes/footer`. Only the diff renderer? `pi install @pi-archimedes/diff`. Mix and match.

This is the only Pi package I run. If you took it apart and put it back together differently, that'd be exactly what I want.

→ [Open an issue](https://github.com/danielcherubini/pi-archimedes/issues) · [Start a discussion](https://github.com/danielcherubini/pi-archimedes/discussions)

## Features

**When installed via the meta package, the seven components share state and cooperate.** For example, `@pi-archimedes/subagent` emits cost events through `@pi-archimedes/core/bus`; the footer picks them up via `CostAccumulator` and merges subagent tokens and cost into the main status bar. The agent manager reuses Core's chrome and color palette. Install pieces individually and these integrations disappear.

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

### 🤖 Subagent ([`@pi-archimedes/subagent`](packages/subagent/README.md))

Dispatch work to other agents and watch them work in real time.

- Sub-agent dispatch with live TUI streaming
- Parallel execution mode
- Per-subagent tool counts and token usage
- Unified cost summary

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

## Quick Start

```bash
pi install pi-archimedes
```

That's it. Reload Pi and you're set.

### Or install selectively

- `pi install @pi-archimedes/core`
- `pi install @pi-archimedes/footer`
- `pi install @pi-archimedes/diff`
- `pi install @pi-archimedes/image-paste`
- `pi install @pi-archimedes/subagent`
- `pi install @pi-archimedes/todo`
- `pi install @pi-archimedes/ask`

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
│   └── todo/         # @pi-archimedes/todo — todo list with auto-clear
└── meta/             # pi-archimedes — meta-package bundling all seven
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
