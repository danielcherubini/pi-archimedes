# Monorepo Split Plan

**Goal:** Split `pi-ui-hephaestus` into a mono-repo with independent npm workspace packages: `@pi-archimedes/core`, `@pi-archimedes/footer`, `@pi-archimedes/diff`, `@pi-archimedes/image-paste`, and umbrella package `pi-archimedes`.

**Architecture:** npm workspaces monorepo with 5 packages. Core provides bus (pub/sub via globalThis Symbol), chrome (palette/theme helpers), text/color utilities, and the main UI modules (editor, message, startup, thinking). Footer depends on core. Diff and image-paste are standalone. Meta-package depends on all four for one-line install.

**Tech Stack:** TypeScript (ESM, no build step — loaded via jiti by pi), npm workspaces, pi extension API (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`).

**Source:** All code is adapted from `/home/daniel/Coding/Javascript/pi-ui-hephaestus/src/`. Import paths must be updated:
- **Within a package:** always use relative paths (e.g., `from "../chrome.js"`)
- **Cross-package:** use package subpath exports (e.g., `from "@pi-archimedes/core/bus"`)

**Not ported:** `src/utils/index.ts` (barrel file — its exports are absorbed into `text.ts` and `color.ts`).

**Config:** Each package reads its own namespace from `~/.pi/agent/settings.json` under `archimedes.{core|footer|diff}`. No migration from old `hephaestus` keys needed.

---

### Task 1: Initialize Monorepo

**Context:**
Set up the root monorepo structure — workspace configuration, shared TypeScript config, git initialization, and README. This is the foundation everything else builds on. Without this, npm workspaces won't function and packages can't reference each other.

**Files:**
- Create: `package.json` (root workspace)
- Create: `tsconfig.json` (shared base config)
- Create: `.gitignore`
- Create: `README.md`
**What to implement:**

1. Initialize git: `git init`

2. Create root `package.json`:
```json
{
  "name": "pi-archimedes-monorepo",
  "private": true,
  "workspaces": ["packages/*", "meta"],
  "type": "module"
}
```

3. Create root `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "exclude": ["node_modules", "dist"]
}
```

4. Create `.gitignore`:
```
node_modules/
dist/
*.tsbuildinfo
```

5. Create `README.md` with project overview, package table, and installation instructions.

6. Run `npm install` to initialize the workspace.

**Steps:**
- [ ] Run `cd /home/daniel/Coding/Javascript/pi-archimedes && git init`
- [ ] Create root `package.json` with workspace config
- [ ] Create root `tsconfig.json` with shared TS config
- [ ] Create `.gitignore`
- [ ] Create `README.md`
- [ ] Update `docs/plans/README.md` — add this plan to the active plans table with status 🚧 IN PROGRESS
- [ ] Run `npm install`
- [ ] Verify `npm ls` shows empty workspaces
- [ ] Commit with message: "chore: initialize monorepo with npm workspaces"

**Acceptance criteria:**
- [ ] `npm ls` runs without errors
- [ ] `git status` shows all files tracked
- [ ] Root `package.json` has `"private": true` and correct workspaces array

---

### Task 2: Create @pi-archimedes/core

**Context:**
Core is the largest package — it contains the bus (cross-package pub/sub), chrome (palette/theme resolution), text/color utilities, config loading, and four UI modules: editor (framed editor with quit guard), message (response time patching), startup (animated splash screen), and thinking (muted thinking blocks). All code comes from `pi-ui-hephaestus/src/` with import paths updated.

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/src/bus.ts`
- Create: `packages/core/src/chrome.ts`
- Create: `packages/core/src/text.ts`
- Create: `packages/core/src/color.ts`
- Create: `packages/core/src/config.ts`
- Create: `packages/core/src/editor/index.ts`
- Create: `packages/core/src/message/index.ts`
- Create: `packages/core/src/startup/index.ts`
- Create: `packages/core/src/startup/logo.ts`
- Create: `packages/core/src/startup/sections.ts`
- Create: `packages/core/src/startup/version.ts`
- Create: `packages/core/src/startup/capture.ts`
- Create: `packages/core/src/thinking/patch.ts`
- Create: `packages/core/src/thinking/theme.ts`
- Create: `packages/core/src/thinking/transform.ts`
- Create: `packages/core/src/thinking/unindent.ts`

