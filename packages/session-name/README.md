# @pi-archimedes/session-name

Auto session naming for the [Pi coding agent](https://github.com/earendil-works/pi).

Automatically generates concise, descriptive session titles using AI after each conversation — so your sessions are easy to find and resume later. Skips sessions already named via `--name` or `/name`, and silently handles errors.

## What you get

- **Automatic naming** — fires on `agent_end` to generate a title from the first user/assistant exchange
- **Smart model resolution** — supports canonical `provider/id`, bare `id`, and thinking-suffix tolerance
- **Respects manual names** — skips sessions already named via `--name` or `/name`
- **Ephemeral-aware** — only names sessions with a session file (skips temporary sessions)
- **Race-safe** — re-checks session name before setting to avoid overwriting manual changes
- **Silent failures** — any error (auth, network, etc.) is caught and ignored

## Install

```bash
pi install npm:@pi-archimedes/session-name
```

Or install full meta package:

```bash
pi install npm:pi-archimedes
```

## Usage

After a conversation ends (`agent_end`), the extension extracts the first user message and assistant response, sends them to the AI with a title-generation prompt, and sets the session name via `pi.setSessionName()`. The title is limited to 80 characters and stripped of surrounding quotes.

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `model` | string | _(current model)_ | Override model for title generation (e.g., `openai/gpt-4o-mini`) |

On/off is managed by the suite: toggle via `/plugins` (`archimedes.sessionName.enabled`, default on).

Settings are stored in `~/.pi/agent/settings.json` under the `archimedes.sessionName` namespace.

## Integration

When installed via `pi-archimedes` (the meta package), the session-name package is automatically registered. Standalone installs work independently — it listens for `agent_end` events and uses the Pi extension API to set session names.

← Back to [pi-archimedes](../../README.md)
