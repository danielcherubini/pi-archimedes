---
status: committed
done-when: The @pi-archimedes/ui package is created in packages/ui with bash tool styling (bold "bash" header, collapsed view with status glyphs [orange ▸ running, green ✓ success, red ✗ fail], muted truncated command, and live duration timer, expanding on click/ctrl+o to full command with "$ " and stdout/stderr output), editor (HephaestusEditor and border spinner), thinking (renderer patch and compact thinking), and startup splash animation migrated out of core into ui, settings migrated from archimedes.core to archimedes.ui, all unit tests passing, and meta and release pipeline updated.
---

# UI Package and Bash Tool Styling Plan

**Goal:** Create a dedicated `@pi-archimedes/ui` package that provides custom bash tool rendering (styled header, collapsed status/command/timer, expanded output) and absorbs existing visual presentation components (`editor`, `thinking`, `startup`) from `@pi-archimedes/core`.

**Architecture:** `@pi-archimedes/ui` encapsulates all Pi TUI extensions, custom editor logic, thinking block renderer patches, and tool overrides for terminal aesthetics, while `@pi-archimedes/core` retains only non-UI primitives (`bus`, `bridge`, `settings-io`, `color`, `text`, `tool-render`, `chrome`, `overlay`, `profiler`). Settings are migrated from `archimedes.core` to `archimedes.ui`, and the new package is wired into `meta` as an optional plugin.

**Tech Stack:** TypeScript, Node.js, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, pnpm workspaces, Vitest.

---

### Task 1: Package Scaffold & Monorepo Setup for `packages/ui`

