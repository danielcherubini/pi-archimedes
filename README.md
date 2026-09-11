<div align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/splash-screen.png" width="600" alt="pi-archimedes splash screen">

# pi-archimedes

**The cohesive extension suite for the Pi coding agent — engineered to turn your terminal into an autonomous AI development cockpit.**

[![npm version](https://img.shields.io/npm/v/pi-archimedes?style=flat-square)](https://www.npmjs.com/package/pi-archimedes)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen?style=flat-square)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-%3E%3D5.0-blue?style=flat-square)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

[Quick Start](#quick-start) • [Why Archimedes?](#why-archimedes) • [Interactive Commands](#interactive-commands) • [Feature Deep Dive](#feature-deep-dive) • [Configuration](#configuration) • [Modular Packages](#modular-packages)

</div>

---

## Why Archimedes?

[Pi](https://github.com/earendil-works/pi) is a fast and lightweight terminal coding agent. But out of the box, extensions don't talk to each other:
- If you dispatch a subagent, you can't see what it's doing or how many tokens it's burning.
- When an agent needs a decision, it either guesses or dumps confusing raw text into the chat.
- There's no built-in way to track multi-step plans across agents without losing context.
- Terminal diffs are plain text without syntax highlighting.
- Running `sudo` can hang your session or leak passwords into prompt history.
- Managing MCP servers means hand-editing JSON files and restarting.

**Archimedes connects all of these pieces together into one seamless terminal experience.**

Instead of installing a bunch of separate plugins that don't know the others exist, Archimedes makes them cooperate:
- **Subagents stream live in your terminal**, and their token usage and dollar costs roll straight into your footer status bar in real time.
- **A shared multi-column todo list** shows what your main agent and every subagent are doing side by side, and automatically dismisses itself when the work is done.
- **Interactive questions (`ask`)**: when an agent needs clarification, it opens a clean interactive prompt right in your terminal, waits for your answer, and keeps going. Even background subagents can ask you questions without breaking execution.
- **Full MCP management (`/mcp`)**: browse tools, toggle servers on or off, and run OAuth logins from a clean terminal UI instead of hand-editing config files.
- **Safe sudo execution**: prompts for passwords securely with masked input, caches credentials in memory, and stops agents from hanging on raw `sudo` commands.
- **Syntax-highlighted diffs**: split side-by-side or unified diffs powered by Shiki, with word-level highlights so you can see exactly what changed before applying edits.
- **Polished daily details**: paste screenshots straight from your clipboard with `Ctrl+V`, watch an animated spinner on the editor border while the agent works, get a desktop notification when long tasks finish, and let AI name your sessions automatically.

Everything can be toggled with `/plugins` and customized with `/archimedes`.

---

## Quick Start

### 1. Install Pi (if you haven't already)

Archimedes requires [Pi](https://github.com/earendil-works/pi) and Node.js >= 22.

```bash
npm install -g @earendil-works/pi-coding-agent
```

### 2. Install Archimedes

Install the full, integrated Archimedes suite with a single command:

```bash
pi install npm:pi-archimedes
```

### 3. Launch

```bash
pi
```

You are immediately greeted with the Archimedes splash screen, animated working indicators, live footer status bar, and complete cockpit tooling.

> [!TIP]
> **Want only specific components?** Archimedes is completely modular. Every package can be installed standalone without the rest of the suite. See [Modular Packages](#modular-packages) below.

---

## Interactive Commands

Archimedes adds a set of dedicated TUI commands to manage your agent environment without leaving your session:

| Command | Description |
|---------|-------------|
| `/archimedes` | Open the interactive graphical settings panel to configure themes, spinners, and thresholds. |
| `/plugins` | Live plugin manager — toggle any of the 11 components on or off on the fly. |
| `/mcp` | Open the Model Context Protocol management panel to browse servers, tools, and run OAuth. |
| `/mcp setup` | Onboarding wizard to scaffold `.mcp.json` or import configs from Cursor, Claude Code, and VS Code. |
| `/agents` | Visual CRUD manager for custom subagent personas in `.pi/agents/*.md` with model and tool pickers. |
| `/todos` | Toggle the live multi-column todo tracking widget (`/todos clear` resets). |
| `/sudo` | Inspect cached privileged credentials state (`/sudo forget` clears memory). |

---

## Feature Deep Dive

### 🤖 Subagents & Live Streaming ([`@pi-archimedes/subagent`](packages/subagent/README.md))

Offload tasks to specialized subagents with real-time visibility. Run single tasks or parallel agents (e.g., a researcher and a reviewer working simultaneously).

- **Live TUI streaming**: Watch subagent reasoning and tool calls execute in real time. Tool states are color-coded (grey while running, green on success, red on failure) with human-readable argument previews.
- **Unified cost accounting**: Per-subagent token usage (input, output, cache read/write) and exact dollar costs flow through the core bus directly into the footer.
- **Visual agent manager (`/agents`)**: Create and edit `.pi/agents/*.md` files with a searchable list, model selector, tool toggle picker, and cross-scope collision warnings.

<div align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/subagents-main-view.png" width="750" alt="Subagents parallel streaming view">
</div>

---

### 📋 Coordinated Multi-Column Todo Board ([`@pi-archimedes/todo`](packages/todo/README.md))

Keep long workflows on track with structured task tracking visible to both you and the LLM.

- **`manage_todo_list` tool**: Read and write operations for task planning and execution tracking.
- **Multi-column display**: Main agent tasks appear on the left; each active subagent gets its own column on the right.
- **Auto-clearing**: When all tasks complete, the board displays a brief all-done celebration for 2 seconds and automatically dismisses itself.
- **Session persistence**: Survives `/reload` and session branch reconstruction.

<div align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/todos-and-subagent.png" width="750" alt="Todos and subagent side-by-side">
</div>

---

### 💬 Interactive Questions (`ask`) ([`@pi-archimedes/ask`](packages/ask/README.md))

Stop agents from guessing when instructions are ambiguous. When an agent or a background subagent needs clarification, `ask` presents a clean interactive prompt.

- **Subagent-to-parent TUI IPC**: Most question tools fail when called from background workers. Archimedes routes subagent `ask` calls through bidirectional IPC directly into the user's terminal. The subagent pauses, you answer in the TUI, and the subagent resumes with your choice.
- **Tabbed multi-question flows**: Review and answer multiple questions at once with keyboard navigation.
- **Inline notes & custom responses**: Attach notes to individual options or type custom answers via automatic "Other" handling.

<div align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/ask-subagent.png" width="750" alt="Interactive ask prompt from a subagent">
</div>

---

### 🔌 Enterprise-Grade MCP Client ([`@pi-archimedes/mcp`](packages/mcp/README.md))

Integrate any Model Context Protocol server (stdio or HTTP/SSE) with full feature parity with dedicated MCP adapters.

- **Gateway proxy + direct tools**: Call tools via the universal `mcp` gateway or register high-frequency tools directly as `{server}_{tool}` for maximum token efficiency.
- **Management panel (`/mcp panel`)**: Live status indicators (`●` connected, `⚠` needs auth, `✗` error, `⊘` disabled, `○` cached), tool list inspection, and server toggles.
- **Setup wizard (`/mcp setup`)**: Scaffold `.mcp.json` or auto-import existing MCP servers from Cursor (`~/.cursor/mcp.json`), Claude Code (`~/.claude.json`), Claude Desktop, and VS Code.
- **OAuth 2.1 + PKCE**: Browser-based authentication flow with secure OS credential store persistence (macOS Keychain, Linux Secret Service, Windows Credential Manager).
- **Metadata cache**: Offline tool search and lazy connections via `~/.pi/agent/mcp-cache.json`.

---

### 🔐 Safe Privileged Execution (`sudo`) ([`@pi-archimedes/sudo`](packages/sudo/README.md))

Run administrative tasks safely without exposing credentials or causing terminal deadlocks.

- **`sudo_exec` tool**: Executes privileged commands via `sudo -S` with explicit command confirmation and human reason display.
- **Masked password prompt**: Passwords are entered via a secure TUI mask and piped strictly over stdin — never exposed in argv, environment variables, logs, or LLM context.
- **Active bash guard**: Automatically detects and blocks interactive `sudo` inside the standard `bash` tool, preventing agent freeze and credential leakage.
- **In-memory cache**: Secure credential cache with a 15-minute TTL, cleared on session end, authentication failure, or `/sudo forget`. Subagents are strictly prevented from prompting for root access.

---

### 🔍 Shiki-Powered Syntax-Highlighted Diffs ([`@pi-archimedes/diff`](packages/diff/README.md))

Inspect code changes with clarity before applying them.

- **Split and unified views**: Side-by-side split view or unified view, automatically adapting based on terminal width.
- **Shiki syntax engine**: Rich highlighting matching your active Pi theme.
- **Word-level diff emphasis**: Changed characters within modified lines are emphasized for surgical review.

<div align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/diff-edit.png" width="750" alt="Shiki syntax-highlighted split diff">
</div>

---

### 📊 Adaptive Footer & Cost Tracker ([`@pi-archimedes/footer`](packages/footer/README.md))

A status bar that delivers vital session context without wasting vertical screen space.

- **At-a-glance context**: Current working directory, git branch, linked worktree indicator (`🌲`), active model, and thinking level.
- **Token & cost accumulator**: Live input/output tokens, cache read/write statistics, and combined session dollar costs (including all subagent usage).
- **Dynamic context bar**: Color-coded progress bar (green → yellow → red) showing remaining context window capacity.
- **Adaptive layout**: Automatically wraps from one to two or three lines on narrower viewports without clipping text.

---

### 🎬 Visual Chrome & Working Indicators ([`@pi-archimedes/core`](packages/core/README.md))

- **Framed editor**: Clean borders around the input area with double-press quit guard.
- **Border spinner**: 10 animated spinner styles running along the editor border while the agent is executing (pendulum, typing, pulse, marquee, wave, rain, sparkle), replacing Pi's native "Working" line.
- **Muted thinking blocks**: Clean styling for chain-of-thought blocks with configurable labels and colors.
- **Animated splash screen**: 9 configurable opening reveal animations.

---

### 🖼️ Clipboard Image Paste ([`@pi-archimedes/image-paste`](packages/image-paste/README.md))

Paste screenshots and UI mockups straight into your terminal prompt with instant inline previews:
- Press `Ctrl+V` (Linux/macOS) or `Alt+V` (Windows) to attach clipboard images directly.
- Built-in size guards prevent accidental multi-megabyte blowouts.

> [!NOTE]
> On Linux, clear Pi's default paste binding in `~/.pi/agent/keybindings.json` (`{ "app.clipboard.pasteImage": [] }`) so Archimedes' preview-enabled handler takes over seamlessly.

---

### 🔔 Delayed Desktop Notifications ([`@pi-archimedes/notify`](packages/notify/README.md))

Step away during long builds or model generations with peace of mind.
- **Delayed trigger**: Alerts trigger only after 30 seconds of inactivity — never spamming you while actively typing.
- **Keystroke circuit breaker**: Touching any key immediately cancels pending alerts.
- **Terminal protocol support**: Native OSC 9, OSC 777, OSC 99, and PowerShell toasts with full tmux passthrough.

---

### 🏷️ AI Session Auto-Naming ([`@pi-archimedes/session-name`](packages/session-name/README.md))

Never lose track of a past session. After your first exchange, a lightweight background model call generates a concise, descriptive 3–8 word session title so you can resume sessions easily with `pi -r`. Respects manual titles set via `/name`.

---

## Configuration

### Interactive Settings Panel

Run `/archimedes` at any time to open the full graphical settings dashboard. Adjust themes, spinner speeds, notification delays, and thresholds with live keyboard controls.

### Plugin Manager

Run `/plugins` to toggle any component on or off. Disabled plugins are cleanly unloaded on the next `/reload`.

### Configuration Reference

Settings are persisted in `~/.pi/agent/settings.json`:

```jsonc
{
  // Core visual chrome
  "archimedes.core": {
    "editorSpinBorder": true,       // Border animation while agent is working
    "editorSpinStyle": "pendulum",  // pendulum | typing | pulse | marquee | wave-rows | rain | sparkle
    "editorSpinSpeed": "normal",    // slow | normal | fast
    "editorSpinLabel": "Working",   // Label beside spinner
    "animationStyle": "vertical-up",// Splash animation
    "mutedTheme": false             // Subdued thinking blocks
  },

  // Footer status bar
  "archimedes.footer": {
    "splitThreshold": 150           // Column width threshold for single-line vs multi-line layout
  },

  // Shiki diff renderer
  "archimedes.diff": {
    "diffTheme": "github-dark",     // Shiki color theme
    "diffSplitMinWidth": 150        // Minimum terminal columns for side-by-side view
  },

  // Desktop notifications
  "archimedes.notify": {
    "notifyOnAgentEnd": true,
    "notifyOnQuestion": true,
    "delayMs": 30000                // Inactivity delay before alerting
  },

  // MCP Adapter
  "archimedes.mcp": {
    "directTools": true,            // Expose {server}_{tool} direct tool definitions
    "idleTimeout": 10,              // Minutes before idling MCP connections close
    "autoAuth": false               // Inline OAuth prompt on needs-auth servers
  },

  // Sudo privilege execution
  "archimedes.sudo": {
    "ttlMs": 900000,                // Password cache lifetime (15 minutes)
    "defaultTimeoutMs": 120000      // Execution timeout per command
  }
}
```

---

## Modular Packages

Prefer to cherry-pick? Every component in Archimedes is published as an independent, standalone package:

| Package | npm | Description |
|---------|-----|-------------|
| **Core** | [`@pi-archimedes/core`](packages/core/README.md) | Event bus, animated splash screen, framed editor, working spinner |
| **Footer** | [`@pi-archimedes/footer`](packages/footer/README.md) | Status bar, token counters, real-dollar costs, context window bar |
| **Subagent** | [`@pi-archimedes/subagent`](packages/subagent/README.md) | Subagent dispatch, live streaming, parallel execution, `/agents` TUI |
| **Todo** | [`@pi-archimedes/todo`](packages/todo/README.md) | Multi-column todo widget with auto-clearing and subagent tracking |
| **Ask** | [`@pi-archimedes/ask`](packages/ask/README.md) | Tabbed questions, inline notes, subagent-to-parent TUI IPC |
| **MCP** | [`@pi-archimedes/mcp`](packages/mcp/README.md) | Full MCP client, `/mcp` management panel, setup wizard, OAuth 2.1 |
| **Sudo** | [`@pi-archimedes/sudo`](packages/sudo/README.md) | Safe `sudo_exec`, masked password prompt, bash interactive guard |
| **Diff** | [`@pi-archimedes/diff`](packages/diff/README.md) | Shiki-highlighted side-by-side and unified terminal diffs |
| **Image Paste** | [`@pi-archimedes/image-paste`](packages/image-paste/README.md) | Direct clipboard screenshot paste (`Ctrl+V`) with inline previews |
| **Notify** | [`@pi-archimedes/notify`](packages/notify/README.md) | Inactivity-delayed desktop alerts with keystroke circuit breaker |
| **Session Name** | [`@pi-archimedes/session-name`](packages/session-name/README.md) | Automated AI session title generator after first conversation turn |

To install an individual component:

```bash
pi install npm:@pi-archimedes/<package-name>
```

> [!IMPORTANT]
> When installed via the full `pi-archimedes` meta package, all components connect to the shared core bus — enabling subagent costs in the footer, subagent columns in the todo board, subagent question prompts in the TUI, and coordinated theme styling.

---

## Development

pi-archimedes is structured as a pnpm monorepo.

```bash
# Clone the repository
git clone https://github.com/danielcherubini/pi-archimedes.git
cd pi-archimedes

# Install dependencies (requires pnpm >= 10)
pnpm install

# Type-check all packages
pnpm -r exec -- tsc --noEmit

# Run unit tests
pnpm test
```

### Local Testing with Pi

To test your local build inside Pi, symlink the repository directly into Pi's extensions directory:

```bash
ln -s $(pwd) ~/.pi/agent/extensions/pi-archimedes
```

Pi's extension loader automatically picks up `meta/src/index.ts` from the root `package.json`.

For contribution conventions, architecture decisions, and release workflows, see [AGENTS.md](AGENTS.md).
