# AGENTS.md

Rules for AI agents working on this monorepo.

## Monorepo Structure

- `packages/core` — event-channel vocabulary, bridge, chrome, text/color utils, overlay, profiler, settings-io, tool-render
- `packages/ui` — TUI enhancements: bash tool styling, custom editor, border spinner, thinking collapse, splash animation (depends on core)
- `packages/ask` — structured question tool with tabbed flow and inline notes (depends on core)
- `packages/footer` — status bar (depends on core)
- `packages/diff` — Shiki-powered diff rendering (standalone)
- `packages/image-paste` — clipboard image paste (depends on core)
- `packages/subagent` — subagent dispatch with live TUI streaming and cost tracking (depends on core, todo)
- `packages/todo` — todo list tool with auto-clear and subagent visibility (depends on core)
- `packages/notify` — delayed desktop notifications with circuit breaker (depends on core)
- `packages/session-name` — auto session naming (depends on core)
- `packages/web` — web search and content fetching with multi-provider routing (depends on core)
- `packages/sudo` — safe privileged execution (sudo_exec tool, masked password prompt, interactive-sudo bash guard) (depends on core)
- `meta` — orchestrator + composed settings (depends on all twelve)

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
3. **`meta/src/index.ts`** — import and register the new package's entry, gated by `isPluginEnabled("<name>")` (the single global gate from `meta/src/plugins.ts`)
4. **`meta/src/plugins.ts`** — add the package to the `PLUGINS` manifest (`id`, `label`, `description`, `namespace` (e.g. `archimedes.<newkey>`), `load()`). A manifest entry is required: registration alone is not enough — the gate, `/archimedes` settings items, and shutdown all key off the manifest, and a missing entry means the package also disappears from the `/plugins` menu. (There is no `defaultEnabled` any more — the manifest entry carries the settings-namespace key the gate reads, and no plugin is off-by-default today.)
5. **npm trusted publishing** — on npmjs.com, add a Trusted Publisher for `@pi-archimedes/<name>`: package page → **Access** → *Trusted Publishing* → add a GitHub Actions publisher for repo `danielcherubini/pi-archimedes`, workflow `.github/workflows/release.yml`. There is **no CLI for this**, and it is **per package** — an existing org/scope setting does not cover a new package. Skip it and the release workflow's `--provenance` publish dies with `ERR_PNPM_AUTH_TOKEN_EXCHANGE … 404` followed by a bare `{"error":"Not found"}`, which reads like a transient registry outage but is not: npm 404s the OIDC token exchange when the package has no matching trusted publisher. Do this **before** the first release that includes the package — `ui` and `web` were both missed, so their versions had to be hand-published without provenance.
6. **`.github/workflows/release.yml`** — add `@pi-archimedes/<name>` to the `ORDER` list in the "Publish to npm" step, placed after its internal deps and before `meta`, and to the package list in the "Verify all packages are on npm" step
7. **`AGENTS.md`** — add to the Monorepo Structure list; bump the "all N package versions" count and the "N package directories" type-check count in Release Steps; add the package to the publish-order line
8. **`README.md`** — add a feature section, a line in the monorepo layout tree, a `pi install @pi-archimedes/<name>` line under "install selectively", and a settings-table entry if it has settings

> A package missing from **both** lists above is invisible to CI: it will never publish and nothing fails to say so.

### Publishing a new package safely

- Always publish via the release workflow (`git tag v...`), which uses `pnpm publish`.
- The publish step skips versions already on npm and retries transient failures, so a **failed run can be re-run safely** (`gh run rerun <id>`) once the cause is fixed — already-published packages are skipped, not re-published. The "Verify all packages are on npm" step is the real gate on whether a release shipped.
- **Publish order matters for `meta`:** `pi-archimedes` pins every component to an exact version, so if any component fails to publish, `meta` is left with an unsatisfiable dependency and `npm install pi-archimedes@<v>` fails with `ETARGET`. Don't consider a release done until the verify step is green.
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
- **Cross-package:** use package subpath exports (e.g., `from "@pi-archimedes/core/events"`)
- **Never** import `../utils/...` — those barrels were dissolved into `text.ts` and `color.ts`

### Config
- Each package reads its own namespace in `~/.pi/agent/settings.json`
- Core: `archimedes.core`, Footer: `archimedes.footer`, Diff: `archimedes.diff`, Session-name: `archimedes.sessionName`
- Plugin on/off: a non-core package's namespace may carry a suite-managed `enabled` boolean (default on when absent). **Only meta reads/writes it**, via `/plugins` (`isPluginEnabled` / `setPluginEnabled` in `meta/src/plugins.ts`, ADR 0012). Package code must never read it as a runtime guard, and it never appears in a package's own settings items — except the first-run keybinding offer (image-paste gate 1, plan-approved 2026-09-11, see ADR 0012 Exception), which runs from the meta `session_start` handler before plugin registration and must read the flag directly to honour a plugin-off toggle
- No migration from old `hephaestus` keys

