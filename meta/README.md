# Archimedes
### Pi, with the good stuff.

An extra pair of eyes on your code. Agents working in parallel. A terminal that keeps you in the loop—and looks good doing it.

**Archimedes brings subagents, shared task lists, and a polished interface to [Pi](https://github.com/earendil-works/pi). Install them together, use what you like, and make the setup yours.**

[![npm version](https://img.shields.io/npm/v/pi-archimedes?style=flat-square)](https://www.npmjs.com/package/pi-archimedes)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.19.0-brightgreen?style=flat-square)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](https://github.com/archimedes-codes/pi-archimedes/blob/main/LICENSE)

[Setup](#setup) • [Commands](#commands) • [Settings](#settings) • [Components](#components)

---

## Setup

### You already use Pi

One command:

```bash
pi install npm:pi-archimedes
```

Your `~/.pi/agent/` stays as it is: Archimedes adds its namespaces under `settings.json`, and Pi's own `auth.json` and your sessions are never written. Two files get written, by the features that own them.

- **`keybindings.json`** — only ever about the paste key, and only via step 6 below. The offer writes the file **only when it is absent and only if you accept** (an existing file is never edited by the offer), and what it writes is the `app.clipboard.pasteImage: []` unbinding from the snippet below, paired with its `"$schema"` line. Setting `archimedes.imagePaste.suppressNativePaste: false` removes that entry again, leaving `{}`. Both directions act on **the suite's own entry only**: a file holding a key of yours, a different `$schema`, a non-empty binding, or JSON that does not parse is left byte-for-byte alone, and you get one warning about it — naming the entry to remove when the file really holds one, and otherwise saying there is nothing of ours to remove. Your own bindings are never rewritten.
- **`agents.local.json`**, plus any agent definition you create or edit with `/agents` — the subagent package's own files.

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

6. **Make image-paste own the paste keys** — Pi's built-in `app.clipboard.pasteImage` owns `Ctrl+V` (Linux/macOS) / `Alt+V` (Windows), and image-paste (on by default in the suite) binds the same keys — clear the built-in in `~/.pi/agent/keybindings.json` so image-paste takes them cleanly. Left as is, **only one handler runs**: an extension shortcut beats a non-reserved built-in, so Pi adds a `[Extension issues]` line (`Extension shortcut conflict: 'ctrl+v' is built-in shortcut for app.clipboard.pasteImage and <ext>. Using <ext>`) and its own action never fires — measured on Pi 1.2.0, one `Ctrl+V`, one insertion, the extension's (format in Pi's [keybindings docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/keybindings.md)). If the file doesn't exist yet, create it with:

   ```json
   {
     "$schema": "https://pi.dev/schemas/keybindings.schema.json",
     "app.clipboard.pasteImage": []
   }
   ```

   The `$schema` line is optional (Pi skips that key when loading the file) — it exists so an editor or a standalone validator can check the file against Pi's published schema, and it's what the first-run offer below writes.

   If it already exists, just add/set `"app.clipboard.pasteImage": []` in there and run `/reload`. Or skip the step entirely if the file doesn't exist yet: on the first TUI session the suite offers to create it automatically with the snippet above — accepting creates the file and then tells you to run `/reload` (measured on Pi 1.2.0: the context an event handler receives has no `reload`, so the automatic path is a notification rather than a reload, and the cleared binding applies once you run it); declining or cancelling (Esc) never asks again. The offer only appears in an install that is going to hold the paste key: if you have set `archimedes.imagePaste.suppressNativePaste: false` first, it never shows, because there is nothing to unbind (and it does not spend its "already asked" flag on that way in, so turning the flag back on still gets you the offer).

   **Want Pi's own paste back?** Set `archimedes.imagePaste.suppressNativePaste: false`. Turning it off removes the suite's `app.clipboard.pasteImage` unbinding from `~/.pi/agent/keybindings.json` (its own entry only, leaving `{}`) **and stops the suite binding that key** — while the flag is off no paste shortcut is registered at all — so Pi's native `app.clipboard.pasteImage` really runs again: `/new` or `/reload` applies it, no restart and no hand-editing files. The cost, in one sentence: with the flag off you get Pi's paste and lose image-paste's image attach, its multi-image queue and the preview **on that key**, because no keypress reaches our handler until you turn it back on. The default (key absent, meaning on) is what keeps the image-attaching paste. If that file holds anything other than the suite's own entry, the suite leaves it alone and tells you so once — and Pi's own paste is answering the key there unless the file itself carries the `[]` unbinding.

`/login` signs you into a supported provider (subscription or API key) and `/model` selects a model from it. Model access comes through the providers you configure in Pi — Pi's [provider docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md) list the supported ones, and Archimedes doesn't ship a model of its own. For the broader first run, Pi's [quickstart](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/quickstart.md) is worth a read.

<p align="center">
  <img src="https://raw.githubusercontent.com/archimedes-codes/pi-archimedes/main/docs/images/splash-screen.png" width="600" alt="The opt-in Archimedes startup splash: the ASCII logo above pi's own startup listing">
</p>

<p align="center"><sub>The startup splash is opt-in — turn it on with <code>/archimedes</code> → Startup Splash. Out of the box Pi's own startup screen is left in place.</sub></p>

---

## Give your agent some backup.

Have one subagent explore the codebase while another reviews your changes. [Subagents](https://github.com/archimedes-codes/pi-archimedes/blob/main/packages/subagent/README.md) run with your choice of models and tools, stream their progress live into your terminal, and their tasks show up side by side on the [shared todo board](https://github.com/archimedes-codes/pi-archimedes/blob/main/packages/todo/README.md).

Their token usage and costs feed into the same status bar. More work happening at once, without losing sight of it.

See the [subagent guide](https://github.com/archimedes-codes/pi-archimedes/blob/main/packages/subagent/README.md) for dispatching, agent definitions, and the `/agents` editor.

<p align="center">
  <img src="https://raw.githubusercontent.com/archimedes-codes/pi-archimedes/main/docs/images/subagents-main-view.png" width="750" alt="Subagents parallel streaming view">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/archimedes-codes/pi-archimedes/main/docs/images/todos-and-subagent.png" width="750" alt="Todos and subagent side-by-side">
</p>

---

## Keep the decisions. Delegate the work.

When a subagent needs your input, it can ask directly in your session — [ask](https://github.com/archimedes-codes/pi-archimedes/blob/main/packages/ask/README.md) presents the question right in your terminal. Pick an option, add a note, or write your own answer. It gets your decision and carries on.

You don't have to copy messages between terminals to stay involved.

<p align="center">
  <img src="https://raw.githubusercontent.com/archimedes-codes/pi-archimedes/main/docs/images/ask-subagent.png" width="750" alt="Interactive ask prompt from a subagent">
</p>

---

## See what changed. Not just that something changed.

[Syntax-highlighted diffs](https://github.com/archimedes-codes/pi-archimedes/blob/main/packages/diff/README.md), side by side when there's room and unified when there isn't. Word-level highlights draw your eye to the changes inside each line.

The details are easier to catch when they're easier to read.

<p align="center">
  <img src="https://raw.githubusercontent.com/archimedes-codes/pi-archimedes/main/docs/images/diff-edit.png" width="750" alt="Shiki syntax-highlighted split diff">
</p>

---

## A terminal worth spending your day in.

[Paste screenshots](https://github.com/archimedes-codes/pi-archimedes/blob/main/packages/image-paste/README.md) with inline previews. Keep your [branch, model, context usage, and costs](https://github.com/archimedes-codes/pi-archimedes/blob/main/packages/footer/README.md) in view. Give sessions [useful names automatically](https://github.com/archimedes-codes/pi-archimedes/blob/main/packages/session-name/README.md) so they're easier to find later.

A [framed editor](https://github.com/archimedes-codes/pi-archimedes/blob/main/packages/core/README.md), animated working indicators, and configurable colours finish the picture. Small touches that make the whole setup feel considered.

**Practical notes:** the paste markers appear as you paste; image previews appear when you submit the message. Image rendering and desktop alerts both depend on your terminal's support — the [image-paste](https://github.com/archimedes-codes/pi-archimedes/blob/main/packages/image-paste/README.md) and [notify](https://github.com/archimedes-codes/pi-archimedes/blob/main/packages/notify/README.md) docs cover what each needs. Naming is a separate (potentially billed) model call, not included in the footer's totals.

---

## A little more care with root access.

For tasks that need sudo, [sudo](https://github.com/archimedes-codes/pi-archimedes/blob/main/packages/sudo/README.md) shows you the exact command and its reason before you enter your password in a masked prompt—not the chat. Credentials are cached in memory with an expiry, and `/sudo forget` clears them.

## Step away without losing track.

[Notify](https://github.com/archimedes-codes/pi-archimedes/blob/main/packages/notify/README.md) alerts you when the agent finishes or a prompt needs your attention. Alerts wait before firing, and typing cancels anything pending.

You can leave the terminal to do its thing.

---

## The whole suite. Or just your favourite parts.

One install brings everything together. Switch optional extensions on or off with `/plugins`, then `/reload` to apply. Use `/archimedes` to adjust the available settings.

Only want the diffs or footer? Each component is available separately — see [Components](#components).

---

## Commands

| Command | Scope | Notes |
|---------|-------|-------|
| `/plugins` | Suite | Toggle the eleven optional extensions (core is always on and not toggleable). Toggles persist immediately; `/reload` (or a fresh session) applies them. |
| `/archimedes` | Suite | Interactive settings panel — up/down moves, left/right changes values, Enter edits supported fields, `s` saves, Esc discards the current edits. Settings captured at startup need `/reload`. Not every setting has a panel control. |
| `/agents` | Suite, subagent enabled | Browse, create, and edit custom subagent definitions in `.pi/agents/*.md`. |
| `/todos` | Todo component | Refreshes the todo widget and reports its status. `/todos clear` clears the list. (The board's visibility is not a `/todos` toggle — see the [todo docs](https://github.com/archimedes-codes/pi-archimedes/blob/main/packages/todo/README.md).) |
| `/sudo`, `/sudo forget` | Sudo component | Inspect cached credential state; `forget` clears it. |
| `/reload` | Pi | Applies plugin changes and settings read at startup. |

---

## Settings

Every component keeps its own namespace under `~/.pi/agent/settings.json`, which Pi parses as **strict JSON**. Each component's README documents its namespace, fields, and defaults — including [core](https://github.com/archimedes-codes/pi-archimedes/blob/main/packages/core/README.md) (chrome, spinner, thinking), [footer](https://github.com/archimedes-codes/pi-archimedes/blob/main/packages/footer/README.md), [diff](https://github.com/archimedes-codes/pi-archimedes/blob/main/packages/diff/README.md), [notify](https://github.com/archimedes-codes/pi-archimedes/blob/main/packages/notify/README.md), [image-paste](https://github.com/archimedes-codes/pi-archimedes/blob/main/packages/image-paste/README.md), and [sudo](https://github.com/archimedes-codes/pi-archimedes/blob/main/packages/sudo/README.md) (also strict JSON). The `/archimedes` panel covers the settings that have a control; not everything does.

### Custom themes must validate against Pi's schema

Pi 1.2.0 validates `~/.pi/agent/themes/*.json` at startup against `theme.schema.json`, and that schema is **`additionalProperties: false`** — on the top-level object and on `colors`. A custom theme that carried extra metadata of its own (`"author"`, `"notes"`, a private palette block, a leftover key from another editor) used to load anyway; now it is refused, the theme is not applied, and Pi reports it as a startup warning. Earlier Pi validated theme JSON too, but without the `additionalProperties` clause, which is why this can arrive as a surprise on upgrade. Move whatever Pi doesn't define out of the theme file, and put `"$schema": "https://pi.dev/schemas/theme.schema.json"` in it so your editor tells you before Pi does. This is Pi's own behaviour — the suite writes no theme files.

---

## Components

| Component | npm package | What it adds |
|-----------|-------------|--------------|
| **Core** | [`@pi-archimedes/core`](https://www.npmjs.com/package/@pi-archimedes/core) | Shared plumbing — `pi.events` channel vocabulary, overlay chrome, settings I/O, tool-row rendering |
| **UI** | [`@pi-archimedes/ui`](https://www.npmjs.com/package/@pi-archimedes/ui) | Framed editor with a working spinner, bash + codemode tool-row styling, thinking collapse, opt-in startup splash |
| **Subagent** | [`@pi-archimedes/subagent`](https://www.npmjs.com/package/@pi-archimedes/subagent) | Live subagent dispatch, custom agent definitions; `/agents` editor with the suite |
| **Todo** | [`@pi-archimedes/todo`](https://www.npmjs.com/package/@pi-archimedes/todo) | Multi-column todo board with subagent columns and auto-clear |
| **Ask** | [`@pi-archimedes/ask`](https://www.npmjs.com/package/@pi-archimedes/ask) | Structured questions — including subagent questions relayed into your terminal |
| **Sudo** | [`@pi-archimedes/sudo`](https://www.npmjs.com/package/@pi-archimedes/sudo) | `sudo_exec` with masked password prompt and interactive-sudo guard |
| **Diff** | [`@pi-archimedes/diff`](https://www.npmjs.com/package/@pi-archimedes/diff) | Syntax-highlighted side-by-side and unified diffs with word-level highlights, drawn into pi's `edit`/`write` tool rows |
| **Footer** | [`@pi-archimedes/footer`](https://www.npmjs.com/package/@pi-archimedes/footer) | Branch, model, context usage, and token/cost status bar |
| **Image Paste** | [`@pi-archimedes/image-paste`](https://www.npmjs.com/package/@pi-archimedes/image-paste) | Clipboard image paste with inline previews |
| **Notify** | [`@pi-archimedes/notify`](https://www.npmjs.com/package/@pi-archimedes/notify) | Delayed desktop notifications with input cancellation |
| **Web** | [`@pi-archimedes/web`](https://www.npmjs.com/package/@pi-archimedes/web) | `web_search`, `fetch_content` and `get_search_content` with multi-provider routing |
| **Session Name** | [`@pi-archimedes/session-name`](https://www.npmjs.com/package/@pi-archimedes/session-name) | Automatic session titles |

The full suite is the supported connected setup — the integrations above (subagent costs in the footer, subagent columns on the todo board, subagent questions in the terminal) light up when the relevant components are loaded together.

To install just the components you want:

```bash
pi install npm:@pi-archimedes/core
pi install npm:@pi-archimedes/subagent
pi install npm:@pi-archimedes/todo
pi install npm:@pi-archimedes/ask
pi install npm:@pi-archimedes/sudo
pi install npm:@pi-archimedes/diff
pi install npm:@pi-archimedes/footer
pi install npm:@pi-archimedes/image-paste
pi install npm:@pi-archimedes/notify
pi install npm:@pi-archimedes/session-name
```

---

## Development

`pi-archimedes` is the meta package of a pnpm monorepo — clone it, run `pnpm install`, and test the full suite from source. For the component layout, no-build-step workflow, and local testing with Pi (including a warning about not loading the local copy and an npm copy at the same time), see the [root README's development instructions](https://github.com/archimedes-codes/pi-archimedes/blob/main/README.md#development) and [AGENTS.md](https://github.com/archimedes-codes/pi-archimedes/blob/main/AGENTS.md).
