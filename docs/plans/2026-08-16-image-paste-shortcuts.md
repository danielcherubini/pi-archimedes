# Configurable Image-Paste Shortcuts Plan

**Goal:** Let users override or disable the keyboard shortcuts used to attach clipboard images.
**Architecture:** Keep configuration and shortcut validation in a small, pure module within `packages/image-paste`; resolve shortcuts once while registering the extension.
**Tech Stack:** TypeScript, Vitest, `@pi-archimedes/core/settings-io`, `@earendil-works/pi-tui`

---

## Implementation

**Files:**
- Create: `packages/image-paste/src/config.ts`
- Create: `packages/image-paste/src/config.test.ts`
- Modify: `packages/image-paste/src/index.ts`
- Modify: `packages/image-paste/package.json`
- Modify: `packages/image-paste/README.md`
- Modify: `pnpm-lock.yaml`

**Steps:**
- [x] Add `archimedes.imagePaste` configuration loading through the core `settings-io` subpath export.
- [x] Resolve configured shortcut IDs only when every entry is a supported Pi TUI `KeyId`.
- [x] Preserve existing platform defaults when the setting is omitted or invalid.
- [x] Treat an empty shortcut array as an explicit opt-out.
- [x] Register resolved shortcuts in the existing image-paste extension flow.
- [x] Declare the workspace core dependency and document the setting.
- [x] Add focused tests for defaults, overrides, opt-out, invalid values, and namespace loading.
- [x] Run `npx tsc --noEmit` in `packages/image-paste`.
- [x] Run `npx --no-install vitest run packages/image-paste`.

**Acceptance criteria:**
- [x] Existing shortcuts remain the default on each platform.
- [x] Users can provide a replacement shortcut list or an empty list.
- [x] Invalid persisted values cannot register unsupported shortcut IDs.
- [x] The package type-check and focused test suite pass.
