# @pi-archimedes/session-name

**Automated AI session titling after first conversation turn for the [Pi coding agent](https://github.com/earendil-works/pi).**

Finding and resuming past coding sessions shouldn't involve reading arbitrary timestamps or raw hashes. `@pi-archimedes/session-name` uses a lightweight background AI call after your first exchange to generate a concise, descriptive title, making resuming with `pi -r` fast and painless.

## Quick Start

### 1. Install Pi (if needed)

```bash
npm install -g @earendil-works/pi-coding-agent
```

### 2. Install

Install standalone:

```bash
pi install npm:@pi-archimedes/session-name
```

Or install the complete [pi-archimedes](https://github.com/danielcherubini/pi-archimedes) development cockpit:

```bash
pi install npm:pi-archimedes
```

---

## What You Get

- **Automatic Title Generation** — Triggers after the first user/assistant exchange to name the session based on actual intent.
- **Respects Manual Naming** — Leaves existing custom session names alone if passed via `--name` or set via `/name`.
- **Ephemeral Session Aware** — Only names persisted sessions, skipping temporary or discardable agent sessions.
- **Smart Model Resolution** — Supports canonical `provider/id`, bare IDs, and thinking-suffix model formats.
- **Silent & Non-Blocking** — Executes in the background; failures (e.g. rate limits or offline mode) are gracefully ignored without interrupting work.

---

## Settings

Settings are stored in `~/.pi/agent/settings.json` under the `archimedes.sessionName` namespace (or configured interactively via `/archimedes`):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `model` | string | `(current model)` | Model override for title generation (e.g., `openai/gpt-4o-mini`) |

---

## Part of the Archimedes Suite

`@pi-archimedes/session-name` is included in [pi-archimedes](https://github.com/danielcherubini/pi-archimedes), where it ensures every session in your history has clear, readable context.

← Back to [pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
