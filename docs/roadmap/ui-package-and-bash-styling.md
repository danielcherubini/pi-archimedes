---
status: approved
done-when: A new @pi-archimedes/ui package is created in packages/ui with bash tool styling (bold "bash" header, collapsed view with status glyphs [orange ▸ running, green ✓ success, red ✗ fail], muted truncated command, and live duration timer, expanding on click/ctrl+o to full command with "$ " and stdout/stderr output), editor (HephaestusEditor and border spinner), thinking (renderer patch and compact thinking), and startup splash animation migrated out of core into ui, settings migrated to archimedes.ui, and integrated into meta and the release pipeline.
---

# UI Package and Bash Tool Styling Specification

## Overview
Create `@pi-archimedes/ui` as a dedicated package in the Archimedes monorepo for terminal presentation and visual styling. It introduces styled rendering for Pi's built-in `bash` tool (matching MCP and Todo styling conventions) and absorbs the visual components previously located in `@pi-archimedes/core` (`editor`, `thinking`, `startup`).

### Bash Tool Appearance
**Collapsed (default)**:
```text
bash
  <status> <bash command in muted grey in one line truncated> (<time running>)
```
Where `<status>` is:
- Orange `▸` (`theme.fg("warning", "▸")`) while executing in-flight (`isPartial: true`).
- Green `✓` (`theme.fg("success", "✓")`) on success (exit code 0).
- Red `✗` (`theme.fg("error", "✗")`) on failure (non-zero exit code or error).

**Expanded (on click or `ctrl+o`)**:
- Full command prefixed with `$ ` (e.g. `$ pnpm test`).
- Complete stdout/stderr output (streaming live if partial).
- Truncation warning if spilled to temp file (`[Truncated: showing X of Y lines. Full output: <path>]`).
- Summary footer with duration (`Took <duration>` / `Elapsed <duration>`) and final status (`✓ Done` / `✗ Command exited with code <code>`).

## Architecture & Package Structure

1. **`packages/ui` (`@pi-archimedes/ui`)**:
   - Monorepo package configured with `"keywords": ["pi-package"]`, `"files": ["src"]`, and `"pi": { "extensions": ["./src/index.ts"] }`.
   - Depends on `@pi-archimedes/core: "workspace:*"`, peerDependencies on `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`.
   - Subpath exports: `./bash`, `./editor`, `./thinking`, `./startup`.

2. **Components in `packages/ui`**:
   - **`bash`**: Wraps Pi's `createBashTool(cwd)` and registers custom `renderCall` and `renderResult`. Preserves standard execution behavior (process groups, timeouts, truncation spills, `PI_*` session env vars).
   - **`editor`**: Migrated from `packages/core/src/editor` (`HephaestusEditor`, border spinner animations, spin quips).
   - **`thinking`**: Migrated from `packages/core/src/thinking` (thinking patch, compact thinking, theme, transform, unindent).
   - **`startup`**: Migrated from `packages/core/src/startup` (logo animations, splash banner, console log capture).

3. **Pure Foundational `packages/core`**:
   - Retains non-visual runtime primitives: `bus`, `bridge`, `settings-io`, `color`, `text`, `tool-render`, `chrome`, `overlay`, `profiler`.
   - Re-exports removed from `core/src/index.ts`; `core` becomes focused solely on shared primitives.

4. **Settings & Migration**:
   - Settings namespace: `archimedes.ui`.
   - One-time migration on session start: copies legacy UI settings (`editorSpinBorder`, `compactThinking`, `animationStyle`, etc.) from `archimedes.core` into `archimedes.ui` and deletes the migrated keys from `archimedes.core`.
   - Settings UI (`getUISettingsItems`): exposes toggles for bash tool styling, editor spinner options, thinking block options, and startup animations.

5. **Meta & Release Integration**:
   - `meta/package.json`: Add dependency on `@pi-archimedes/ui: "workspace:*"`.
   - `meta/src/plugins.ts`: Add `ui` to `PLUGINS` manifest with namespace `archimedes.ui` (default enabled, controllable via `/plugins`).
   - `meta/src/index.ts`: Register `packages/ui` gated by `isPluginEnabled("ui")`.
   - `.github/workflows/release.yml`: Add publish step for `@pi-archimedes/ui`.
   - `AGENTS.md` and `README.md`: Update monorepo structure, package counts (13 packages total), and documentation.
