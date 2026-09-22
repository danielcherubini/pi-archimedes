---
status: approved
done-when: A new @pi-archimedes/bash package overrides the bash tool rendering in Pi with an Archimedes-styled header (bold "bash"), a clean single-line collapsed view showing status (orange ▸ running, green ✓ success, red ✗ fail), truncated muted command, and live elapsed timer, which expands on click/ctrl+o to show the full command and complete output.
---

# Bash Tool Styling Specification

## Overview
Style the Pi built-in `bash` tool to match the design conventions established by `@pi-archimedes/mcp` and `@pi-archimedes/todo`.

Collapsed appearance:
```text
bash
  <status> <bash command in muted grey in one line truncated> (<time running>)
```
Where `<status>` is:
- Orange `▸` while in-flight / executing (`isPartial: true`).
- Green `✓` on successful completion (exit code 0).
- Red `✗` on failure (non-zero exit code or execution error).

Clicking or toggling expansion (`ctrl+o`) expands to the full bash command with `$ ` prefix followed by stdout/stderr output.

## Package Architecture
- **Location**: `packages/bash` (`@pi-archimedes/bash`)
- **Type**: Standalone pi-package in the Archimedes monorepo, integrated into `meta` and controlled via `/plugins` (`archimedes.bash`).
- **Dependencies**: `@pi-archimedes/core`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`.

## Implementation Details

### 1. Tool Wrapping & Execution
- In `packages/bash/src/index.ts`, instantiate the built-in bash tool via `createBashTool(cwd)` from `@earendil-works/pi-coding-agent`.
- Register the tool override via `pi.registerTool({ ...origBash, renderCall, renderResult })`.
- Delegates execution completely to Pi's core `createBashTool`, preserving standard process spawning, detached process trees, output truncation, temp file spilling, and `PI_*` session environment variable injection.

### 2. Header Slot (`renderCall`)
- Uses `renderToolHeader("bash", undefined, theme)` from `@pi-archimedes/core/tool-render`.
- Renders `bash` in bold `toolTitle` foreground.

### 3. Collapsed View (`renderResult`, `expanded: false`)
- Single line layout: ` <status> <command> (<duration>)`
- **Status Indicator**:
  - In flight: `theme.fg("warning", "▸")` (orange running glyph)
  - Success: `theme.fg("success", "✓")` (green checkmark)
  - Failure: `theme.fg("error", "✗")` (red cross)
- **Command Preview**:
  - Strips/replaces newlines with spaces.
  - Formatted in `theme.fg("muted", command)` (muted grey).
  - Truncated cleanly to visual length (e.g., 70-80 chars with `…`).
- **Duration & Live Timer**:
  - Formatted as `(1.2s)`, `(45s)`, `(2m 14s)`.
  - Dim/muted styling.
  - While running (`options.isPartial: true`), maintains an interval timer (1s) calling `context.invalidate()` to update the live elapsed time.
  - Clears interval immediately upon completion or unmount/shutdown.

### 4. Expanded View (`renderResult`, `expanded: true`)
- **Command Block**:
  - Displays full bash command prefixed with `$ ` (e.g. `$ pnpm test`).
  - Preserves formatting and multi-line commands.
- **Output Block**:
  - Full output text from `result.content` (stdout and stderr).
  - While running, streams live output chunks as they arrive.
  - In error states, styles error message appropriately.
  - Displays truncation warning if output was spilled to disk: `[Truncated: showing X of Y lines. Full output: <path>]`.
- **Footer**:
  - Duration: `Took <duration>` (completed) or `Elapsed <duration>` (running).
  - Status summary: `✓ Done` or `✗ Command exited with code <code>`.

### 5. Monorepo Checklist Updates
- `packages/bash/package.json`: Version matching monorepo (`1.2.0`), `keywords: ["pi-package"]`, `files: ["src"]`, `pi.extensions: ["./src/index.ts"]`.
- `meta/package.json`: Add dependency.
- `meta/src/plugins.ts`: Add `bash` to `PLUGINS` manifest.
- `meta/src/index.ts`: Register gated by `isPluginEnabled("bash")`.
- `.github/workflows/release.yml`: Add publish step.
- `AGENTS.md` and `README.md`: Add package to documentation and package lists.
