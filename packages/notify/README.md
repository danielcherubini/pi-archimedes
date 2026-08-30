# @pi-archimedes/notify

Delayed desktop notifications with circuit breaker for the [Pi coding agent](https://github.com/earendil-works/pi).

Get notified when Pi finishes long tasks or needs an answer, without constant popup spam thanks to delayed firing and raw keypress circuit breaking. You can safely switch windows while long-running jobs execute, knowing a desktop alert will trigger only if you aren't already actively typing in the terminal.

## What you get

- **Delayed notification** — fires only after a configurable period of inactivity (default 30s), so you're not spammed when actively working
- **Circuit breaker** — any keystroke immediately cancels a pending notification via raw terminal input listening
- **Terminal-aware dispatch** — auto-detects your terminal and uses the optimal protocol (OSC 99, OSC 9, OSC 777, or PowerShell toasts)
- **tmux passthrough** — all sequences wrapped via DCS for correct rendering inside tmux
- **Per-trigger toggles** — independently enable/disable notifications for task completion and unanswered questions
- **Pi-native triggers** — keyed on pi's `agent_settled` and `ui_prompt_start` lifecycle events, so task completion works and *any* blocking extension prompt (ask, sudo, mcp OAuth) can hold your attention

## Install

```bash
pi install npm:@pi-archimedes/notify
```

Or install full meta package:

```bash
pi install npm:pi-archimedes
```

## Usage

When the agent's run has settled (`agent_settled`) or an extension opens a blocking prompt (`ui_prompt_start` — ask, sudo, mcp OAuth), a timer starts. If you don't interact for the configured delay, a desktop notification fires. Any keystroke — even just pressing a key without submitting — cancels the timer immediately.

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `notifyOnAgentEnd` | bool | `true` | Notify when agent finishes a task |
| `notifyOnQuestion` | bool | `true` | Notify when a question needs your answer |
| `delayMs` | number | `30000` | Milliseconds to wait before sending notification (default 30 seconds) |

On/off is managed by the suite: toggle via `/plugins` (`archimedes.notify.enabled`, default on).

Settings are stored in `~/.pi/agent/settings.json` under the `archimedes.notify` namespace.

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

When installed via `pi-archimedes` (the meta package), the notify package is automatically registered and its settings appear in the `/archimedes` settings panel. Standalone installs work independently — any blocking extension UI prompt will trigger the question notification.

← Back to [pi-archimedes](../../README.md)
