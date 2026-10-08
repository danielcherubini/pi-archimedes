---
status: committed
done-when: pnpm test (vitest) is green including the new symlink-preservation cases in packages/core/src/settings-io.test.ts and packages/subagent/src/local-config.test.ts, tsc --noEmit is green in both packages, and a symlinked settings.json survives a saveConfig with its destination updated (GH issue #73 closed)
---

# Symlink-preserving settings writes Plan (issue #73)

**Goal:** Atomic settings writes must preserve symlinks (e.g. Stow-managed `~/.pi/agent/settings.json`) so updates reach the symlink's destination instead of replacing the link.
**Architecture:** One exported helper in `packages/core/src/settings-io.ts` (`writeAtomicPreservingSymlinks`) resolves a symlink to its real destination, writes the temp file beside that destination, and renames onto it. Both `saveConfig`/`removeConfig` delegate to it, and the subagent package's `agents.local.json` writer (an identical copy of the buggy pattern) delegates to the same helper via the core subpath export.
**Tech Stack:** vitest (root `pnpm test` = `vitest run`; CI gate in `.github/workflows/ci.yml` runs `pnpm test`); `tsc --noEmit` as the type gate; no build step.

**Background for the executing agent (no prior context assumed):**
- `packages/core/src/settings-io.ts` exports `loadConfig`, `saveConfig`, `removeConfig`, `isConfigEnabled`, `setConfigEnabled`, `updateConfig`. `SETTINGS_PATH` is computed **at module load** as `join(getAgentDir(), "settings.json")`.
- The bug: both writers do `writeFileSync(SETTINGS_PATH + ".tmp", …)` then `renameSync(tmp, SETTINGS_PATH)`. `rename(2)` replaces a symlink itself rather than following it. Reproduced: after a save through a symlink, the link is gone and the target file is unchanged.
- The same pattern is copy-pasted in `packages/subagent/src/local-config.ts` → `writeConfigAtomic()` for `agents.local.json` (its doc comment even says "Follows the pattern in packages/core/src/settings-io.ts").
- **Explicitly OUT of scope:** `packages/image-paste/src/keybinding-offer.ts` has the same tmp+rename pattern for `~/.pi/agent/keybindings.json`, but that write only fires on the one-shot first-run keybinding offer, which only triggers when the file is *missing* — a live symlink is therefore never hit. A dangling `keybindings.json` + offer firing is a degenerate case; if ever needed, that file can delegate to the same helper (it already imports from `@pi-archimedes/core/settings-io`). Say so in the issue #73 comment (Task 3).
- Test infrastructure (do NOT invent new): the repo uses **vitest** — root `pnpm test` = `vitest run`; each package's `vitest.config.ts` includes `src/**/*.test.ts`; test files live in `src/` and ARE type-checked by the package `tsconfig.json` (`include: ["src"]`). Existing suites: `packages/core/src/settings-io.test.ts` (30+ tests; harness = `vi.mock("@earendil-works/pi-coding-agent", () => ({ getAgentDir: () => tempDir }))` with a `vi.hoisted` temp dir, then `await import("./settings-io.js")`) and `packages/subagent/src/local-config.test.ts` (harness = `process.env.PI_CODING_AGENT_DIR = testDir` set at module top before import, `testDir = join(tmpdir(), "pi-test-local-config")`, `mkdirSync` in `beforeEach`). New cases go into these existing files as new `describe` blocks. Do not modify any tsconfig or vitest config. There is no formatter or linter in this repo; do not run one.
- Node `fs` semantics the design relies on: `existsSync` **follows** symlinks (false for a dangling link); `lstatSync` does **not** follow (a dangling link is still a symlink); `realpathSync` throws ENOENT for a dangling link, ELOOP for a loop.

---

### Task 1: Core symlink-preserving writer + settings-io regression tests

**Context:**
`saveConfig`/`removeConfig` in `packages/core/src/settings-io.ts` clobber a symlinked `settings.json` (GH issue #73). This task adds the shared helper, routes both writers through it, and locks the behavior in with vitest regression cases added to the existing `src/settings-io.test.ts`. The helper is exported because Task 2 (subagent) reuses it. Dangling-symlink behavior was decided explicitly: a direct write through the link recreates the destination, making the link live again (no data loss); `removeConfig` on a dangling link is a no-op (its `existsSync` early-return treats it as missing) and the link is left untouched. Regular-file and missing-file behavior must stay exactly what it is today — the existing 30+ cases in `settings-io.test.ts` are the safety net and must keep passing.

**Files:**
- Modify: `packages/core/src/settings-io.ts`
- Modify: `packages/core/src/settings-io.test.ts`

**What to implement:**

1. In `settings-io.ts`, extend the `node:fs` import to also include `lstatSync` and `realpathSync`. Add this exported function (place it above `saveConfig`):

```ts
/**
 * Atomic write that preserves symlinks: if `path` is a symlink to an
 * existing file, the temp file is created beside the resolved destination
 * and the rename targets the destination — leaving the link intact.
 * Regular files and missing files behave exactly as a plain tmp-then-rename
 * would (temp beside `path`, rename onto `path`).
 *
 * Dangling symlink: `realpathSync` throws (ENOENT) — the fallback writes
 * directly through the link, recreating the destination so the link is
 * live again.
 *
 * Failure-mode note (deliberate, differs from the old clobber behavior):
 * a symlink loop (ELOOP) or an unwritable destination directory (EACCES)
 * now throw out of this function, where the old code would have
 * "succeeded" by replacing the link with a regular file in the writable
 * agent dir.
 *
 * The rename-failure fallback also writes through a live symlink, since
 * writeFileSync follows links — even the non-atomic path never clobbers a
 * link to an existing file.
 */
export function writeAtomicPreservingSymlinks(path: string, data: string): void {
  let isLink = false;
  try { isLink = lstatSync(path).isSymbolicLink(); } catch { /* missing → plain path */ }
  let target = path;
  if (isLink) {
    try {
      target = realpathSync(path);
    } catch {
      // Dangling symlink: write through the link, recreating the destination.
      writeFileSync(path, data, "utf-8");
      return;
    }
  }
  const tmpPath = target + ".tmp";
  try {
    writeFileSync(tmpPath, data, "utf-8");
    renameSync(tmpPath, target);
  } catch {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    writeFileSync(target, data, "utf-8");
  }
}
```

2. In `saveConfig`, replace everything from `const tmpPath = SETTINGS_PATH + ".tmp";` through the end of the `try/catch` (the whole tmp/rename/fallback block) with exactly:

```ts
  writeAtomicPreservingSymlinks(SETTINGS_PATH, JSON.stringify(full, null, 2));
```

   Also update its JSDoc line "Save a config section to settings.json (atomic: write to .tmp then rename)." to "Save a config section to settings.json (atomic, symlink-preserving — delegates to writeAtomicPreservingSymlinks)."

3. In `removeConfig`, apply the identical replacement (same block, same one-line call).

4. Do NOT touch: `readRawSettings`, `parseSettings`, `readSettings`, `loadConfig`, `isConfigEnabled`, `setConfigEnabled`, `updateConfig`. Do NOT change the function signatures of `saveConfig`/`removeConfig`. Do NOT modify any other file in `packages/core`.

5. In `packages/core/src/settings-io.test.ts`, add a new `describe("symlink preservation")` block at the end of the file (reuse the file's existing `tempDir` / `fs` / `join` from the hoisted mock — the mocked `getAgentDir()` already points the module at `tempDir`). Per-test setup helper (local to the block): remove any prior `settings.json`, `settings.json.tmp`, AND any prior dangling target (e.g. `nope.json` — case 5 recreates it, so case 6 must start from a genuinely absent path); create a fresh target file `join(tempDir, "dotfiles-settings.json")` pre-seeded with `{ "preexisting": "keep-me" }`; create `join(tempDir, "settings.json")` as a **symlink** to it (reset per case; for the dangling cases, point the link at a non-existent path instead — use `nope.json` for case 5 and `nope2.json` for case 6 so the cases cannot contaminate each other).

   Cases (one `it()` per case; read the *target file* path for content assertions, not the link):
   1. **saveConfig through symlink preserves the link and updates the destination** — `saveConfig("archimedes.test", { a: 1 })`; expect `fs.lstatSync(settingsLink).isSymbolicLink()` true; target JSON has `archimedes.test` deep-equal `{ a: 1 }` **and** `preexisting === "keep-me"`.
   2. **removeConfig through symlink preserves the link** — save first, then `removeConfig("archimedes.test")`; expect link still a symlink; target has no `archimedes.test` key, still has `preexisting`.
   3. **regular file behavior unchanged** — remove the link, `fs.writeFileSync(settingsLink, "{}")` (a real file now); `saveConfig("archimedes.test", { b: 2 })`; expect `isSymbolicLink()` false; content has `b: 2`; also expect no stray `settings.json.tmp` left behind.
   4. **removeConfig with missing file creates nothing** — remove the link; `removeConfig("archimedes.test")`; expect `fs.existsSync(settingsLink)` false.
   5. **dangling symlink: saveConfig recreates the destination, link live again** — link points at `join(tempDir, "nope.json")` (absent); `saveConfig("archimedes.test", { c: 3 })`; expect `fs.existsSync("nope.json" path)` true with `c: 3` and link still a symlink.
   6. **dangling symlink: removeConfig is a no-op, link untouched** — link points at `nope2.json` (absent, distinct from case 5's `nope.json`); `removeConfig("archimedes.test")`; expect link still a symlink, `nope2.json` still absent, no file created.
   7. **sibling namespaces survive a save** — target pre-seeded with `{ "archimedes.other": { keep: true } }`; `saveConfig("archimedes.test", { d: 4 })`; expect target has BOTH `archimedes.other.keep === true` AND `archimedes.test` deep-equal `{ d: 4 }` (the second assertion is the one the bug actually breaks — both are required).

**Steps:**
- [ ] Add the `describe("symlink preservation")` block with all 7 cases to `packages/core/src/settings-io.test.ts`, written against the **fixed** behavior.
- [ ] Run `cd packages/core && npx vitest run src/settings-io.test.ts`
  - Did the **new** symlink cases fail (link replaced / `isSymbolicLink()` false — the current bug) while all pre-existing cases still pass? If the new symlink cases unexpectedly passed, stop and investigate before implementing.
- [ ] Implement items 1–3 in `packages/core/src/settings-io.ts` exactly as specified.
- [ ] Run `cd packages/core && npx vitest run src/settings-io.test.ts`
  - Did all cases pass (old + new)? If not, fix and re-run before continuing.
- [ ] Run `cd packages/core && npx tsc --noEmit`
  - Did it succeed? If not, fix and re-run before continuing.
- [ ] Commit with message: `fix(core): preserve symlinks in settings writes (issue #73)`

**Acceptance criteria:**
- [ ] `npx vitest run src/settings-io.test.ts` in `packages/core` passes — all pre-existing cases plus the 7 new ones.
- [ ] A symlinked `settings.json` is still a symlink after `saveConfig`/`removeConfig`, and its destination file holds the new content.
- [ ] `npx tsc --noEmit` in `packages/core` passes with zero errors.
- [ ] `git diff` shows changes only in `packages/core/src/settings-io.ts` and `packages/core/src/settings-io.test.ts`.

---

### Task 2: Subagent agents.local.json via the shared core writer

**Context:**
`writeConfigAtomic()` in `packages/subagent/src/local-config.ts` is a literal copy of the buggy tmp/rename pattern from Task 1 (for `agents.local.json`). A symlinked `agents.local.json` (same Stow scenario) would be replaced identically. This task deletes the duplicated write logic and delegates to the shared helper from Task 1 — no new behavior beyond "symlinks are preserved". The regression cases go into the existing `src/local-config.test.ts` (vitest; its harness already sets `PI_CODING_AGENT_DIR` to `testDir` at module top and imports `./local-config.js`).

**Files:**
- Modify: `packages/subagent/src/local-config.ts`
- Modify: `packages/subagent/src/local-config.test.ts`

**What to implement:**

1. In `local-config.ts`:
   - Add import: `import { writeAtomicPreservingSymlinks } from "@pi-archimedes/core/settings-io";`
   - In `writeConfigAtomic`, replace **everything from the first line of its body** (`const path = getLocalConfigPath();`) **through the end of its `try/catch`** with:

```ts
  writeAtomicPreservingSymlinks(
    getLocalConfigPath(),
    JSON.stringify(config, null, 2),
  );
```

   - Update its doc comment to: `/** Write the full config atomically (backup+restore safe). Delegates to the shared core helper, which preserves symlinked config files. */`
   - Reduce the `node:fs` import to exactly `readFileSync, existsSync` — remove `writeFileSync`, `renameSync`, and `unlinkSync` (verify: after the delegation, `readLocalConfigRaw` uses only `readFileSync` + `existsSync`; `tsc` will not flag unused imports, so check manually).
   - Do NOT touch: `readLocalConfigRaw`, `readLocalConfig`, `writeLocalField`, `deleteLocalField`, `deleteLocalAgent`, `writeLocalModel`, `deleteLocalModel`, `writeLocalThinking`, `deleteLocalThinking`, `setLocalConfig`.
2. In `packages/subagent/src/local-config.test.ts`, add a new `describe("symlink preservation")` block (reuse the file's existing `testDir`; per-test setup: rm any prior `agents.local.json` + `.tmp` in `testDir`, create a fresh target file pre-seeded with `{ "preexisting": "keep-me" }`, symlink `join(testDir, "agents.local.json")` to it). Cases:
   1. **writeLocalField through symlink** — `writeLocalField("general", "model", "test-model")`; expect link still a symlink; target has `general.model === "test-model"` and still `preexisting === "keep-me"`.
   2. **deleteLocalField through symlink** — fresh setup; `writeLocalField("general", "model", "test-model")` then `deleteLocalField("general", "model")`; expect link still a symlink; target has no `general` entry (field-level delete removes the entry when it becomes empty) but still `preexisting`.
   3. **regular file unchanged** — replace the link with a real file; `writeLocalField("general", "thinking", "high")`; expect not a symlink; target has the override; no stray `.tmp`.
   4. **setLocalConfig is a full replace, through the symlink** — fresh setup; `setLocalConfig({ alpha: { model: "m" } })`; expect link intact; target JSON deep-equals exactly `{ "alpha": { "model": "m" } }` — `preexisting` is **gone** (full replace is the existing contract).

**Steps:**
- [ ] Add the `describe("symlink preservation")` block with all 4 cases to `packages/subagent/src/local-config.test.ts`, written against the **fixed** behavior.
- [ ] Run `cd packages/subagent && npx vitest run src/local-config.test.ts`
  - Did the **new** symlink cases fail (link replaced — the current bug) while all pre-existing cases still pass? If the new cases passed unexpectedly, stop and investigate.
- [ ] Implement item 1 in `packages/subagent/src/local-config.ts`.
- [ ] Run `cd packages/subagent && npx vitest run src/local-config.test.ts`
  - Did all cases pass (old + new)? If not, fix and re-run before continuing.
- [ ] Run `cd packages/subagent && npx tsc --noEmit`
  - Did it succeed? If not, fix (e.g. a stale import) and re-run.
- [ ] Run `pnpm test` from the repo root (the CI gate — runs vitest across all packages)
  - Did everything pass? If not, fix and re-run before continuing.
- [ ] Commit with message: `fix(subagent): preserve symlinked agents.local.json via shared core writer`

**Acceptance criteria:**
- [ ] `npx vitest run src/local-config.test.ts` in `packages/subagent` passes — all pre-existing cases plus the 4 new ones.
- [ ] `pnpm test` from the repo root is green (CI gate).
- [ ] `git diff` on `packages/subagent/src/local-config.ts` shows only the new import, the body delegation, the comment, and the import cleanup.
- [ ] `npx tsc --noEmit` in `packages/subagent` passes.

---

### Task 3: Close GH issue #73

**Context:**
The bug is fixed and regression-covered by Tasks 1–2. Close the issue with a comment linking the fix so the reporter sees the resolution. No repo file changes in this task.

**Files:**
- None (external action only).

**What to implement:**
1. `gh issue comment 73` with a short summary: rename-onto-path replaced the link; writes now resolve the symlink's destination (temp file created beside it, rename targets the destination); a dangling symlink's destination is recreated by a direct write; behavior for regular/missing files unchanged; regression tests added to `packages/core/src/settings-io.test.ts` and `packages/subagent/src/local-config.test.ts` (vitest, run by CI). Note that `settings.json` and `agents.local.json` are covered, and that the one-shot first-run `keybindings.json` write (image-paste) is not affected because it only fires when the file is missing.
2. Link the two commits as full URLs: `https://github.com/danielcherubini/pi-archimedes/commit/<sha7>` for the Task 1 and Task 2 commits (get the SHAs with `git log --oneline -2`).
3. Then `gh issue close 73`.

**Steps:**
- [ ] Post the comment: `gh issue comment 73 --body "..."`, then close: `gh issue close 73`.
- [ ] Confirm: `gh issue view 73 --json state` reports `CLOSED`.

**Acceptance criteria:**
- [ ] Issue #73 is closed with a comment linking both fix commits.
