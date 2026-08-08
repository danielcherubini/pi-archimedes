# @pi-archimedes/notify

Delayed desktop notifications with circuit breaker for the [Pi coding agent](https://github.com/earendil-works/pi).

## Features

- **Delayed notification** — fires only after a configurable period of inactivity (default 30s), so you're not spammed when actively working
- **Circuit breaker** — any keystroke immediately cancels a pending notification via raw terminal input listening
- **Terminal-aware dispatch** — auto-detects your terminal and uses the optimal protocol:
  - Kitty → OSC 99 (two-sequence title + body)
  - iTerm2 → OSC 9
  - Windows Terminal → PowerShell toast (ToastText02)
  - Ghostty, WezTerm, others → OSC 777 fallback
- **tmux passthrough** — all sequences wrapped via DCS for correct rendering inside tmux
- **Per-trigger toggles** — independently enable/disable notifications for task completion and unanswered questions
- **Bus-driven** — listens for `agent_end` and `ASK_REQUEST` bus events, so it works with any package that emits them

## Installation

```bash
pi install npm:@pi-archimedes/notify
```

Or install the full [pi-archimedes](../..) meta package for the integrated experience:

```bash
pi install npm:pi-archimedes
```

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabled` | bool | `true` | Enable desktop notifications |
| `notifyOnAgentEnd` | bool | `true` | Notify when agent finishes a task |
| `notifyOnQuestion` | bool | `true` | Notify when a question needs your answer |
| `delayMs` | number | `30` | Seconds to wait before sending notification (stored as ms) |

Settings are stored in `~/.pi/agent/settings.json` under the `archimedes.notify` namespace.

## How it works

When the agent finishes a task (`agent_end`) or a question is asked (`ASK_REQUEST`), a timer starts. If you don't interact for the configured delay, a desktop notification fires. Any keystroke — even just pressing a key without submitting — cancels the timer immediately.

## Terminal compatibility

| Terminal | Protocol | Title + Body |
|----------|----------|--------------|
| Kitty | OSC 99 | ✅ |
| iTerm2 | OSC 9 | Body only |
| Windows Terminal | PowerShell toast | ✅ |
| Ghostty | OSC 777 | ✅ |
| WezTerm | OSC 777 | ✅ |
| tmux (any above) | DCS passthrough | ✅ |

## Integration

When installed via `pi-archimedes` (the meta package), the notify package is automatically registered and its settings appear in the `/archimedes` settings panel. Standalone installs work independently — any package emitting `agent_end` or `ASK_REQUEST` bus events will trigger notifications.
