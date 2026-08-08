# @pi-archimedes/core

The visual foundation and shared infrastructure for pi-archimedes.

Core is what you see first — the animated splash screen, the framed editor, and styled thinking blocks. It is also the invisible glue: an event bus that lets packages talk to each other, shared text and color utilities, and a settings system. Install it standalone for polished chrome, or let the meta package include it automatically.

## What you get

- **Animated splash screen** — configurable reveal animations (9 styles) that set the tone when Pi starts
- **Framed editor** — custom editor component with double-press quit guard
- **Styled thinking blocks** — configurable label text, color, and muted theme option; optional code block unindenting
- **Event bus** — shared pub/sub channel that lets packages communicate (subagent costs → footer, subagent questions → ask, etc.)
- **Shared utilities** — text truncation/width calculation, color helpers, config loading, settings I/O, and startup profiling

## Install

```bash
pi install npm:@pi-archimedes/core
```

Or install the full [pi-archimedes](../../README.md) meta package:

```bash
pi install npm:pi-archimedes
```

## Usage

Core works automatically when Pi starts. It sets the session header, editor frame, and thinking block renderer automatically. There are no manual commands or tools to call.

For configuration:
- When using the meta package, run `/archimedes` to access the settings panel.
- For standalone installs, edit `archimedes.core` in `~/.pi/agent/settings.json`.

## Settings

Core reads configuration from the `archimedes.core` namespace in `~/.pi/agent/settings.json`.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `mutedTheme` | bool | `false` | Use subdued colors for thinking blocks |
| `codeUnindent` | bool | `true` | Remove common indentation from code blocks inside thinking sections |
| `labelText` | string | `Thinking...` | Custom prefix shown before thinking blocks |
| `labelColor` | string | `255,215,0` | RGB color for the thinking label |
| `animationStyle` | string | `vertical-up` | Splash animation style (9 options) |

## Integration

Core is auto-included by the `pi-archimedes` meta package. All other archimedes packages depend on `@pi-archimedes/core` for the event bus, chrome elements, and utilities. Standalone installation provides the visual chrome and bus without the other archimedes features.

← Back to [pi-archimedes](../../README.md)
