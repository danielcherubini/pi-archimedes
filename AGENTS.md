# AGENTS.md

Rules for AI agents working on this monorepo.

## Monorepo Structure

- `packages/core` — bus, chrome, text/color utils, editor, message, startup, thinking
- `packages/footer` — status bar (depends on core)
- `packages/diff` — Shiki-powered diff rendering (standalone)
- `packages/image-paste` — clipboard image paste (standalone)
- `meta` — orchestrator + composed settings (depends on all four)

## Conventions

### Imports
- **Within a package:** always relative paths (e.g., `from "../chrome.js"`)
- **Cross-package:** use package subpath exports (e.g., `from "@pi-archimedes/core/bus"`)
- **Never** import `../utils/...` — those barrels were dissolved into `text.ts` and `color.ts`

### Config
- Each package reads its own namespace in `~/.pi/agent/settings.json`
- Core: `archimedes.core`, Footer: `archimedes.footer`, Diff: `archimedes.diff`
- No migration from old `hephaestus` keys

### No Build Step
- All packages use `"type": "module"` with `.ts` entry points
- Pi's jiti loader handles TypeScript at runtime
- Verification is `tsc --noEmit`, not a build or test command

### Verification Order (run independently, wait for each)
1. `npx tsc --noEmit` in the package directory
2. If it fails: read the error → read the relevant file → fix → re-run
3. Loop-break: if a check fails twice without edits between, stop and report BLOCKED

### Commits
- `chore:` for infra (workflows, config, README)
- `feat:` for new features or packages
- `fix:` for bug fixes
- Always commit per logical unit — don't batch unrelated changes

### Event Handlers
- Register `session_shutdown` handlers at the top level of `register()`, NOT inside `session_start`
- Nested registration causes handler accumulation on `/reload`

### Source Files
- Pi loads `.ts` files directly — publish `src/` in `"files"` field
- ANSI escape sequences use `\x1b` with semicolons (e.g., `\x1b[38;2;255;215;0m`)
- Common pitfall: commas instead of semicolons in truecolor ANSI codes

## Testing Locally

Symlink monorepo root into pi extensions:
```bash
ln -s $(pwd) ~/.pi/agent/extensions/pi-archimedes
```
Root `package.json` has `pi.extensions` pointing to `meta/src/index.ts`.

## Publishing

- All packages share the same version (bump all together)
- `git tag v0.x.y && git push origin v0.x.y` triggers the release workflow
- Publishes in dependency order: core → footer → diff → image-paste → meta
