---
status: committed
done-when: The @pi-archimedes/ui package is created in packages/ui with bash tool styling (bold "bash" header, collapsed view with status glyphs [orange ▸ running, green ✓ success, red ✗ fail], muted truncated command, and live duration timer, expanding on click/ctrl+o to full command with "$ " and stdout/stderr output), editor (HephaestusEditor and border spinner), thinking (renderer patch and compact thinking), and startup splash animation migrated out of core into ui, settings migrated from archimedes.core to archimedes.ui, all unit tests passing, and meta and release pipeline updated.
---

# UI Package and Bash Tool Styling Plan

**Goal:** Create a dedicated `@pi-archimedes/ui` package providing custom bash tool rendering (styled header, collapsed status/command/timer, expanded output) and absorbing existing visual presentation components (`editor`, `thinking`, `startup`) from `@pi-archimedes/core`.

**Architecture:** `@pi-archimedes/ui` encapsulates all Pi TUI extensions, custom editor logic, thinking block renderer patches, and tool overrides for terminal aesthetics, while `@pi-archimedes/core` retains only non-UI primitives (`bus`, `bridge`, `settings-io`, `color`, `text`, `tool-render`, `chrome`, `overlay`, `profiler`). Settings are migrated from `archimedes.core` to `archimedes.ui`, and the new package is wired into `meta` as an optional plugin.

**Tech Stack:** TypeScript, Node.js, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, pnpm workspaces, Vitest.

---

### Task 1: Package Scaffold & Test Config for `packages/ui`

