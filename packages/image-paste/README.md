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
- **Inline preview** — a preview of the attached images is sent and rendered in the TUI. Previews appear where your terminal renders inline images; on a terminal that can't show them, the image is still attached — only the preview falls back. Turn it off with `/archimedes` → Image Paste Preview, or `archimedes.imagePaste.preview: false`; images still attach.
- **Same key, wider scope** — the paste key is Pi's own (`app.clipboard.pasteImage`), and taking it means covering everything it did, so with no image on the clipboard the handler falls back to what Pi does: copied **file paths** are inserted at the cursor with Pi's own spacing, and otherwise the clipboard **text** is inserted. One keypress produces one outcome, in that order: image, then paths, then text. Nothing on the clipboard leaves the draft untouched and says nothing, exactly as Pi does.
- **Size guard** — 20 MiB **per image**, rejected with a clear message before it wastes context or hangs the submit.
- **Bounded reads** — every clipboard read has a deadline (the same budget Pi gives its own clipboard commands), so a helper that stops answering — an X11/Wayland session that went unresponsive, say — reports `Clipboard paste failed: … timed out` instead of silently taking the paste key out of service for the rest of the session.
- **Text stays text** — clipboard text is inserted as it is, with one exception: terminal escape bytes are dropped. The insert an extension has is a bracketed paste, so an escape byte coming from the clipboard would otherwise close the paste mid-string and swallow everything behind it.
- **Model side** — the session's model must support images for the attachment to be usable.

## Paste shortcuts

| Platform | Shortcuts |
|----------|-----------|
| Linux (X11/Wayland) | `Ctrl+V`, `Alt+V`, `Ctrl+Alt+V` |
| macOS | `Ctrl+V`, `Alt+V`, `Ctrl+Alt+V` |
| Windows | `Alt+V`, `Ctrl+Alt+V` |

> [!NOTE]
> **Pi's built-in `app.clipboard.pasteImage` owns the table's first shortcut on every platform** — `Ctrl+V` on Linux/macOS, `Alt+V` on Windows — so the two collide everywhere. They do **not** both run: an extension shortcut wins over a built-in that is not on Pi's reserved list, so Pi reports one `[Extension issues]` line (`Extension shortcut conflict: 'ctrl+v' is built-in shortcut for app.clipboard.pasteImage and <ext>. Using <ext>`) and its own action never fires — measured on Pi 1.2.0, one `Ctrl+V`, one insertion, this extension's. Clear the built-in binding in `~/.pi/agent/keybindings.json` so the preview-enhanced handler takes the paste cleanly:
>
> ```json
> { "$schema": "https://pi.dev/schemas/keybindings.schema.json", "app.clipboard.pasteImage": [] }
> ```
>
> The `$schema` line is optional — Pi skips that key when it loads the file — but it lets an editor validate the file against Pi's published keybindings schema, and it is exactly what the first-run offer below writes.
>
> **First-run offer (once ever, all platforms)** — when installed via the suite, on the first TUI session with image-paste enabled and with the suite going to hold the paste key (i.e. `suppressNativePaste` is not `false`), if `~/.pi/agent/keybindings.json` doesn't exist yet, the suite offers to create it with exactly the snippet above: accepting creates the file and then tells you to run `/reload` (measured on Pi 1.2.0, the context an event handler receives has no `reload`, so the automatic path is a notification and the cleared binding applies once you run it), declining or cancelling (Esc) never asks again — re-open by deleting `archimedes.imagePaste.keybindingsPromptDone` from `~/.pi/agent/settings.json`. With `suppressNativePaste: false` the offer never appears — an install that will not bind the key has nothing to unbind — and that way of skipping does not spend `keybindingsPromptDone`, so turning the flag back on still brings the offer.
>
> **Handing the key back to Pi** — `archimedes.imagePaste.suppressNativePaste: false` does two things, and both are needed: the package removes its own `app.clipboard.pasteImage` entry from `~/.pi/agent/keybindings.json` (that entry only, and only when the file holds nothing but it and this package's own `"$schema"` line — anything else is left byte-for-byte alone with a warning that names an entry only when the file really holds one), **and** it registers no paste shortcut at all. The second half is what makes the first one reachable: while a shortcut is registered Pi keeps it and its restored binding never runs. So with the flag off you get Pi's paste and lose this package's image attach, queue and preview on the paste key. `/new` or `/reload` applies a change to the setting — no restart. If the file could not be cleaned it is left exactly as it is and you get one warning naming it. What the key then does depends on the file: if it still carries `"app.clipboard.pasteImage": []` (or Pi's old name for that same action, `"pasteImage": []`, which Pi still reads as an unbinding), nothing answers the key until you delete that entry; if it does not — only `$schema`, other keys, or JSON that does not parse or cannot be read (Pi discards a file it cannot use and every action keeps its default) — Pi's own paste is already answering it. The warning names the file in every case, and the entry only where one is actually in there: a file of foreign keys, or a `$schema`-only file, is told there is nothing of ours to remove and nothing for it to edit, and a file that cannot be read or parsed is handed back to you to check, with Pi's fallback stated so you know what it is doing in the meantime.

## Per-platform requirements

- **Linux** — a graphical session (`DISPLAY` or `WAYLAND_DISPLAY`) and one of `wl-clipboard` (tried first on Wayland sessions), `xclip` (tried first on X11), or `@earendil-works/pi-tui` native clipboard bindings. Termux is not supported.
- **macOS** — `@earendil-works/pi-tui` bundled native clipboard helper.
- **Windows** — `@earendil-works/pi-tui` native clipboard helper first, with a PowerShell fallback.

## Settings

`~/.pi/agent/settings.json`, under `archimedes.imagePaste` (strict JSON):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabled` | bool | `true` | On/off for the extension, via `/plugins` (suite-managed) |
| `suppressNativePaste` | bool | `true` | `false` gives the paste key back to Pi: the suite's `app.clipboard.pasteImage` entry is removed from `~/.pi/agent/keybindings.json` (only that entry, only if the file holds nothing else but the suite's own `"$schema"` line) **and** no paste shortcut is registered. It also keeps the first-run offer silent — there is nothing to unbind — without spending `keybindingsPromptDone`, so turning it back on still brings the offer. You get Pi's paste and lose image attach / queue / preview on those keys. Applies at the next `/new` or `/reload`. Anything that is not the strict boolean `false` — `"false"`, `0` — keeps the default. |
| `preview` | bool | `true` | `false` stops the inline preview of attached images on submit. Images still attach. Also in `/archimedes` → Image Paste Preview. Read on every submit, so no `/reload` needed. Anything that is not the strict boolean `false` keeps the default. |
| `keybindingsPromptDone` | bool | `false` | Set true once the first-run keybindings.json offer has been answered (accept or decline); delete to re-open the offer |

In the suite on/off is managed by the suite: toggle via `/plugins` (`archimedes.imagePaste.enabled`, default on).

## Part of the suite

In [pi-archimedes](https://github.com/danielcherubini/pi-archimedes), image-paste works alongside the framed editor, the status bar, and the todo board; on/off is managed by the suite (`/plugins`, `archimedes.imagePaste.enabled`, default on).

← [Back to pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
