# @pi-archimedes/image-paste

**Show the screenshot rather than describing it.**

"the button above the header and below the nav" is work nobody wants to do. Image-paste puts the image from your clipboard into the prompt as you type: markers land in the text on paste, the matching queued images attach on submit, and a terminal preview shows you what the agent will see.

## Install

Standalone:

```bash
pi install npm:@pi-archimedes/image-paste
```

Or the full suite instead:

```bash
pi install npm:pi-archimedes
```

New to Pi? Pi itself is a one-time global install and needs Node.js ≥ 22.19.0. If you need Pi, [its quickstart](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/quickstart.md) starts with `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`. After installing Pi, choose one installation command above, then `cd` into your project, run `pi`, and use `/login` and `/model` inside the session. The [setup section](https://github.com/danielcherubini/pi-archimedes#setup) covers it end to end. `/reload` picks the extension up in a running session.

## How it works

- **Markers on paste** — pasting inserts a visible `[Image #1]` placeholder at the cursor; each paste gets the next number.
- **Attachment on submit** — when you send the message, your text is scanned for markers and the matching queued images are attached to it. Delete a marker and its image is not attached — the text is the source of truth.
- **Inline preview** — a preview of the attached images is sent and rendered in the TUI. Previews appear where your terminal renders inline images; on a terminal that can't show them, the image is still attached — only the preview falls back.
- **Size guard** — 20 MiB **per image**, rejected with a clear message before it wastes context or hangs the submit.
- **Model side** — the session's model must support images for the attachment to be usable.

## Paste shortcuts

| Platform | Shortcuts |
|----------|-----------|
| Linux (X11/Wayland) | `Ctrl+V`, `Alt+V`, `Ctrl+Alt+V` |
| macOS | `Ctrl+V`, `Alt+V`, `Ctrl+Alt+V` |
| Windows | `Alt+V`, `Ctrl+Alt+V` |

> [!NOTE]
> **Pi's built-in `app.clipboard.pasteImage` owns the table's first shortcut on every platform** — `Ctrl+V` on Linux/macOS, `Alt+V` on Windows — so the two conflict everywhere. When both fire on the shared key, the built-in throws warning banners (seen on Linux). Clear the built-in binding in `~/.pi/agent/keybindings.json` so the preview-enhanced handler takes the paste:
>
> ```json
> { "app.clipboard.pasteImage": [] }
> ```

## Per-platform requirements

- **Linux** — a graphical session (`DISPLAY` or `WAYLAND_DISPLAY`) and one of `wl-clipboard` (tried first on Wayland sessions), `xclip` (tried first on X11), or the `@mariozechner/clipboard` native module. Termux is not supported.
- **macOS** — the only image reader on macOS is the `@mariozechner/clipboard` native module (no other CLI fallback); it ships inside the `pi-coding-agent` installation but must be importable from the extension's location, so if your Pi install's layout puts it out of resolution reach, a read reports the reader as unavailable — make the module resolvable beside the extension and `/reload`.
- **Windows** — the `@mariozechner/clipboard` native module first, with a PowerShell fallback.

## Part of the suite

In [pi-archimedes](https://github.com/danielcherubini/pi-archimedes), image-paste works alongside the framed editor, the status bar, and the todo board; on/off is managed by the suite (`/plugins`, `archimedes.imagePaste.enabled`, default on).

← [Back to pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
