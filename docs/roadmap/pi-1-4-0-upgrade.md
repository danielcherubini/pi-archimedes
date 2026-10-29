---
status: committed
issue: https://github.com/danielcherubini/pi-archimedes/issues/151
done-when: All 13 manifests pin devDependencies to 1.4.0, pnpm-lock.yaml is updated with @types/node at 22.19.19, settings-io handles UTF-8 BOM, subagent validates 1.4.0 thinking levels, pnpm -r exec -- tsc --noEmit passes with 0 errors, and all 2518+ vitest tests pass.
---

# Pi 1.4.0 Upgrade Plan

**Goal:** Upgrade the compile-time type target of the `pi-archimedes` monorepo to Pi `1.4.0`, incorporate upstream UTF-8 BOM resilience and thinking level validation alignment, and verify clean workspace compilation and test passes.  
**Architecture:** Monorepo package manifests update devDependencies to pinned `"1.4.0"` while keeping runtime peer floors honest (ADR 0026) and holding `@types/node` at `22.19.19`. Core settings parser strips leading UTF-8 BOM to prevent settings clobbering, subagent thinking levels are aligned to 1.4.0, and documentation updates reflect the new compile target.  
**Tech Stack:** TypeScript, pnpm workspace, Vitest, `@earendil-works/pi-coding-agent@1.4.0`, `@earendil-works/pi-tui@1.4.0`, `@earendil-works/pi-ai@1.4.0`.

---

## Parallelisation

**Verdict:** SERIAL — Task 1 introduces code changes and unit tests, Task 2 touches all 13 package manifests and regenerates the shared `pnpm-lock.yaml` artifact (failing Gate 3 for parallel execution), and Task 3 performs full-workspace type-check, documentation, and end-to-end verification.

---

### Task 1: Core BOM Resilience & Subagent Version Alignment

**Parallel:** none — precedes package manifest and workspace lockfile changes.

