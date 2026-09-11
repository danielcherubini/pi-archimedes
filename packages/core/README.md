# @pi-archimedes/core

**Visual foundation, working spinners, framed editor, and reactive event bus for the [Pi coding agent](https://github.com/earendil-works/pi).**

Core provides the visual polish you see on every session and the invisible infrastructure powering the entire Archimedes ecosystem. It transforms Pi's default prompt into a framed terminal editor with animated border spinners while the agent works, styles chain-of-thought blocks, and provides the shared reactive bus that lets extensions communicate.

## Quick Start

### 1. Install Pi (if needed)

```bash
npm install -g @earendil-works/pi-coding-agent
```

### 2. Install

Install standalone:

```bash
pi install npm:@pi-archimedes/core
```

Or install the complete [pi-archimedes](https://github.com/danielcherubini/pi-archimedes) development cockpit:

```bash
pi install npm:pi-archimedes
```

---

## What You Get

- **Framed Editor** — Clean bordered input box with double-press quit guard (`Ctrl+C` twice to exit).
- **Editor Border Spinner** — 10 gallery-derived animations (pendulum, typing, pulse, marquee, wave-rows, columns, cascade, diagonal-swipe, rain, sparkle) that trace the editor border while the agent works, replacing Pi's native "Working" line.
- **Animated Splash Screen** — 9 configurable reveal animations that greet you on session launch.
- **Styled Thinking Blocks** — Clean formatting for chain-of-thought reasoning with custom labels, colors, and muted theme support.
- **Reactive Event Bus (`@pi-archimedes/core/bus`)** — High-performance pub/sub event bus that enables cross-extension cooperation (e.g. subagent costs routing to the footer, subagent questions routing to the ask UI).
- **Shared Utilities** — Text truncation, width calculation, color formatting, settings I/O, and startup profiling.

---

## Settings

Settings are stored in `~/.pi/agent/settings.json` under the `archimedes.core` namespace (or configured interactively via `/archimedes` when using the full suite):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `editorSpinBorder` | bool | `true` | Show animated border spinner on the editor while the agent works |
| `editorSpinStyle` | string | `pendulum` | Spinner animation style (`pendulum`, `typing`, `pulse`, `marquee`, `wave-rows`, `columns`, `cascade`, `diagonal-swipe`, `rain`, `sparkle`) |
| `editorSpinSpeed` | string | `normal` | Border spinner speed (`slow`, `normal`, `fast`) |
| `editorSpinLabel` | string | `Working` | Text label displayed alongside the border spinner |
| `animationStyle` | string | `vertical-up` | Splash screen reveal style (9 animation variants) |
| `mutedTheme` | bool | `false` | Subdue thinking block colors |
| `codeUnindent` | bool | `true` | Strip common indentation from code blocks in thinking sections |
| `labelText` | string | `Thinking...` | Prefix displayed before thinking blocks |
| `labelColor` | string | `255,215,0` | RGB color string for the thinking label |

---

## Part of the Archimedes Suite

`@pi-archimedes/core` is included automatically in the [pi-archimedes](https://github.com/danielcherubini/pi-archimedes) meta package, where it serves as the backbone for the status footer, subagent swarms, question IPC, and todo tracking.

← Back to [pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