**What to implement:**

1. **`packages/core/package.json`**:
```json
{
  "name": "@pi-archimedes/core",
  "version": "0.1.0",
  "type": "module",
  "keywords": ["pi-package"],
  "description": "Core UI modules for pi-archimedes: editor, message, startup, thinking",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./bus": "./src/bus.ts",
    "./chrome": "./src/chrome.ts",
    "./text": "./src/text.ts",
    "./color": "./src/color.ts",
    "./config": "./src/config.ts"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.1.0",
    "@earendil-works/pi-tui": ">=0.1.0"
  },
  "devDependencies": {
    "typescript": "^6.0.0"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

2. **`packages/core/tsconfig.json`** — extends root:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

3. **`packages/core/src/bus.ts`** — pub/sub via globalThis Symbol. Copy from the revised spec:
   - `getBus()` — lazy init with event queue. Returns `Bus` with `emit()`, `on()`.
   - `initBus()` — called on session_start, flushes queued events.
   - `Events` object with `COST_UPDATE: "archimedes:cost_update"`.
   - `CostUpdatePayload` interface with `source`, `inputTokens?`, `outputTokens?`, `cacheReadTokens?`, `cacheWriteTokens?`, `cost?`.

4. **`packages/core/src/chrome.ts`** — copy from `pi-ui-hephaestus/src/chrome.ts`. No import changes needed (it imports from pi packages).

5. **`packages/core/src/text.ts`** — copy from `pi-ui-hephaestus/src/utils/text.ts`. Changes:
   - Inline `stripSgr` (1 line: `const stripSgr = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");`)
   - Add `stripAnsi` from `pi-ui-hephaestus/src/utils/ansi.ts` (4 lines, used by startup/sections.ts and startup/index.ts)
   - Keep `clampLine`, `clampLines`, `isParentBorder`, `formatKey`

6. **`packages/core/src/color.ts`** — copy from `pi-ui-hephaestus/src/utils/color.ts`. No changes needed (pure functions, no external imports).

7. **`packages/core/src/config.ts`** — create new config module:
   - Read/write `~/.pi/agent/settings.json` under `archimedes.core` key.
   - `CoreConfig` interface: `mutedTheme: boolean`, `codeUnindent: boolean`, `labelText: string`, `labelColor: string`, `animationStyle: AnimationStyle`.
   - `ANIMATION_STYLES` constant array (copy from hephaestus config.ts).
   - `DEFAULT_CORE_CONFIG` with defaults.
   - `loadCoreConfig(): CoreConfig` — reads from settings.json, merges with defaults.
   - `saveCoreConfig(config: CoreConfig): void` — writes to settings.json.

8. **`packages/core/src/editor/index.ts`** — copy from `pi-ui-hephaestus/src/editor/index.ts`. Update imports to relative paths:
   - `from "../chrome.js"` → `from "../chrome.js"` (same — chrome.ts is at core/src/ level)
   - `from "../utils/text.js"` → `from "../text.js"`

9. **`packages/core/src/message/index.ts`** — copy from `pi-ui-hephaestus/src/message/index.ts`. Update imports to relative paths:
   - `from "../chrome.js"` → `from "../chrome.js"` (same — chrome.ts is at core/src/ level)

