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
- **Failures tell you.** A failed title request is retried on a later turn, and the provider's error is logged as `[archimedes] session-name failed: <provider error>`. After three failures in one session it stops trying and shows a single warning: *Session naming failed 3 times. Check the model configuration or use /name.* The warning is skipped when there's no UI to show it in (`pi -p`) or if you named the session in the meantime. Cancelling a request doesn't count as a failure, and neither does a session that's replaced or torn down while a title is in flight.
- **Skips** — Ephemeral sessions (no session file) are skipped, and so is a model with no configured auth. Neither counts against the three attempts.

## Settings

`~/.pi/agent/settings.json`, under `archimedes.sessionName` (strict JSON):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `model` | string | _(current model)_ | Model used for title generation (e.g. `openai/gpt-4o-mini`). Canonical `provider/id`, bare IDs, and thinking-suffix forms are all resolved. Empty = current model. |
| `reasoning` | string \| null | `minimal` | Thinking level for the title request: `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Set `null` to omit the option entirely — that's the fix for a provider that rejects thinking levels outright, which shows up as the naming warning plus a `400 Invalid request parameters` line in the log. Case and stray spaces are tolerated (`" Minimal "` works). Anything unrecognised is ignored in favour of the default and logged as `[archimedes] session-name: ignoring unrecognized reasoning <value>` — it is never sent to the provider, because what an unknown level *means* is provider-dependent: some read it as more thinking, some reject the request, and we'd rather not depend on which. |

`model` is also editable in the `/archimedes` panel (**Model for naming** — Enter to type, blank to go back to the current model); `reasoning` is JSON-only.

On/off is managed by the suite: toggle via `/plugins` (`archimedes.sessionName.enabled`, default on).

← [Back to pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
