# @pi-archimedes/core

**A terminal worth spending your day in — plus the plumbing that keeps the rest of the suite talking.**

Core is the face of every session: the animated splash screen on launch, the framed editor where you type, the border spinner that works while the agent works, and clean, labelled thinking blocks. Under the surface it runs the shared event bus through which the other components pass costs, todos, and questions — and the text, colour, and settings utilities they all build on.

## Install

Standalone:

```bash
pi install npm:@pi-archimedes/core
```

Or the full suite instead (which includes core and the ten optional components):

```bash
pi install npm:pi-archimedes
```

New to Pi? Pi itself is a one-time global install and needs Node.js ≥ 22.19.0:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

After installing Pi, choose one installation command above, then `cd` into your project and run `pi`. Inside the session, `/login` signs you into a supported provider and `/model` picks a model; the full walkthrough, including API-key setup, is in the repo's [setup section](https://github.com/danielcherubini/pi-archimedes#setup) and Pi's own [quickstart](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/quickstart.md). A session that's already running picks up the extension with `/reload`.

## What you get

- **Splash screen** — an animated greeting when the session launches, in one of nine reveal styles (`diagonal`, `top-right`, `bottom-left`, `bottom-right`, `center-out`, `wave`, `horizontal`, `vertical`, `vertical-up`).
- **Framed editor** — your input in a clean bordered frame, with a double-press quit guard (`Ctrl+C` twice) so a stray keystroke doesn't end the session.
- **Working spinner on the border** — one of ten animating styles (`pendulum`, `typing`, `pulse`, `marquee`, `wave-rows`, `columns`, `cascade`, `diagonal-swipe`, `rain`, `sparkle`) traces the editor frame while the agent works, replacing Pi's native "Working" line.
- **Thinking blocks** — chain-of-thought output gets a consistent label, colour, and layout; `codeUnindent` strips the common indentation so code in reasoning reads flush.
- **The bus** (`@pi-archimedes/core/bus`) — a global pub/sub event system: `COST_UPDATE`, `ASK_REQUEST`, `TODOS_UPDATE`, `TODOS_CLEAR`… subagent costs flow to the footer through it, subagent todos to the task board, subagent questions to the ask UI.
- **Shared utilities** — text truncation and width measurement, colour formatting, settings I/O, and startup profiling.

## Settings

Settings live in `~/.pi/agent/settings.json` under `archimedes.core`. The file is **strict JSON — no comments or trailing commas** (unlike the MCP server config files, which accept both).

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `editorSpinBorder` | bool | `true` | Show the animated border spinner while the agent works |
| `editorSpinStyle` | string | `pendulum` | One of the ten spinner styles |
| `editorSpinSpeed` | string | `normal` | `slow`, `normal`, or `fast` |
| `editorSpinLabel` | string | `Working` | Label shown alongside the border spinner |
| `animationStyle` | string | `vertical-up` | Splash-screen reveal style (the nine styles above) |
| `labelText` | string | `Thinking...` | Prefix before thinking blocks |
| `labelColor` | string | `255,215,0` | RGB string for the thinking label |
| `codeUnindent` | bool | `true` | Strip common indentation from code blocks in thinking sections |
| `mutedTheme` | bool | `false` | Stored, but **not yet effective** — the current thinking renderer doesn't consult it, so treat it as a pending toggle |

In the suite, `/archimedes` offers panel controls for the settings that have them; `/reload` applies any that are read at startup.

## Part of the suite

In [pi-archimedes](https://github.com/danielcherubini/pi-archimedes), core is always registered — it isn't one of the `/plugins` toggles — and it underpins what the other components share: the bus that feeds subagent costs to the footer, subagent todos to the task board, and subagent questions to the ask UI, plus the chrome and colour utilities the TUIs use. The diff renderer is standalone and does not depend on core's chrome — it only shares the suite when it loads.

← [Back to pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