10. **`packages/core/src/startup/`** — copy all 5 files from `pi-ui-hephaestus/src/startup/`. Update imports to relative paths:
    - `logo.ts`: `from "../utils/index.js"` → `from "../color.js"` (for gray, rgb, extractRgb, lerp — these are moved into color.ts, see step 4)
    - `sections.ts`: `from "../utils/index.js"` → split into `from "../text.js"` (for clampLine, stripAnsi) and `from "../color.js"` (for gray, rgb, extractRgb, lerp)
    - `index.ts`: `from "../utils/ansi.js"` → `from "../text.js"` (for stripAnsi), `from "../config.js"` → `from "../config.js"` (same — config.ts is at core/src/ level), `from "../message/index.js"` → `from "../message/index.js"` (same)
    
    **IMPORTANT:** The color helpers `gray`, `rgb`, `extractRgb`, `lerp` currently live in `utils/ansi.ts` but are color-related. Move them into `src/color.ts` so startup can import from there.

11. **`packages/core/src/thinking/`** — copy all 4 files from `pi-ui-hephaestus/src/thinking/`. Update imports to relative paths:
    - `theme.ts`: `from "../utils/color.js"` → `from "../color.js"`

12. **`packages/core/src/index.ts`** — the extension entry point. Adapted from `pi-ui-hephaestus/src/index.ts`:
    - Import and wire: editor, message (patchUserMessage), startup (renderHeader + patchStartupListing), thinking (patchThinkingRenderer)
    - Import `loadCoreConfig` from `./config.js`
    - Import `initBus` from `./bus.js` and call it on `session_start`
    - Handle `session_shutdown` cleanup
    - Do NOT include footer, diff, or image-paste registration (those are separate packages)
    - **Export pattern** — provide both a default export (for standalone `pi.extensions` loading) AND a named `registerCore` for the meta orchestrator:
      ```typescript
      export default function (pi: ExtensionAPI): void { registerCore(pi); }
      export function registerCore(pi: ExtensionAPI): void { /* ... */ }
      ```
    - **Export `getCoreSettingsItems(): SettingItem[]`** — returns the settings items for mutedTheme, codeUnindent, labelText, labelColor, animationStyle. The meta-package's composed settings UI imports this.

