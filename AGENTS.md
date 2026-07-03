# AGENTS.md

Rules for AI agents working on this monorepo.

## Monorepo Structure

- `packages/core` — bus, chrome, text/color utils, editor, message, startup, thinking
- `packages/ask` — structured question tool with tabbed flow and inline notes (depends on core)
- `packages/footer` — status bar (depends on core)
- `packages/diff` — Shiki-powered diff rendering (standalone)
- `packages/image-paste` — clipboard image paste (standalone)
- `packages/subagent` — subagent dispatch with live TUI streaming and cost tracking (depends on core)
- `packages/todo` — todo list tool with auto-clear and subagent visibility (depends on core)
- `packages/notify` — delayed desktop notifications with circuit breaker (depends on core)
- `meta` — orchestrator + composed settings (depends on all eight)

## Adding a New Package

When a new package is added under `packages/<name>/`, update **all** of these or it will silently break the release / `pi install` flow (this is exactly how `todo` got missed):

1. **`packages/<name>/package.json`** — must include:
   - `"version"` matching the shared monorepo version
   - `"keywords": ["pi-package"]`
   - `"files": ["src"]`
   - `"pi": { "extensions": ["./src/index.ts"] }` ← **required**; without it, standalone `pi install @pi-archimedes/<name>` loads nothing
   - Internal deps as `"@pi-archimedes/core": "workspace:*"` (pnpm rewrites this to a real version at publish time)
   - `peerDependencies` for `@earendil-works/pi-coding-agent` / `pi-tui` / `pi-ai` as needed
2. **`meta/package.json`** — add `"@pi-archimedes/<name>": "workspace:*"` to `dependencies`
3. **`meta/src/index.ts`** — import and register the new package's entry
4. **`.github/workflows/release.yml`** — add a `pnpm --filter "@pi-archimedes/<name>" publish --access public --no-git-checks` line, placed after its internal deps and before `meta`
5. **`AGENTS.md`** — add to the Monorepo Structure list; bump the "all N package versions" count and the "N package directories" type-check count in Release Steps; add the package to the publish-order line
6. **`README.md`** — add a feature section, a line in the monorepo layout tree, a `pi install @pi-archimedes/<name>` line under "install selectively", and a settings-table entry if it has settings

### Publishing a new package safely

- Always publish via the release workflow (`git tag v...`), which uses `pnpm publish`.
- **Never** `npm publish` a workspace package directly — npm does **not** rewrite `workspace:*`, so the leaked protocol spec breaks `pi install` (npm) with `Unsupported URL Type "workspace"`. This is what happened to `todo@1.2.0`.
- If you must publish manually, use `pnpm publish --no-git-checks --access public` from the package directory (it rewrites `workspace:*` → real version) and provide `--otp=<code>` if 2FA is enabled.

## Conventions

### Package Manager
- This is a **pnpm workspace** — always use `pnpm install`, never `npm install`
- `packageManager` field in root `package.json` pins pnpm via Corepack
- `workspace:*` protocol in dependencies is pnpm-specific; npm cannot parse it
- `.npmrc` sets `package-manager-strict=true` and `manage-package-manager-versions=true`

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

### Plans
- Plans live in `docs/plans/YYYY-MM-DD-<feature>.md`
- Use the `create-plan` skill to generate plans, then dispatch the `reviewer` subagent to review them
- **Always commit the plan file to git** — it is an untracked file by default and will be lost if not added
- Update `docs/plans/README.md` to track plan status (IN PROGRESS → COMPLETED)

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
- Publishes in dependency order: core → ask → todo → notify → footer → diff → image-paste → subagent → meta

## Release Steps

When releasing a new version, apply these steps after bumping versions but before tagging:

1. **Bump all 9 package versions** — `packages/core`, `packages/ask`, `packages/footer`, `packages/diff`, `packages/image-paste`, `packages/notify`, `packages/subagent`, `packages/todo`, `meta` all share the same version. The root `package.json` is private and has no version to bump.

2. **Type-check all packages** — run `npx tsc --noEmit` in each of the 8 package directories (7 components + notify). Don't release if any check fails.

3. **Ensure CI is green** — check the latest CI run on `feature/monorepo-split` (or `main`). Don't release on a red build.

4. **Tag and push** — use annotated tag with `v` prefix: `git tag -a v0.x.y -m "Release v0.x.y"` then `git push origin v0.x.y`. The release workflow handles publishing to npm.