**Context:**
Pi 1.4.0 introduced BOM tolerance for `mcp.json` (#11191) and the managed-install marker, addressing files generated on Windows by PowerShell 5.1 (`Out-File`) or Windows Notepad that start with a Byte Order Mark (`\uFEFF`). In `packages/core/src/settings-io.ts`, `parseSettings` returns an empty `{}` on parse failure; before this fix, if `settings.json` began with a BOM, `parseSettings` parsed it as empty, and the subsequent `saveConfig` would clobber sibling namespaces and cause data loss. Stripping `\uFEFF` before calling `JSON.parse` hardens our settings reader against this silent failure mode (note: subsequent writes drop the BOM via `JSON.stringify`, which is standard and expected).
Additionally, `packages/subagent/src/thinking-validation.ts` tracks `THINKING_LEVELS_PI_VERSION`, currently set to `"1.2.0"`. Upstream Pi 1.4.0 CLI (`pi/dist/cli/args.js:7`) accepts the identical set of 7 levels (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`), so the version constant and its accompanying doc comment should be bumped to `"1.4.0"`.

**Files:**
- Modify: `packages/core/src/settings-io.ts`
- Modify: `packages/core/src/settings-io.test.ts`
- Modify: `packages/subagent/src/thinking-validation.ts`
- Test: `packages/core/src/settings-io.test.ts`
- Test: `packages/subagent/src/thinking-validation.test.ts`

**What to implement:**
1. In `packages/core/src/settings-io.ts`:
   Update private `parseSettings(raw: string | null)` to strip a leading `\uFEFF`:
   ```typescript
   function parseSettings(raw: string | null): Record<string, unknown> {
     if (raw === null) return {};
     const sanitized = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
     try {
       return JSON.parse(sanitized) as Record<string, unknown>;
     } catch {
       return {};
     }
   }
   ```
2. In `packages/core/src/settings-io.test.ts`:
   Do NOT export private `parseSettings`. Instead, write integration test cases in the existing `describe("loadConfig", ...)` block using the established fixture pattern (`fs.writeFileSync(join(tempDir, "settings.json"), "\uFEFF" + ...)`):
   - **Case 1: BOM parsing:** Write a file starting with `"\uFEFF" + JSON.stringify({ "test.ns": { foo: "overridden" } })`. Assert that `loadConfig("test.ns", { foo: "bar", count: 42 })` returns `{ foo: "overridden", count: 42 }`. (Verify this fails before the fix returning default `{ foo: "bar", count: 42 }`, and passes after the fix).
   - **Case 2: Clobber prevention:** After reading the BOM-prefixed file from Case 1, call `saveConfig("other.ns", { val: 123 })`. Read the resulting file and assert that the original `"test.ns"` content was preserved alongside `"other.ns"`.
   - **Case 3: Effective settings:** Assert that `readEffectiveSettings()` (without a `pi` handle) correctly returns the parsed object from a BOM-prefixed `settings.json`.
3. In `packages/subagent/src/thinking-validation.ts`:
   - Update line 36:
     ```typescript
     export const THINKING_LEVELS_PI_VERSION = "1.4.0";
     ```
   - Update doc comment on line 38 from `/** pi 1.2.0's VALID_THINKING_LEVELS, in pi's order. */` to `/** pi 1.4.0's VALID_THINKING_LEVELS, in pi's order. */`.
   - Leave the historical sentence `Greptile found it; a live 1.2.0 child confirmed the mechanism` intact.

**Steps:**
- [ ] Add the 3 BOM test cases in `packages/core/src/settings-io.test.ts` under `describe("loadConfig", ...)`.
- [ ] Run `npx vitest run packages/core/src/settings-io.test.ts`
  - Verify that the new BOM tests fail as expected prior to modifying `settings-io.ts`.
- [ ] Implement BOM stripping in `packages/core/src/settings-io.ts`.
- [ ] Run `npx vitest run packages/core/src/settings-io.test.ts`
  - Verify all 46+ tests in `settings-io.test.ts` pass.
- [ ] Update `THINKING_LEVELS_PI_VERSION = "1.4.0"` and doc comment in `packages/subagent/src/thinking-validation.ts`.
- [ ] Run `npx vitest run packages/subagent/src/thinking-validation.test.ts`
  - Verify all subagent thinking validation tests pass.
- [ ] Commit with message: `fix(core): strip UTF-8 BOM in parseSettings and align subagent thinking levels version to 1.4.0`

**Acceptance criteria:**
- [ ] `packages/core/src/settings-io.ts` cleanly parses settings files starting with a UTF-8 BOM (`\uFEFF`) and prevents data loss on subsequent writes.
- [ ] `THINKING_LEVELS_PI_VERSION` is `"1.4.0"`.
- [ ] All tests in `settings-io.test.ts` and `thinking-validation.test.ts` pass.

---

### Task 2: Manifest devDependencies Bump & Lockfile Regeneration

**Parallel:** none — modifies shared lockfile (`pnpm-lock.yaml`) and workspace manifests.

**Context:**
Per `AGENTS.md` and ADR 0026, the monorepo pins host packages in `devDependencies` to exact strings to maintain deterministic type-checking. All 13 manifests must be updated from `"1.2.0"` to `"1.4.0"` for `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`. The 4 packages declaring `@earendil-works/pi-ai` (`session-name`, `subagent`, `todo`, `ui`) must also update it to `"1.4.0"`.
CRITICAL: Do NOT perform a blind replace of `1.2.0` with `1.4.0` across manifests — `peerDependencies` floors (e.g. `">=1.2.0"` in `meta`, `ask`, `diff`, `subagent`, `ui`) must NOT be raised, adhering strictly to ADR 0026.
In `pnpm-workspace.yaml`, the time-limited `minimumReleaseAgeExclude` entries for `1.2.0` (lines 8–18) are expired and must be removed, leaving the file ending in a trailing newline.
`pnpm install` must be run to update `pnpm-lock.yaml`, followed by a `--frozen-lockfile` check to ensure CI lockfile consistency.

**Files:**
- Modify: `meta/package.json`
- Modify: `packages/ask/package.json`
- Modify: `packages/core/package.json`
- Modify: `packages/diff/package.json`
- Modify: `packages/footer/package.json`
- Modify: `packages/image-paste/package.json`
- Modify: `packages/notify/package.json`
- Modify: `packages/session-name/package.json`
- Modify: `packages/subagent/package.json`
- Modify: `packages/sudo/package.json`
- Modify: `packages/todo/package.json`
- Modify: `packages/ui/package.json`
- Modify: `packages/web/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**What to implement:**
1. In `meta/package.json` and all 12 `packages/*/package.json`:
   - Target only the devDependencies entries matching exact string `"1.2.0"`:
     `"@earendil-works/pi-coding-agent": "1.2.0"` → `"1.4.0"`
     `"@earendil-works/pi-tui": "1.2.0"` → `"1.4.0"`
2. In `packages/session-name/package.json`, `packages/subagent/package.json`, `packages/todo/package.json`, `packages/ui/package.json`:
   - Target only the devDependencies entry:
     `"@earendil-works/pi-ai": "1.2.0"` → `"1.4.0"`
3. Verify that `peerDependencies` in all packages were NOT modified:
   Run `git diff -- '**/package.json' | grep -E '>=1\.'` — must produce empty output.
4. Verify `@types/node: "22.19.19"` remains held in root `package.json`, `packages/subagent/package.json`, and `packages/web/package.json`.
5. In `pnpm-workspace.yaml`:
   - Delete lines 8–18 (the `minimumReleaseAgeExclude` block for `1.2.0`). Ensure trailing newline is preserved.
6. Run `pnpm install` to update `pnpm-lock.yaml`.
7. Run `pnpm install --frozen-lockfile` to verify lockfile consistency.
8. Verify single `@types/node` version: `pnpm why @types/node | grep -o "2[0-9]\.[0-9]*\.[0-9]*" | sort -u` must output only `22.19.19`.

**Steps:**
- [ ] Update `devDependencies` in all 13 package manifests (`meta/package.json` and `packages/*/package.json`) using exact-pin replacements.
- [ ] Run `git diff -- '**/package.json' | grep -E '>=1\.'` and confirm no peer dependency floors were touched.
- [ ] Remove `minimumReleaseAgeExclude` block in `pnpm-workspace.yaml`.
- [ ] Run `pnpm install` to update `pnpm-lock.yaml`.
- [ ] Run `pnpm install --frozen-lockfile` to confirm lockfile integrity.
- [ ] Run `pnpm why @types/node | grep -o "2[0-9]\.[0-9]*\.[0-9]*" | sort -u`
  - Confirm output is exactly `22.19.19`.
- [ ] Run `pnpm -r exec -- tsc --noEmit`
  - Verify workspace type-check passes with 0 errors against Pi 1.4.0 types.
- [ ] Commit with message: `chore: bump pi devDependencies to 1.4.0 and regenerate lockfile`

**Acceptance criteria:**
- [ ] All 13 manifests declare `1.4.0` in `devDependencies` for pi packages.
- [ ] Zero `peerDependencies` floors were modified.
- [ ] `pnpm-workspace.yaml` has no stale 1.2.0 release-age exclusions.
- [ ] Exactly one version of `@types/node` (`22.19.19`) resolves across the workspace.
- [ ] `pnpm install --frozen-lockfile` and `pnpm -r exec -- tsc --noEmit` succeed with 0 errors.

---

### Task 3: Documentation Updates & Full Suite Verification

**Parallel:** none — depends on Tasks 1 and 2 completing.

**Context:**
`AGENTS.md` explicitly documents the compile target and the `@types/node` hold under `### Type-Check Target: pi 1.2.0 (and the @types/node hold)`. This section heading and body must be updated to reference Pi `1.4.0`, including line 95 which describes CI testing against pinned 1.4.0. The historical reference to bundled `26.6.5` on line 77 remains untouched.
In `docs/features/image-paste.md` (the sole document detailing inline image preview behavior), record a concise note that Pi ≥1.4.0 natively detects `TERM_PROGRAM=rex` with partial Kitty graphics support; note that the suite introduces no custom Rex overrides and has not independently verified Rex terminal previews. (Do not modify `docs/features/ui.md` or `README.md`, keeping their verification metadata and feature boundaries clean).
Finally, run the full test suite (all 2,518+ vitest tests) and type-check to confirm complete workspace health.

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/features/image-paste.md`

**What to implement:**
1. In `AGENTS.md`:
   - Update heading on line 74: `### Type-Check Target: pi 1.4.0 (and the @types/node hold)`
   - Update text on line 75: "Every one of the 13 manifests pins `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` in **`devDependencies` to the exact string `"1.4.0"`** — not a range. The four packages that declare `@earendil-works/pi-ai` pin it to `"1.4.0"` too."
   - Update text on line 95: change "pinned 1.2.0" to "pinned 1.4.0" (`...against our pinned 1.4.0. Red means our tree stopped compiling or stopped working.`).
   - Retain line 77's historical note about `@types/node` 26.6.5 and the 22.19.19 pin intact.
2. In `docs/features/image-paste.md`:
   - In the terminal compatibility or preview section, add a note: Pi ≥1.4.0 detects `TERM_PROGRAM=rex` as supporting partial Kitty graphics inline images, OSC 8 hyperlinks, and truecolor. Archimedes adds no Rex-specific logic and relies on host terminal detection.
3. Full verification:
   - Run `pnpm -r exec -- tsc --noEmit` (exit code 0, 0 errors).
   - Run `pnpm test` (all 148 test files, 2,518+ tests pass).
   - Run `git diff --check` (clean formatting, no trailing whitespace).

**Steps:**
- [ ] Edit `AGENTS.md` (lines 74, 75, 95) to reference Pi 1.4.0 compile target.
- [ ] Edit `docs/features/image-paste.md` to document host Rex terminal inline image capabilities.
- [ ] Run `pnpm -r exec -- tsc --noEmit`
  - Verify 0 errors across all 14 workspace projects.
- [ ] Run `pnpm test`
  - Verify all 2,518+ vitest tests pass.
- [ ] Commit with message: `docs: update type-check target to pi 1.4.0 in AGENTS.md and document Rex terminal compatibility`

**Acceptance criteria:**
- [ ] `AGENTS.md` accurately describes the 1.4.0 compile target in lines 74, 75, and 95.
- [ ] `docs/features/image-paste.md` documents host Rex terminal inline image capabilities.
- [ ] `pnpm test` passes 100% of tests (148+ test files, 2,518+ tests).
- [ ] `pnpm -r exec -- tsc --noEmit` passes with 0 errors.
