# @pi-archimedes/sudo

**Safe privileged execution and interactive-sudo guard for the [Pi coding agent](https://github.com/earendil-works/pi).**

When coding agents attempt to install system packages or execute administrative tasks using ordinary shell execution, interactive `sudo` prompts cause terminal deadlocks and risk exposing root credentials in LLM context. `@pi-archimedes/sudo` provides a dedicated `sudo_exec` tool with masked password entry, in-memory credential caching, and an active bash guard that prevents the agent from running unprotected interactive sudo commands.

## Quick Start

### 1. Install Pi (if needed)

```bash
npm install -g @earendil-works/pi-coding-agent
```

### 2. Install

Install standalone:

```bash
pi install npm:@pi-archimedes/sudo
```

Or install the complete [pi-archimedes](https://github.com/danielcherubini/pi-archimedes) development cockpit:

```bash
pi install npm:pi-archimedes
```

---

## What You Get

- **`sudo_exec` Tool** — Executes privileged commands via `sudo -S`, displaying the exact command and human-readable reason for confirmation before any credential prompt is shown.
- **Masked Password Prompt** — Passwords are typed into a secure masked UI and transmitted strictly over stdin — never visible in argv, environment variables, command logs, or LLM context.
- **Active Bash Guard** — Intercepts and blocks interactive `sudo` invocations inside the standard `bash` tool, steering the agent toward safe, managed privilege escalation.
- **Process Group Kill on Timeout** — If a privileged command hangs or times out, the abort signal propagates to the entire process group, ensuring root descendants are terminated cleanly.
- **In-Memory Credential Cache** — Secure cache with a 15-minute TTL. Cleared on session termination, authentication failure, or manual `/sudo forget`.
- **Headless Protection** — Background subagents are strictly blocked from requesting root elevation, preventing prompt deadlocks.

---

## Usage

### The `sudo_exec` Tool

```jsonc
{
  "command": "apt install ripgrep",                    // exact argv string (no leading 'sudo', no raw shell syntax)
  "reason": "ripgrep is required for indexing tooling", // human-readable explanation displayed in confirmation prompt
  "timeoutMs": 120000                                   // optional execution timeout (defaults to 120s)
}
```

### The Bash Guard

The guard automatically inspects commands submitted to Pi's built-in `bash` tool:
- **Blocked:** `sudo` in command position without a non-interactive flag (including commands run via `env`, `nohup`, `timeout`, `xargs`, or nested shells like `bash -c`).
- **Allowed:** Non-interactive sudo commands (`sudo -n`, `-l`, `-v`, `-K`, `-k`, `--non-interactive`) pass through without interception.

### Commands

- `/sudo` — Check whether a valid credential is currently held in memory.
- `/sudo forget` — Immediately flush cached credentials from memory.

---

## Settings

Settings are stored in `~/.pi/agent/settings.json` under the `archimedes.sudo` namespace:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `ttlMs` | number | `900000` | Password cache TTL in milliseconds (default 15 minutes) |
| `defaultTimeoutMs` | number | `120000` | Default execution timeout in milliseconds (default 120 seconds) |

---

## Part of the Archimedes Suite

When installed via [pi-archimedes](https://github.com/danielcherubini/pi-archimedes), `@pi-archimedes/sudo` operates across both main agent sessions and subagents, ensuring privileged operations are safely managed throughout the swarm.

← Back to [pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
