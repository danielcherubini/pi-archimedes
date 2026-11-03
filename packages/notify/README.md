# @pi-archimedes/notify

**Step away without losing track.**

Leave the terminal for a coffee. When the work has actually settled — or something needs your decision — notify tells you, once, after a short delay. Press a key and the pending alert is cancelled; there's no inactivity scrutiny, no focus tracking. Keystrokes are the only signal — a terminal answering Pi's own questions (colour palette, device attributes, cell size) is not one.

## Install

Standalone:

```bash
pi install npm:@pi-archimedes/notify
```

Or the full suite instead:

```bash
pi install npm:pi-archimedes
```

New to Pi? Pi itself is a one-time global install and needs Node.js ≥ 22.19.0:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

After installing Pi, choose one installation command above, then `cd` into your project and run `pi`. Inside the session, `/login` signs you in and `/model` picks a model — the [setup section](https://github.com/archimedes-codes/pi-archimedes#setup) covers the first run. `/reload` picks the extension up in a running session.

## Triggers

- **Settled runs** — on Pi's `agent_settled` event: the run has fully settled (no automatic retry, compaction, or queued continuation still to fire), not merely "a turn ended".
- **Blocking prompts** — on `ui_prompt_start`: any extension prompt is waiting on you (a tabbed ask, a sudo password or command-confirm prompt) — direct **or** subagent-relayed, since the event fires in the parent process.

The alert fires after a fixed `delayMs` (30 s by default) from the trigger. It is a delay, not an idle timer: nothing measures how long you've been reading. A keystroke in the terminal cancels a pending alert immediately — and only a keystroke: pi-tui's decoder decides, so protocol traffic that reaches the listener (a device-attributes reply, a cell-size report, focus and mouse sequences) cannot silently swallow an alert nobody dismissed. Anything you actually typed counts, including the characters the decoder has no name for — an accented key or an IME commit on a terminal that doesn't speak the Kitty keyboard protocol. A new agent run cancels pending alerts, whichever kind of run start it was, and a prompt that closes without you typing (say, a confirm dialog that times out and auto-declines) cancels its own timer — so a long-gone question can't ring.

## Terminal delivery

| Environment | Protocol | Notes |
|-------------|----------|-------|
| Windows Terminal | PowerShell toast | title + body |
| Kitty | OSC 99 | title + body |
| iTerm2 | OSC 9 | body only |
| tmux over any of the above | DCS passthrough wrap | alerts break through tmux |
| other terminals | OSC 777 | generic fallback |

Delivery depends on your terminal understanding one of these protocols; if it understands none, no alert will appear. Both triggers work standalone — the extension alone gets you the same behaviour.

## Settings

`~/.pi/agent/settings.json`, under `archimedes.notify` (strict JSON):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `notifyOnAgentEnd` | bool | `true` | Notify when a run has fully settled |
| `notifyOnQuestion` | bool | `true` | Notify when a blocking prompt needs input |
| `delayMs` | number | `30000` | Delay after the trigger before the alert fires |

In the suite the settings also appear in `/archimedes` (where the panel has a control), and on/off is managed by the suite: toggle via `/plugins` (`archimedes.notify.enabled`, default on).

← [Back to pi-archimedes](https://github.com/archimedes-codes/pi-archimedes)
