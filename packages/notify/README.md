# @pi-archimedes/notify

**Delayed desktop notifications with keystroke circuit breaker for the [Pi coding agent](https://github.com/earendil-works/pi).**

Long-running agent workflows invite you to switch to your browser or other workspaces. `@pi-archimedes/notify` alerts you when Pi finishes a task or requires your input — without constant popup spam. Notifications only fire after an inactivity threshold, and touching any key immediately disarms pending alerts.

## Quick Start

### 1. Install Pi (if needed)

```bash
npm install -g @earendil-works/pi-coding-agent
```

### 2. Install

Install standalone:

```bash
pi install npm:@pi-archimedes/notify
```

Or install the complete [pi-archimedes](https://github.com/danielcherubini/pi-archimedes) development cockpit:

```bash
pi install npm:pi-archimedes
```

---

## What You Get

- **Delayed Inactivity Dispatch** — Alerts only trigger after you've been inactive for a configurable delay (default 30 seconds), preventing spam while you're actively reading terminal output.
- **Keystroke Circuit Breaker** — Any keypress in the terminal immediately aborts pending notification timers via raw terminal input listening.
- **Terminal-Aware Protocols** — Automatically chooses the cleanest protocol for your environment (OSC 99, OSC 9, OSC 777, or native PowerShell toasts).
- **tmux Passthrough** — All escape sequences are wrapped via DCS sequences to ensure alerts break through tmux sessions reliably.
- **Lifecycle Integration** — Triggers on Pi's `agent_settled` event and whenever any blocking UI prompt opens (such as `ask`, `sudo`, or MCP OAuth).

---

## Settings

Settings are stored in `~/.pi/agent/settings.json` under the `archimedes.notify` namespace (or configured interactively via `/archimedes`):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `notifyOnAgentEnd` | bool | `true` | Notify when the agent completes execution |
| `notifyOnQuestion` | bool | `true` | Notify when an extension prompt needs your input |
| `delayMs` | number | `30000` | Inactivity delay in milliseconds before alerting |

---

## Part of the Archimedes Suite

When installed as part of [pi-archimedes](https://github.com/danielcherubini/pi-archimedes), `@pi-archimedes/notify` integrates across all extensions, alerting you whenever `@pi-archimedes/ask`, `@pi-archimedes/sudo`, or `@pi-archimedes/mcp` need your attention.

← Back to [pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