**Context:**
Create the initial package structure for `@pi-archimedes/ui` in `packages/ui/` following monorepo rules from `AGENTS.md`. It must have matching version (`2.8.0`), `keywords: ["pi-package"]`, `"files": ["src"]`, `"pi": { "extensions": ["./src/index.ts"] }`, `devDependencies` for local workspace symlinking, and internal workspace dependencies. Both a named `registerUI` and default export are scaffolded from the beginning so consumers (`meta` and standalone Pi) can load it cleanly. Its test suite must be wired into both its local `vitest.config.ts` and the root `vitest.config.ts`.

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/vitest.config.ts`
- Create: `packages/ui/src/index.ts`
- Create: `packages/ui/src/index.test.ts`
- Modify: `vitest.config.ts`
- Modify: `meta/package.json`
- Modify: `.github/workflows/release.yml`

**What to implement:**
1. `packages/ui/package.json`:
   - Name: `@pi-archimedes/ui`
   - Version: `2.8.0`
   - Type: `"module"`
   - Keywords: `["pi-package"]`
   - Files: `["src"]`
   - `main`: `./src/index.ts`
   - `pi.extensions`: `["./src/index.ts"]`
   - Dependencies: `"@pi-archimedes/core": "workspace:*"`
   - DevDependencies (required for pnpm workspace symlinking):
     ```json
     "devDependencies": {
       "@earendil-works/pi-ai": "^0.87.0",
       "@earendil-works/pi-coding-agent": "^0.87.0",
       "@earendil-works/pi-tui": "^0.87.0",
       "typescript": "^6.0.0"
     }
     ```
   - PeerDependencies: `@earendil-works/pi-ai: ">=0.1.0"`, `@earendil-works/pi-coding-agent: ">=0.1.0"`, `@earendil-works/pi-tui: ">=0.1.0"`
   - Exports:
     - `.`: `./src/index.ts`
     - `./bash`: `./src/bash/index.ts`
     - `./editor`: `./src/editor/index.ts`
     - `./thinking`: `./src/thinking/patch.ts`
     - `./startup`: `./src/startup/index.ts`
     - `./config`: `./src/config.ts`
2. `packages/ui/tsconfig.json`: matching `packages/todo/tsconfig.json`.
3. `packages/ui/vitest.config.ts`: matching `packages/core/vitest.config.ts` (`environment: "node"`, `include: ["src/**/*.test.ts"]`, `exclude: ["**/node_modules/**"]`).
4. Root `vitest.config.ts`: add `"packages/ui"` to the `projects` array.
5. `packages/ui/src/index.ts`:
   - Export named function `registerUI(pi: ExtensionAPI): void`.
   - Export default function `(pi: ExtensionAPI): void { registerUI(pi); }`.
6. `packages/ui/src/index.test.ts`: test both named `registerUI` and default export functions exist.
7. `meta/package.json`: add `"@pi-archimedes/ui": "workspace:*"` to `dependencies`.
8. `.github/workflows/release.yml`: add `pnpm --filter "@pi-archimedes/ui" publish --access public --no-git-checks --provenance` immediately after `@pi-archimedes/core` and before `@pi-archimedes/sudo`.

**Steps:**
- [ ] Create `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/vitest.config.ts`
- [ ] Add `"packages/ui"` to `projects` in root `vitest.config.ts`
- [ ] Write failing test in `packages/ui/src/index.test.ts`
- [ ] Run `npx vitest run packages/ui`
  - Did it fail with missing module / export?
- [ ] Implement scaffold in `packages/ui/src/index.ts` with named `registerUI` and default export
- [ ] Run `npx vitest run packages/ui`
  - Did tests pass?
- [ ] Add `@pi-archimedes/ui` to `meta/package.json`
- [ ] Add publish step with `--provenance` to `.github/workflows/release.yml`
- [ ] Run `pnpm install` at root
- [ ] Run `npx tsc --noEmit` in `packages/ui`
- [ ] Commit with message: "feat(ui): scaffold @pi-archimedes/ui package"

**Acceptance criteria:**
- [ ] `packages/ui` is recognized by pnpm workspace and typechecks cleanly without missing dependency errors.
- [ ] Root `npx vitest run` executes tests in `packages/ui`.
- [ ] `.github/workflows/release.yml` includes the `@pi-archimedes/ui` publish step with `--provenance`.

---

### Task 2: Migrate `editor`, `thinking`, and `startup` from `core` to `ui`

**Context:**
Move visual presentation directories (`editor/`, `thinking/`, `startup/`) and all associated configuration types/constants from `packages/core/src/` to `packages/ui/src/`. All cross-package imports (for bus, chrome, color, text, settings-io) must point to `@pi-archimedes/core/*`, while config imports resolve to the local `packages/ui/src/config.ts`. All `UIConfig` fields must be required (matching `CoreConfig`), preserving strict types with `exactOptionalPropertyTypes`.

**Files:**
- Move: `packages/core/src/editor/*` → `packages/ui/src/editor/*`
- Move: `packages/core/src/thinking/*` → `packages/ui/src/thinking/*`
- Move: `packages/core/src/startup/*` → `packages/ui/src/startup/*`
- Create: `packages/ui/src/config.ts`
- Create: `packages/ui/src/config.test.ts`
- Modify: Migrated files in `packages/ui/src/{editor,thinking,startup}/`

**What to implement:**
1. `packages/ui/src/config.ts`:
   - Move all UI-related configuration constants, types, and defaults:
     - `ANIMATION_STYLES`, `AnimationStyle`
     - `CompactThinking`, `COMPACT_THINKING_VALUES`, `normalizeCompactThinking`
     - `SpinnerStyle`, `SPIN_SPEED_MULT`
     - `UIConfig` interface with required properties:
       ```ts
       export interface UIConfig {
         bashToolStyling: boolean;
         mutedTheme: boolean;
         autoCollapseThinking: boolean;
         compactThinking: CompactThinking;
         codeUnindent: boolean;
         labelText: string;
         labelColor: string;
         animationStyle: AnimationStyle;
         editorSpinBorder: boolean;
         editorSpinSpeed: "slow" | "normal" | "fast";
         editorSpinLabel: string;
         editorSpinStyle: SpinnerStyle;
       }
       ```
     - Compatibility alias: `export type CoreConfig = UIConfig;` (so any internal code expecting `CoreConfig` compiles cleanly).
     - `DEFAULT_UI_CONFIG: UIConfig`: matching prior `DEFAULT_CORE_CONFIG` values plus `bashToolStyling: true`.
     - `loadUIConfig(): UIConfig`: reads `archimedes.ui` via `loadConfig(NAMESPACE, DEFAULT_UI_CONFIG)`.
     - `saveUIConfig(config: UIConfig): void`: writes `archimedes.ui` via `saveConfig(NAMESPACE, config)`.
2. Move files from `packages/core/src/editor/` to `packages/ui/src/editor/`:
   - `index.ts`, `index.test.ts`, `spin.ts`, `spin.test.ts`, `spin-quips.ts`, `spin-quips.test.ts`.
   - In `editor/index.ts`: update `import { SPIN_SPEED_MULT, type CoreConfig, type SpinnerStyle } from "../config.js"` → `import { SPIN_SPEED_MULT, type UIConfig, type SpinnerStyle } from "../config.js"`, and update `CoreConfig["editorSpinSpeed"]` → `UIConfig["editorSpinSpeed"]`.
   - Update imports in `editor/`:
     - `from "../chrome.js"` → `from "@pi-archimedes/core/chrome"`
     - `from "../color.js"` → `from "@pi-archimedes/core/color"`
     - `from "../text.js"` → `from "@pi-archimedes/core/text"`
     - `from "../config.js"` → `from "../config.js"` (resolves to local `packages/ui/src/config.js`)
3. Move files from `packages/core/src/thinking/` to `packages/ui/src/thinking/`:
   - `patch.ts`, `patch.test.ts`, `theme.ts`, `theme.test.ts`, `transform.ts`, `transform.test.ts`, `unindent.ts`, `unindent.test.ts`.
   - Update imports in `thinking/`:
     - `from "../color.js"` → `from "@pi-archimedes/core/color"`
     - `from "../text.js"` → `from "@pi-archimedes/core/text"` (in `theme.test.ts`)
     - `from "../config.js"` → `from "../config.js"` (resolves to local `packages/ui/src/config.js`)
4. Move files from `packages/core/src/startup/` to `packages/ui/src/startup/`:
   - `index.ts`, `capture.ts`, `logo.ts`, `logo.test.ts`, `sections.ts`, `sections.test.ts`, `version.ts`, `version.test.ts`.
   - In `startup/index.ts`: update `loadCoreConfig` to `loadUIConfig` from `../config.js`.
   - Update cross-package imports to `@pi-archimedes/core/color`, `@pi-archimedes/core/text`.
5. Run a check for any dangling `from "../`:
   - Verify that all relative imports in `packages/ui/src/{editor,thinking,startup}` point only to valid local files (like `../config.js`) or `@pi-archimedes/core/*`.
6. Unit tests:
   - `packages/ui/src/config.test.ts`: test `loadUIConfig`, `saveUIConfig`, normalization of `compactThinking`, and default values.
   - Run all migrated tests in `packages/ui`.

**Steps:**
- [ ] Move directories: `editor/`, `thinking/`, `startup/` from `packages/core/src/` to `packages/ui/src/`
- [ ] Write `packages/ui/src/config.ts` and `packages/ui/src/config.test.ts`
- [ ] Update imports across all migrated files in `packages/ui/src/`
- [ ] Run `npx vitest run packages/ui`
  - Did all migrated tests pass under `packages/ui`?
- [ ] Run `npx tsc --noEmit` in `packages/ui`
- [ ] Commit with message: "refactor(ui): migrate editor, thinking, and startup to @pi-archimedes/ui"

**Acceptance criteria:**
- [ ] All unit tests for editor, thinking, and startup pass under `packages/ui`.
- [ ] `packages/ui` typechecks cleanly with no dangling relative imports.

---

### Task 3: Implement Styled Bash Tool Renderer in `packages/ui`

**Context:**
Implement custom rendering for Pi's built-in `bash` tool in `packages/ui/src/bash/`. It uses Pi's `createBashToolDefinition(cwd, options)` from `@earendil-works/pi-coding-agent` (which returns a `ToolDefinition`, matching `pi.registerTool` parameter type, preserving execution, parameters, timeouts, and `PI_*` environment injection).
- `renderCall`: bold `bash` header.
- Collapsed view (`renderResult` when `!options.expanded`):
  ` <status> <command in muted grey in one line truncated> (<time running>)`
  Status glyphs:
  - Orange `▸` (`theme.fg("warning", "▸")`) while executing in-flight (`isPartial: true`).
  - Green `✓` (`theme.fg("success", "✓")`) on success (exit 0).
  - Red `✗` (`theme.fg("error", "✗")`) on failure (exit != 0 or error).
  Duration: live 1s interval timer calling `context.invalidate()` during execution.
- Expanded view (`renderResult` when `options.expanded`):
  - Full command prefixed with `$ ` (`theme.fg("dim", "$ ") + theme.fg("toolOutput", command)`).
  - Complete output text (streaming live if partial).
  - Truncation notice if output was spilled to disk: `[Truncated: showing X of Y lines. Full output: <path>]`.
  - Summary footer: `Took <duration>` (or `Elapsed <duration>`) and final status (`✓ Done` / `✗ Command exited with code <code>`).

**Files:**
- Create: `packages/ui/src/bash/renderer.ts`
- Create: `packages/ui/src/bash/renderer.test.ts`
- Create: `packages/ui/src/bash/tool.ts`
- Create: `packages/ui/src/bash/tool.test.ts`
- Create: `packages/ui/src/bash/index.ts`

**What to implement:**
1. `packages/ui/src/bash/renderer.ts`:
   - `formatDuration(ms: number): string`: format as `<X.X>s`, `<X>s`, or `<M>m <S>s`.
   - `renderBashCall(args: unknown, theme: Theme, context: unknown): Component`:
     - Uses `renderToolHeader("bash", undefined, theme)` from `@pi-archimedes/core/tool-render`.
     - Returns `Text` component.
   - `renderBashResult(result: unknown, options: { expanded?: boolean; isPartial?: boolean }, theme: Theme, context: unknown): Component`:
     - Reads/writes `context.state` for `startedAt: number`, `endedAt: number`, `interval: NodeJS.Timeout | undefined`.
     - Handles timer lifecycle:
       - If `context.executionStarted && state.startedAt === undefined`: sets `state.startedAt = Date.now()`.
       - While `options.isPartial` and `!state.interval`: sets `state.interval = setInterval(() => context.invalidate(), 1000)`.
       - If not partial or `context.isError`: sets `state.endedAt ??= Date.now()`; clears and nulls `state.interval`.
     - Collapsed view (`!options.expanded`):
       - Determines status: `isPartial ? "running" : (isError || result.isError ? "error" : "success")`.
       - Status glyph: `running` → `theme.fg("warning", "▸")`, `success` → `theme.fg("success", "✓")`, `error` → `theme.fg("error", "✗")`.
       - Command text: extracts `context.args?.command`, strips `\r` and `\n` to spaces, truncates to 70 chars with `…`, styled with `theme.fg("muted", truncatedCmd)`.
       - Elapsed duration: `theme.fg("dim", `(${formatDuration(elapsed)})`)`.
       - Returns `Text` with ` ${statusGlyph} ${styledCmd} ${styledDuration}`.
     - Expanded view (`options.expanded`):
       - Full command line: `theme.fg("dim", "$ ") + theme.fg("toolOutput", command)`.
       - Output lines: extracted from `result.content` (filtering text blocks), styled with `theme.fg(isError ? "error" : "toolOutput", line)`.
       - Truncation notice: if `result.details?.truncation?.truncated`, appends `theme.fg("warning", `[Truncated: showing ${details.truncation.outputLines} of ${details.truncation.totalLines} lines. Full output: ${details.fullOutputPath}]`)`.
       - Footer: `theme.fg("muted", `${isPartial ? "Elapsed" : "Took"} ${formatDuration(elapsed)}`)` and status line (`✓ Done` or `✗ Command exited with code ...`).
2. `packages/ui/src/bash/tool.ts`:
   - `registerBashToolOverride(pi: ExtensionAPI, cwd: string)`:
     - Uses `createBashToolDefinition(cwd)` from `@earendil-works/pi-coding-agent`.
     - Registers with `pi.registerTool({ ...def, renderCall: renderBashCall, renderResult: renderBashResult })`.
3. `packages/ui/src/bash/index.ts`:
   - Exports `renderBashCall`, `renderBashResult`, `registerBashToolOverride`, `formatDuration`.
4. Tests in `renderer.test.ts` and `tool.test.ts`:
   - Collapsed rendering in running, success, error states.
   - Command newline normalization and truncation.
   - Live timer tick and interval cleanup.
   - Expanded view formatting ($ prefix, output lines, truncation message, footer stats).

**Steps:**
- [ ] Write failing unit tests in `packages/ui/src/bash/renderer.test.ts`
- [ ] Run `npx vitest run packages/ui/src/bash/renderer.test.ts`
  - Did it fail as expected?
- [ ] Implement `packages/ui/src/bash/renderer.ts`
- [ ] Run `npx vitest run packages/ui/src/bash/renderer.test.ts`
  - Did all tests pass?
- [ ] Write unit tests for `registerBashToolOverride` in `packages/ui/src/bash/tool.test.ts`
- [ ] Implement `packages/ui/src/bash/tool.ts` and `packages/ui/src/bash/index.ts`
- [ ] Run `npx vitest run packages/ui/src/bash/`
  - Did all tests pass?
- [ ] Run `npx tsc --noEmit` in `packages/ui`
- [ ] Commit with message: "feat(ui): implement styled bash tool renderer"

**Acceptance criteria:**
- [ ] Collapsed bash row displays orange `▸` when running, green `✓` on success, red `✗` on failure, with muted command and live duration.
- [ ] Expanded bash row displays full command with `$ ` prefix, output, truncation notice, and duration footer.
- [ ] `createBashToolDefinition` is used as base definition.
- [ ] 100% unit test coverage for bash renderer and clean typecheck.

---

### Task 4: UI Settings, Migration & Complete Extension Lifecycle

**Context:**
Create settings items and one-time migration for `archimedes.ui`. Wire the complete `registerUI` extension function in `packages/ui/src/index.ts`, porting the full splash-screen, editor, and thinking lifecycle verbatim from `packages/core/src/index.ts` (including `ListingRef`, `setHeader(headerFactory)`, `patchStartupListing`, `HephaestusEditor`, `setWorkingVisible`, spin interval reaping, and matching teardown in `session_shutdown`). Re-export `unpatchConsoleLog`, `getUISettingsItems`, `loadUIConfig`, `saveUIConfig`, `DEFAULT_UI_CONFIG`, `UIConfig`, and `ANIMATION_STYLES` from `packages/ui/src/index.ts`. Port the comprehensive lifecycle tests from the old core test into `packages/ui/src/index.test.ts`.

**Files:**
- Create: `packages/ui/src/migration.ts`
- Create: `packages/ui/src/migration.test.ts`
- Create: `packages/ui/src/settings.ts`
- Create: `packages/ui/src/settings.test.ts`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/src/index.test.ts`

**What to implement:**
1. `packages/ui/src/migration.ts`:
   - `migrateCoreToUIConfig(): void`:
     - Checks `loadConfig("archimedes.core", {})`.
     - Identifies UI keys: `editorSpinBorder`, `editorSpinSpeed`, `editorSpinStyle`, `editorSpinQuips`, `editorSpinLabel`, `mutedTheme`, `autoCollapseThinking`, `compactThinking`, `codeUnindent`, `labelText`, `labelColor`, `animationStyle`.
     - If UI keys exist in core: copies them to `archimedes.ui` (only if not already set in `archimedes.ui`), then deletes those keys from `archimedes.core`.
     - Idempotent: does nothing if core has no UI keys.
2. `packages/ui/src/settings.ts`:
   - `getUISettingsItems(config: UIConfig): SettingItem[]`:
     - `bashToolStyling`: "Bash Tool Styling", values ["On", "Off"].
     - Thinking settings: `mutedTheme`, `autoCollapseThinking`, `compactThinking`, `codeUnindent`, `labelText`, `labelColor`.
     - Editor settings: `editorSpinBorder`, `editorSpinSpeed`, `editorSpinStyle`, `editorSpinLabel`.
     - Startup setting: `animationStyle`.
3. `packages/ui/src/index.ts`:
   - Root re-exports:
     - `export { unpatchConsoleLog } from "./startup/capture.js";`
     - `export { getUISettingsItems } from "./settings.js";`
     - `export { loadUIConfig, saveUIConfig, DEFAULT_UI_CONFIG, ANIMATION_STYLES, type UIConfig } from "./config.js";`
     - `export { registerUI }` and `export default (pi) => registerUI(pi);`
   - `registerUI(pi: ExtensionAPI)`:
     - Runs `migrateCoreToUIConfig()` at top level.
     - Calls `patchConsoleLog()` during startup.
     - Subscribes `session_start` to:
       - Load `UIConfig`.
       - If `config.bashToolStyling !== false`: call `registerBashToolOverride(pi, ctx.cwd)`.
       - If `ctx.hasUI`:
         - Thinking: apply `patchThinkingRenderer()`, wire `transformThinkingContent` via `context` event.
         - Splash header: create `ListingRef`, install `ctx.ui.setHeader(headerFactory)` where `headerFactory` calls `renderHeader(theme, ref, width, tui.terminal.rows - 3)`, and call `patchStartupListing(tui, theme, ref)`.
         - Editor: if `config.editorSpinBorder`, install `HephaestusEditor` via `ctx.ui.setEditorComponent(...)` and manage border spinner intervals.
     - Registers top-level `session_shutdown`:
       - Restores `unpatchConsoleLog()`.
       - Settles `ListingRef`, restores patched `addChild`, clears animation and debounce timers.
       - Restores `ctx.ui.setWorkingVisible(true)`.
       - Reaps editor spin intervals and resets editor component `ctx.ui.setEditorComponent(undefined)`.
4. `packages/ui/src/index.test.ts`:
   - Port all lifecycle tests previously covering editor/thinking/splash from `packages/core/src/index.test.ts`:
     - Test that `registerUI` registers `session_start` and `session_shutdown`.
     - Test that `session_start` sets header and editor component when `hasUI` is true.
     - Test that `session_shutdown` reaps spin timers, unpatches console log, restores `addChild`, and clears editor component.
     - Test that bash tool override is registered when `bashToolStyling` is true.

**Steps:**
- [ ] Write failing test for `migrateCoreToUIConfig` in `packages/ui/src/migration.test.ts`
- [ ] Implement `packages/ui/src/migration.ts`
- [ ] Run `npx vitest run packages/ui/src/migration.test.ts`
  - Did all migration tests pass?
- [ ] Write failing test for `getUISettingsItems` in `packages/ui/src/settings.test.ts`
- [ ] Implement `packages/ui/src/settings.ts`
- [ ] Complete `packages/ui/src/index.ts` with complete `registerUI` lifecycle and all root re-exports
- [ ] Write lifecycle test suite in `packages/ui/src/index.test.ts`
- [ ] Run `npx vitest run packages/ui`
  - Did all tests pass?
- [ ] Run `npx tsc --noEmit` in `packages/ui`
- [ ] Commit with message: "feat(ui): add settings, migration, root re-exports, and full extension lifecycle"

**Acceptance criteria:**
- [ ] `migrateCoreToUIConfig` moves legacy keys to `archimedes.ui` without data loss.
- [ ] `getUISettingsItems` provides full settings configuration including `bashToolStyling`.
- [ ] Root exports include `registerUI`, `unpatchConsoleLog`, `getUISettingsItems`, `loadUIConfig`, `saveUIConfig`, `DEFAULT_UI_CONFIG`, `UIConfig`.
- [ ] `packages/ui/src/index.test.ts` passes and covers full lifecycle.

---

### Task 5: Clean up `packages/core` and Rewire `meta` in Tandem

**Context:**
To keep the monorepo build and typecheck green at every step, clean up `packages/core` and rewire `meta` in the same task:
- In `packages/core`:
  - `packages/core/src/index.ts`: remove all visual imports and registrations (`HephaestusEditor`, `renderHeader`, `patchStartupListing`, `patchConsoleLog`, `unpatchConsoleLog`, `patchThinkingRenderer`, `transformThinkingContent`, `getCoreSettingsItems`). `registerCore(pi: ExtensionAPI)` now only registers `initBus()` and `registerBridge(pi)`. Remove `./editor`, `./thinking`, `./startup` from `core/package.json` exports.
  - `packages/core/src/config.ts`: clean `CoreConfig` to empty `{}` interface (`export interface CoreConfig {}`, `DEFAULT_CORE_CONFIG = {}`, `loadCoreConfig() { return {}; }`, `saveCoreConfig() {}`).
  - `packages/core/src/index.test.ts`: **rewrite completely** to test only `registerCore` registering `initBus` and `registerBridge(pi)` (removing all editor/thinking/startup/settings mocks and assertions).
  - `packages/core/src/config.test.ts`: update to test the minimal core config.
- In `meta`:
  - `meta/src/config.ts`:
    - Update return-type annotation of `loadAllConfig()`:
      ```ts
      export function loadAllConfig(): {
        core: CoreConfig;
        ui: UIConfig;
        footer: FooterConfig;
        diff: DiffConfig;
        notify: NotifyConfig;
        sessionName: SessionNameSettings;
      }
      ```
    - Import and re-export `loadUIConfig`, `saveUIConfig`, `DEFAULT_UI_CONFIG`, `type UIConfig`, `ANIMATION_STYLES` from `@pi-archimedes/ui/config`.
    - In `loadAllConfig()`: add `ui: loadUIConfig()`.
  - `meta/src/settings.ts`:
    - Import `getUISettingsItems`, `saveUIConfig`, `type UIConfig` from `@pi-archimedes/ui`.
    - In `buildSettingsItems`: replace `getCoreSettingsItems({ ...allConfig.core })` with `getUISettingsItems({ ...allConfig.ui })`.
    - In `openSettings`: rename local `const coreConfig: CoreConfig` to `const uiConfig: UIConfig = { ...allConfig.ui };`.
    - In the `switch` statement: route all UI setting branches (`mutedTheme`, `autoCollapseThinking`, `compactThinking`, `codeUnindent`, `editorSpin*`, `labelText`, `labelColor`, `animationStyle`, `bashToolStyling`) to `uiConfig`.
    - In `onSave`: replace `saveCoreConfig(coreConfig)` with `saveUIConfig(uiConfig)` (drop `saveCoreConfig`).
  - `meta/src/plugins.ts`:
    - Add `ui` plugin definition to `PLUGINS`:
      `{ id: "ui", label: "UI Enhancements", description: "Bash styling, editor spinner, thinking collapse, splash animation", namespace: "archimedes.ui", load: () => import("@pi-archimedes/ui") }`.
  - `meta/src/index.ts`:
    - Import `registerUI`, `unpatchConsoleLog` from `@pi-archimedes/ui`.
    - Retain `registerCore(pi)` for foundational bus/bridge.
    - Add `if (isPluginEnabled("ui")) registerUI(pi);` with `archTime("registerUI")`.
    - Call `unpatchConsoleLog()` in `session_shutdown`.
  - Update `meta/src/plugins.test.ts`:
    - Add `"ui"` to `EXPECTED_IDS` array (lines 188-203).
    - Update test title from `"lists exactly the 10 non-core packages (no drift)"` to `"lists exactly the 11 non-core packages (no drift)"`.
    - Replace the `@pi-archimedes/core` mock for `getCoreSettingsItems` with a mock of `@pi-archimedes/ui` exporting `getUISettingsItems: vi.fn(() => [])`.
  - Update `meta/src/factory-lifecycle.test.ts`:
    - Keep `registerCore: vi.fn()` in `@pi-archimedes/core` mock.
    - Add `vi.mock("@pi-archimedes/ui", () => ({ registerUI: vi.fn(), unpatchConsoleLog: vi.fn() }))`.
    - Update expectations for shutdown to verify `unpatchConsoleLog` from `@pi-archimedes/ui` was called.

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/index.test.ts`
- Modify: `packages/core/src/config.ts`
- Modify: `packages/core/src/config.test.ts`
- Modify: `packages/core/package.json`
- Modify: `meta/src/config.ts`
- Modify: `meta/src/settings.ts`
- Modify: `meta/src/plugins.ts`
- Modify: `meta/src/index.ts`
- Modify: `meta/src/plugins.test.ts`
- Modify: `meta/src/factory-lifecycle.test.ts`

**Steps:**
- [ ] Clean up `packages/core/src/index.ts`, `config.ts`, `package.json`
- [ ] Rewrite `packages/core/src/index.test.ts` and update `config.test.ts`
- [ ] Update `meta/src/config.ts` and `meta/src/settings.ts`
- [ ] Add `ui` to `PLUGINS` in `meta/src/plugins.ts`
- [ ] Update `meta/src/index.ts` with `registerUI` and `unpatchConsoleLog` from `@pi-archimedes/ui`
- [ ] Update `meta/src/plugins.test.ts` (`EXPECTED_IDS`, test title, mock) and `meta/src/factory-lifecycle.test.ts`
- [ ] Run `npx vitest run packages/core`
- [ ] Run `cd meta && npx vitest run`
- [ ] Run `npx vitest run` at root
- [ ] Run `npx tsc --noEmit` in `packages/core`, `packages/ui`, and `meta`
- [ ] Commit with message: "refactor: decouple core from UI and rewire meta to @pi-archimedes/ui"

**Acceptance criteria:**
- [ ] `packages/core` has no visual components or UI settings.
- [ ] `packages/core/src/index.test.ts` passes cleanly testing core bus/bridge.
- [ ] `meta` compiles and passes all unit tests using `@pi-archimedes/ui`.
- [ ] `cd meta && npx vitest run` passes 100%.
- [ ] All tests across root and meta pass cleanly.

---

### Task 6: Documentation and Monorepo Release Checklist

**Context:**
Complete all documentation requirements from `AGENTS.md` rule 7: create `packages/ui/README.md`, update `packages/core/README.md`, top-level `README.md`, and `AGENTS.md`. Update all package counts in `AGENTS.md` ("eleven" → "twelve", "12" → "13", "11 package directories" → "12 package directories"). Verify full monorepo type-checking across all 13 package directories.

**Files:**
- Create: `packages/ui/README.md`
- Modify: `packages/core/README.md`
- Modify: `README.md`
- Modify: `AGENTS.md`

**What to implement:**
1. `packages/ui/README.md`:
   - Feature documentation for bash tool styling (collapsed & expanded views, live timer, status indicators).
   - Editor documentation (HephaestusEditor, border spinner animations, spin quips).
   - Thinking documentation (compact thinking, collapsible thinking, theme).
   - Startup documentation (splash logo reveal animations).
   - Settings table for `archimedes.ui` (`bashToolStyling`, `editorSpin*`, `compactThinking`, `labelText`, `animationStyle`, etc.).
   - Standalone install instructions: `pi install @pi-archimedes/ui`.
2. `packages/core/README.md`:
   - Remove editor, thinking, and splash screen sections and settings table.
   - Describe core's role: foundational non-UI runtime (bus, bridge, settings-io, pure text/color/tool-render utilities, overlay chrome).
3. `README.md`:
   - Add `@pi-archimedes/ui` feature section and bash tool styling summary.
   - Update layout tree to include `packages/ui`.
   - Update selective install list with `pi install @pi-archimedes/ui`.
   - Update components table and settings namespaces table (`archimedes.ui`).
4. `AGENTS.md`:
   - Add `packages/ui` to Monorepo Structure list:
     `- packages/ui — TUI enhancements: bash tool styling, custom editor, border spinner, thinking collapse, splash animation (depends on core)`.
   - Line 18: update `"depends on all eleven"` → `"depends on all twelve"`.
   - Line 113: update `"Bump all 12 package versions"` → `"Bump all 13 package versions"` and add `packages/ui` to the list.
   - Line 115: update `"11 package directories (10 components + session-name)"` → `"12 package directories (11 components + session-name)"`.
   - Update dependency publish order line in Publishing section:
     `core → ui → sudo → ask → todo → notify → session-name → footer → diff → image-paste → subagent → mcp → meta`.
5. Monorepo verification:
   - `pnpm test` at root (runs all 12 vitest projects, meta excluded).
   - `cd meta && npx vitest run` (runs meta tests).
   - `pnpm -r exec -- tsc --noEmit` (runs typecheck across all 13 package directories).

**Steps:**
- [ ] Create `packages/ui/README.md`
- [ ] Update `packages/core/README.md`
- [ ] Update top-level `README.md`
- [ ] Update `AGENTS.md`
- [ ] Run `pnpm test`
- [ ] Run `cd meta && npx vitest run`
- [ ] Run `pnpm -r exec -- tsc --noEmit`
- [ ] Commit with message: "docs: add @pi-archimedes/ui documentation and update monorepo checklist"

**Acceptance criteria:**
- [ ] All 13 package directories typecheck without errors (`pnpm -r exec -- tsc --noEmit`).
- [ ] All test suites (root `pnpm test` and `cd meta && npx vitest run`) pass.
- [ ] `packages/ui/README.md`, `packages/core/README.md`, `README.md`, and `AGENTS.md` reflect the updated 13-package monorepo architecture.
