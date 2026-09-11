<div align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/splash-screen.png" width="600" alt="pi-archimedes splash screen">

# pi-archimedes

**The cohesive extension suite for the Pi coding agent — engineered to turn your terminal into an autonomous AI development cockpit.**

[![npm version](https://img.shields.io/npm/v/pi-archimedes?style=flat-square)](https://www.npmjs.com/package/pi-archimedes)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen?style=flat-square)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-%3E%3D5.0-blue?style=flat-square)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](https://github.com/danielcherubini/pi-archimedes/blob/main/LICENSE)

[Quick Start](#quick-start) • [Why Archimedes?](#why-archimedes) • [Interactive Commands](#interactive-commands) • [Feature Deep Dive](#feature-deep-dive) • [Configuration](#configuration) • [Modular Packages](#modular-packages) • [GitHub](https://github.com/danielcherubini/pi-archimedes)

</div>

---

## Why Archimedes?

[Pi](https://github.com/earendil-works/pi) is a fast, hackable, and lightweight coding agent harness for the terminal. But out of the box, extensions operate in silos:
- Subagents execute blindly as black boxes, burning tokens invisible to your status bar.
- Long-running tasks have no shared progress tracking.
- Clarification questions break agent loops or force clumsy terminal hacks.
- Reviewing diffs in plain text causes subtle regressions.
- Privileged commands risk terminal hangs or leaked credentials.

**pi-archimedes transforms Pi from a raw agent runner into a cohesive, production-grade development cockpit.**

Instead of eleven disjointed plugins that fight for terminal real estate, Archimedes functions as a **single, reactive nervous system**:
- **Cooperative Event Bus**: Subagent tool calls and real-dollar costs flow directly into your footer status bar in real time.
- **Shared Multi-Column Todo Board**: The main agent and every spawned subagent report tasks side by side, automatically clearing when done.
- **Bidirectional Human-in-the-Loop (`ask`)**: When a background subagent needs a critical decision, it surfaces an interactive multi-tab prompt in your TUI over IPC and resumes the moment you answer.
- **First-Class MCP Experience**: Connect, inspect, authenticate (OAuth 2.1 PKCE), and toggle Model Context Protocol servers through a dedicated interactive TUI overlay (`/mcp`).
- **Safe Privileged Execution**: Run root commands with masked interactive password prompts, strictly scoped process-group timeouts, and a bash guard that prevents the agent from hanging on unprotected `sudo`.
- **Obsessive Visual Polish**: Shiki syntax-highlighted side-by-side diffs, border spinners while the agent works, clipboard image pasting (`Ctrl+V`), and desktop notifications when tasks finish.

Everything is toggleable, theme-aware, and built to be lived in.

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

### 🤖 Subagent Swarms & Live Streaming ([`@pi-archimedes/subagent`](https://github.com/danielcherubini/pi-archimedes/tree/main/packages/subagent#readme))

Offload tasks to specialized subagents with real-time visibility. Run single subagents or parallel swarms (e.g., a researcher and a reviewer working simultaneously).

- **Live TUI streaming**: Watch subagent reasoning and tool calls execute in real time. Tool states are color-coded (grey while running, green on success, red on failure) with human-readable argument previews.
- **Unified cost accounting**: Per-subagent token usage (input, output, cache read/write) and exact dollar costs flow through the core bus directly into the footer.
- **Visual agent manager (`/agents`)**: Create and edit `.pi/agents/*.md` files with a searchable list, model selector, tool toggle picker, and cross-scope collision warnings.

<div align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/subagents-main-view.png" width="750" alt="Subagents parallel streaming view">
</div>

---

### 📋 Coordinated Multi-Column Todo Board ([`@pi-archimedes/todo`](https://github.com/danielcherubini/pi-archimedes/tree/main/packages/todo#readme))

Keep long workflows on track with structured task tracking visible to both you and the LLM.

- **`manage_todo_list` tool**: Read and write operations for task planning and execution tracking.
- **Multi-column display**: Main agent tasks appear on the left; each active subagent gets its own column on the right.
- **Auto-clearing**: When all tasks complete, the board displays a brief all-done celebration for 2 seconds and automatically dismisses itself.
- **Session persistence**: Survives `/reload` and session branch reconstruction.

<div align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/todos-and-subagent.png" width="750" alt="Todos and subagent side-by-side">
</div>

---

### 💬 Bidirectional Human-in-the-Loop (`ask`) ([`@pi-archimedes/ask`](https://github.com/danielcherubini/pi-archimedes/tree/main/packages/ask#readme))

Eliminate ambiguous back-and-forth guessing. When an agent or a background subagent needs human guidance, `ask` presents an interactive, structured question flow.

- **Subagent-to-parent TUI IPC**: Most question tools fail when called from background workers. Archimedes routes subagent `ask` calls through bidirectional IPC directly into the user's terminal. The subagent pauses, you answer in the TUI, and the subagent resumes with your choice.
- **Tabbed multi-question flows**: Review and answer multiple questions at once with keyboard navigation.
- **Inline notes & custom responses**: Attach notes to individual options or type custom answers via automatic "Other" handling.

<div align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/ask-subagent.png" width="750" alt="Interactive ask prompt from a subagent">
</div>

---

### 🔌 Enterprise-Grade MCP Client ([`@pi-archimedes/mcp`](https://github.com/danielcherubini/pi-archimedes/tree/main/packages/mcp#readme))

Integrate any Model Context Protocol server (stdio or HTTP/SSE) with full feature parity with dedicated MCP adapters.

- **Gateway proxy + direct tools**: Call tools via the universal `mcp` gateway or register high-frequency tools directly as `{server}_{tool}` for maximum token efficiency.
- **Management panel (`/mcp panel`)**: Live status indicators (`●` connected, `⚠` needs auth, `✗` error, `⊘` disabled, `○` cached), tool list inspection, and server toggles.
- **Setup wizard (`/mcp setup`)**: Scaffold `.mcp.json` or auto-import existing MCP servers from Cursor (`~/.cursor/mcp.json`), Claude Code (`~/.claude.json`), Claude Desktop, and VS Code.
- **OAuth 2.1 + PKCE**: Browser-based authentication flow with secure OS credential store persistence (macOS Keychain, Linux Secret Service, Windows Credential Manager).
- **Metadata cache**: Offline tool search and lazy connections via `~/.pi/agent/mcp-cache.json`.

---

### 🔐 Safe Privileged Execution (`sudo`) ([`@pi-archimedes/sudo`](https://github.com/danielcherubini/pi-archimedes/tree/main/packages/sudo#readme))

Run administrative tasks safely without exposing credentials or causing terminal deadlocks.

- **`sudo_exec` tool**: Executes privileged commands via `sudo -S` with explicit command confirmation and human reason display.
- **Masked password prompt**: Passwords are entered via a secure TUI mask and piped strictly over stdin — never exposed in argv, environment variables, logs, or LLM context.
- **Active bash guard**: Automatically detects and blocks interactive `sudo` inside the standard `bash` tool, preventing agent freeze and credential leakage.
- **In-memory cache**: Secure credential cache with a 15-minute TTL, cleared on session end, authentication failure, or `/sudo forget`. Subagents are strictly prevented from prompting for root access.

---

### 🔍 Shiki-Powered Syntax-Highlighted Diffs ([`@pi-archimedes/diff`](https://github.com/danielcherubini/pi-archimedes/tree/main/packages/diff#readme))

Inspect code changes with clarity before applying them.

- **Split and unified views**: Side-by-side split view or unified view, automatically adapting based on terminal width.
- **Shiki syntax engine**: Rich highlighting matching your active Pi theme.
- **Word-level diff emphasis**: Changed characters within modified lines are emphasized for surgical review.

<div align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/diff-edit.png" width="750" alt="Shiki syntax-highlighted split diff">
</div>

---

### 📊 Adaptive Footer & Cost Tracker ([`@pi-archimedes/footer`](https://github.com/danielcherubini/pi-archimedes/tree/main/packages/footer#readme))

A status bar that delivers vital session context without wasting vertical screen space.

- **At-a-glance context**: Current working directory, git branch, linked worktree indicator (`🌲`), active model, and thinking level.
- **Token & cost accumulator**: Live input/output tokens, cache read/write statistics, and combined session dollar costs (including all subagent usage).
- **Dynamic context bar**: Color-coded progress bar (green → yellow → red) showing remaining context window capacity.
- **Adaptive layout**: Automatically wraps from one to two or three lines on narrower viewports without clipping text.

---

### 🎬 Visual Chrome & Working Indicators ([`@pi-archimedes/core`](https://github.com/danielcherubini/pi-archimedes/tree/main/packages/core#readme))

- **Framed editor**: Clean borders around the input area with double-press quit guard.
- **Border spinner**: 10 animated spinner styles running along the editor border while the agent is executing (pendulum, typing, pulse, marquee, wave, rain, sparkle), replacing Pi's native "Working" line.
- **Muted thinking blocks**: Clean styling for chain-of-thought blocks with configurable labels and colors.
- **Animated splash screen**: 9 configurable opening reveal animations.

---

### 🖼️ Clipboard Image Paste ([`@pi-archimedes/image-paste`](https://github.com/danielcherubini/pi-archimedes/tree/main/packages/image-paste#readme))

Paste screenshots and UI mockups straight into your terminal prompt with instant inline previews:
- Press `Ctrl+V` (Linux/macOS) or `Alt+V` (Windows) to attach clipboard images directly.
- Built-in size guards prevent accidental multi-megabyte blowouts.

> [!NOTE]
> On Linux, clear Pi's default paste binding in `~/.pi/agent/keybindings.json` (`{ "app.clipboard.pasteImage": [] }`) so Archimedes' preview-enabled handler takes over seamlessly.

---

### 🔔 Delayed Desktop Notifications ([`@pi-archimedes/notify`](https://github.com/danielcherubini/pi-archimedes/tree/main/packages/notify#readme))

Step away during long builds or model generations with peace of mind.
- **Delayed trigger**: Alerts trigger only after 30 seconds of inactivity — never spamming you while actively typing.
- **Keystroke circuit breaker**: Touching any key immediately cancels pending alerts.
- **Terminal protocol support**: Native OSC 9, OSC 777, OSC 99, and PowerShell toasts with full tmux passthrough.

---

### 🏷️ AI Session Auto-Naming ([`@pi-archimedes/session-name`](https://github.com/danielcherubini/pi-archimedes/tree/main/packages/session-name#readme))

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
| **Core** | [`@pi-archimedes/core`](https://www.npmjs.com/package/@pi-archimedes/core) | Event bus, animated splash screen, framed editor, working spinner |
| **Footer** | [`@pi-archimedes/footer`](https://www.npmjs.com/package/@pi-archimedes/footer) | Status bar, token counters, real-dollar costs, context window bar |
| **Subagent** | [`@pi-archimedes/subagent`](https://www.npmjs.com/package/@pi-archimedes/subagent) | Subagent dispatch, live streaming, parallel swarms, `/agents` TUI |
| **Todo** | [`@pi-archimedes/todo`](https://www.npmjs.com/package/@pi-archimedes/todo) | Multi-column todo widget with auto-clearing and subagent tracking |
| **Ask** | [`@pi-archimedes/ask`](https://www.npmjs.com/package/@pi-archimedes/ask) | Tabbed questions, inline notes, subagent-to-parent TUI IPC |
| **MCP** | [`@pi-archimedes/mcp`](https://www.npmjs.com/package/@pi-archimedes/mcp) | Full MCP client, `/mcp` management panel, setup wizard, OAuth 2.1 |
| **Sudo** | [`@pi-archimedes/sudo`](https://www.npmjs.com/package/@pi-archimedes/sudo) | Safe `sudo_exec`, masked password prompt, bash interactive guard |
| **Diff** | [`@pi-archimedes/diff`](https://www.npmjs.com/package/@pi-archimedes/diff) | Shiki-highlighted side-by-side and unified terminal diffs |
| **Image Paste** | [`@pi-archimedes/image-paste`](https://www.npmjs.com/package/@pi-archimedes/image-paste) | Direct clipboard screenshot paste (`Ctrl+V`) with inline previews |
| **Notify** | [`@pi-archimedes/notify`](https://www.npmjs.com/package/@pi-archimedes/notify) | Inactivity-delayed desktop alerts with keystroke circuit breaker |
| **Session Name** | [`@pi-archimedes/session-name`](https://www.npmjs.com/package/@pi-archimedes/session-name) | Automated AI session title generator after first conversation turn |

To install an individual component:

```bash
pi install npm:@pi-archimedes/<package-name>
```

> [!IMPORTANT]
> When installed via the full `pi-archimedes` meta package, all components connect to the shared core bus — enabling subagent costs in the footer, subagent columns in the todo board, subagent question prompts in the TUI, and coordinated theme styling.

---

## Repository & Development

pi-archimedes is developed openly on GitHub: [github.com/danielcherubini/pi-archimedes](https://github.com/danielcherubini/pi-archimedes).

For development setup, local extension symlinking, and guidelines, see the repository README and [AGENTS.md](https://github.com/danielcherubini/pi-archimedes/blob/main/AGENTS.md).
