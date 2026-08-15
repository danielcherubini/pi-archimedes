# Center-screen /archimedes settings (matching /agents) Plan

**Goal:** Move the `/archimedes` settings screen out of full-screen stock `SettingsList` into a centered, bordered overlay that looks and behaves like the `/agents` manager, with shared chrome extracted into core so both screens can't drift.
**Architecture:** Extract the pure overlay chrome helpers (text width math, border, header/footer rendering, overlay options constant) from `agent-manager.ts` into a new `packages/core/src/overlay.ts`. Write a new `createSettingsManager` TUI component in `meta/src/settings-manager.ts` (list mode + inline prompt mode, modeled on `agent-manager.ts`'s state machine), then rewire `openSettings()` in `meta/src/settings.ts` to render it as a centered overlay. No item factories, config save/load logic, or other commands change.
**Tech Stack:** pi-tui (`@earendil-works/pi-tui` component protocol: `render(width) / handleInput(data) / invalidate() / dispose()`), pi-coding-agent `Theme` type, TypeScript (jiti runtime — no build step), vitest (core + subagent only; `meta` is excluded from the vitest projects by repo convention).

**Approved spec (summary):** see conversation — 5 sections, all approved. Key decisions:
1. Chrome extraction is a **byte-identical move** of pure functions; `agent-manager.ts` behavior must not change.
2. Settings screen: same centered overlay as `/agents` (`anchor: "center", width: 84, maxHeight: "80%"`), themed header ` Settings `, dim hint footer.
3. Free-text/number fields (7 of them) use an **inline prompt mode** inside the same overlay (replaces the current full-screen submenu components, which are deleted).
4. Saving: `[s]` saves all five namespaces and exits; `[esc]` exits discarding changes (no dirty-confirm).
5. `meta` package gets **no vitest tests** (it is excluded from `vitest.config.ts` projects — see the comment there). Verification for meta is `tsc --noEmit` + manual TUI smoke test.

---

### Task 1: Extract shared overlay chrome into core

**Context:**
`packages/subagent/src/agent-manager.ts` (1821 lines) is a TUI overlay component whose chrome helpers — text width math, header/footer rendering, border wrapping — are private functions at the top of the file. The new `/archimedes` settings overlay (Task 2) needs the exact same chrome so both screens look identical. The monorepo convention is that shared cross-package helpers live in `@pi-archimedes/core` with per-file subpath exports (`packages/core/package.json` has `"exports"` entries like `"./bus": "./src/bus.ts"`). This task moves the helpers byte-identically into `packages/core/src/overlay.ts`, adds one new helper (`borderContentWidth`) plus a shared overlay-options constant, and refactors `agent-manager.ts` and `packages/subagent/src/index.ts` to use them. `/agents` must behave exactly as before.

**Files:**
- Create: `packages/core/src/overlay.ts`
- Create: `packages/core/src/overlay.test.ts`
- Modify: `packages/core/package.json` (add `"./overlay"` export)
- Modify: `packages/subagent/src/agent-manager.ts` (delete private copies, import from core)
- Modify: `packages/subagent/src/index.ts` (use shared `OVERLAY_CHROME` constant)

**What to implement:**

1. `packages/core/src/overlay.ts` — new module. **Theme typing (important — read carefully):** do NOT import the real `Theme` class here. `agent-manager.ts` uses a *local structural* interface `interface Theme { fg(token: string, text: string): string; bold(text: string): string }` and its call sites pass that local type; the real pi-coding-agent `Theme` is a class with private fields and is NOT compatible with that local interface (a byte-identical move that types the helpers with the real `Theme` breaks `tsc` in subagent). Instead, define and export a minimal structural type in `overlay.ts`:

   ```ts
   /** Minimal structural theme — anything with `fg` satisfies it (the real pi-coding-agent Theme, agent-manager's local interface, or a test mock). */
   export interface OverlayTheme {
     fg(token: string, text: string): string;
   }
   ```

   Type every helper in this file with `OverlayTheme`. This keeps `agent-manager.ts` call sites truly untouched (its local `Theme` has `fg` + `bold`, structurally assignable) and lets the test use a plain mock with no cast. Note: `packages/core/src/chrome.ts` still imports the real `Theme` — that's correct for chrome.ts (it uses `getBgAnsi` etc.), just not for overlay.

   Export exactly these, with bodies **copied verbatim** from `packages/subagent/src/agent-manager.ts` (they currently live roughly between the "Helper functions" and "List screen" banners), re-typed from `theme: Theme` to `theme: OverlayTheme`:

   ```ts
   export function visibleWidth(text: string): number
   export function padEnd(text: string, width: number): string
   export function wrapText(text: string, width: number): string[]
   export function hardTruncate(text: string, maxVisible: number): string
   export function renderHeader(text: string, width: number, theme: OverlayTheme): string
   export function renderFooter(text: string, width: number, theme: OverlayTheme): string
   export function wrapWithBorder(lines: string[], width: number, theme: OverlayTheme): string[]
   ```

   Plus two NEW exports (derived from the existing width math inside `wrapWithBorder`):

   ```ts
   /** Content width available inside wrapWithBorder at a given outer width.
    *  inner = max(1, width - 2); content = max(1, inner - 2). */
   export function borderContentWidth(width: number): number {
     const innerWidth = Math.max(1, width - 2);
     return Math.max(1, innerWidth - 2);
   }

   /** Shared overlay options so /agents and /archimedes never drift. */
   export const OVERLAY_CHROME = { anchor: "center", width: 84, maxHeight: "80%" } as const;
   ```

   Also delete the tiny `row(text, width, theme)` helper from `agent-manager.ts` — it is dead code (only used as an alias for `padEnd`); confirm with `grep -n "\brow(" packages/subagent/src/agent-manager.ts` that no call sites exist before deleting, and if any exist, replace them with `padEnd`.

   Do NOT move: `fuzzyFilter`, `filterModels`, `scopeLabel`, `agentModel` — those are agent-domain, not chrome.

2. `packages/core/package.json` — add `"./overlay": "./src/overlay.ts"` to the `exports` map, inserted between the existing `"./color"` and `"./config"` entries.

3. `packages/subagent/src/agent-manager.ts` — delete the now-duplicate local functions (`visibleWidth`, `padEnd`, `wrapText`, `hardTruncate`, `renderHeader`, `renderFooter`, `wrapWithBorder`, and `row` if present) and add to the top-level imports:

   ```ts
   import {
     visibleWidth,
     padEnd,
     wrapText,
     hardTruncate,
     renderHeader,
     renderFooter,
     wrapWithBorder,
   } from "@pi-archimedes/core/overlay";
   ```

   (Merge into an existing `@pi-archimedes/core/...` import if one exists in this file; there is currently none, so a fresh import line is fine.) Leave every call site untouched — the signatures are identical.

4. `packages/subagent/src/index.ts` — around line 349 the `/agents` command calls `ctx.ui.custom` with an inline literal:
   ```ts
   { overlay: true, overlayOptions: { anchor: "center", width: 84, maxHeight: "80%" } },
   ```
   Replace the inline object with `OVERLAY_CHROME` imported from `@pi-archimedes/core/overlay`.

5. `packages/core/src/overlay.test.ts` — new vitest file (core is in the vitest projects). Test the pure helpers WITHOUT a real Theme: use a mock theme object `{ fg: (color: string, text: string) => text }` (i.e. `fg` returns its second argument — this satisfies `OverlayTheme` structurally, no cast needed); for the header/footer color assertions use a mock that records the color arg (`fg: (color, text) => { lastColor = color; return text; }`). Import from `"./overlay.js"` (repo convention — the `.js` extension resolves to `.ts` under bundler resolution, same as other core tests like `text.test.ts`). Cover:
   - `visibleWidth`: plain string, string with ANSI SGR codes (e.g. `"\x1b[31mred\x1b[0m"` → 3), empty string.
   - `padEnd`: pads to width, returns input unchanged when visible width ≥ target, returns `""` for width ≤ 0.
   - `wrapText`: wraps long words/lines to width, preserves empty paragraphs as blank lines, returns `[]` for width ≤ 0.
   - `hardTruncate`: leaves short strings alone, truncates at visible-width boundary, truncates an ANSI-colored string and appends a reset (`\x1b[0m`) so styling doesn't bleed.
   - `renderHeader` / `renderFooter`: pad to width and pass text through `theme.fg` (assert with a mock that records the color arg: `fg` called with `"accent"` / `"dim"` respectively).
   - `wrapWithBorder` / `borderContentWidth`: for width 84 → border rows `┌` + 82×`─` + `┐`, body rows `│ … │` with 1-space inner padding, exactly `lines.length + 2` output rows, all rows exactly `width` visible chars; content longer than content width (80) is hard-truncated, not overflowing; `borderContentWidth(84)` === 80.

   Do NOT modify `packages/core/src/index.ts` (barrel) unless other core modules export individual files through it — check how `chrome.ts` is exposed (it is a subpath export, not in the barrel; `overlay` follows the same pattern, so no barrel change).

**Steps:**
- [ ] Write `packages/core/src/overlay.test.ts` with the cases above (imports will fail to resolve — that's the expected failure).
- [ ] Run `npx vitest run` from the repo root (or `cd packages/core && npx vitest run`)
  - Did it fail with a missing module `./overlay` / missing exports? If it passed unexpectedly, stop and investigate why.
- [ ] Create `packages/core/src/overlay.ts` per spec above; add the `exports` entry to `packages/core/package.json`.
- [ ] Run `npx vitest run`
  - Did all tests pass? If not, fix and re-run before continuing.
- [ ] Refactor `packages/subagent/src/agent-manager.ts` and `packages/subagent/src/index.ts` per spec.
- [ ] Run `cd packages/core && npx tsc --noEmit`, then `cd packages/subagent && npx tsc --noEmit` (independently, wait for each)
  - Did both succeed? If not, fix and re-run.
- [ ] Run `npx vitest run` (repo root) — subagent tests must stay green.
- [ ] Commit with message: `refactor: extract shared overlay chrome into @pi-archimedes/core/overlay`

**Acceptance criteria:**
- [ ] `grep -n "function wrapWithBorder" packages/subagent/src/agent-manager.ts` returns nothing (all chrome now in core).
- [ ] `packages/core/src/overlay.ts` exports the 7 moved helpers + `borderContentWidth` + `OVERLAY_CHROME`.
- [ ] `packages/core/src/overlay.test.ts` passes; all pre-existing vitest suites pass.
- [ ] `tsc --noEmit` clean in core and subagent.
- [ ] `/agents` renders identically to before (manual: open pi, run `/agents`, confirm bordered centered panel unchanged).

---

### Task 2: createSettingsManager component in meta

**Context:**
`meta/src/settings.ts` currently opens `/archimedes` by building a stock pi-tui `SettingsList` (full screen) plus two home-grown submenu factories (`createTextSubmenu` for text, `createNumberSubmenu` for numbers) that render full-screen prompt views for the 7 free-input fields. This task builds the replacement component, `meta/src/settings-manager.ts`, modeled on `packages/subagent/src/agent-manager.ts` (same component protocol, same state-machine style, same use of `matchesKey`/`Key`/`CURSOR_MARKER` from `@earendil-works/pi-tui` and the chrome helpers from `@pi-archimedes/core/overlay`). It is a new file with no callers yet — wiring happens in Task 3, so this commit is behavior-neutral. **No vitest tests for this file**: `meta` is deliberately excluded from the vitest projects (see `vitest.config.ts` comment) — verification is `tsc --noEmit` plus a code-shape review against `agent-manager.ts`.

**Files:**
- Create: `meta/src/settings-manager.ts`

**What to implement:**

Exported types and factory:

```ts
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";
import { matchesKey, Key, CURSOR_MARKER, truncateToWidth } from "@earendil-works/pi-tui";
import {
  visibleWidth,
  padEnd,
  wrapText,
  renderHeader,
  renderFooter,
  wrapWithBorder,
  borderContentWidth,
} from "@pi-archimedes/core/overlay";
```

(`Theme` is the real pi-coding-agent type — the `theme` passed in from `ctx.ui.custom` IS the real class, so type `SettingsManagerOptions.theme` as `Theme` and pass it through; `Theme` is structurally assignable to `OverlayTheme` where the chrome helpers expect it. Do NOT import `OverlayTheme` itself — it is unused in this file.)

Exported types and factory (`PromptDescriptor` must be exported — Task 3 imports it):

```ts
export interface PromptDescriptor {
  kind: "text" | "number";
  label: string;
  min?: number;
}

export interface SettingsManagerOptions {
  items: SettingItem[];
  prompts: Record<string, PromptDescriptor>;   // keyed by item.id — only the 7 free-input fields
  theme: Theme;
  onChange: (id: string, newValue: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export function createSettingsManager(opts: SettingsManagerOptions): {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
  dispose(): void;
}
```

Internal state object (single `state` closure variable, same style as `ManagerState` in `agent-manager.ts`):

```ts
mode: "list" | "prompt";
selectedIndex: number;          // index into filteredItems
searchQuery: string;            // "" = no search
filterActive: boolean;          // search input armed (toggled by /)
filteredItems: SettingItem[];   // recomputed when searchQuery changes
promptField: string | null;     // item.id while in prompt mode
promptValue: string;            // seeded from item.currentValue on entry
promptError: string | null;
```

**Render (list mode):** compute `const contentWidth = borderContentWidth(width)` ONCE at the top and use `contentWidth` for ALL inner-line math (header, footer, blank lines, rows, description wrap). Pass the OUTER `width` only to `wrapWithBorder(lines, width, theme)`. This mirrors `agent-manager.ts`, whose `render()` computes `contentWidth = width - 4` and passes it to its screen renderers — without this, every line is padded to the outer width and `wrapWithBorder` hard-truncates the last 4 chars of the value column.

Build an unframed `lines` array, then return `wrapWithBorder(lines, width, theme)`. Exact line order (mirrors `renderList` in `agent-manager.ts`):
1. `renderHeader(" Settings ", contentWidth, theme)`
2. blank line (`padEnd("", contentWidth)`)
3. if `state.filterActive`: a search line `padEnd(`Search: ${searchQuery}${CURSOR_MARKER}`, contentWidth)` (cursor marker always shown while search is active)
4. blank line
5. setting rows for the visible scroll window — render ONLY the window (a `VISIBLE_ROWS = 20` constant; there are 15 composed settings so today `start` is always 0, but the window + scroll indicator must work if the list ever grows): `const start = Math.max(0, Math.min(state.selectedIndex - 10, state.filteredItems.length - VISIBLE_ROWS));` then iterate `i` from `start` to `Math.min(start + VISIBLE_ROWS, state.filteredItems.length)`. **`noUncheckedIndexedAccess` is on in the root tsconfig** — every indexed access needs a guard (`const item = state.filteredItems[i]; if (!item) continue;`), same as `renderList`'s `if (!agent) continue;`.
   - row text (match `/agents`' list rows, NOT stock `SettingsList`): `const prefix = isCursor ? "> " : "  ";` (width **2**: the `>`/` ` mark plus its separating space, exactly like `renderList`'s `cursorMark + " "`); then `item.label` padded to `maxLabelWidth = Math.min(30, max of visibleWidth(label) across all items)` — rendered `theme.fg("accent", ...)` when selected, plain otherwise; then two spaces; then the value: build the full value string FIRST — `item.currentValue` plus, when `opts.prompts[item.id]` exists, `"  " + theme.fg("dim", "edit…")` — THEN `truncateToWidth(valueString, remainingWidth, "")` (composing the marker before truncation so it is never clipped). `remainingWidth = contentWidth - 2 - maxLabelWidth - 2` (2 for the prefix, 2 for the label↔value separator); render the value `theme.fg("dim", ...)` when NOT selected (mirrors how /agents dims non-cursor columns). End each row with `padEnd(line, contentWidth)`.
6. scroll indicator when `state.filteredItems.length > VISIBLE_ROWS`: `theme.fg("dim", "  (n/m)")` where n = selectedIndex+1, m = filteredItems.length.
7. if the selected item has a `description`: blank line, then the description wrapped with `wrapText(desc, contentWidth - 2)`, each line `theme.fg("dim", "  " + line)` (the `contentWidth - 2` accounts for the 2-space indent) — same pattern as `SettingsList`.
8. blank line
9. `renderFooter(" [↑↓] move  [←→] value  [enter] edit  [/] search  [s] save  [esc] close ", contentWidth, theme)`

**Render (prompt mode):** same `contentWidth` convention as list mode. Build lines the same way but the body is:
1. `renderHeader(" Settings ", contentWidth, theme)`
2. blank
3. blank
4. `theme.fg("dim", "  " + descriptor.label)` where `const descriptor = state.promptField ? opts.prompts[state.promptField] : undefined; if (!descriptor) return wrapWithBorder([], width, theme);` (render must be total — guard the impossible state rather than assuming non-null)
5. `  ${state.promptValue}${CURSOR_MARKER}` (prefix the value with two spaces, cursor marker directly after the last char)
6. blank
7. if `promptError`: `theme.fg("error", "  " + promptError)` (the real `Theme` always has the `"error"` color token — no fallback needed; `agent-manager.ts` calls `theme.fg("error", …)` directly)
8. blank
9. `renderFooter(" [enter] confirm  [esc] cancel ", contentWidth, theme)`
Then `wrapWithBorder(lines, width, theme)`.

**Input (list mode)** — use `matchesKey(data, Key.up)` etc. exactly like `agent-manager.ts`. **`noUncheckedIndexedAccess` + strict null checks are on: guard EVERY indexed access and every possibly-null read, in render AND input handlers.** Concretely:
- `Key.up` / `Key.down`: `if (state.filteredItems.length === 0) return;` then move `selectedIndex` within `filteredItems`, wrapping at both ends (same wrap behavior as `agent-manager.ts`'s list screen).
- `Key.left` / `Key.right`: start with `const item = state.filteredItems[state.selectedIndex]; if (!item) return;` then, if `item.values` exists with length > 1: find current index of `item.currentValue` in `item.values` (fall back to 0), step ±1 with wrap, `const next = item.values[nextIndex]; if (next === undefined) return;`, then `item.currentValue = next; onChange(item.id, next)`. No-op for prompt fields.
- `Key.enter`: `const item = state.filteredItems[state.selectedIndex]; if (!item) return;` then `if (opts.prompts[item.id])` → enter prompt mode: `mode = "prompt"`, `promptField = item.id`, `promptValue = item.currentValue`, `promptError = null`.
- `"/"`: open the search input: `state.filterActive = true` (if not already — re-pressing `/` while active is a no-op). While `filterActive` is true it STAYS true through typing and backspace; it is only cleared by `esc`. While active: printable characters (same "single printable char" check `agent-manager.ts` uses for its search input) append to `searchQuery`, `Key.backspace` removes the last char; after each change recompute `filteredItems = filterItemsByLabel(opts.items, searchQuery)` and clamp `selectedIndex` to 0.
- `"s"`: call `opts.onSave()` — but only when `!state.filterActive` (so typing "s" in search doesn't save).
- `Key.escape`: if `filterActive` → clear `searchQuery`, `filterActive = false`, restore `filteredItems = opts.items`, clamp `selectedIndex` to 0. Otherwise `opts.onClose()`.
- Ignore everything else.

`filterItemsByLabel`: case-insensitive `item.label.toLowerCase().includes(query.toLowerCase())` (simple substring is fine; do NOT import fuzzyFilter from subagent — meta must not depend on subagent internals for chrome). Initialize `state.filteredItems` to `opts.items` in the factory.

**Input (prompt mode)** — while `mode === "prompt"`, handle ONLY these (swallow everything else, including arrows, `s`, `/`, enter-for-nothing):
- `Key.escape`: `mode = "list"`, `promptField = null`, `promptError = null` (discard typed value; `item.currentValue` untouched).
- `Key.enter`: resolve the field with guards: `const field = state.promptField; if (!field) { state.mode = "list"; return; }` and `const descriptor = opts.prompts[field]; if (!descriptor) { state.mode = "list"; return; }`. Validate. Text kind: always valid, normalized = `promptValue`. Number kind: `const n = parseInt(promptValue, 10)`; if `!Number.isFinite(n) || n < (descriptor.min ?? 0)` → `promptError = "must be >= " + (descriptor.min ?? 0)` and stay in prompt mode. Valid → compute the NORMALIZED value (number fields: `String(n)` so `"0120"` displays as `"120"`, matching the old submenu's `done(String(n))`; text fields: `promptValue`), then `onChange(field, normalized)`, `item.currentValue = normalized` (update the item in `opts.items` — via `opts.items.find((i) => i.id === field)` with an `if (!item) return;` guard — so the list shows the new value), `mode = "list"`, `promptError = null`, `selectedIndex` stays on the field.
- `Key.backspace`: `promptValue = promptValue.slice(0, -1)`.
- Single printable char: append — number kind only if `/^\d$/` (matching the old `createNumberSubmenu` behavior); text kind appends any 1-char printable.
- Clear `promptError` on any successful edit (set `promptError = null` when a char is accepted).

`invalidate()`: no-op (component owns all state). `dispose()`: no-op (no timers/subscriptions — same as `agent-manager.ts`).

**What NOT to do:**
- Do not import or reuse the `createTextSubmenu`/`createNumberSubmenu` factories (they are deleted in Task 3).
- Do not add search fuzzy-matching beyond substring, no pagination, no per-item confirm step, no dirty tracking, no undo.
- Do not modify any file in `packages/*`.

**Steps:**
- [ ] Create `meta/src/settings-manager.ts` implementing the above.
- [ ] Run `cd meta && npx tsc --noEmit`
  - Did it succeed? If not, read the error, read the relevant file, fix, re-run.
- [ ] Re-read the finished file once top to bottom against `packages/subagent/src/agent-manager.ts`'s render/input structure to confirm the chrome calls (`wrapWithBorder`, `renderHeader`, `renderFooter`, `truncateToWidth`, `matchesKey`) are used with the same argument conventions (text, width, theme order).
- [ ] Commit with message: `feat(meta): add settings-manager overlay component (list + prompt modes)`

**Acceptance criteria:**
- [ ] `createSettingsManager` compiles under `tsc --noEmit` in `meta/`.
- [ ] The component renders the bordered panel with header/footer exactly as specified, in both modes.
- [ ] All 7 prompt fields route to prompt mode on Enter; multi-value items cycle with ←/→ and call `onChange` immediately.
- [ ] No files outside `meta/` are touched.

---

### Task 3: Rewire /archimedes to the new overlay

**Context:**
With the component in place (Task 2), this task switches `/archimedes` over to it: `openSettings()` in `meta/src/settings.ts` is restructured to build the items + a `prompts` table and return `createSettingsManager(...)` from `ctx.ui.custom` with the shared `OVERLAY_CHROME` overlay options. The old submenu factories die. The `onChange` switch-case (config-object writes, including the `delayMs` seconds→ms conversion) and all `save*Config` calls are preserved verbatim.

**Files:**
- Modify: `meta/src/settings.ts`

**What to implement:**

1. Delete `createTextSubmenu` and `createNumberSubmenu` (both factories, ~60 lines) and the `addSubmenus` function. Remove now-unused imports (`TUI`/`Component` type if it becomes unused — keep `TUI` since the `ctx.ui.custom` callback still receives it).

2. Add the prompts table (module-level const, replacing what `addSubmenus` encoded):

   ```ts
   const PROMPTS: Record<string, PromptDescriptor> = {
     labelText: { kind: "text", label: "Label text" },
     labelColor: { kind: "text", label: "RGB color (e.g. 255,215,0)" },
     diffTheme: { kind: "text", label: "Shiki theme" },
     diffSplitMinWidth: { kind: "number", label: "Diff split min width", min: 100 },
     diffSplitMinCodeWidth: { kind: "number", label: "Diff split min code width", min: 30 },
     splitThreshold: { kind: "number", label: "Footer split threshold", min: 80 },
     delayMs: { kind: "number", label: "Notify delay (seconds)", min: 1 },
   };
   ```

   Note `delayMs`'s prompt is in **seconds** and the existing `onChange` case already does `notifyConfig.delayMs = v * 1000` — keep that. **Important:** the `getNotifySettingsItems` factory in `packages/notify/src/index.ts` emits `currentValue: String(config.delayMs / 1000) + "s"` — i.e. **`"30s"`, with a trailing `"s" suffix**, which is not a valid seed for the number prompt (typed digits would append to `"30s"` and `parseInt` would silently discard the edit). Do NOT change the notify package. Instead, in `openSettings` after building `notifyItems`, find the `delayMs` item and normalize it: `item.currentValue = String(notifyConfig.delayMs / 1000)` (plain seconds, no suffix).

3. Restructure `openSettings` (keep it `async`, keep the lazy `await import("@pi-archimedes/diff")` first thing — that keeps shiki out of the startup chain):

   ```ts
   export async function openSettings(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
     const { getDiffSettingsItems } = await import("@pi-archimedes/diff");
     const allConfig = loadAllConfig();
     const coreConfig = { ...allConfig.core };
     const footerConfig = { ...allConfig.footer };
     const diffConfig = { ...allConfig.diff };
     const notifyConfig = { ...allConfig.notify };
     const sessionNameConfig = { ...allConfig.sessionName };

     const coreItems = getCoreSettingsItems(coreConfig);
     const footerItems = getFooterSettingsItems();
     const diffItems = getDiffSettingsItems();
     const notifyItems = getNotifySettingsItems(notifyConfig);
     const sessionNameItems = getSessionNameSettingsItems(sessionNameConfig);

     const items: SettingItem[] = [
       ...coreItems, ...footerItems, ...diffItems, ...notifyItems, ...sessionNameItems,
     ];
     // (drop the old "save" list item — saving is now the [s] keybinding)

     ctx.ui.custom((_tui, theme, _keybindings, done) => {
       const settingsManager = createSettingsManager({
         items,
         prompts: PROMPTS,
         theme,
         onChange: (id, newValue) => { /* existing switch-case, verbatim, minus the "save" case */ },
         onSave: () => {
           saveCoreConfig(coreConfig);
           saveFooterConfig(footerConfig);
           saveDiffConfig(diffConfig);
           saveNotifyConfig(notifyConfig);
           saveSessionNameConfig(sessionNameConfig);
           done(undefined);
         },
         onClose: () => { done(undefined); },
       });
       return settingsManager;
     }, { overlay: true, overlayOptions: OVERLAY_CHROME });
   }
   ```

   New imports: `createSettingsManager, type PromptDescriptor` from `./settings-manager.js`; `OVERLAY_CHROME` from `@pi-archimedes/core/overlay`. Remove imports that become unused — `SettingsList` and `getSettingsListTheme` for sure; also `TUI` and `Theme` type imports (the new `ctx.ui.custom` callback infers all params contextually, so neither needs an explicit annotation). `SettingItem` type stays (used to type `items`).

   Important: the `onChange` switch-case today has a `case "save"` that calls the five saves + `done()` — remove that case (saving moved to `onSave`). Everything else in the switch stays byte-identical.

4. `meta/src/index.ts` needs no change (it still calls `openSettings` from the `archimedes` command).

**Steps:**
- [ ] Make the `meta/src/settings.ts` changes above.
- [ ] Run `cd meta && npx tsc --noEmit`
  - Did it succeed? If not, read the error, fix, re-run.
- [ ] Run `cd packages/core && npx tsc --noEmit` and `cd packages/subagent && npx tsc --noEmit` (guard against accidental breakage — these should be unchanged)
- [ ] Run `npx vitest run` from the repo root — all suites green.
- [ ] Manual smoke test (symlink install per AGENTS.md: `ln -s $(pwd) ~/.pi/agent/extensions/pi-archimedes`), in a pi session run `/reload` then `/archimedes`:
  - [ ] Panel is centered, bordered, ~84 cols, with ` Settings ` header and dim hint footer — visually matching `/agents` (open `/agents` right after to compare chrome).
  - [ ] ↑/↓ navigates; ←/→ toggles an On/Off item and cycles `animationStyle`; the value updates live.
  - [ ] Enter on `Label text` opens the inline prompt; type a value, Enter saves it to the list; try ESC mid-prompt (value unchanged).
  - [ ] Enter on `Footer split threshold`, type `5` (below min 80) + Enter → error line shown, still in prompt; fix to `120` + Enter → applied.
  - [ ] `/` opens search; typing filters by label; ESC clears the query; typing "s" in search does NOT save.
  - [ ] `s` writes `~/.pi/agent/settings.json` (verify the changed values landed) and closes; ESC closes without writing (change a value, ESC, confirm file untouched).
- [ ] Commit with message: `feat(meta): render /archimedes settings as centered overlay matching /agents`

**Acceptance criteria:**
- [ ] `grep -rn "createTextSubmenu\|createNumberSubmenu\|addSubmenus" meta/src/` returns nothing.
- [ ] `/archimedes` opens as a centered bordered overlay identical in chrome to `/agents`.
- [ ] All settings remain editable exactly as before (toggles, 7 free-input fields with the same validation), saved via `s`, discarded via ESC.
- [ ] `tsc --noEmit` clean in meta, core, subagent; full `vitest run` green.
- [ ] No package outside `meta/` is modified.