**Steps:**
- [ ] Create `packages/core/package.json` and `packages/core/tsconfig.json`
- [ ] Create `src/bus.ts` with getBus(), initBus(), Events, CostUpdatePayload
- [ ] Create `src/chrome.ts` (copy from hephaestus, no changes)
- [ ] Create `src/color.ts` (copy from hephaestus utils/color.ts + add gray, rgb, extractRgb, lerp from utils/ansi.ts)
- [ ] Create `src/text.ts` (copy from hephaestus utils/text.ts, inline stripSgr)
- [ ] Create `src/config.ts` with CoreConfig, loadCoreConfig, saveCoreConfig
- [ ] Create `src/editor/index.ts` (copy + update imports)
- [ ] Create `src/message/index.ts` (copy + update imports)
- [ ] Create `src/startup/` (copy all 5 files + update imports)
- [ ] Create `src/thinking/` (copy all 4 files + update imports)
- [ ] Create `src/index.ts` — wires all modules, exports `registerCore(pi)` and `getCoreSettingsItems()`, plus default export
- [ ] Run `cd packages/core && npx tsc --noEmit` to verify TypeScript compiles
- [ ] Fix any import errors or type mismatches
- [ ] Re-run `npx tsc --noEmit` until clean
- [ ] Commit with message: "feat: add @pi-archimedes/core with editor, message, startup, thinking"

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` passes with zero errors in `packages/core/`
- [ ] `src/index.ts` exports default function `(pi: ExtensionAPI) => void`
- [ ] `src/bus.ts` exports `getBus()`, `initBus()`, `Events`, `CostUpdatePayload`
- [ ] `src/config.ts` reads/writes `archimedes.core` namespace in settings.json
- [ ] All import paths resolve correctly — relative within package, no `../utils/...` references
- [ ] `src/text.ts` exports `stripAnsi` (used by startup/sections.ts and startup/index.ts)
- [ ] `src/index.ts` exports `registerCore(pi)` and `getCoreSettingsItems()` plus default export

---

### Task 3: Create @pi-archimedes/footer

**Context:**
The footer provides the status bar showing git status, model, thinking level, token usage, cost, and context window progress. It depends on `@pi-archimedes/core` for `text.ts` (clampLine) and config loading. It includes a `CostAccumulator` that subscribes to the bus for `COST_UPDATE` events from future plugins like subagent.

**Files:**
- Create: `packages/footer/package.json`
- Create: `packages/footer/tsconfig.json`
- Create: `packages/footer/src/index.ts`
- Create: `packages/footer/src/config.ts`
- Create: `packages/footer/src/cost-accumulator.ts`
- Create: `packages/footer/src/utils/git.ts`
- Create: `packages/footer/src/utils/stats.ts`
- Create: `packages/footer/src/utils/format.ts`
- Create: `packages/footer/src/utils/icons.ts`

**What to implement:**

1. **`packages/footer/package.json`**:
```json
{
  "name": "@pi-archimedes/footer",
  "version": "0.1.0",
  "type": "module",
  "keywords": ["pi-package"],
  "description": "Rich footer status bar for pi-archimedes",
  "main": "./src/index.ts",
  "dependencies": {
    "@pi-archimedes/core": "workspace:*"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.1.0",
    "@earendil-works/pi-tui": ">=0.1.0"
  },
  "devDependencies": {
    "typescript": "^6.0.0"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

2. **`packages/footer/tsconfig.json`** — extends root tsconfig.

3. **`packages/footer/src/config.ts`** — new config module:
   - Read/write `~/.pi/agent/settings.json` under `archimedes.footer` key.
   - `FooterConfig` interface: `splitThreshold: number` (default 150).
   - `loadFooterConfig(): FooterConfig`.
   - `saveFooterConfig(config: FooterConfig): void`.
   - **Export `getFooterSettingsItems(): SettingItem[]`** — returns settings items for splitThreshold. The meta-package imports this.

4. **`packages/footer/src/cost-accumulator.ts`** — new module:
   ```typescript
   import { getBus, Events, type CostUpdatePayload } from "@pi-archimedes/core/bus";
   
   export class CostAccumulator {
     inputTokens = 0;
     outputTokens = 0;
     cacheReadTokens = 0;
     cacheWriteTokens = 0;
     cost = 0;
     private unsubscribes: Array<() => void> = [];
   
     subscribe(): void {
       const unsub = getBus().on(Events.COST_UPDATE, (data: CostUpdatePayload) => {
         this.inputTokens += data.inputTokens ?? 0;
         this.outputTokens += data.outputTokens ?? 0;
         this.cacheReadTokens += data.cacheReadTokens ?? 0;
         this.cacheWriteTokens += data.cacheWriteTokens ?? 0;
         this.cost += data.cost ?? 0;
       });
       this.unsubscribes.push(unsub);
     }
   
     reset(): void {
       this.inputTokens = 0;
       this.outputTokens = 0;
       this.cacheReadTokens = 0;
       this.cacheWriteTokens = 0;
       this.cost = 0;
     }
   
     dispose(): void {
       this.unsubscribes.forEach(unsub => unsub());
       this.unsubscribes = [];
     }
   }
   ```

5. **`packages/footer/src/utils/`** — copy all 4 files from `pi-ui-hephaestus/src/footer/utils/`. No import changes needed (they only reference each other locally).

6. **`packages/footer/src/index.ts`** — adapt from `pi-ui-hephaestus/src/footer/index.ts`:
   - Change `import { clampLine } from "../utils/text.js"` → `import { clampLine } from "@pi-archimedes/core/text"`
   - Change `import { loadConfig } from "../config.js"` → `import { loadFooterConfig } from "./config.js"`
   - Change `loadConfig().diffSplitMinWidth` → `loadFooterConfig().splitThreshold`
   - Add `CostAccumulator` — create instance on session_start, add its accumulated values to the token stats displayed in the footer
   - In footer render: merge main agent stats (from ctx.sessionManager) with subagent stats (from CostAccumulator)
   - On session_shutdown: call `accumulator.dispose()` and `accumulator.reset()`
   - **Export pattern** — provide both default export and named `registerFooter`:
     ```typescript
     export default function (pi: ExtensionAPI): void { registerFooter(pi); }
     export function registerFooter(pi: ExtensionAPI): void { /* ... */ }
     ```

**Steps:**
- [ ] Create `packages/footer/package.json` and `tsconfig.json`
- [ ] Copy `src/utils/` from hephaestus (git.ts, stats.ts, format.ts, icons.ts)
- [ ] Create `src/config.ts` with FooterConfig, loadFooterConfig, saveFooterConfig
- [ ] Create `src/cost-accumulator.ts` with CostAccumulator class
- [ ] Create `src/index.ts` adapted from hephaestus footer (update imports, add CostAccumulator, export `registerFooter(pi)` plus default export)
- [ ] Run `cd packages/footer && npx tsc --noEmit`
- [ ] Fix any import errors
- [ ] Re-run until clean
- [ ] Commit with message: "feat: add @pi-archimedes/footer with cost accumulator"

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] Footer imports `clampLine` from `@pi-archimedes/core/text`
- [ ] Footer reads config from `archimedes.footer` namespace
- [ ] `CostAccumulator` subscribes to `Events.COST_UPDATE` on session_start
- [ ] Footer display merges main agent + subagent token stats
- [ ] `src/index.ts` exports `registerFooter(pi)` and `getFooterSettingsItems()` plus default export

---

### Task 4: Create @pi-archimedes/diff

**Context:**
The diff renderer provides Shiki-powered syntax-highlighted diffs for write/edit tool output. It is fully standalone — no dependencies on core or any other archimedes package. Its ANSI utilities are already internal to the diff-render folder.

**Files:**
- Create: `packages/diff/package.json`
- Create: `packages/diff/tsconfig.json`
- Create: `packages/diff/src/index.ts`
- Create: `packages/diff/src/core/diff.ts`
- Create: `packages/diff/src/ansi.ts`
- Create: `packages/diff/src/render.ts`
- Create: `packages/diff/src/shiki.ts`
- Create: `packages/diff/src/word-diff.ts`

**What to implement:**

1. **`packages/diff/package.json`**:
```json
{
  "name": "@pi-archimedes/diff",
  "version": "0.1.0",
  "type": "module",
  "keywords": ["pi-package"],
  "description": "Shiki-powered diff rendering for pi-archimedes",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "diff": "^8.0.0",
    "shiki": "^4.0.0",
    "@shikijs/cli": "^4.0.2"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.1.0",
    "@earendil-works/pi-tui": ">=0.1.0"
  },
  "devDependencies": {
    "@types/diff": "^7.0.2",
    "typescript": "^6.0.0"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

2. **`packages/diff/tsconfig.json`** — extends root tsconfig.

3. **`packages/diff/src/ansi.ts`** — copy from `pi-ui-hephaestus/src/diff-render/ansi.ts`. Update import:
   - Change `import { stripSgr } from "../utils/ansi.js"` → inline: `const stripSgr = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");`
   - All other imports are local or from shiki — no changes.

4. **`packages/diff/src/core/diff.ts`** — copy from `pi-ui-hephaestus/src/diff-render/core/diff.ts`. No import changes (pure diff parsing, imports `diff` package).

5. **`packages/diff/src/render.ts`** — copy from `pi-ui-hephaestus/src/diff-render/render.ts`. Update imports to local relative paths. The `setConfigGetter` pattern stays — it receives config from the extension entry point.

6. **`packages/diff/src/shiki.ts`** — copy from `pi-ui-hephaestus/src/diff-render/shiki.ts`. Update imports to local relative paths. `setConfigGetter` pattern stays.

7. **`packages/diff/src/word-diff.ts`** — copy from `pi-ui-hephaestus/src/diff-render/word-diff.ts`. Update imports to local relative paths.

8. **`packages/diff/src/index.ts`** — adapt from `pi-ui-hephaestus/src/diff-render/index.ts`:
   - Update all relative imports to local paths within `packages/diff/src/`
   - The `registerDiffTools` function signature stays the same
   - Config: the diff package reads its own config. Create a small inline config reader or use the pattern where `registerDiffTools` receives a `readConfig` callback
   - `HephaestusDiffConfig` → rename to `DiffConfig` (or keep for now, renaming is cosmetic)
   - **Export `getDiffSettingsItems(): SettingItem[]`** — returns settings items for diffTheme, diffSplitMinWidth, diffSplitMinCodeWidth. The meta-package imports this.

**Steps:**
- [ ] Create `packages/diff/package.json` and `tsconfig.json`
- [ ] Copy `src/core/diff.ts` from hephaestus (no changes needed)
- [ ] Copy `src/ansi.ts` from hephaestus (inline stripSgr import)
- [ ] Copy `src/render.ts`, `src/shiki.ts`, `src/word-diff.ts` from hephaestus (update relative imports)
- [ ] Create `src/index.ts` adapted from hephaestus diff-render/index.ts (update all imports)
- [ ] Run `cd packages/diff && npx tsc --noEmit`
- [ ] Fix any import errors
- [ ] Re-run until clean
- [ ] Commit with message: "feat: add @pi-archimedes/diff with Shiki-powered diff rendering"

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] `src/ansi.ts` has `stripSgr` inlined (no import from core)
- [ ] `src/index.ts` exports `registerDiffTools(pi, getTheme, readConfig)` and `getDiffSettingsItems()`
- [ ] All relative imports within diff package resolve correctly

