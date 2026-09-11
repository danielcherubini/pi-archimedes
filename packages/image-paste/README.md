# @pi-archimedes/image-paste

**Direct clipboard image pasting with inline terminal previews for the [Pi coding agent](https://github.com/earendil-works/pi).**

Paste screenshots and UI mockups directly into your prompt from your system clipboard without manually saving temporary image files to disk. Instant inline terminal previews ensure your prompts stay clean, accurate, and visually contextualized before submission.

## Quick Start

### 1. Install Pi (if needed)

```bash
npm install -g @earendil-works/pi-coding-agent
```

### 2. Install

Install standalone:

```bash
pi install npm:@pi-archimedes/image-paste
```

Or install the complete [pi-archimedes](https://github.com/danielcherubini/pi-archimedes) development cockpit:

```bash
pi install npm:pi-archimedes
```

---

## What You Get

- **Clipboard Image Paste** — Capture a screenshot with your OS tool and hit paste straight into Pi.
- **Inline Previews** — Renders an inline terminal preview of attached images directly in the TUI.
- **Marker-Based Attachment** — Clean placeholder markers (`[Image #1]`) indicate attachments without cluttering your prompt text.
- **Size Protection** — Rejects files over 20MB with a clear warning before wasting context tokens or hanging uploads.

---

## Usage

With your Pi session focused, press your platform paste shortcut:

| Platform | Shortcut |
|----------|----------|
| Linux | `Ctrl+V` |
| macOS | `Ctrl+V` or `Alt+V` |
| Windows | `Alt+V` |

> [!NOTE]
> **Linux Shortcut Tip:** On Linux, `Ctrl+V` is also Pi's built-in binding for `app.clipboard.pasteImage`. To enable Archimedes' preview-enhanced handler without warning banners, clear the built-in binding in `~/.pi/agent/keybindings.json`:
> ```json
> { "app.clipboard.pasteImage": [] }
> ```

---

## Part of the Archimedes Suite

`@pi-archimedes/image-paste` is included in the [pi-archimedes](https://github.com/danielcherubini/pi-archimedes) suite, fully configured to work alongside the framed editor, todo tracker, and status bar.

← Back to [pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