**Context:**
Create the initial package structure for `@pi-archimedes/ui` in `packages/ui/` following monorepo rules from `AGENTS.md`. It must have matching version (`2.8.0`), `keywords: ["pi-package"]`, `"files": ["src"]`, `"pi": { "extensions": ["./src/index.ts"] }`, and internal workspace dependencies.

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/src/index.ts`
- Create: `packages/ui/src/index.test.ts`
- Modify: `meta/package.json`
- Modify: `.github/workflows/release.yml`

**What to implement:**
1. `packages/ui/package.json`:
   - Name: `@pi-archimedes/ui`
   - Version: `2.8.0`
   - Keywords: `["pi-package"]`
   - Files: `["src"]`
   - `pi.extensions`: `["./src/index.ts"]`
   - Dependencies: `"@pi-archimedes/core": "workspace:*"`
   - Peer dependencies: `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`
   - Exports: `.`, `./bash`, `./editor`, `./thinking`, `./startup`
2. `packages/ui/tsconfig.json`: matching `packages/todo/tsconfig.json`.
3. Minimal `packages/ui/src/index.ts` exporting a default extension factory function.
4. Minimal `packages/ui/src/index.test.ts` verifying default export.
5. Add `@pi-archimedes/ui: "workspace:*"` to `meta/package.json`.
6. Add `@pi-archimedes/ui` publish line to `.github/workflows/release.yml` after `@pi-archimedes/core` and before `meta`.

**Steps:**
- [ ] Create `packages/ui/package.json` and `packages/ui/tsconfig.json`
- [ ] Write failing test in `packages/ui/src/index.test.ts` checking default export of `packages/ui/src/index.ts`
- [ ] Run `pnpm --filter "@pi-archimedes/ui" test` or `npx vitest run packages/ui`
  - Did it fail with module not found or missing export?
- [ ] Implement scaffold in `packages/ui/src/index.ts`
- [ ] Run `npx vitest run packages/ui`
  - Did all tests pass?
- [ ] Update `meta/package.json` with dependency on `@pi-archimedes/ui: "workspace:*"`
- [ ] Update `.github/workflows/release.yml` with `pnpm --filter "@pi-archimedes/ui" publish --access public --no-git-checks`
- [ ] Run `pnpm install` at root
- [ ] Run `npx tsc --noEmit` in `packages/ui`
- [ ] Commit with message: "feat(ui): scaffold @pi-archimedes/ui package"

**Acceptance criteria:**
- [ ] `packages/ui` is recognized by pnpm workspace and typechecks cleanly with `npx tsc --noEmit`.
- [ ] `.github/workflows/release.yml` includes the publish step.

---

### Task 2: Migrate `editor`, `thinking`, and `startup` from `core` to `ui`

**Context:**
Visual presentation components currently live in `packages/core/src/editor/`, `packages/core/src/thinking/`, and `packages/core/src/startup/`. We move these modules and their unit tests to `packages/ui/src/`, updating their internal imports to import from `@pi-archimedes/core` (for `bus`, `color`, `text`, `chrome`, `settings-io`).

**Files:**
- Move: `packages/core/src/editor/*` → `packages/ui/src/editor/*`
- Move: `packages/core/src/thinking/*` → `packages/ui/src/thinking/*`
- Move: `packages/core/src/startup/*` → `packages/ui/src/startup/*`
- Create: `packages/ui/src/config.ts` (defining `UIConfig`, defaults, normalization)
- Create: `packages/ui/src/config.test.ts`
- Modify: Imports in migrated files to reference `@pi-archimedes/core/chrome`, `@pi-archimedes/core/color`, `@pi-archimedes/core/text`, `@pi-archimedes/core/bus`, `@pi-archimedes/core/settings-io`

**What to implement:**
1. Move `editor/` (`index.ts`, `spin.ts`, `spin-quips.ts`, and test files) to `packages/ui/src/editor/`.
2. Move `thinking/` (`patch.ts`, `theme.ts`, `transform.ts`, `unindent.ts`, and test files) to `packages/ui/src/thinking/`.
3. Move `startup/` (`index.ts`, `logo.ts`, `sections.ts`, `version.ts`, `capture.ts`, and test files) to `packages/ui/src/startup/`.
4. In `packages/ui/src/config.ts`:
   - Move UI-specific fields from `core/src/config.ts` into `UIConfig`:
     `editorSpinBorder`, `editorSpinSpeed`, `editorSpinStyle`, `editorSpinQuips`, `editorSpinLabel`,
     `mutedTheme`, `autoCollapseThinking`, `compactThinking`, `codeUnindent`, `labelText`, `labelColor`, `animationStyle`.
   - Provide `loadUIConfig()` and `saveUIConfig()` reading/writing `archimedes.ui`.
5. Update relative imports that used `../chrome.js`, `../bus.js`, `../color.js`, `../text.js`, `../settings-io.js` to use `@pi-archimedes/core/chrome`, `@pi-archimedes/core/bus`, `@pi-archimedes/core/color`, `@pi-archimedes/core/text`, `@pi-archimedes/core/settings-io`.

**Steps:**
- [ ] Move files from `packages/core/src/{editor,thinking,startup}` to `packages/ui/src/{editor,thinking,startup}`
- [ ] Create `packages/ui/src/config.ts` with `UIConfig` and `packages/ui/src/config.test.ts`
- [ ] Update import paths in `packages/ui/src/{editor,thinking,startup}/*.ts`
- [ ] Run `npx vitest run packages/ui`
  - Did all migrated unit tests pass in `packages/ui`?
- [ ] Run `npx tsc --noEmit` in `packages/ui`
- [ ] Commit with message: "refactor(ui): migrate editor, thinking, and startup to @pi-archimedes/ui"

**Acceptance criteria:**
- [ ] All unit tests for editor, thinking, and startup run and pass under `packages/ui`.
- [ ] `packages/ui` typechecks cleanly.

---

### Task 3: Clean up `packages/core`

**Context:**
Now that `editor`, `thinking`, and `startup` live in `packages/ui`, `packages/core` should be cleaned up. It should no longer register editor or thinking patches, and `core/src/config.ts` should only maintain core-level configuration (e.g. `bridge` or pure settings, if any). For backwards compatibility during transition, `core` will no longer export visual components.

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/index.test.ts`
- Modify: `packages/core/src/config.ts`
- Modify: `packages/core/src/config.test.ts`
- Modify: `packages/core/package.json`

**What to implement:**
1. In `packages/core/src/index.ts`:
   - Remove imports and registrations for `HephaestusEditor`, `renderHeader`, `patchStartupListing`, `patchThinkingRenderer`, `transformThinkingContent`.
   - `packages/core` default export registers `initBus()` and `registerBridge(pi)`.
   - Remove `getCoreSettingsItems` (visual settings moved to `packages/ui`).
2. In `packages/core/src/config.ts`:
   - Clean up UI keys from `CoreConfig` (they now belong to `UIConfig` in `packages/ui`).
   - Retain `loadCoreConfig` / `saveCoreConfig` for non-UI configuration.
3. Update `packages/core/src/index.test.ts` and `packages/core/src/config.test.ts` to test core's remaining responsibilities (bus, bridge, settings-io, pure helpers).
4. Run `npx vitest run packages/core` and `npx tsc --noEmit` in `packages/core`.

**Steps:**
- [ ] Update `packages/core/src/index.ts` to remove visual imports and registration
- [ ] Update `packages/core/src/config.ts` to remove UI config keys
- [ ] Update `packages/core/src/index.test.ts` and `config.test.ts`
- [ ] Run `npx vitest run packages/core`
  - Did all core tests pass?
- [ ] Run `npx tsc --noEmit` in `packages/core`
- [ ] Commit with message: "refactor(core): remove visual presentation modules from @pi-archimedes/core"

**Acceptance criteria:**
- [ ] `packages/core` has no dependencies on editor, thinking, or startup visual code.
- [ ] All tests in `packages/core` pass and typecheck passes.

---

### Task 4: Implement Bash Tool Styling in `packages/ui`

**Context:**
Implement custom rendering for Pi's built-in `bash` tool in `packages/ui/src/bash/`. It must render a bold `bash` header in `renderCall`, and a clean single-line collapsed view in `renderResult`:
` <status> <command in muted grey in one line truncated> (<time running>)`
Where `<status>` is:
- Orange `▸` (`theme.fg("warning", "▸")`) while in-flight / partial.
- Green `✓` (`theme.fg("success", "✓")`) on exit 0.
- Red `✗` (`theme.fg("error", "✗")`) on exit != 0 or error.
Upon clicking or expanding (`ctrl+o`), it displays:
- Full command prefixed with `$ ` (e.g. `$ pnpm test`).
- Full stdout/stderr output (streaming live if partial).
- Truncation notice if output spilled to disk: `[Truncated: showing X of Y lines. Full output: <path>]`.
- Summary footer with duration (`Took <duration>` / `Elapsed <duration>`) and final status (`✓ Done` / `✗ Command exited with code <code>`).

**Files:**
- Create: `packages/ui/src/bash/renderer.ts`
- Create: `packages/ui/src/bash/renderer.test.ts`
- Create: `packages/ui/src/bash/tool.ts`
- Create: `packages/ui/src/bash/tool.test.ts`
- Create: `packages/ui/src/bash/index.ts`

**What to implement:**
1. `packages/ui/src/bash/renderer.ts`:
   - `renderBashCall(args, theme, context)`:
     - Uses `renderToolHeader("bash", undefined, theme)` from `@pi-archimedes/core/tool-render`.
     - Returns `Text` component.
   - `renderBashResult(result, options, theme, context)`:
     - Reads `context.state` for `startedAt` and `endedAt`.
     - If `context.executionStarted && state.startedAt === undefined`: sets `state.startedAt = Date.now()`.
     - While `options.isPartial` and no interval: creates a 1s interval that calls `context.invalidate()`.
     - When not partial or error: records `endedAt` and clears interval.
     - Collapsed view (`!options.expanded`):
       - Line: ` <status> <command> (<duration>)`
       - Status glyph: `▸` (orange `warning`), `✓` (green `success`), `✗` (red `error`).
       - Command: single line, newlines replaced with spaces, formatted with `theme.fg("muted", truncatedCmd)`.
       - Duration: `(formatDuration(durationMs))` formatted dim.
     - Expanded view (`options.expanded`):
       - Full command line: `theme.fg("dim", "$ ") + theme.fg("toolOutput", command)`.
       - Output body: `theme.fg("toolOutput", output)` (or error colored if `context.isError`).
       - Truncation warning if `result.details?.truncation` and `fullOutputPath`.
       - Duration footer: `theme.fg("muted", `${isPartial ? "Elapsed" : "Took"} ${formatDuration(durationMs)}`)`.
       - Status line: `theme.fg("success", "✓ Done")` or `theme.fg("error", "✗ Command exited with code ...")`.
2. `packages/ui/src/bash/tool.ts`:
   - `registerBashToolOverride(pi, cwd)`:
     - Dynamically imports `@earendil-works/pi-coding-agent` (or accepts `createBashTool`).
     - Calls `origBash = createBashTool(cwd)`.
     - Registers with `pi.registerTool({ ...origBash, renderCall: renderBashCall, renderResult: renderBashResult })`.
3. Unit tests in `renderer.test.ts` and `tool.test.ts`:
   - Test collapsed rendering with running (orange ▸), success (green ✓), error (red ✗).
   - Test command line newline normalization and truncation.
   - Test live duration calculation.
   - Test expanded rendering with `$ ` prefix, output formatting, truncation notice, and status footer.
   - Test error handling when result content or args are empty or undefined.

**Steps:**
- [ ] Write failing unit tests in `packages/ui/src/bash/renderer.test.ts`
- [ ] Run `npx vitest run packages/ui/src/bash/renderer.test.ts`
  - Did tests fail as expected?
- [ ] Implement `packages/ui/src/bash/renderer.ts`
- [ ] Run `npx vitest run packages/ui/src/bash/renderer.test.ts`
  - Did all renderer tests pass?
- [ ] Write unit tests for tool override in `packages/ui/src/bash/tool.test.ts`
- [ ] Implement `packages/ui/src/bash/tool.ts` and `packages/ui/src/bash/index.ts`
- [ ] Run `npx vitest run packages/ui/src/bash/`
  - Did all tests pass?
- [ ] Run `npx tsc --noEmit` in `packages/ui`
- [ ] Commit with message: "feat(ui): implement styled bash tool renderer"

**Acceptance criteria:**
- [ ] Collapsed view matches specification (`<status> <command> (<duration>)` with orange/green/red status glyphs).
- [ ] Expanded view renders `$ <command>`, full output, truncation notices, and footer stats.
- [ ] Live duration interval runs during execution and clears upon completion.
- [ ] 100% test pass and clean typecheck.

---

### Task 5: Settings Management & One-Time Migration (`archimedes.ui`)

**Context:**
Configuration for UI components needs to live under `archimedes.ui`. We implement config load/save, settings menu items, and a one-time migration from `archimedes.core` to seamlessly preserve users' existing configurations for editor spinner, thinking, and splash animations.

**Files:**
- Create: `packages/ui/src/settings.ts`
- Create: `packages/ui/src/settings.test.ts`
- Create: `packages/ui/src/migration.ts`
- Create: `packages/ui/src/migration.test.ts`
- Modify: `packages/ui/src/index.ts`

**What to implement:**
1. `packages/ui/src/migration.ts`:
   - `migrateCoreToUIConfig()`:
     - Reads `archimedes.core` via `loadConfig`.
     - If keys like `editorSpinBorder`, `compactThinking`, `animationStyle`, `mutedTheme`, etc. exist in `archimedes.core`:
       - Copies them to `archimedes.ui` (only if not already set in `archimedes.ui`).
       - Removes the migrated keys from `archimedes.core` via `saveConfig`.
     - Idempotent: does nothing if `archimedes.core` has no UI keys.
2. `packages/ui/src/settings.ts`:
   - `getUISettingsItems(config: UIConfig)`:
     - Settings item for `bashToolStyling` ("Bash Tool Styling", toggle On/Off).
     - Settings items for thinking (`mutedTheme`, `autoCollapseThinking`, `compactThinking`, `codeUnindent`, `labelText`, `labelColor`).
     - Settings items for editor spinner (`editorSpinBorder`, `editorSpinSpeed`, `editorSpinStyle`, `editorSpinQuips`, `editorSpinLabel`).
     - Settings item for startup logo (`animationStyle`).
3. In `packages/ui/src/index.ts`:
   - `registerUI(pi)`:
     - Runs `migrateCoreToUIConfig()` at top level.
     - Reads `loadUIConfig()`.
     - If `config.bashToolStyling !== false`: registers bash tool override on `session_start`.
     - Registers `HephaestusEditor` on `session_start` (if editor spin enabled).
     - Registers startup logo/banner hook on `session_start`.
     - Applies `patchThinkingRenderer` on `session_start`.
     - Registers top-level `session_shutdown` handler for cleanup.
4. Unit tests in `migration.test.ts` and `settings.test.ts`.

**Steps:**
- [ ] Write failing tests for `migrateCoreToUIConfig()` in `packages/ui/src/migration.test.ts`
- [ ] Run `npx vitest run packages/ui/src/migration.test.ts`
  - Did tests fail as expected?
- [ ] Implement `packages/ui/src/migration.ts`
- [ ] Run `npx vitest run packages/ui/src/migration.test.ts`
  - Did all migration tests pass?
- [ ] Write failing tests for `getUISettingsItems()` in `packages/ui/src/settings.test.ts`
- [ ] Implement `packages/ui/src/settings.ts`
- [ ] Update `packages/ui/src/index.ts` to wire everything together
- [ ] Run `npx vitest run packages/ui`
  - Did all tests pass?
- [ ] Run `npx tsc --noEmit` in `packages/ui`
- [ ] Commit with message: "feat(ui): add archimedes.ui settings and migration from core"

**Acceptance criteria:**
- [ ] Existing `archimedes.core` UI settings are migrated to `archimedes.ui` once and deleted from core.
- [ ] `getUISettingsItems` returns valid SettingItem definitions for all UI features.
- [ ] `registerUI` registers bash tool styling, editor, thinking, and startup hooks cleanly.

---

### Task 6: Wire `ui` into `meta` & Update Monorepo Documentation

**Context:**
Register `@pi-archimedes/ui` in `meta/src/plugins.ts` and `meta/src/index.ts`. Update the `/archimedes` settings panel so it displays UI settings. Update `AGENTS.md`, `README.md`, and verify full monorepo typecheck and test suite.

**Files:**
- Modify: `meta/src/plugins.ts`
- Modify: `meta/src/index.ts`
- Modify: `meta/src/settings.ts`
- Modify: `meta/src/plugins.test.ts`
- Modify: `meta/src/settings.test.ts` (if applicable)
- Modify: `AGENTS.md`
- Modify: `README.md`

**What to implement:**
1. In `meta/src/plugins.ts`:
   - Add `ui` to `PLUGINS` manifest:
     `{ id: "ui", label: "UI Enhancements", description: "Bash styling, editor spinner, thinking collapse, splash animation", namespace: "archimedes.ui", load: () => import("@pi-archimedes/ui") }`
2. In `meta/src/index.ts`:
   - Import `registerUI` and `getUISettingsItems` from `@pi-archimedes/ui`.
   - Register UI when `isPluginEnabled("ui")`.
   - Update `/archimedes` settings integration to include `getUISettingsItems`.
3. In `AGENTS.md`:
   - Add `packages/ui` to the Monorepo Structure list.
   - Bump all package counts from 12 to 13 in the release steps and type-check steps.
   - Update the dependency publishing order line:
     `core → ui → sudo → ask → todo → notify → session-name → footer → diff → image-paste → subagent → mcp → meta`.
4. In `README.md`:
   - Add `@pi-archimedes/ui` to feature list, monorepo directory tree, selective install section (`pi install @pi-archimedes/ui`), and settings table (`archimedes.ui`).
5. Run full monorepo verification:
   - `pnpm test` across all packages.
   - `npx tsc --noEmit` in all 13 package directories.

**Steps:**
- [ ] Update `meta/src/plugins.ts` to add `ui` to `PLUGINS`
- [ ] Update `meta/src/index.ts` and `meta/src/settings.ts` to wire `registerUI` and UI settings
- [ ] Update `meta/src/plugins.test.ts` to verify `ui` plugin registration and presence in manifest
- [ ] Update `AGENTS.md` and `README.md` with `@pi-archimedes/ui`
- [ ] Run `pnpm test`
  - Did all tests pass across the entire monorepo?
- [ ] Run `npx tsc --noEmit` across all package directories
  - Did all typechecks pass?
- [ ] Commit with message: "feat(meta): wire @pi-archimedes/ui into meta and update docs"

**Acceptance criteria:**
- [ ] `/plugins` lists "UI Enhancements" with toggle capability.
- [ ] `/archimedes` settings includes UI settings items.
- [ ] All 13 packages typecheck without errors.
- [ ] Full `pnpm test` passes.
