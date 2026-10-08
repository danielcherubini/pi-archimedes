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

- **After the first user + assistant exchange settles**, it takes that exchange (500 characters per side), asks a model to write a 3–8-word title, caps it at 80 characters, and sets the session name — with a final re-check so a name you set yourself can never be overwritten.
- **Manual names win.** If you named the session (`--name` or `/name`), naming is skipped, and it re-checks before writing.
- **It uses your current model unless you configure another.** The title is a separate model call outside the main run — with its own cost, **not reflected in the footer's totals**. A `model` setting (e.g. a cheap model) avoids spending your main model on titles.
- **No thinking level is requested by default.** Some providers reject `reasoning_effort` values outright (a 400 on the title call), so the request omits it and lets the provider decide. Set `reasoning` only if you want thinking spent on a title; a level the model declares unsupported is dropped rather than sent.
- **Failures say so.** The first failure shows a warning with the provider's reason, and when the retry budget runs out you get one more warning telling you naming has given up for the session — no more per-attempt spam. A context torn down mid-request (`pi -p` teardown, `/reload`) is treated as a non-event and costs you no retries.
- **Skips** — Ephemeral sessions (no session file) are skipped, and so is a model with no configured auth; neither counts against the retry budget.

## Settings

`~/.pi/agent/settings.json`, under `archimedes.sessionName` (strict JSON):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `model` | string | _(current model)_ | Model used for title generation (e.g. `openai/gpt-4o-mini`). Canonical `provider/id`, bare IDs, and thinking-suffix forms are all resolved. Empty = current model. |
| `reasoning` | string | _(none)_ | Thinking level for the title request (`minimal`, `low`, `medium`, `high`, `xhigh`, `max`). Unset asks for no reasoning, which is the safe default — providers that reject effort values (e.g. opencode-go answers 400 for `minimal`) work untouched. A level the model marks unsupported is dropped instead of sent. `"off"` means the same as unset. |

On/off is managed by the suite: toggle via `/plugins` (`archimedes.sessionName.enabled`, default on). Both settings have a row in `/archimedes`.

← [Back to pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
