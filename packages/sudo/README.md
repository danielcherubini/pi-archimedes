# @pi-archimedes/sudo

Safe privileged execution for the [Pi coding agent](https://github.com/earendil-works/pi): a dedicated `sudo_exec` tool with a masked password prompt, plus a guard that keeps the ordinary `bash` tool from driving interactive `sudo`.

## What you get

- **`sudo_exec` tool** — runs a privileged command via `sudo -S`, showing the exact command and reason for confirmation before any credential is requested; on timeout/abort the kill applies to the command's entire process group, so privileged (root) descendants are killed too, not just the direct sudo process
- **Masked password prompt** — the password is entered only through a masked UI, cached in memory for the session, and passed to sudo via stdin only — never in argv, env, logs, or files
- **Defensive scrubbing** — command output lines containing the password are redacted before they appear in tool results
- **Credential lifecycle** — single in-memory cache with TTL (default 15 min, `ttlMs`); cleared on auth failure, `session_start`/`session_shutdown`, and `/sudo forget`
- **Headless sessions blocked** — subagent/headless sessions get a clear error from `sudo_exec` instead of a prompt; the masked prompt only ever appears in a human's TUI
- **Bash guard** — active `tool_call` veto (ADR 0010): interactive `sudo` through the built-in `bash` tool is blocked, funneling privileged execution through `sudo_exec`
- **`/sudo` + `/sudo forget`** — report the credential-cache state or clear it from memory

## Install

```bash
pi install npm:@pi-archimedes/sudo
```

## Usage

### The `sudo_exec` tool

```jsonc
{
  "command": "apt install ripgrep", // exact argv string — no leading 'sudo'; no shell syntax (pipes, &&, redirects, env assignments)
  "reason": "ripgrep is needed for the search tooling", // required — shown to the user before execution
  "timeoutMs": 120000 // optional override of config.defaultTimeoutMs
}
```

The tool uses pi's built-in `renderCall`/`renderResult`; command output is surfaced as plain text, scrubbed with the password masked.

### The bash guard

A pure, exhaustively-tested scanner vetoes `tool_call` events on the built-in `bash` tool:

- **Blocked:** `sudo` in command position without a no-prompt flag — including through runner wrappers (`env`, `nohup`, `timeout`, `xargs`, …), nested shells (`bash -c`, `su -c`), `eval`, compound keywords, and heredoc bodies
- **Allowed:** non-interactive sudo (`sudo -n`, `-l`, `-v`, `-K`, `-k`, `--non-interactive`) — these cannot prompt and pass through untouched

The guard is a heuristic with accepted residual bypasses documented in the [ADR 0010 design notes](../../docs/adr/0010-archimedes-sudo-security.md) (e.g. cross-token variable indirection, and sudo inside `$(...)`/backtick interpolation whose text the word-position model cannot see). Over-blocking is the safe direction; the tested no-prompt flag set is a stable contract.

## Commands

- `/sudo` — report whether a credential is cached
- `/sudo forget` — clear the credential from memory

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `ttlMs` | number | `900000` | Password cache TTL in milliseconds (default 15 minutes) |
| `defaultTimeoutMs` | number | `120000` | `sudo_exec` default command timeout in milliseconds (default 120 seconds) |

On/off is managed by the suite: toggle via `/plugins` (`archimedes.sudo.enabled`, default on). Config is JSON-only in the `archimedes.sudo` namespace of `~/.pi/agent/settings.json` — there is no settings-panel UI in v1.

## Integration

When installed via `pi-archimedes` (the meta package), the sudo package is registered and gated by the suite's plugin manifest (ADR 0012); the bash guard and `sudo_exec` are loaded in both the main session and subagent children — the guard still vetoes there, while `sudo_exec` itself refuses to run headless. Standalone installs work independently.

← Back to [pi-archimedes](../../README.md)
