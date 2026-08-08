# @pi-archimedes/image-paste

Paste images from your clipboard directly into the Pi chat with inline previews.

Paste images directly from clipboard into Pi chats without manually saving files to disk first. Sharing visual context like UI mockups or error screenshots becomes instant, while inline previews keep your prompt clean and predictable.

## What you get

- **Clipboard image paste** — grab a screenshot and paste it straight into the prompt
- **Inline previews** — images render in the TUI so you can see what you attached
- **Marker-based attachment** — placeholder markers (`[Image #1]`) are matched and attached on submit
- **Size guard** — rejects images over 20MB with a clear warning

## Install

```bash
pi install npm:@pi-archimedes/image-paste
```

Or install full meta package:

```bash
pi install npm:pi-archimedes
```

## Usage

With Pi focused, press the paste shortcut and any image in your clipboard is attached:

| Platform | Shortcut |
|----------|----------|
| Linux | `Ctrl+V` |
| macOS | `Ctrl+V` or `Alt+V` |
| Windows | `Alt+V` |

A `[Image #N]` placeholder is inserted into your draft. When you submit, any images referenced by markers are automatically attached to the message. If you remove the markers before submitting, the images are discarded.

## Settings

Uses Pi's core `terminal.showImages` setting to control inline previews. No package-specific settings.

## Troubleshooting

### `ctrl+v` shortcut conflict on Linux

Pi has a built-in `ctrl+v` handler (`app.clipboard.pasteImage`) that conflicts with this extension. You'll see a warning like:

```
Extension shortcut conflict: 'ctrl+v' is built-in shortcut for app.clipboard.pasteImage
```

**Fix:** Clear the built-in binding in `~/.pi/agent/keybindings.json`:

```json
{
  "app.clipboard.pasteImage": []
}
```

This lets archimedes' handler take over (it does the same thing plus inline previews) without the warning.

← Back to [pi-archimedes](../../README.md)
