---
status: live
last-verified: 2026-09-14
verified-by: "pnpm test — packages/image-paste/src/keybinding-offer.test.ts (107 tests: gate matrix, auto-reload ordering, updateConfig concurrency) + meta/src/factory-lifecycle.test.ts (wiring)"
---

# First-run keybinding offer

## What it is

On the first TUI session where the image-paste plugin is active (via suite
composition), if `~/.pi/agent/keybindings.json` is absent, the suite offers
once to create it with the docs snippet:

```json
{ "app.clipboard.pasteImage": [] }
```

This clears Pi's built-in `app.clipboard.pasteImage` binding (Ctrl+V on
Linux/macOS, Alt+V on Windows) so it does not double-fire with image-paste's
own Ctrl+V handler. The user must accept; the file is never created silently.

## Gates (evaluated in order)

1. **Config enabled** — `isConfigEnabled("archimedes.imagePaste")` must return
   true. This is the sanctioned ADR 0012 exception: the check runs in-package,
   from the meta `session_start` handler, before plugin registration, so there
   is no registration gate available. See
   `docs/decisions/0012-plugin-gate-in-package-namespace.md § Exception`.
2. **TUI mode** — `ctx.mode === "tui"`. The flag is deliberately NOT consumed in
   non-TUI modes (`rpc`, `json`, `print`), so a later TUI session still gets
   the offer.
3. **Flag unset** — `loadConfig("archimedes.imagePaste", { keybindingsPromptDone: false }).keybindingsPromptDone !== true`.
4. **File absent** — `!existsSync(join(getAgentDir(), "keybindings.json"))`.
5. **Confirm** — `ctx.ui.confirm(title, message)` (title first, per Pi API).

## Offer-once semantics

The `keybindingsPromptDone` flag is set on **every** outcome:

- **Accept** (confirm → `true`) — file written, then flag set, then reload.
- **Decline** (confirm → `false`) — flag set; file untouched.
- **Cancel** (Esc / session tear-down / timeout — `confirm` resolves `false` either way) — counts as decline; flag set.

To reset the offer, delete the `keybindingsPromptDone` key from
`archimedes.imagePaste` in `~/.pi/agent/settings.json`.

**Concurrent-session edge:** if the user runs `/new` or `/reload` while the
confirm dialog is open, `ctx.ui.confirm` resolves `false` (the TUI tears down).
This counts as a decline — the flag is set and the offer does not appear again.

## Consent-based, atomic file write

The file is created **only on accept and only when absent**. Write is atomic:

1. Write to `<keybindingsPath>.<pid>.tmp`.
2. **Pre-rename existence re-check** — if the file was created concurrently in
   the window between gate 4 and the rename, the tmp is removed and the offer
   ends without clobbering the existing file. Flag is set (gate 4 will block
   any re-offer anyway).
3. `renameSync(tmpPath, keybindingsPath)` — atomic on POSIX, best-effort on
   Windows.

**File write strictly before flag set.** If the write throws (including the
rename), the flag is NOT set and the offer self-heals next session. A failed
write notifies the user via `ctx.ui.notify` and returns without crashing.

## Auto-reload on accept

After a successful write and flag set, the module calls `await ctx.reload()`.
This runs the exact `/reload` TUI flow: re-reads `keybindings.json` and
re-binds extension shortcuts, so the cleared built-in binding applies
immediately.

`ctx.reload()` **must be the last use of `ctx`** — Pi invalidates the extension
runtime on reload. If the reload fails, the TUI shows its own "Reload failed"
status; the file and flag are already persisted, so a manual `/reload` heals it
and the offer is not repeated (flag gate).

## Wiring

`offerKeybindingFix(ctx)` is called from a **top-level** `session_start` handler
in `meta/src/index.ts` `register()` — top-level per the AGENTS.md rule (nested
registration accumulates on `/reload`). The call is fire-and-forget; an uncaught
error never takes down session startup.

The handler is **not** double-gated with `isPluginEnabled("image-paste")`:
that helper resolves to the same `archimedes.imagePaste.enabled` key as gate 1,
so the check would be redundant. Standalone installs (not via meta) see the
wiring note in the image-paste README but do not receive the offer — the
`session_start` hook is not wired in standalone mode. The five gates make any
accidental double-wiring a no-op.

## Settings surface

| Key | Default | Notes |
|-----|---------|-------|
| `archimedes.imagePaste.enabled` | `true` (absent) | Suite-managed; toggled via `/plugins`. Never read at runtime except by this gate. |
| `archimedes.imagePaste.keybindingsPromptDone` | `false` (absent) | Set to `true` on any outcome. Delete to reset the offer. |

`saveConfig` **replaces** the whole namespace object, so all reads and writes
to `archimedes.imagePaste` must go through load-modify-save or through
`updateConfig`. The flag write uses `updateConfig` (see below).

## `updateConfig` concurrency safety

`markPromptDone` calls `updateConfig<PromptConfig>(namespace, defaults, mutate)`:

1. Reads `settings.json` raw string (`before`).
2. Parses and applies the mutate callback.
3. Reads `settings.json` again (`after`).
4. If `before !== after` **and** attempts remain, discards and retries from step 1,
   recomputing from the freshest state.
5. After `maxAttempts` (default 3) or when a clean window is observed, writes via
   `saveConfig` (which performs its own fresh read for sibling namespaces before
   the atomic rename).

The residual last-writer-wins window between the final `after` check and
`saveConfig`'s internal read cannot be eliminated without file locks. Node core
exposes no portable `flock`/`fcntl`, so optimistic retry is the strongest safe
primitive without new dependencies.
