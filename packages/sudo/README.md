# @pi-archimedes/sudo

**A little more care with root access.**

Interactive `sudo` inside an agent session is a mistake waiting to happen — it can deadlock the terminal and drag root credentials into the LLM's context. Sudo puts a deliberate step between the model and the password: the exact command and its reason for your eyes first, a masked prompt (never the chat) for the credential, and a guard that keeps the ordinary `bash` tool from driving interactive `sudo` at all.

## Install

Standalone:

```bash
pi install npm:@pi-archimedes/sudo
```

Or the full suite instead:

```bash
pi install npm:pi-archimedes
```

New to Pi? Pi itself is a one-time global install and needs Node.js ≥ 22.19.0:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

Then `pi install npm:pi-archimedes`, `cd` into the project you want to work on and run `pi`. Inside the session, `/login` signs you in and `/model` picks a model — the [setup section](https://github.com/danielcherubini/pi-archimedes#setup) covers the first run. `/reload` picks the extension up in a running session.

## What you get

- **`sudo_exec` tool** — runs a privileged command via `sudo -S`, showing the exact command and a human-readable **reason** for confirmation before any credential prompt appears. A declined confirmation means nothing runs and no password is requested.
- **Masked password prompt** — the password is typed into a masked UI and passed to sudo via stdin only. It is never in argv, environment variables, command logs, or the LLM context.
- **Defensive output scrubbing** — command output lines that contain the password are redacted before they reach the tool result. That is a literal-substring scrub: it catches common cases, and it is **not** universal leak protection.
- **Credential cache** — a single in-memory cache with a TTL (15 minutes by default, `ttlMs`); cleared on authentication failure, at `session_start`/`session_shutdown`, and by `/sudo forget`.
- **Timeout kills the group** — the abort signal propagates to the command's entire process group, so root children, not just the direct sudo process, are terminated. Deliberately detached descendants (`setsid`, daemonising) leave the process group and survive any user-space kill — such commands should be given a managed lifecycle flag (e.g. `--foreground`) instead.
- **Headless sessions refused** — `sudo_exec` requires an interactive (TUI) session; subagent and headless sessions get a clear error instead of a prompt. The masked prompt only ever appears in front of a human.
- **Active bash guard** — a `tool_call` veto on the built-in `bash` tool (per [ADR 0010](https://github.com/danielcherubini/pi-archimedes/blob/main/docs/adr/0010-archimedes-sudo-security.md)) blocks interactive `sudo`, funneling privileged execution toward `sudo_exec`.

## Usage

### The `sudo_exec` tool

```jsonc
{
  "command": "apt install ripgrep",                    // exact argv string — no leading 'sudo'; no shell syntax (pipes, &&, redirects, env assignments)
  "reason": "ripgrep is needed for the search tooling", // required — shown before execution
  "timeoutMs": 120000                                   // optional override of config.defaultTimeoutMs
}
```

### The bash guard

The scanned `bash` commands:

- **Blocked:** `sudo` in command position without a no-prompt flag — including through runner wrappers (`env`, `nohup`, `timeout`, `xargs`, …), nested shells (`bash -c`, `su -c`), `eval`, compound keywords, and heredoc bodies.
- **Allowed:** non-interactive sudo (`sudo -n`, `-l`, `-v`, `-K`, `-k`, `--non-interactive`) — these cannot prompt and pass through untouched.

The guard is a **heuristic with accepted residual bypasses** documented in the [ADR 0010 design notes](https://github.com/danielcherubini/pi-archimedes/blob/main/docs/adr/0010-archimedes-sudo-security.md) — for example cross-token variable indirection, and `sudo` inside `$(...)`/backtick interpolation the word-position model cannot see. Over-blocking is the safe direction; the tested no-prompt flag set is a stable contract of the scanner, **not** a guarantee that no prompt can occur.

## Commands

- `/sudo` — report whether a credential is currently cached in memory.
- `/sudo forget` — flush the cached credential immediately.

## Settings

`~/.pi/agent/settings.json`, under `archimedes.sudo` — **JSON only**, no settings-panel UI in v1:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `ttlMs` | number | `900000` | Password cache TTL in milliseconds (default 15 minutes) |
| `defaultTimeoutMs` | number | `120000` | `sudo_exec` default command timeout in milliseconds (default 120 seconds) |

### Credential limitation on sudoers that retain no reusable ticket

On sudoers policies that retain no reusable credential ticket (e.g. `timestamp_timeout=0` with strict `Defaults`), an authenticated but failed command is indistinguishable from an authentication failure to any non-interactive check. The tool applies a two-consecutive-failure rule: the first failure keeps the cached password (with a visible warning), the second clears it. A wrong password on such a sudo is therefore detected on the second failure, not the first — the bounded cost of a policy that exposes no ticket to verify against.

## Part of the suite

In [pi-archimedes](https://github.com/danielcherubini/pi-archimedes), the package is registered by the plugin manifest; the bash guard and `sudo_exec` are loaded in the main session and in subagent children — the guard still vetoes there, while `sudo_exec` itself refuses to run in headless mode. Standalone works independently. On/off is managed by the suite: toggle via `/plugins` (`archimedes.sudo.enabled`, default on).

← [Back to pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
