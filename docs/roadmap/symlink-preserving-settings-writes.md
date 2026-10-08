---
status: approved
done-when: node --test is green for packages/core/test and packages/subagent/test, tsc --noEmit is green in both packages, and a symlinked settings.json survives a saveConfig with its destination updated (GH issue #73 closed)
---

# Preserve symlinks in settings saves (issue #73)

## Problem

`saveConfig()` and `removeConfig()` in `packages/core/src/settings-io.ts` perform their atomic write as `tmp → renameSync(SETTINGS_PATH)`. When `~/.pi/agent/settings.json` is a symlink (e.g. Stow-managed dotfiles), the rename **replaces the link itself** — updates stop reaching the dotfiles repo, and Stow reports a conflict. Pi's own `SettingsManager` avoids this by writing directly (which follows symlinks) under a lockfile. The same rename pattern is duplicated in `packages/subagent/src/local-config.ts` for `agents.local.json`.

Reproduced during spec discussion with a smoke test against the real `saveConfig` in a temp `PI_CODING_AGENT_DIR`: after a save through a symlink, the link is gone and the target file is unchanged.

## Goal

Atomic writes that preserve symlinks: a settings file (or `agents.local.json`) that is a symlink stays a symlink, and its **destination** receives the update. Regular-file and missing-file behavior stays identical to today.

Decisions made during discussion (2026-10-08):
- Scope: fix both `settings-io.ts` and the `subagent` `local-config.ts` copy via one shared helper (user-approved).
- Tests: checked-in `node --test` files, zero new deps, manual run (not wired to CI) (user-approved).

## Changes

### 1. `packages/core/src/settings-io.ts`

- New exported helper:
  ```ts
  export function writeAtomicPreservingSymlinks(path: string, data: string): void
  ```
  - If `path` exists and `lstatSync(path).isSymbolicLink()`, resolve `target = realpathSync(path)` (throws ENOENT when dangling — caught by the outer try).
  - `tmp = target + ".tmp"` → `writeFileSync(tmp, data)` → `renameSync(tmp, target)`.
  - On any failure: unlink `tmp` (best-effort) and fall back to `writeFileSync(target, data)` — which writes *through* the link for a real target, so even the non-atomic fallback preserves the link.
  - Dangling-symlink behavior (explicit decision): the fallback direct write **recreates the destination** with the new content — the link becomes live again, no data loss.
- `saveConfig` and `removeConfig` keep their existing read/merge/guard logic and replace their inline tmp/rename blocks with the helper.
- `updateConfig`, `loadConfig`, `isConfigEnabled`, `setConfigEnabled`: unchanged (they delegate to `saveConfig`/`removeConfig`).
- New imports: `lstatSync`, `realpathSync` from `node:fs`.

### 2. `packages/subagent/src/local-config.ts`

- `writeConfigAtomic` replaces its inline tmp/rename block with `writeAtomicPreservingSymlinks(getLocalConfigPath(), JSON.stringify(config, null, 2))`, imported from `@pi-archimedes/core/settings-io` (subpath export; subagent already depends on core).
- Its doc comment updates to "Delegates to the shared core helper (preserves symlinked files)".

### 3. Regression tests (checked in, `node --test`, zero new deps)

- `packages/core/test/settings-io.test.ts` — harness: `mkdtempSync` a fake agent dir, set `process.env.PI_CODING_AGENT_DIR` **before** `await import` of `../src/settings-io.ts` (the module resolves `SETTINGS_PATH` at load). Cases:
  1. save through symlink → link intact, destination updated
  2. `removeConfig` through symlink → link intact, namespace gone from destination
  3. save to regular file → unchanged behavior, content correct
  4. `removeConfig` when file missing → no file created
  5. save through **dangling** symlink → destination recreated, link live again
  6. sibling namespaces survive a save (read-modify-write preserved)
- `packages/subagent/test/local-config.test.ts` — same harness for `agents.local.json` via `writeLocalField`/`removeLocalField` (symlink preserved, destination updated; regular file unchanged).
- Test files live under `test/` — outside every package's `tsconfig.json` `include: ["src"]`, so `tsc --noEmit` is unaffected. Run: `node --test test` from the package dir (Node ≥ 22 type-strips the `.ts`; verified on Node 22.23.1).
- No CI wiring (manual run only, per decision).

### 4. Docs & issue

- Close GH issue #73 with a summary comment linking the commit.
- No README change (no user-facing behavior beyond the bug fix; no new settings).
- No ADR (fix technique is self-evident and issue-suggested); no CONTEXT.md term (nothing newly resolved).

## Verification

1. `npx tsc --noEmit` in `packages/core` and `packages/subagent`
2. `node --test test` in both package dirs — all cases green
3. Manual end-to-end (optional): temp `PI_CODING_AGENT_DIR` with symlinked `settings.json`, toggle a real setting, confirm link intact + destination updated (already prototyped in the spec session)
4. `git diff` review: only the three areas above touched
