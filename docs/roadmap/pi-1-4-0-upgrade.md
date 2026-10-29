---
status: approved
issue: https://github.com/danielcherubini/pi-archimedes/issues/151
done-when: All 13 manifests pin devDependencies to 1.4.0, pnpm-lock.yaml is updated with @types/node at 22.19.19, settings-io handles UTF-8 BOM, subagent validates 1.4.0 thinking levels, pnpm -r exec -- tsc --noEmit passes with 0 errors, and all 2518+ vitest tests pass.
---

# Specification: Upgrade pi-archimedes to Pi 1.4.0 Target

## 1. Overview & Objective
Align the `pi-archimedes` monorepo's compile-time target and runtime environment from Pi `1.2.0` to Pi `1.4.0`. Incorporate upstream resilience fixes (such as UTF-8 BOM handling for settings), align thinking validation levels, document Rex terminal support, and ensure 100% clean type-checking and test passes across all 14 workspace packages.

## 2. Invariants & Guardrails
- **Honest Peer Floors (ADR 0026):** No `peerDependencies` floor is raised. Existing packages work across Pi 1.2.x, 1.3.x, and 1.4.x without requiring 1.4.0-exclusive APIs. Runtime checks (`reportPiSupport`) remain at `"1.2.0"`.
- **`@types/node` 22.19.19 Hold (ADR 0026):** Root `package.json`, `packages/subagent/package.json`, and `packages/web/package.json` hold `@types/node: "22.19.19"` to prevent dual-declaration conflicts on `ChildProcess.on` caused by Pi's bundled `@types/node@26.6.6`.
- **Atomic Lockfile:** `pnpm-lock.yaml` is regenerated via `pnpm install` in the same commit as the manifest version bumps.

## 3. Scope of Changes

### Section 1: Manifests, Workspace & Compile Targets
- **13 Package Manifests:** Update `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` in `devDependencies` to `"1.4.0"`:
  - `meta/package.json`
  - `packages/ask/package.json`
  - `packages/core/package.json`
  - `packages/diff/package.json`
  - `packages/footer/package.json`
  - `packages/image-paste/package.json`
  - `packages/notify/package.json`
  - `packages/session-name/package.json`
  - `packages/subagent/package.json`
  - `packages/sudo/package.json`
  - `packages/todo/package.json`
  - `packages/ui/package.json`
  - `packages/web/package.json`
- **4 AI Manifests:** Update `@earendil-works/pi-ai` in `devDependencies` to `"1.4.0"`:
  - `packages/session-name/package.json`
  - `packages/subagent/package.json`
  - `packages/todo/package.json`
  - `packages/ui/package.json`
- **Workspace Config:** Remove expired `minimumReleaseAgeExclude` entries for `1.2.0` in `pnpm-workspace.yaml`.
- **Lockfile:** Regenerate `pnpm-lock.yaml` via `pnpm install`.

### Section 2: Code Adjustments
- **Subagent Thinking Levels:** In `packages/subagent/src/thinking-validation.ts`, bump `THINKING_LEVELS_PI_VERSION` from `"1.2.0"` to `"1.4.0"`.
- **Settings I/O BOM Stripping:** In `packages/core/src/settings-io.ts`, update `parseSettings` to strip a leading `\uFEFF` before calling `JSON.parse` (matching upstream fix `#11191`).
- **Tests:** Add a unit test in `packages/core/src/settings-io.test.ts` verifying `parseSettings` successfully parses JSON prefixed with a UTF-8 BOM.

### Section 3: Documentation & Verification
- **AGENTS.md:** Update section header to `### Type-Check Target: pi 1.4.0 (and the @types/node hold)` and update manifest version text to `"1.4.0"`.
- **Rex Terminal Docs:** Mention Rex terminal (`TERM_PROGRAM=rex`) support (truecolor, OSC 8, Kitty graphics inline images) in `docs/features/ui.md` and `README.md`.
- **Verification:**
  1. `pnpm install`
  2. `pnpm -r exec -- tsc --noEmit` (0 errors)
  3. `pnpm test` (all 2,518+ vitest tests pass)
  4. `pnpm why @types/node` (single version: 22.19.19)