### No Build Step
- All packages use `"type": "module"` with `.ts` entry points
- Pi's jiti loader handles TypeScript at runtime
- Verification is `tsc --noEmit`, not a build or test command

### Type-Check Target: pi 1.4.0 (and the `@types/node` hold)
- Every one of the 13 manifests pins `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` in **`devDependencies` to the exact string `"1.4.0"`** — not a range. The four packages that declare `@earendil-works/pi-ai` pin it to `"1.4.0"` too. Ranges are wrong here on purpose: caret on an 0.x (`^0.87.0`) cannot even resolve `0.87.1`, and the suite once type-checked eleven releases behind what users ran.
- This is a **compile-time** pin only. At runtime pi aliases every host specifier to its own copy (ADR 0026), so the workspace `node_modules` copy is never what executes. `typescript` stays where it is (root `^7.0.2`, packages `^6.0.x`).
- **`@types/node` is held at `22.19.19`** — pinned exactly in root `devDependencies` (which is what makes `packages/core`'s hoisted `node:fs` compile deterministically) and declared in `packages/subagent` and `packages/web`. Do **not** "modernise" it to 26.x: pi 1.2.0 bundles `@types/node` 26.6.5, where `ChildProcess extends InternalEventEmitter<ChildProcessEventMap>`, and if both copies land in one program you get three false `Property 'on' does not exist on type 'ChildProcessWithoutNullStreams'` errors — `packages/image-paste/src/clipboard.ts` and `packages/sudo/src/tool.ts` — that read exactly like real upstream breakage. Check with `pnpm why @types/node | grep -o "2[0-9]\.[0-9]*\.[0-9]*" | sort -u` (exactly one version). The pin will look stale to a future contributor; that is why it is written down here and in ADR 0026.

### Two Never-Do Rules (suite-wide, mechanically guarded)
1. **Never decide a colour by parsing an escape string — ask the theme for a token.** A theme token may be `""` (terminal default), which `Theme.getBgAnsi()` renders as `\x1b[49m`: a **truthy** string, so `getBgAnsi(k) ?? FALLBACK` never falls back, and a `38;2;`-only parser returns a near-black slab instead of "no colour" — which is how black editor borders on a light terminal got shipped. Read the token (`theme.colors[token]`, `theme.style(...)`), read `theme.appearance` for light/dark, and treat a terminal-default token as *no colour* (`isTerminalDefault()` / `NO_PANEL_COLOR` in `packages/core/src/chrome.ts`). Producers stay exempt — emitting `38;2;`/`48;2;` codes and `packages/diff/src/ansi/`'s decoder are not decisions. Full wording: `docs/features/ui.md`.
2. **Never `console.*` from a render or event path — use `core/log`'s `diag`.** On fullscreen screen a stray write lands inside the differential frame and smears the viewport until the next full redraw; inside a subagent child every non-JSON stdout line is discarded by the reader. Developer diagnostics go to `diag(scope, msg)` / `describeError(err)` (file sink, `$PI_ARCHIMEDES_LOG`, silent when unset); anything the user must act on goes to `ctx.ui.notify`. Guards: `packages/core/src/log-discipline.test.ts` matches **every** `console.<method>(` and its allow-list is `packages/core/src/log.ts` alone — if you widen it, the entry must name the task that removes it. `packages/diff` keeps a sibling copy because it is standalone.

### Peer Floors Are Documentation, Not Protection
- `pi install` omits peers (`--legacy-peer-deps` / `--omit=peer`) and the loader aliases host packages, so a published range is **never installed, solved, parsed or warned about**; `>=0.1.0` and `*` are byte-for-byte equivalent at install time (ADR 0026). The mechanism that can actually reach a user is `reportPiSupport(pkg, min)` (`packages/core/src/pi-support.ts`, sibling copy in `packages/diff`), which compares against the running pi's `VERSION` and warns without refusing to register.
- Because the pi family is published in lockstep (one train, one install), **all pi peers a package declares carry that package's single floor** — a host that has `pi-coding-agent@1.2.0` has `pi-tui@1.2.0` with it. A floor is the oldest published train whose declarations provide every host symbol the shipped (non-test) code touches at runtime; a symbol reached *optionally* (`getFilePaths?.()`) or behind a documented fallback (`pi.getSettings` in `core/src/settings-io.ts`) does not raise one, and those guards are load-bearing, not incidental.
- `0.1.0` was **never published** for `pi-coding-agent`, `pi-tui` or `pi-ai` (their oldest releases are `0.74.0`), so `>=0.1.0` asserts nothing about a real host. It survives in ADR 0013 as the marker for a *types-only* package; no package in this suite is types-only today, which is why none of them carry it any more.

### Verification Order (run independently, wait for each)
1. `npx tsc --noEmit` in the package directory
2. If it fails: read the error → read the relevant file → fix → re-run
3. Loop-break: if a check fails twice without edits between, stop and report BLOCKED

### CI: the floor job and the floating `pi@latest` job
`.github/workflows/ci.yml` has two jobs, and they answer different questions:
- **`typecheck`** — the floor job: `pnpm install --frozen-lockfile`, `pnpm -r exec -- tsc --noEmit`, `pnpm test`, against *our* pinned 1.4.0. Red means our tree stopped compiling or stopped working.
- **`pi-latest`** — the drift detector: same compile surface after `pnpm update -r` against whatever `@earendil-works/pi-*@latest` publishes today (with `minimum-release-age 0` set in the runner's project config, because pnpm's 24h policy would otherwise reject the newest pi for its first day — exactly the window the job covers). pi does not follow semver (`patch` and `minor` both ship breaking changes), so this job is the only drift detector available.
- **`pi-latest` is gated to `schedule` and `workflow_dispatch`**, deliberately: a float job that ran on PRs would turn every open PR red for a reason the author cannot fix. So **`pi-latest` showing *SKIPPED* on a pull request is the expected result, not a failure.** To run it on demand: `gh workflow run ci.yml --ref <branch>` (`workflow_dispatch` also lets anyone re-check against today's latest on `main`).

### Commits
- `chore:` for infra (workflows, config, README)
- `feat:` for new features or packages
- `fix:` for bug fixes
- Always commit per logical unit — don't batch unrelated changes

### Documentation Structure
Docs follow the skill-suite layout (`specify`/`finish` conventions):
- **Plans** live in `docs/roadmap/<feature>.md` (kebab-case, named for the outcome) with front-matter `status` (`considering` / `committed`) + `done-when`. Only *unfinished* plans live on disk — the doc is **deleted when the feature ships** (history lives in git; no plan index, no `done/` graveyard). Supersede: note it in the old doc's body, then delete it.
- **Persistent knowledge** goes to `docs/features/<feature>.md` (present-tense, front-matter `status: live` + `last-verified`) or `docs/decisions/NNNN-slug.md` — never left in a plan.
- `docs/research/` holds research reports (front-matter, kebab-cased `docs/research/<topic>.md`); `docs/reviews/` holds code-review write-ups.
- Use the `specify` skill to generate plans (spec input from the `discuss` conversation), then dispatch the `reviewer` subagent to review the plan against the codebase. **Commit the plan file to git** — it is untracked by default and would be lost.

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
- Publishes in dependency order: core → ui → sudo → ask → todo → notify → session-name → footer → diff → image-paste → subagent → web → meta

## Release Steps

When releasing a new version, apply these steps after bumping versions but before tagging:

1. **Bump all 13 package versions** — `packages/core`, `packages/ui`, `packages/sudo`, `packages/ask`, `packages/footer`, `packages/diff`, `packages/image-paste`, `packages/notify`, `packages/subagent`, `packages/todo`, `packages/session-name`, `packages/web`, `meta` all share the same version. The root `package.json` is private and has no version to bump.

2. **Type-check all packages** — run `npx tsc --noEmit` in each of the 12 package directories (11 components + session-name). Don't release if any check fails.

3. **Ensure CI is green** — check the latest CI run on `feature/monorepo-split` (or `main`). Don't release on a red build.

4. **Tag and push** — use annotated tag with `v` prefix: `git tag -a v0.x.y -m "Release v0.x.y"` then `git push origin v0.x.y`. The release workflow handles publishing to npm.

5. **Create the GitHub Release** — after tagging, create a release with notes summarizing user-facing changes since the previous tag (gather them with `git log v<prev>..v<cur>`): `gh release create v0.x.y --title "v0.x.y" --target main --notes "..."`. Backfill releases for any tags that were skipped. Edit with `gh release edit v0.x.y --notes "..."` if the notes need fixing after the fact.

### Writing release notes

Structure (in this order):

1. **Headline first** — anything new/structural leads its own `##` section (e.g. "New package: ..."), before per-package diffs
2. **`## Other changes`** — one bullet per package, bold package name, user-visible behavior only
3. **`## Thanks to contributors`** — credit external contributors only, with their contribution linked

Rules:

- **Link every change** to its PR (`#31` — GitHub auto-links PR refs in release bodies) or, for work pushed directly to `main`, its commit as a **full URL** (bare SHAs don't auto-link: `https://github.com/danielcherubini/pi-archimedes/commit/<sha7>`)
- **Gather contributors** with `git log v<prev>..v<cur> --pretty='%an|%h|%s'` and cross-check PRs with `gh pr list --state merged --json number,title,author`
- **Never thank the maintainer** (the repo owner) — the thanks section is for external contributors only
- **Don't mention internal reference projects** the work was ported from or benchmarked against — release notes describe what the user gets, not the lineage
- **No internal jargon** — describe user-visible behavior; plan numbers are fine in passing ("plan 028") but never as the headline
- Keep bullets to one or two lines apiece
