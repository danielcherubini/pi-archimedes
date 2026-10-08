---
status: live
last-verified: 2026-10-08
---

# Symlink-preserving settings writes

## What it is

Settings writes — `saveConfig` / `removeConfig` in `packages/core/src/settings-io.ts` and the subagent package's `agents.local.json` writes — are atomic and symlink-preserving. A config file that is a symlink (the Stow/dotfiles scenario: `~/.pi/agent/settings.json` → a dotfiles repo) stays a symlink after a write, and its destination receives the update. A regular file or a missing file behaves exactly as a plain tmp-then-rename would.

## Durable semantics

- **Symlinked file:** the link is resolved to its real destination; the temp file is created beside the destination and the rename targets it. The link is never replaced.
- **Dangling symlink:** a `saveConfig` writes through the link, recreating the destination so the link is live again. A `removeConfig` on a dangling link is a no-op — the link is left untouched.
- **Failed temp write (e.g. ENOSPC):** the temp file is cleaned up and the error re-throws — the live file survives untouched, so a disk-full failure cannot truncate previously-valid settings.
- **Failed rename:** falls back to a direct write-through (which follows symlinks), safe because the temp already holds the full content.
- **Symlink loop (ELOOP) / unwritable destination (EACCES):** throw out of the write; nothing is clobbered.

## Implementation

One shared helper, `writeAtomicPreservingSymlinks`, exported from `@pi-archimedes/core` (the `settings-io` subpath), is the single implementation: both `saveConfig` and `removeConfig` delegate to it, and the subagent package's `local-config.ts` writer does the same for `agents.local.json`. image-paste's one-shot `keybindings.json` write is unaffected — it only fires on the first-run keybinding offer when the file is missing, so a live symlink is never hit.
