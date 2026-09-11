# @pi-archimedes/session-name

**Find the session you meant.**

Timestamps and raw hash names don't tell you what a session was *for*. Session-name gives every session a short, descriptive name based on your first exchange, so `pi -r` stops being a guessing game.

## Install

Standalone:

```bash
pi install npm:@pi-archimedes/session-name
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

## How it works

- After the first user + assistant exchange settles, it takes the first exchange (500 characters per side), asks a model to write a 3–8-word title, caps it at 80 characters, and sets the session name — with a final re-check so a name you set yourself can never be overwritten.
- **Manual names win.** If you named the session (`--name` or `/name`), naming is skipped, and it re-checks before writing.
- **It uses your current model unless you configure another.** The title is a separate model call outside the main run — with its own cost, **not reflected in the footer's totals**. A `model` setting (e.g. a cheap model) avoids spending your main model on titles.
- **Skips and retries** — Ephemeral sessions (no session file) are skipped; if the model has no configured auth, the call is skipped. Transient failures print to the console and re-try on later `agent_end` events, giving up for the session after three. It is non-blocking and unobtrusive, but "silent" is too strong: failures are logged.

## Settings

`~/.pi/agent/settings.json`, under `archimedes.sessionName` (strict JSON):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `model` | string | _(current model)_ | Model used for title generation (e.g. `openai/gpt-4o-mini`). Canonical `provider/id`, bare IDs, and thinking-suffix forms are all resolved. Empty = current model. |

On/off is managed by the suite: toggle via `/plugins` (`archimedes.sessionName.enabled`, default on).

← [Back to pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
