# Ask Tool Plan

**Goal:** Add `@pi-archimedes/ask` — a structured question tool with tabbed multi-question flow, inline note editing, and markdown descriptions — as a standalone package in the pi-archimedes monorepo.

**Architecture:** Adapt 7 source files from an existing pi extension, swapping fork imports (`@mariozechner` → `@earendil-works`), migrating TypeBox (`@sinclair/typebox` → `typebox` v1.x), and renaming modules to match monorepo conventions (strip `ask-` prefix). Package is standalone — no internal workspace dependencies. Registered through the meta orchestrator like all other packages.

**Tech Stack:** TypeScript ESM, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox` v1.x, pnpm workspace

---

### Task 1: Create package scaffold and source files

**Context:**
Create the `packages/ask/` directory with package configuration and all 7 adapted source files. This is the core of the feature — the tool registration, UI logic, and helpers. All files are adapted from an existing extension with three systematic changes: (1) fork import swap, (2) TypeBox migration, (3) module rename. The package must type-check independently with `npx tsc --noEmit`.

**Files:**
- Create: `packages/ask/package.json`
- Create: `packages/ask/tsconfig.json`
- Create: `packages/ask/src/index.ts`
- Create: `packages/ask/src/selection.ts`
- Create: `packages/ask/src/picker.ts`
- Create: `packages/ask/src/dialog.ts`
- Create: `packages/ask/src/note.ts`
- Create: `packages/ask/src/cursor.ts`
- Create: `packages/ask/src/wrap.ts`
- Create: `packages/ask/README.md`

**What to implement:**

**`packages/ask/package.json`** — follow the convention from `packages/diff/package.json` or `packages/image-paste/package.json` (standalone packages). Exact fields:
```json
{
  "name": "@pi-archimedes/ask",
  "version": "1.2.1",
  "type": "module",
  "keywords": ["pi-package"],
  "description": "Structured question tool with tabbed multi-question flow and inline note editing",
  "files": ["src"],
  "main": "./src/index.ts",
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.1.0",
    "@earendil-works/pi-tui": ">=0.1.0",
    "typebox": ">=1.1.0"
  },
  "devDependencies": {
    "typebox": "^1.1.38",
    "typescript": "^6.0.0"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

**`packages/ask/tsconfig.json`** — extend root tsconfig like other packages:
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

**`packages/ask/src/selection.ts`** — adapted from `ask-logic.ts`. Changes:
- Export `OTHER_OPTION`, `RECOMMENDED_OPTION_TAG`, interfaces `AskOption`, `AskQuestion`, `AskSelection`
- Export functions: `appendRecommendedTagToOptionLabels`, `buildSingleSelectionResult`, `buildMultiSelectionResult`
- No import changes needed (pure logic, no external deps)

**`packages/ask/src/cursor.ts`** — adapted from `ask-inline-editor-cursor.ts`. Changes:
- Swap import: `@mariozechner/pi-tui` → `@earendil-works/pi-tui`
- Export `getLinearCursorIndexFromEditor` and `CursorReadableEditor` interface
- No logic changes

**`packages/ask/src/wrap.ts`** — adapted from `ask-text-wrap.ts`. Changes:
- Swap import: `@mariozechner/pi-tui` → `@earendil-works/pi-tui`
- Export `appendWrappedTextLines` and `AppendWrappedTextOptions`
- No logic changes

**`packages/ask/src/note.ts`** — adapted from `ask-inline-note.ts`. Changes:
- Swap import: `@mariozechner/pi-tui` → `@earendil-works/pi-tui`
- Internal import: `./ask-inline-editor-cursor` → `./cursor` (but this file doesn't import cursor — it's imported BY picker/dialog)
- Export: `INLINE_NOTE_WRAP_PADDING`, `CURSOR_MARKER` passthrough not needed, `buildOptionLabelWithInlineNote`, `buildWrappedOptionLabelWithInlineNote`
- No logic changes

**`packages/ask/src/picker.ts`** — adapted from `ask-inline-ui.ts`. Changes:
- Swap imports: `@mariozechner/pi-coding-agent` → `@earendil-works/pi-coding-agent`, `@mariozechner/pi-tui` → `@earendil-works/pi-tui`
- Internal imports: `./ask-logic` → `./selection`, `./ask-inline-editor-cursor` → `./cursor`, `./ask-inline-note` → `./note`, `./ask-text-wrap` → `./wrap`
- Export `askSingleQuestionWithInlineNote`
- No logic changes

**`packages/ask/src/dialog.ts`** — adapted from `ask-tabs-ui.ts`. Changes:
- Swap imports: `@mariozechner/pi-coding-agent` → `@earendil-works/pi-coding-agent`, `@mariozechner/pi-tui` → `@earendil-works/pi-tui`
- Internal imports: `./ask-logic` → `./selection`, `./ask-inline-editor-cursor` → `./cursor`, `./ask-inline-note` → `./note`, `./ask-text-wrap` → `./wrap`
- Export `askQuestionsWithTabs`, `formatSelectionForSubmitReview`
- No logic changes

**`packages/ask/src/index.ts`** — adapted from `index.ts`. Changes:
- Swap imports: `@mariozechner/pi-coding-agent` → `@earendil-works/pi-coding-agent`, `@sinclair/typebox` → `typebox`
- Internal imports: `./ask-logic` → `./selection`, `./ask-inline-ui` → `./picker`, `./ask-tabs-ui` → `./dialog`
- Export default function renamed to `registerAsk` (named export, not default) to match monorepo convention (all other packages use named exports: `registerCore`, `registerFooter`, etc.)
- The tool schema, execute handler, and session content formatting stay identical
- No logic changes beyond the export style

**Steps:**
- [ ] Create `packages/ask/` directory
- [ ] Write `packages/ask/package.json` with exact fields above
- [ ] Write `packages/ask/tsconfig.json` extending root (match `packages/diff/tsconfig.json` pattern)
- [ ] Copy and adapt `selection.ts` (no import swaps, pure logic)
- [ ] Copy and adapt `cursor.ts` (swap pi-tui import)
- [ ] Copy and adapt `wrap.ts` (swap pi-tui import)
- [ ] Copy and adapt `note.ts` (swap pi-tui import)
- [ ] Copy and adapt `picker.ts` (swap pi-coding-agent + pi-tui imports, update internal imports)
- [ ] Copy and adapt `dialog.ts` (swap pi-coding-agent + pi-tui imports, update internal imports)
- [ ] Copy and adapt `index.ts` (swap pi-coding-agent + typebox imports, update internal imports, change to named export `registerAsk`)
- [ ] Write `packages/ask/README.md` — short package README with install snippet (`pi install @pi-archimedes/ask`), feature bullets, and "No settings yet." note (match format of `packages/subagent/README.md` or `packages/image-paste/README.md`)
- [ ] Run `cd packages/ask && npx tsc --noEmit`
  - **Expected:** The monorepo's root `tsconfig.json` enables `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and `verbatimModuleSyntax` — stricter than the source repo. Small fixes (e.g. `string | undefined` guards on indexed access) are likely. Fix inline and keep in the same commit per AGENTS.md's "Always commit per logical unit" rule.
  - Did it succeed? If not, read errors → fix → re-run. Max 2 attempts before reporting BLOCKED.
- [ ] Commit with message: "feat: add @pi-archimedes/ask package"

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` passes in `packages/ask/` with zero errors (after any strictness fixes)
- [ ] All 7 source files present in `packages/ask/src/`
- [ ] `packages/ask/README.md` present (install snippet + feature bullets)
- [ ] `package.json` has `pi.extensions` field pointing to `./src/index.ts`
- [ ] No references to `@mariozechner` or `@sinclair/typebox` remain
- [ ] Export is named `registerAsk` (not default export)
- [ ] Tests intentionally not ported (consistent with monorepo convention — `tsc --noEmit` only)

---

### Task 2: Wire into meta orchestrator

**Context:**
The meta package is the entry point when users install `pi-archimedes`. It imports and registers all component packages. The ask package must be imported and its `registerAsk(pi)` called so the tool is available in sessions. The ask tool has no session lifecycle hooks (no session_start or session_shutdown needs) — it's a pure tool registration.

**Files:**
- Modify: `meta/package.json`
- Modify: `meta/src/index.ts`

**What to implement:**

**`meta/package.json`** — add to `dependencies`:
```json
"@pi-archimedes/ask": "workspace:*"
```
Place it alphabetically or near other standalone packages (after `@pi-archimedes/image-paste` is fine).

**`meta/src/index.ts`** — add:
1. Import line: `import { registerAsk } from "@pi-archimedes/ask";`
2. Call `registerAsk(pi);` in the main function, alongside other `register*` calls (after `registerTodo(pi)` is fine)
3. Do NOT add any session_start or session_shutdown handlers for ask

**Steps:**
- [ ] Add `"@pi-archimedes/ask": "workspace:*"` to `meta/package.json` dependencies
- [ ] Add `import { registerAsk } from "@pi-archimedes/ask";` to `meta/src/index.ts`
- [ ] Add `registerAsk(pi);` call in the main extension function
- [ ] Run `cd meta && npx tsc --noEmit`
  - Did it succeed? If not, read errors → fix → re-run. Max 2 attempts.
- [ ] Run `pnpm install` at root to update lockfile
- [ ] Commit with message: "feat: wire ask package into meta orchestrator"

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` passes in `meta/` with zero errors
- [ ] `registerAsk` is imported and called in `meta/src/index.ts`
- [ ] No session lifecycle handlers added for ask

---

### Task 3: Update release workflow and documentation

**Context:**
The monorepo has automated release infrastructure and documentation that must be kept in sync when packages are added. The `todo` package was previously missed in the release workflow, causing a broken publish — the AGENTS.md has explicit checklist items to prevent this. Since ask is standalone (no internal deps), it publishes after `core` (which has no deps either) and before packages that depend on core.

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `AGENTS.md`
- Modify: `README.md`

**What to implement:**

**`.github/workflows/release.yml`** — add one line after the `core` publish and before `todo`:
```yaml
pnpm --filter "@pi-archimedes/ask" publish --access public --no-git-checks
```

**`AGENTS.md`** — four changes:
1. **Monorepo Structure**: add line `- packages/ask — structured question tool with tabbed flow and inline notes (standalone)`
2. **Release Steps**: bump "all 7 package versions" → "all 8 package versions", bump "6 package directories" → "7 package directories", bump "(5 components + todo)" → "(6 components + todo)"
3. **Release Steps bullet list**: add `packages/ask` to the explicit list of packages that share the same version (e.g., `packages/core`, `packages/ask`, `packages/footer`, ...)
4. **Publishing section**: add `ask` to the publish order line: `core → ask → todo → footer → diff → image-paste → subagent → meta`

**`README.md`** — four changes:
1. **Features section**: Add a new section after Todo (or in logical position):
   ```markdown
   ### 💬 Ask ([`@pi-archimedes/ask`](packages/ask/README.md))

   Structured questioning with interactive options and inline notes.

   - Tabbed multi-question flow with submit review
   - Single-question picker with instant submit
   - Inline note editing per option
   - Markdown context descriptions
   - Automatic "Other (type your own)" handling
   ```
2. **Selective install list**: add `- pi install @pi-archimedes/ask`
3. **Monorepo layout tree**: add `│   ├── ask/          # @pi-archimedes/ask — structured question tool`
4. **Settings section**: add a subsection stating "No settings yet." (like subagent)
5. Update "six components" → "seven components" in the Features intro paragraph

**Steps:**
- [ ] Add ask publish line to `.github/workflows/release.yml` (after core, before todo)
- [ ] Update `AGENTS.md` Monorepo Structure list with ask entry
- [ ] Update `AGENTS.md` Release Steps counts (increment by 1, including parenthetical "(5 components + todo)" → "(6 components + todo)")
- [ ] Update `AGENTS.md` Release Steps bullet list to include `packages/ask` alongside other version-shared packages
- [ ] Update `AGENTS.md` publish order line to include ask
- [ ] Add Ask feature section to `README.md` with heading `### 💬 Ask ([`@pi-archimedes/ask`](packages/ask/README.md))`
- [ ] Add ask to selective install list in `README.md`
- [ ] Add ask to monorepo layout tree in `README.md`
- [ ] Add ask settings subsection in `README.md` using heading pattern `### [`@pi-archimedes/ask`](packages/ask/README.md)` with body "No settings yet."
- [ ] Update component count references in `README.md` (six → seven)
- [ ] Commit with message: "chore: update release workflow and docs for ask package"

**Acceptance criteria:**
- [ ] `release.yml` includes `@pi-archimedes/ask` publish step in correct dependency order
- [ ] `AGENTS.md` Monorepo Structure lists ask package
- [ ] `AGENTS.md` Release Steps counts are incremented (including parenthetical)
- [ ] `AGENTS.md` Release Steps bullet list includes `packages/ask`
- [ ] `AGENTS.md` publish order includes ask
- [ ] `README.md` features section includes ask with link to `packages/ask/README.md`
- [ ] `README.md` selective install list includes ask
- [ ] `README.md` monorepo layout tree includes ask
- [ ] `README.md` settings subsection for ask present
- [ ] `README.md` component counts updated

---

### Task 4: Final verification

**Context:**
Run type-checks across all affected packages to ensure nothing is broken by the new package. This is the final gate before the feature is considered complete.

**Files:**
- No file changes — verification only

**Steps:**
- [ ] Run `cd packages/ask && npx tsc --noEmit` — must pass
- [ ] Run `cd meta && npx tsc --noEmit` — must pass
- [ ] Run `pnpm -r exec -- tsc --noEmit` at repo root — must pass (mirrors the release workflow's verification)
- [ ] If any check fails: read error → fix → re-run. Max 2 attempts per check before reporting BLOCKED.
- [ ] Commit with message: "chore: verify type-checks across all packages" (only if there were fixes; otherwise skip this commit)

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` passes in `packages/ask/`
- [ ] `npx tsc --noEmit` passes in `meta/`
- [ ] `pnpm -r exec -- tsc --noEmit` passes across all packages (no regressions)

---

## Addendum: Subagent ask support (added during execution)

The original plan (Tasks 1–4) shipped a standalone `ask` tool that only worked when called by the **main agent**. During execution we extended it so a **subagent** can also call `ask` and have the question surface in the parent's TUI — the marquee feature of this package. This required crossing a process boundary (subagents run as a separate `pi` child process), so the package is **no longer standalone**: it now depends on `@pi-archimedes/core` for the shared event bus.

### The core problem

The eventbus (`@pi-archimedes/core/bus`) is per-process — a `Symbol.for("archimedes:bus")` on `globalThis`. The subagent runs as a child process (`spawn(..., { stdio: ["ignore", "pipe", "pipe"] })`), so the parent can *read* the child's stdout (JSON events) but has no way to inject data back. Fire-and-forget patterns (todos, cost) work because the parent just observes. But `ask` needs a **request → response round-trip**, so the answer must travel back to the child.

### Task 5: Shared bus events + core dependency

**Files:** `packages/core/src/bus.ts`, `packages/ask/package.json`, `packages/ask/src/index.ts`

- Added `ASK_REQUEST` and `ASK_RESPONSE` events to `packages/core/src/bus.ts` with typed payloads (`{ source, requestId, questions }` and `{ requestId, cancelled, results }`).
- Added `@pi-archimedes/core` as a `workspace:*` dependency of `ask` (the package is no longer standalone — AGENTS.md + README updated accordingly).

### Task 6: Bidirectional Unix socket IPC in spawn.ts

**Files:** `packages/subagent/src/spawn.ts`, `packages/subagent/src/stream.ts`

The parent's `spawnSubagent` now creates a Unix domain socket server before spawning the child and passes its path via the `PI_SUBAGENT_SOCKET` env var. The socket is used **bidirectionally**:

- **Child → parent:** the child's ask tool connects and writes `{ type: "ask_request", requestId, questions }`.
- **Parent → child:** the parent's socket server parses incoming `ask_request` lines, emits `ASK_REQUEST` on the bus, and — when the UI returns an `ASK_RESPONSE` — writes `{ type: "ask_response", requestId, cancelled, results }` back over the same socket.

The `pendingAsks: Map<string, Socket>` routes each response back to the originating socket (important for parallel subagents). The ASK_RESPONSE bus listener lives in `spawn.ts` (it owns the socket), not `stream.ts`.

**Why not stdout?** An earlier attempt had the child write `ask_request` to its stdout JSON stream. Pi's json-mode stdout handler captured it and turned it into the subagent's *output text* — it never reached the parent's event parser cleanly. Using the socket for both directions avoids stdout entirely.

### Task 7: Headless mode in the ask tool

**Files:** `packages/ask/src/index.ts`

When `!ctx.hasUI` (subagent/headless), the tool's `execute`:
1. Generates a `requestId`.
2. Connects to `process.env.PI_SUBAGENT_SOCKET`, sends the `ask_request` JSON line.
3. Awaits a matching `ask_response` line on the same socket.
4. Resolves on response / socket error / 5-minute timeout, then builds the tool result.

**Critical bug fixed here:** the original 5-minute `setTimeout` was never cleared when the response arrived, and it wasn't `unref()`'d — so even though the answer came back in ~2s, the dangling timer kept the child's event loop alive and the child refused to exit, making every subagent ask take 5m6s. Fix: a `finish()` helper that's idempotent (`resolved` guard), calls `clearTimeout(timer)`, and `timer.unref()` as belt-and-suspenders.

### Task 8: Parent UI handler

**Files:** `packages/ask/src/index.ts`, `packages/ask/src/picker.ts`, `packages/ask/src/dialog.ts`

`registerAsk` listens on the bus for `ASK_REQUEST`, defers one tick (`setImmediate`) so the TUI can settle, then calls `handleAskRequest` which reuses the **same** picker/dialog UI as the direct path:
- single non-multi question → `askSingleQuestionWithInlineNote`
- single multi-select question → `askQuestionsWithTabs` (the picker doesn't support `multi` — matching the direct path's routing)
- multiple questions → `askQuestionsWithTabs` (tabbed flow)

Both UI functions gained an optional `{ overlay?: boolean }` arg. The final implementation uses the **non-overlay** full-screen `ui.custom()` (identical to the direct ask); the overlay option was kept for flexibility. `currentCtx` is refreshed on `session_start`/`turn_start`. The handler is wrapped in try/catch so a `ui.custom()` returning `undefined` degrades to "cancelled" instead of crashing.

### Task 9: Cross-platform IPC

**Files:** `packages/subagent/src/spawn.ts`

The socket path is platform-aware:
- Unix (macOS/Linux): `join(tmpdir(), "pi-subagent-<ts>-<rand>")` — a filesystem Unix domain socket, pre-unlinked before listen.
- Windows: `\\.\pipe\pi-subagent-<ts>-<rand>` — a named pipe (Node requires the `\\.\pipe\` prefix explicitly; it doesn't auto-add it).

`unlinkSync` cleanup is guarded to Unix-only (Windows named pipes don't persist as files). `net.connect()` handles both path forms identically on the child side.

### Task 10: Docs rework

**Files:** `README.md`, `packages/ask/README.md`, `packages/ask/package.json`, `docs/images/ask-subagent.png`

- Rewrote the README's "Why pi-archimedes?" opener around the origin story: plugins don't talk to each other → built footer + subagent + bus → subagent todos → subagent ask. Lands on "All of that is solved now."
- Expanded the Ask feature section to sell the dual-mode capability (main agent **or** subagent), split into "From the main agent" / "From a subagent" bullets.
- Added `docs/images/ask-subagent.png` (screenshot of a subagent asking mid-stream), wired into both the root README and `packages/ask/README.md`, and added the `pi.image` field to `packages/ask/package.json` (matching the convention used by subagent/todo/diff).
- Updated `packages/ask/README.md` with the subagent feature and the core dependency note.

### Verification

All three subagent scenarios tested end-to-end and passing:
- Single question (subagent → overlay-free full-screen UI → answer returned in ~2s, subagent exits immediately)
- Multi-question tabs
- Multi-select

`pnpm -r exec -- tsc --noEmit` passes across all packages. Versions aligned to `1.2.2`.
