# @pi-archimedes/diff

Shiki-powered diff rendering for the [Pi coding agent](https://github.com/earendil-works/pi).

Syntax-highlighted, word-level diffs make reviewing code changes effortless. By rendering clear side-by-side or unified diffs directly in your terminal with themes matched to your environment, code modifications can be inspected at a glance before committing.

## What you get

- **Split and unified views** — side-by-side split diff or traditional unified view, auto-selected based on terminal width
- **Shiki syntax highlighting** — full syntax highlighting powered by [Shiki](https://shiki.style), with auto-derived theme colors
- **Word-level emphasis** — changed characters within lines are highlighted at word level for precise change tracking
- **Graceful fallback** — falls back to plain text diff when Shiki is unavailable or the language is unrecognized
- **Configurable thresholds** — control minimum terminal width for split view and minimum code width per side

## Screenshots

### Split diff view

Side-by-side diff with syntax highlighting, word-level emphasis on changed characters, and line numbers:

![diff edit](../../docs/images/diff-edit.png)

## Install

```bash
pi install npm:@pi-archimedes/diff
```

Or install full meta package:

```bash
pi install npm:pi-archimedes
```

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `diffTheme` | string | `github-dark` | Shiki syntax-highlighting theme |
| `diffSplitMinWidth` | number | `150` | Minimum terminal columns to show split diff view (≥ 100) |
| `diffSplitMinCodeWidth` | number | `60` | Minimum code columns per side in split view (≥ 30) |

Settings are stored in `~/.pi/agent/settings.json` under the `archimedes.diff` namespace.

## Integration

When installed via `pi-archimedes` (the meta package), the diff tools are registered with callbacks to the current theme and config, ensuring colors match your active Pi theme. Standalone installs use default dark theme colors.

← Back to [pi-archimedes](../../README.md)
