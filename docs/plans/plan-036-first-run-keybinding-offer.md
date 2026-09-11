# Plan 036: First-run keybinding offer

**Status:** IN PROGRESS — unassigned
**PR:** (pending)
**Created:** 2026-09-11

## Goal

On the first TUI session where the suite is active, if `~/.pi/agent/keybindings.json` does not exist, ask the user (once ever, all platforms) whether to create it with the content from the docs snippet, so Pi's built-in paste doesn't double-fire with image-paste's `Ctrl+V` handler.

Direction approved via `ask` (2026-09-11): **all platforms, once ever — decline means never ask again.**

## Context

- `~/.pi/agent/keybindings.json` is parsed by Pi itself; Archimedes only *reads* it (the core editor resolves `app.clear`). The suite must never merge into or rewrite an existing user file.
- The docs already instruct this config (root + meta README setup step 6, `packages/image-paste/README.md#paste-shortcuts`); this plan makes the setup self-hosted instead of docs-only.
- Existing pieces: `ctx.ui.confirm(title, message)` (Pi API — **title first**; `docs/extensions.md:165`, `types.d.ts:72`), suite config helpers `loadConfig` / `saveConfig` / `isConfigEnabled` (`packages/core/src/settings-io.ts`), `getAgentDir()` from Pi, `KeybindingsManager.reload()` (re-read on `/reload`, `dist/core/keybindings.js`).

## Design

1. **New module** `packages/image-paste/src/keybinding-offer.ts` keeps `index.ts` slim. It exports one function: `offerKeybindingFix(ctx)` guarded end-to-end (gates in this order):
   1. Extension on: `isConfigEnabled("archimedes.imagePaste")`.
   2. Interactive **TUI**: `ctx.mode === "tui"` (context mode is `tui | rpc | json | print` — `types.d.ts:213-215`; never in non-TUI runs; the flag is **not** consumed when non-TUI, so a later TUI session still gets the offer).
   3. Not yet consumed: `loadConfig("archimedes.imagePaste", { keybindingsPromptDone: false }).keybindingsPromptDone !== true`.
   4. File absent: `!existsSync(join(getAgentDir(), "keybindings.json"))`.
   5. Ask: `ctx.ui.confirm("First run", "…message…")` — **title first**; message wording may be tuned during review.
   - **Yes** → write `keybindings.json` with its own tmp+rename — **re-check `existsSync` immediately before rename** so a concurrently created file is never clobbered; content exactly the docs snippet (JSON with the `app.clipboard.pasteImage` key mapped to an empty array — i.e. `app.clipboard.pasteImage: []`). **Then** set the flag. File write strictly before flag set — deliberate, so a failed write leaves both gates open and the offer self-heals next session.
   - **No** → set the flag and do nothing else. **Cancel (Esc/timeout — `confirm` resolves `false` either way) counts as decline**: flag set, offer gone. To re-open, delete `archimedes.imagePaste.keybindingsPromptDone` from `settings.json`.
   - Errors: wrap the yes-path in try/catch. File write fails → do **not** set the flag, `ctx.ui.notify` the error, self-heals next session. Flag persistence fails after a successful write → notify, leave flag unset (gate 4 then blocks re-offer anyway).
   - Flag persistence is **load-modify-save** (`loadConfig` → set field → `saveConfig`): `saveConfig` *replaces* the namespace object (`settings-io.ts:29-33`), so a bare `saveConfig(ns, { keybindingsPromptDone: true })` would erase other keys under `archimedes.imagePaste`.
2. **Config addition** — `archimedes.imagePaste` gains `keybindingsPromptDone?: boolean` (default `false`) in the existing settings-io namespace. Existing users: flag absent → offered exactly once on their next TUI session.
3. **Hook** — **mandate** a top-level `pi.on("session_start", ...)` in `meta/src/index.ts` `register()` (AGENTS.md rule: handlers register at top level, not nested). Rationale: the shipped composition is meta (`meta/src/index.ts:76-122`) — its `session_start` lazy-imports the package and calls `registerImagePaste` / `initImagePasteSession`, and never runs image-paste's own default-export hook. Wiring the offer only into that hook (as a "wire it into the existing handler" shortcut would) would silently never fire on the primary path. If the standalone default-export hook is wired later, the flag + file-absence gates make the second call a no-op.
   - On success: `ctx.ui.notify("Created ~/.pi/agent/keybindings.json — /reload applies it", "info")` — `/reload` is verified to re-read the file (`KeybindingsManager.reload()`).

## Testable behavior

- Offer fires exactly once (flag persisted) — accept, decline, **and cancel (resolves false → decline)** paths; flag write preserves existing `archimedes.imagePaste` keys (load-modify-save regression case, since `saveConfig` replaces the namespace object).
- Never fires when the file already exists (any content); never fires when the plugin is disabled; never fires in non-TUI modes and *does not* mark the flag in either case.
- File write: atomic tmp+rename with pre-rename existence re-check, content exactly the snippet, never merged into and never clobbered into an existing file; **file write fails → flag stays false**.
- Test setup: follow `settings-io.test.ts` (hoisted temp dir + `vi.mock("@earendil-works/pi-coding-agent", ...)` for `getAgentDir`) — the mock must be registered before the module under test is first imported, since module-scope path constants capture `getAgentDir()` at load time (`settings-io.ts:5`).

## Tasks

### 1. TDD: the offer module
- `packages/image-paste/src/keybinding-offer.ts` + `keybinding-offer.test.ts` — table: `isConfigEnabled` × {t, f} × `ctx.mode` ∈ {tui, rpc, json, print} × file {absent, present} × flag {unset, set} × confirm outcome {yes, no, cancel-resolves-false}.
- The "file write throws → flag stays false" and "flag write throws → notify, no crash" cases.
- Mock `ctx.ui.confirm` / `notify`; temp agent dir per the setup note in Testable behavior.

### 2. Wire it up
- Top-level `session_start` handler in **`meta/src/index.ts`** `register()` calling `offerKeybindingFix(ctx)` (per Design §3 — not the default-export hook).
- Import `loadConfig` / `saveConfig` / `isConfigEnabled` from `@pi-archimedes/core/settings-io` in `keybinding-offer.ts`.

### 3. Docs + settings reference
- `packages/image-paste/README.md` — one line under the existing Paste-shortcuts note: on the first TUI session, the suite offers to create `keybindings.json` when it's missing (once ever; decline/cancel stops it).
- Root + meta README setup step 6 — note the suite offers it automatically on the first run (keep the snippet).
- Settings tables: `keybindingsPromptDone` in the image-paste README settings section + the root/meta suite settings references.

## Verification

1. `npx tsc --noEmit` in `packages/image-paste` (and `meta`)
2. `pnpm test`

(Docs portion double-checked against source at review time.)

## Risks & notes

- This becomes the first write Archimedes makes into `~/.pi/agent/` besides `settings.json`, `mcp-cache.json`, `agents.local.json`, and agent definition files — the keybindings write is guarded by all five gates, only ever creates a fresh file, and never touches an existing one (even if the built-in binding is still set in it — that is the user's file).
- TOCTOU (file created between gate 4 and the rename) is ruled out by the pre-rename existence re-check.
- The flag is a suite-owned field written through the suite's existing settings path: other *namespaces* always survive; keys within `archimedes.imagePaste` survive only because of the mandated load-modify-save; a corrupt `settings.json` is clobbered by any suite settings write (pre-existing `settings-io` semantics, `settings-io.ts:11-18`, not introduced here).
