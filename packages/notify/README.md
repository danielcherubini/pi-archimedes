# @pi-archimedes/notify

**Step away without losing track.**

Leave the terminal for a coffee. When the work has actually settled — or something needs your decision — notify tells you, once, after a short delay. Type anything and the pending alert is cancelled; there's no inactivity scrutiny, no focus tracking. Keystrokes are the only signal.

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

After installing Pi, choose one installation command above, then `cd` into your project and run `pi`. Inside the session, `/login` signs you in and `/model` picks a model — the [setup section](https://github.com/danielcherubini/pi-archimedes#setup) covers the first run. `/reload` picks the extension up in a running session.

## Triggers

- **Settled runs** — on Pi's `agent_settled` event: the run has fully settled (no automatic retry, compaction, or queued continuation still to fire), not merely "a turn ended".
- **Blocking prompts** — on `ui_prompt_start`: any extension prompt is waiting on you (a tabbed ask, a sudo password prompt, an MCP OAuth loader) — direct **or** subagent-relayed, since the event fires in the parent process.

The alert fires after a fixed `delayMs` (30 s by default) from the trigger. It is a delay, not an idle timer: nothing measures how long you've been reading. Any input in the terminal cancels pending alerts immediately, a new agent run cancels them, and a prompt that closes without you typing (say, the OAuth loader finishing from the browser) cancels its own timer — so a long-gone question can't ring.

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

← [Back to pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