---

### Task 5: Create @pi-archimedes/image-paste

**Context:**
The image-paste module handles clipboard image paste (Ctrl+V/Alt+V), image preview rendering, and marker-based image attachment to messages. It's fully standalone — no dependencies on core or any other archimedes package.

**Files:**
- Create: `packages/image-paste/package.json`
- Create: `packages/image-paste/tsconfig.json`
- Create: `packages/image-paste/src/index.ts`
- Create: `packages/image-paste/src/clipboard.ts`
- Create: `packages/image-paste/src/preview.ts`
- Create: `packages/image-paste/src/types.ts`

**What to implement:**

1. **`packages/image-paste/package.json`**:
```json
{
  "name": "@pi-archimedes/image-paste",
  "version": "0.1.0",
  "type": "module",
  "keywords": ["pi-package"],
  "description": "Clipboard image paste for pi-archimedes",
  "main": "./src/index.ts",
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.1.0",
    "@earendil-works/pi-tui": ">=0.1.0"
  },
  "devDependencies": {
    "typescript": "^6.0.0"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

2. **`packages/image-paste/tsconfig.json`** — extends root tsconfig.

3. **`packages/image-paste/src/types.ts`** — copy from `pi-ui-hephaestus/src/image-paste/types.ts`. No changes.

4. **`packages/image-paste/src/clipboard.ts`** — copy from `pi-ui-hephaestus/src/image-paste/clipboard.ts`. No changes (imports from node builtins and local types).

5. **`packages/image-paste/src/preview.ts`** — copy from `pi-ui-hephaestus/src/image-paste/preview.ts`. No changes.

6. **`packages/image-paste/src/index.ts`** — copy from `pi-ui-hephaestus/src/image-paste/index.ts`. Update relative imports to local paths within the package.

**Steps:**
- [ ] Create `packages/image-paste/package.json` and `tsconfig.json`
- [ ] Copy `src/types.ts`, `src/clipboard.ts`, `src/preview.ts` from hephaestus (no changes)
- [ ] Copy `src/index.ts` from hephaestus (update relative imports)
- [ ] Run `cd packages/image-paste && npx tsc --noEmit`
- [ ] Fix any import errors
- [ ] Re-run until clean
- [ ] Commit with message: "feat: add @pi-archimedes/image-paste"

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] Zero dependencies on `@pi-archimedes/core` or any other archimedes package
- [ ] `src/index.ts` exports `registerImagePaste`, `initImagePasteSession`, `shutdownImagePaste`

---

### Task 6: Create pi-archimedes Meta-Package

**Context:**
The meta-package is the umbrella — it depends on all four component packages and provides: (1) the main `pi-archimedes` install target, (2) composed settings UI from all packages, (3) config loading with namespaced settings, and (4) the `/archimedes` command. It declares all component extensions in its `pi.extensions` array so pi loads them automatically.

**Files:**
- Create: `meta/package.json`
- Create: `meta/tsconfig.json`
- Create: `meta/src/index.ts`
- Create: `meta/src/config.ts`
- Create: `meta/src/settings.ts`

**What to implement:**

1. **`meta/package.json`**:
```json
{
  "name": "pi-archimedes",
  "version": "0.1.0",
  "type": "module",
  "keywords": ["pi-package"],
  "description": "Visual polish and useful context for the Pi coding agent TUI",
  "main": "./src/index.ts",
  "dependencies": {
    "@pi-archimedes/core": "workspace:*",
    "@pi-archimedes/footer": "workspace:*",
    "@pi-archimedes/diff": "workspace:*",
    "@pi-archimedes/image-paste": "workspace:*"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.1.0",
    "@earendil-works/pi-tui": ">=0.1.0"
  },
  "devDependencies": {
    "typescript": "^6.0.0"
  },
  "pi": {
    "extensions": [
      "./src/index.ts"
    ],
    "image": "https://raw.githubusercontent.com/danielcherubini/pi-ui-hephaestus/main/docs/splash-screen.png"
  }
}
```

2. **`meta/tsconfig.json`** — extends root tsconfig.

3. **`meta/src/config.ts`** — composed config loader:
   - Re-export `loadCoreConfig` from `@pi-archimedes/core/config`
   - Re-export `loadFooterConfig` from `@pi-archimedes/footer/config` (if footer exports it, otherwise read directly)
   - Provide a `loadAllConfig()` that returns `{ core, footer, diff }` for use by the orchestrator
   - Each package reads its own config independently; this is just a convenience for the orchestrator

4. **`meta/src/settings.ts`** — composed settings UI:
   - Adapted from `pi-ui-hephaestus/src/settings.ts`
   - Collect settings items from all packages. Each package should export `getSettingsItems(): SettingItem[]` (add this export to core, footer, diff in their respective index.ts or config.ts)
   - The `openSettings(pi, ctx)` function composes all items and renders the `SettingsList`
   - On save: write all configs to their respective namespaces

   **Add `getSettingsItems()` exports to component packages:**
   - In `packages/core/src/index.ts` or `config.ts`: export `getCoreSettingsItems(): SettingItem[]`
   - In `packages/footer/src/index.ts` or `config.ts`: export `getFooterSettingsItems(): SettingItem[]`
   - In `packages/diff/src/index.ts` or `config.ts`: export `getDiffSettingsItems(): SettingItem[]`

5. **`meta/src/index.ts`** — the main orchestrator. Adapted from `pi-ui-hephaestus/src/index.ts`:
   - Import `registerDiffTools` from `@pi-archimedes/diff`
   - Import `registerImagePaste`, `initImagePasteSession`, `shutdownImagePaste` from `@pi-archimedes/image-paste`
   - Import `initBus` from `@pi-archimedes/core/bus`
   - Import config loaders
   - Import `openSettings` from `./settings.js`
   
   The orchestrator's `session_start` handler:
   ```typescript
   pi.on("session_start", (_event, ctx) => {
     // Initialize bus
     initBus();
     
     // Register footer (core registers its own UI via its extension)
     // Note: footer, diff, image-paste are registered as SEPARATE extensions
     // via pi.extensions array. This orchestrator just wires cross-package concerns.
     
     // Register diff tools
     registerDiffTools(pi, () => ctx.ui.theme, () => loadDiffConfig());
     
     // Initialize image paste
     initImagePasteSession(ctx);
     
     // ... other cross-package wiring
   });
   
   pi.on("session_shutdown", (_event, _ctx) => {
     shutdownImagePaste();
   });
   
   // Register /archimedes command
   pi.registerCommand("archimedes", {
     description: "Open Archimedes settings",
     handler: async (args, ctx) => openSettings(pi, ctx),
   });
   ```
   
   **IMPORTANT:** The `pi.extensions` array in `meta/package.json` should include ALL extension entry points so pi loads them:
   ```json
   "pi": {
     "extensions": [
       "./src/index.ts",
       "../../packages/core/src/index.ts",
       "../../packages/footer/src/index.ts",
       "../../packages/diff/src/index.ts",
       "../../packages/image-paste/src/index.ts"
     ]
   }
   ```
   
   Wait — when installed from npm, these paths won't resolve. Instead, the meta-package should use `node_modules/` paths:
   ```json
   "pi": {
     "extensions": [
       "./src/index.ts"
     ]
   }
   ```
   
   And the orchestrator (`./src/index.ts`) should programmatically load and register the other packages' extensions by importing them. Each component package exports a `register(pi: ExtensionAPI)` function that the orchestrator calls.
   
   **Revised approach:** Each component package exports a `register` function:
   - `@pi-archimedes/core` → `export function registerCore(pi: ExtensionAPI): void`
   - `@pi-archimedes/footer` → `export function registerFooter(pi: ExtensionAPI): void`
   - `@pi-archimedes/diff` → already exports `registerDiffTools`
   - `@pi-archimedes/image-paste` → already exports `registerImagePaste`
   
   The meta-package's `pi.extensions` only lists `./src/index.ts`. The orchestrator imports and calls all register functions.

**Steps:**
- [ ] Create `meta/package.json` with dependencies on all workspace packages
- [ ] Create `meta/tsconfig.json`
- [ ] Add `registerCore(pi)` export to `packages/core/src/index.ts` (refactor current default export)
- [ ] Add `registerFooter(pi)` export to `packages/footer/src/index.ts`
- [ ] Create `meta/src/config.ts` with composed config loaders
- [ ] Create `meta/src/settings.ts` with composed settings UI (adapted from hephaestus settings.ts)
- [ ] Create `meta/src/index.ts` — orchestrator that imports and wires all packages
- [ ] Run `cd meta && npx tsc --noEmit`
- [ ] Fix any import errors
- [ ] Re-run until clean
- [ ] Run `npm install` at root to verify workspace resolution
- [ ] Commit with message: "feat: add pi-archimedes meta-package with orchestrator and composed settings"

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` passes in `meta/`
- [ ] `meta/package.json` depends on all 4 component packages (footer depends on core; diff and image-paste are standalone)
- [ ] `pi.extensions` lists only `./src/index.ts`
- [ ] Orchestrator imports and calls register functions from all component packages
- [ ] `/archimedes` command opens composed settings UI
- [ ] `npm ls` at root shows correct dependency tree

---

### Notes

- **No tests:** This project uses TypeScript loaded via jiti by pi — no build step, no test framework. Verification is `tsc --noEmit` and manual testing in pi.
- **No build step:** All packages use `"type": "module"` and `.ts` entry points. Pi's jiti loader handles TypeScript at runtime.
- **Import path convention:** Use package subpath exports (e.g., `@pi-archimedes/core/bus`) for cross-package imports. Use relative paths within a package.
- **Config namespacing:** All settings under `archimedes.*` in `~/.pi/agent/settings.json`. No migration from old `hephaestus` keys.
- **Versioning:** All packages start at `0.1.0`. Version independently after initial release.
