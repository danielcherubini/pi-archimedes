---
status: accepted
date: 2026-09-22
superseded-by:
---

# UI package extraction and bash tool styling

Visual and terminal presentation features (custom editor, border spinner animations, quips, thinking block renderer patch, startup splash logo, and new bash tool styling) are presentation concerns rather than foundational runtime primitives. We decided to extract these visual features out of `@pi-archimedes/core` into a dedicated package, `@pi-archimedes/ui`, and introduce the stylized `bash` tool.

We decided on:

- **A dedicated `@pi-archimedes/ui` package.** Rather than creating a one-off package for each tool's visual presentation (e.g. `packages/bash`), all terminal presentation enhancements belong together in `@pi-archimedes/ui`.
- **Pure foundational `core`.** `@pi-archimedes/core` is stripped of active UI hooks and visual components (`editor`, `thinking`, `startup`). `core` retains only non-UI primitives (`bus`, `bridge`, `settings-io`, `color`, `text`, `tool-render`, `chrome`, `overlay`, `profiler`). Shared modal framing helpers (`OVERLAY_CHROME`, `chrome.ts`, `overlay.ts`) remain in `core` so packages like `mcp` and `subagent` don't take on an unnecessary dependency on `ui`.
- **Bash tool styling.** In `packages/ui`, wrap Pi's built-in `createBashTool(cwd)` and register it via `pi.registerTool({ ...origBash, renderCall, renderResult })`. Execution behavior (process spawning, detach, timeouts, truncation spills, session env vars) remains untouched. The collapsed header renders bold `bash`, followed by a single line with an orange running indicator (`▸`), green checkmark (`✓`), or red cross (`✗`), the truncated muted command, and a live duration timer. Expanding with click or `ctrl+o` displays the full command prefixed with `$ ` and the complete stdout/stderr output.
- **Settings namespace `archimedes.ui` with migration.** Configuration is managed under `archimedes.ui` (`bashToolStyling`, `editorSpin*`, `compactThinking`, `autoCollapseThinking`, `mutedTheme`, `animationStyle`). On startup, an idempotent migration inspects `archimedes.core`, copies any existing UI setting keys into `archimedes.ui`, and cleans up the legacy keys in `archimedes.core`.
- **Plugin manifest.** `ui` is registered in `meta/src/plugins.ts` as an optional plugin with namespace `archimedes.ui` (default enabled, controllable via `/plugins`).

Considered and rejected:

- **A standalone `packages/bash` package:** Styling an existing built-in tool is a purely visual enhancement rather than a new tool like `mcp` or `ask`. Creating a separate package per tool renderer would fragment the monorepo unnecessarily.
- **Keeping visual features in `core`:** `core` is imported as a dependency by virtually every package in the suite. Packing custom editors, spinner animation loops, and ASCII logos into `core` bloated what was meant to be a lightweight foundation.

Consequences:
- `packages/core` becomes lighter and purely foundational.
- `@pi-archimedes/ui` becomes the single home for TUI styling, custom editors, thinking blocks, and shell tool rendering.
- Total package count in the monorepo increases from 12 to 13 (`core`, `ui`, `sudo`, `ask`, `footer`, `diff`, `image-paste`, `notify`, `subagent`, `todo`, `session-name`, `mcp`, `meta`).
