# Archimedes
### Pi, with the good stuff.

An extra pair of eyes on your code. Agents working in parallel. A terminal that keeps you in the loop—and looks good doing it.

**Archimedes brings subagents, shared task lists, MCP tools, and a polished interface to [Pi](https://github.com/earendil-works/pi). Install them together, use what you like, and make the setup yours.**

[![npm version](https://img.shields.io/npm/v/pi-archimedes?style=flat-square)](https://www.npmjs.com/package/pi-archimedes)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.19.0-brightgreen?style=flat-square)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](https://github.com/danielcherubini/pi-archimedes/blob/main/LICENSE)

[Setup](#setup) • [Commands](#commands) • [Settings](#settings) • [Components](#components)

---

## Setup

### You already use Pi

One command:

```bash
pi install npm:pi-archimedes
```

Your `~/.pi/agent/` stays as it is — Archimedes only adds its namespaces under `settings.json`. Pi's own `auth.json`, `keybindings.json`, agents, and sessions are untouched (and `/mcp setup` only writes the project's `.mcp.json`, when you run it).

Then run `/reload` in your session (or start a new one) to pick it up — that reloads the extensions *and* your keybindings, so any shortcuts you've customized in `~/.pi/agent/keybindings.json` keep working.

### New to Pi

1. **Node.js ≥ 22.19.0** — the requirement [Pi](https://github.com/earendil-works/pi) itself declares.
2. **Install Pi** (shell):

   ```bash
   npm install -g --ignore-scripts @earendil-works/pi-coding-agent
   ```

3. **Install Archimedes** (shell):

   ```bash
   pi install npm:pi-archimedes
   ```

4. **Launch** the terminal in the project you want to work on (shell):

   ```bash
   cd /path/to/your/project
   pi
   ```

5. **Authenticate and pick a model** (inside the Pi session):

   ```text
   /login
   /model
   ```

6. **Make image-paste own the paste keys** — Pi's built-in `app.clipboard.pasteImage` owns `Ctrl+V` (Linux/macOS) / `Alt+V` (Windows), and image-paste (on by default in the suite) binds the same keys — clear the built-in in `~/.pi/agent/keybindings.json` so image-paste takes them cleanly (otherwise both handlers fire on the shared key and the built-in throws warning banners; format in Pi's [keybindings docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/keybindings.md)). If the file doesn't exist yet, create it with:

   ```json
   {
     "app.clipboard.pasteImage": []
   }
   ```

   If it already exists, just add/set `"app.clipboard.pasteImage": []` in there and run `/reload`.

`/login` signs you into a supported provider (subscription or API key) and `/model` selects a model from it. Model access comes through the providers you configure in Pi — Pi's [provider docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md) list the supported ones, and Archimedes doesn't ship a model of its own. For the broader first run, Pi's [quickstart](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/quickstart.md) is worth a read.

<p align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/splash-screen.png" width="600" alt="pi-archimedes splash screen">
</p>

---

## Give your agent some backup.

Have one subagent explore the codebase while another reviews your changes. [Subagents](https://github.com/danielcherubini/pi-archimedes/blob/main/packages/subagent/README.md) run with your choice of models and tools, stream their progress live into your terminal, and their tasks show up side by side on the [shared todo board](https://github.com/danielcherubini/pi-archimedes/blob/main/packages/todo/README.md).

Their token usage and costs feed into the same status bar. More work happening at once, without losing sight of it.

See the [subagent guide](https://github.com/danielcherubini/pi-archimedes/blob/main/packages/subagent/README.md) for dispatching, agent definitions, and the `/agents` editor.

<p align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/subagents-main-view.png" width="750" alt="Subagents parallel streaming view">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/todos-and-subagent.png" width="750" alt="Todos and subagent side-by-side">
</p>

---

## Keep the decisions. Delegate the work.

When a subagent needs your input, it can ask directly in your session — [ask](https://github.com/danielcherubini/pi-archimedes/blob/main/packages/ask/README.md) presents the question right in your terminal. Pick an option, add a note, or write your own answer. It gets your decision and carries on.

You don't have to copy messages between terminals to stay involved.

<p align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/ask-subagent.png" width="750" alt="Interactive ask prompt from a subagent">
</p>

---

## Bring the tools you already use.

[Connect MCP servers](https://github.com/danielcherubini/pi-archimedes/blob/main/packages/mcp/README.md), browse their tools, and handle authentication inside Pi. Import server definitions from Cursor, Claude Code, Claude Desktop, or VS Code rather than rebuilding your setup.

Start with `/mcp setup`. Manage it with `/mcp`.

---

## See what changed. Not just that something changed.

[Syntax-highlighted diffs](https://github.com/danielcherubini/pi-archimedes/blob/main/packages/diff/README.md), side by side when there's room and unified when there isn't. Word-level highlights draw your eye to the changes inside each line.

The details are easier to catch when they're easier to read.

<p align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/diff-edit.png" width="750" alt="Shiki syntax-highlighted split diff">
</p>

---

## A terminal worth spending your day in.

[Paste screenshots](https://github.com/danielcherubini/pi-archimedes/blob/main/packages/image-paste/README.md) with inline previews. Keep your [branch, model, context usage, and costs](https://github.com/danielcherubini/pi-archimedes/blob/main/packages/footer/README.md) in view. Give sessions [useful names automatically](https://github.com/danielcherubini/pi-archimedes/blob/main/packages/session-name/README.md) so they're easier to find later.

A [framed editor](https://github.com/danielcherubini/pi-archimedes/blob/main/packages/core/README.md), animated working indicators, and configurable colours finish the picture. Small touches that make the whole setup feel considered.

**Practical notes:** the paste markers appear as you paste; image previews appear when you submit the message. Image rendering and desktop alerts both depend on your terminal's support — the [image-paste](https://github.com/danielcherubini/pi-archimedes/blob/main/packages/image-paste/README.md) and [notify](https://github.com/danielcherubini/pi-archimedes/blob/main/packages/notify/README.md) docs cover what each needs. Naming is a separate (potentially billed) model call, not included in the footer's totals.

---

## A little more care with root access.

For tasks that need sudo, [sudo](https://github.com/danielcherubini/pi-archimedes/blob/main/packages/sudo/README.md) shows you the exact command and its reason before you enter your password in a masked prompt—not the chat. Credentials are cached in memory with an expiry, and `/sudo forget` clears them.

## Step away without losing track.

[Notify](https://github.com/danielcherubini/pi-archimedes/blob/main/packages/notify/README.md) alerts you when the agent finishes or a prompt needs your attention. Alerts wait before firing, and typing cancels anything pending.

You can leave the terminal to do its thing.

---

## The whole suite. Or just your favourite parts.

One install brings everything together. Switch optional extensions on or off with `/plugins`, then `/reload` to apply. Use `/archimedes` to adjust the available settings.

Only want the diffs, footer, or MCP tools? Each component is available separately — see [Components](#components).

---

## Commands

| Command | Scope | Notes |
|---------|-------|-------|
| `/plugins` | Suite | Toggle the ten optional extensions (core is always on and not toggleable). Toggles persist immediately; `/reload` (or a fresh session) applies them. |
| `/archimedes` | Suite | Interactive settings panel — up/down moves, left/right changes values, Enter edits supported fields, `s` saves, Esc discards the current edits. Settings captured at startup need `/reload`. Not every setting has a panel control. |
| `/agents` | Suite, subagent enabled | Browse, create, and edit custom subagent definitions in `.pi/agents/*.md`. |
| `/todos` | Todo component | Refreshes the todo widget and reports its status. `/todos clear` clears the list. (The board's visibility is not a `/todos` toggle — see the [todo docs](https://github.com/danielcherubini/pi-archimedes/blob/main/packages/todo/README.md).) |
| `/mcp`, `/mcp setup` | MCP component | Manage servers and run logins; the setup wizard scaffolds `.mcp.json` or imports configs from Cursor, Claude Code, Claude Desktop, or VS Code. |
| `/sudo`, `/sudo forget` | Sudo component | Inspect cached credential state; `forget` clears it. |
| `/reload` | Pi | Applies plugin changes and settings read at startup. |

---

## Settings

Every component keeps its own namespace under `~/.pi/agent/settings.json`, which Pi parses as **strict JSON** (no comments — unlike MCP server configs, which accept JSONC). Each component's README documents its namespace, fields, and defaults — including [core](https://github.com/danielcherubini/pi-archimedes/blob/main/packages/core/README.md) (chrome, spinner, thinking), [footer](https://github.com/danielcherubini/pi-archimedes/blob/main/packages/footer/README.md), [diff](https://github.com/danielcherubini/pi-archimedes/blob/main/packages/diff/README.md), [notify](https://github.com/danielcherubini/pi-archimedes/blob/main/packages/notify/README.md), [mcp](https://github.com/danielcherubini/pi-archimedes/blob/main/packages/mcp/README.md), and [sudo](https://github.com/danielcherubini/pi-archimedes/blob/main/packages/sudo/README.md) (also strict JSON). The `/archimedes` panel covers the settings that have a control; not everything does.

---

## Components

| Component | npm package | What it adds |
|-----------|-------------|--------------|
| **Core** | [`@pi-archimedes/core`](https://www.npmjs.com/package/@pi-archimedes/core) | Shared event bus, splash screen, framed editor, working spinner, thinking blocks |
| **Subagent** | [`@pi-archimedes/subagent`](https://www.npmjs.com/package/@pi-archimedes/subagent) | Live subagent dispatch, custom agent definitions; `/agents` editor with the suite |
| **Todo** | [`@pi-archimedes/todo`](https://www.npmjs.com/package/@pi-archimedes/todo) | Multi-column todo board with subagent columns and auto-clear |
| **Ask** | [`@pi-archimedes/ask`](https://www.npmjs.com/package/@pi-archimedes/ask) | Structured questions — including subagent questions relayed into your terminal |
| **MCP** | [`@pi-archimedes/mcp`](https://www.npmjs.com/package/@pi-archimedes/mcp) | `/mcp` management, setup wizard, OAuth, config imports |
| **Sudo** | [`@pi-archimedes/sudo`](https://www.npmjs.com/package/@pi-archimedes/sudo) | `sudo_exec` with masked password prompt and interactive-sudo guard |
| **Diff** | [`@pi-archimedes/diff`](https://www.npmjs.com/package/@pi-archimedes/diff) | Syntax-highlighted side-by-side and unified diffs with word-level highlights |
| **Footer** | [`@pi-archimedes/footer`](https://www.npmjs.com/package/@pi-archimedes/footer) | Branch, model, context usage, and token/cost status bar |
| **Image Paste** | [`@pi-archimedes/image-paste`](https://www.npmjs.com/package/@pi-archimedes/image-paste) | Clipboard image paste with inline previews |
| **Notify** | [`@pi-archimedes/notify`](https://www.npmjs.com/package/@pi-archimedes/notify) | Delayed desktop notifications with input cancellation |
| **Session Name** | [`@pi-archimedes/session-name`](https://www.npmjs.com/package/@pi-archimedes/session-name) | Automatic session titles |

The full suite is the supported connected setup — the integrations above (subagent costs in the footer, subagent columns on the todo board, subagent questions in the terminal) light up when the relevant components are loaded together.

To install just the components you want:

```bash
pi install npm:@pi-archimedes/core
pi install npm:@pi-archimedes/subagent
pi install npm:@pi-archimedes/todo
pi install npm:@pi-archimedes/ask
pi install npm:@pi-archimedes/mcp
pi install npm:@pi-archimedes/sudo
pi install npm:@pi-archimedes/diff
pi install npm:@pi-archimedes/footer
pi install npm:@pi-archimedes/image-paste
pi install npm:@pi-archimedes/notify
pi install npm:@pi-archimedes/session-name
```

---

## Development

`pi-archimedes` is the meta package of a pnpm monorepo — clone it, run `pnpm install`, and test the full suite from source. For the component layout, no-build-step workflow, and local testing with Pi (including a warning about not loading the local copy and an npm copy at the same time), see the [root README's development instructions](https://github.com/danielcherubini/pi-archimedes/blob/main/README.md#development) and [AGENTS.md](https://github.com/danielcherubini/pi-archimedes/blob/main/AGENTS.md).
