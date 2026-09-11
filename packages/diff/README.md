# @pi-archimedes/diff

**Shiki-powered syntax-highlighted side-by-side and unified diffs for the [Pi coding agent](https://github.com/earendil-works/pi).**

Reviewing code modifications in raw text diffs leads to missed regressions and eye strain. `@pi-archimedes/diff` brings full syntax highlighting powered by [Shiki](https://shiki.style) directly into your terminal, with adaptive split side-by-side views, word-level change emphasis, and colors that match your active terminal theme.

<div align="center">
  <img src="https://raw.githubusercontent.com/danielcherubini/pi-archimedes/main/docs/images/diff-edit.png" width="700" alt="Shiki syntax-highlighted split diff">
</div>

## Quick Start

### 1. Install Pi (if needed)

```bash
npm install -g @earendil-works/pi-coding-agent
```

### 2. Install

Install standalone:

```bash
pi install npm:@pi-archimedes/diff
```

Or install the complete [pi-archimedes](https://github.com/danielcherubini/pi-archimedes) development cockpit:

```bash
pi install npm:pi-archimedes
```

---

## What You Get

- **Split & Unified Views** — Side-by-side split diff or traditional unified view, automatically selected based on terminal column width.
- **Shiki Syntax Highlighting** — Full language-aware syntax highlighting powered by Shiki with theme-derived palettes.
- **Word-Level Emphasis** — Sub-line character diffs highlight exactly which tokens or words were altered.
- **Graceful Fallback** — Transparently falls back to plain text diffs when Shiki is unavailable or for unrecognized binary/text formats.
- **Configurable Thresholds** — Fine-tune minimum terminal width and code column budgets for split rendering.

---

## Settings

Settings are stored in `~/.pi/agent/settings.json` under the `archimedes.diff` namespace (or configured interactively via `/archimedes`):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `diffTheme` | string | `github-dark` | Shiki syntax-highlighting theme |
| `diffSplitMinWidth` | number | `150` | Minimum terminal columns required to show split view (≥ 100) |
| `diffSplitMinCodeWidth` | number | `60` | Minimum code columns per side in split view (≥ 30) |

---

## Part of the Archimedes Suite

When installed via [pi-archimedes](https://github.com/danielcherubini/pi-archimedes), the diff renderer integrates with Pi's active theme, ensuring syntax colors blend seamlessly into your editor and chrome.

← Back to [pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
