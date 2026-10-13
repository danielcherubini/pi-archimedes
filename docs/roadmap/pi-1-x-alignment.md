---
status: committed
done-when: Every custom surface behaves on both screen modes, 13/13 packages type-check against pi 1.2.0 with a scheduled `pi@latest` job guarding drift, no package depends on a pi private module or prototype, and 2.11.0 is released with subagent cost visible in `/session`.
---

# Pi 1.x alignment plan

**Goal:** Make pi-archimedes correct on pi 1.2.0 (users run it today) and remove the six couplings to pi internals that made it silently wrong.

**Architecture:** pi resolves every host specifier to its own copy at runtime (jiti aliases), so the workspace's `node_modules` copy is compile-time only — the suite currently type-checks against 0.87.0 while executing 1.2.0. Tasks 1–2 move the compile target and add drift detection; 3–7 fix behaviour (screen mode, frame fitting, colour, diagnostics, events, CLI); 8–10 replace tool take-overs and hand-rolled plumbing with pi's own APIs; 11–12 settle the native-overlap product calls and ship.

**Tech Stack:** TypeScript ESM with `.ts` entry points loaded by pi's jiti runtime (no build step), pnpm workspace, vitest (`*.test.ts` colocated in `src/`), `@earendil-works/pi-coding-agent` + `pi-tui` + `pi-ai` as peers.

## Ground rules for every task

- **pnpm only.** Root `package.json` has a `preinstall` guard that exits 1 under npm. Never run `npm install`.
- **Type-check** per package: `cd packages/<name> && npx tsc --noEmit`. Whole workspace: `pnpm -r exec -- tsc --noEmit`. This is the suite's verification command (AGENTS.md "Verification Order") — there is no build.
- **Tests:** `pnpm test` at the root (`vitest run`). Single file: `npx vitest run packages/core/src/text.test.ts`.
- **No formatter or linter is configured.** Match the surrounding file's style; do not reformat untouched lines.
- **Do not read or write the suite-managed `enabled` boolean** in any `archimedes.*` settings namespace (ADR 0012); only `meta` touches it.
- **Loop-break:** if a check fails twice with no edit in between, stop and report BLOCKED with the error text.
- **Commit per logical unit** (AGENTS.md). Conventional commits: `fix:` / `feat:` / `chore:` / `docs:`.
- Decisions behind each change are in `docs/decisions/0026`–`0030`. Terminology (`screen mode`, `screen capability`, `run outcome`) is in `CONTEXT.md`. Do not rename those terms.

## pi 1.2.0 API reference (verified against the installed package)

From `@earendil-works/pi-coding-agent` `dist/core/extensions/types.d.ts` (line numbers are 1.2.0):

```ts
pi.registerToolRenderer(resolver: ToolRendererResolver): void            // :1256
type ToolRenderers = Pick<AnyToolDefinition, "renderShell" | "renderCall" | "renderResult">   // :521
type ToolRendererResolver = (toolName: string, next: () => ToolRenderers | undefined)
  => ToolRenderers | undefined                                           // :526
interface ToolRenderContext { …; durationMs: number | undefined;         // :376
                              outputPad: number }                        // :378
ToolDefinition: renderShell?: "default" | "self"                         // :469
                outputSchema?: TSchema                                   // :476
                exposure?: ToolExposure                                  // :480
                annotations?: ToolAnnotations                            // :492
ToolExposure = "direct" | "model-only" | "codemode" | "deferred" | "hidden"   // :395
ToolAnnotations { readOnlyHint?, destructiveHint?, idempotentHint?, openWorldHint? }
result: { structuredContent?: JsonValue; isError: boolean; usage?: Usage }   // :997-1000
pi.events: EventBus   // { emit(channel: string, data: unknown): void;
                      //   on(channel: string, handler: (data: unknown) => void): () => void }
pi.getSettings(): Settings                                             // :1286
```

From `@earendil-works/pi-tui` `dist/index.d.ts`: `isViewportTUI`, `renderFakeCursor`, `compositeTuiLine`, `CURSOR_MARKER`, `Container` (`:32`); `stripTerminalSequences`, `sliceByColumn`, `truncateToWidth`, `visibleWidth`, `wrapTextWithAnsi`, `getOsc8LinkAtColumn` (`:35`); `matchesKey`, `isKeyRelease`, `Key` (`:23`); `SettingsList`, `SettingItem`, `SettingsListTheme` (`:15`); `formatProgramStatus`, `ProgramStatus` (`:27`); `TuiAltScreen`, `TuiMainScreen` (`:33-34`, exported but irrelevant here). `VIEWPORT_TUI` — the symbol `isViewportTUI` reads — is **not** exported, which is why `screenCapabilities()` takes a mode rather than a `tui` (Task 3). `ctx.ui.onTerminalInput` takes pi's `TerminalInputHandler` (`extensions/types.d.ts:54,82`), **not** pi-tui's `TuiInputListener` — import the former. `NativeClipboard` (`pi-tui/dist/native-platform.d.ts`) has `getImage()` and optional `getFilePaths?()` (`:6`,`:8`).

Runtime facts that shape the code: `switchTuiMode()` (`interactive-mode.js:604`) builds a **new** TUI and re-mounts children into it, and refuses when an overlay is open; fullscreen screen is the default (`settings-defaults.d.ts:59`); a token may resolve to `""`, which `Theme.getBgAnsi()` renders as `\x1b[49m` (`theme.js:135-140`) and `Theme`'s internal maps are now `fgAnsi`/`bgAnsi` (`theme.js:117-118`); `pi-tui` is aliased to the host copy by the extension loader, so **deep pi-tui subpath imports break** (`@earendil-works/pi-tui/dist/utils.js` resolves to `…/index.js/dist/utils.js`) — always import from the bare specifier.

---

### Task 1: Move the type-check target to pi 1.2.0

**Context:** The lockfile pins `@earendil-works/pi-coding-agent@0.87.0` and `^0.87.0` cannot even resolve `0.87.1` (caret on 0.x means `<0.88.0`), so `release.yml` type-checks every published artifact against a 21-day-old, eleven-release-old API while users run 1.2.0. Nothing in the suite is symbol-incompatible with 1.2.0 — verified twice with control runs — so this task is a mechanical pin move that must come first because every later task uses 1.2.0 types. The one real trap is `@types/node`: pi 1.2.0 bundles 26.6.5, where `ChildProcess extends InternalEventEmitter<ChildProcessEventMap>`; if both copies land in one program, `packages/image-paste/src/clipboard.ts:208,216` and `packages/sudo/src/tool.ts:55` fail with `Property 'on' does not exist on type 'ChildProcessWithoutNullStreams'`. Decision: ADR 0026.

**Files:**
- Modify: `packages/{core,ui,ask,footer,diff,image-paste,subagent,todo,notify,session-name,web,sudo}/package.json`, `meta/package.json` — devDependencies
- Modify: `packages/subagent/package.json:31`, `packages/web/package.json:27` — `@types/node`
- Modify: `package.json` (root) — add `@types/node` to `devDependencies`
- Regenerated: `pnpm-lock.yaml`

**What to implement:**
In each of the 13 manifests, change `"@earendil-works/pi-coding-agent"` and `"@earendil-works/pi-tui"` in `devDependencies` from `"^0.87.0"` to the exact string `"1.2.0"`. In the four packages that declare it (`session-name`, `subagent`, `todo`, `ui`), change `"@earendil-works/pi-ai"` to `"1.2.0"` as well. Leave **every `peerDependencies` range untouched in this task** — floors move in Tasks 5–10 as the code starts requiring newer behaviour.

Change `"@types/node": "^22.0.0"` to `"@types/node": "22.19.19"` in `packages/subagent/package.json` and `packages/web/package.json`, and add `"@types/node": "22.19.19"` to root `devDependencies` so a single version resolves workspace-wide. Do not "modernise" it to 26.x — that reintroduces the three false errors (ADR 0026 Consequences).

Do not change `typescript` versions (root `^7.0.2`, packages `^6.0.0`); that mismatch is pre-existing and out of scope. Note for later tasks: `packages/core` declares no `@types/node` and compiles `node:fs` via the hoisted copy — the root pin added here is what makes that deterministic.

**The supply-chain gate you will hit (verified on this checkout).** pnpm 12.5 enforces a default `minimumReleaseAge` of 24 hours, and the pi 1.x family is published as one train — `pi-coding-agent@1.2.0` and its six siblings (`pi-agent-core`, `pi-ai`, `pi-codemode`, `pi-mcp`, `pi-telemetry`, `pi-tui`) all landed at 2026-10-12 ~23:00Z. While they are younger than 24 hours, `pnpm install --frozen-lockfile` **fails** with `The lockfile contains entries that the active policies reject … was published … within the minimumReleaseAge cutoff`, which CI reads as a suspect lockfile. `pnpm install` resolves this by writing `minimumReleaseAgeExclude:` entries into `pnpm-workspace.yaml` (an explicit per-version policy exclusion — commit it, do not fight it, and say so in the commit message). The exclusion is time-limited by nature: it becomes unnecessary 24 hours after the pi release, and should then be deleted rather than left as a permanent hole in the policy.

**Steps:**
- [ ] Edit the 13 manifests + 2 `@types/node` lines + root `devDependencies`.
- [ ] Run `pnpm install` (never `npm install`).
  - Succeeded? If it reports an engine or resolution error, stop and report it — do not add overrides to `.npmrc`.
- [ ] Run `pnpm why @types/node | grep -o "2[0-9]\.[0-9]*\.[0-9]*" | sort -u`
  - Exactly one version printed? If two appear, the root pin is not winning; add `"pnpm": { "overrides": { "@types/node": "22.19.19" } }` to root `package.json`, re-run `pnpm install`, re-check.
- [ ] Run `pnpm -r exec -- tsc --noEmit`
  - Zero errors? The expected failure mode is the three `ChildProcess` errors above — they mean a second `@types/node` is in the program, not that pi broke. Fix the pin, not the code.
- [ ] Run `pnpm test`
  - All green? If a test mocked a 0.87-only shape, fix the test to match 1.2.0 and note it in the commit message.
- [ ] Commit: `chore: move type-check target to pi 1.2.0 and pin @types/node 22.19.19`

**Acceptance criteria:**
- [ ] `pnpm why @types/node` shows one version across all 13 projects.
- [ ] `pnpm -r exec -- tsc --noEmit` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm-lock.yaml` is in the commit (CI runs `pnpm install --frozen-lockfile`; a stale lockfile fails with `ERR_PNPM_OUTDATED_LOCKFILE`).
- [ ] If `pnpm-workspace.yaml` gained `minimumReleaseAgeExclude` entries, they are in the same commit with the reason stated, and a follow-up line is recorded here to delete them once the pinned pi release is older than 24 hours (`1.2.0`: published 2026-10-12 ~23:00Z, so safe to drop from 2026-10-13 ~23:00Z).
- [ ] No `peerDependencies` range changed.

---

### Task 2: Add a floating `pi@latest` type-check job on a schedule

**Context:** pi's own release policy is *"patch = fixes + additions, minor = breaking changes. No major releases"* (upstream `.pi/skills/release.md`), so breaking changes arrive in minors — 1.2.0 and 1.0.3 (a patch) both shipped them. Peer ranges cannot warn anyone: `pi install` passes `--legacy-peer-deps`/`--omit=peer` and the loader aliases host packages, so a range is never installed, solved, or parsed. The only drift detector available is a CI job that type-checks against `pi@latest`, and it must run on a **schedule** — a float job that only runs on PRs stays green while nobody touches the repo. The existing job becomes the floor job. Decision: ADR 0026.

**Files:**
- Modify: `.github/workflows/ci.yml` (currently one job, `typecheck`, triggered on `push`/`pull_request` to `main`)

**What to implement:**
Add to the existing `on:` block:
```yaml
  schedule:
    - cron: "17 6 * * *"
  workflow_dispatch:
```
(An odd minute avoids the queue pileup; `workflow_dispatch` lets anyone re-run it against today's latest on demand.)

Add a second job `pi-latest` that mirrors the checkout/setup-node/pnpm-setup steps of `typecheck`, then instead of `pnpm install --frozen-lockfile`:
```yaml
      - run: pnpm install --config.minimum-release-age=0
      - run: pnpm update -r --config.minimum-release-age=0 "@earendil-works/pi-coding-agent@latest" "@earendil-works/pi-tui@latest" "@earendil-works/pi-ai@latest"
      - run: pnpm -r exec -- tsc --noEmit
```
The `--config.minimum-release-age=0` is load-bearing, not decoration, and it has to be on **both** commands. pnpm's default 24-hour supply-chain gate applies to `pnpm update` just as it does to `pnpm install` — but on an update it does not announce itself: a flagless `pnpm update` **silently resolves the previous release** (verified on this checkout: flagless `pnpm update` selected `pi-tui@1.1.0` while `1.2.0` was still inside the window; with the flag the same command selected `1.2.0`). A job that passes the flag only to the install therefore goes green while type-checking *yesterday's* pi — exactly the drift it exists to detect — and it does so during the one day after a release when running it matters most. The same gate also rejects a fresh pi release outright on a frozen or cold install (`… was published …, within the minimumReleaseAge cutoff`), which would leave a job that floats to `@latest` red for 24 hours after every pi release. The flag is the only way to express this for a *floating* version, because `minimumReleaseAgeExclude` pins exact versions. The floor job keeps the policy untouched; only the float job relaxes it, and only in CI.
`pnpm update -r` prints "ignored update" for packages that do not declare a given specifier and still exits 0 — that is fine. **Do not** substitute `pnpm -r add`: it writes into `dependencies`, which is the wrong section for a compile-time-only host package and would corrupt the manifests Task 1 just pinned. Do not run `pnpm test` in this job — its purpose is the compile surface, and test failures against an unreleased pi would be noise on the main branch's green check.

Leave the existing `typecheck` job exactly as it is (frozen lockfile + `pnpm test`): it is now the floor job and its failure means "our supported floor no longer compiles", which is actionable.

**Steps:**
- [ ] Edit `.github/workflows/ci.yml`.
- [ ] Validate locally: `pnpm install --config.minimum-release-age=0 && pnpm update -r --config.minimum-release-age=0 "@earendil-works/pi-coding-agent@latest" "@earendil-works/pi-tui@latest" "@earendil-works/pi-ai@latest" && pnpm -r exec -- tsc --noEmit` — the flag on **both** commands, exactly as the job has it, or the local run resolves an older pi than the job will and proves nothing.
  - Green? If `pnpm update -r` errors out entirely (rather than printing "ignored update"), report BLOCKED with its output — do not switch to `pnpm -r add`.
  - Then discard the float bump with a **path-scoped** checkout: `git checkout -- package.json 'packages/*/package.json' 'meta/package.json' pnpm-lock.yaml` (this job must not commit bumped versions). It is path-scoped because the float bump rewrites the 13 manifests as well as the lockfile, and `git checkout -- .` would throw away the `ci.yml` edit this same task just made — the `ci.yml` change must survive.
- [ ] Validate the workflow parses: `npx --yes js-yaml .github/workflows/ci.yml >/dev/null`
  - Non-zero exit means bad YAML; fix indentation and re-run.
- [ ] Push and trigger `pi-latest` with `gh workflow run ci.yml`, then confirm from `gh run view --log` that both jobs exist.
  - Note: GitHub only fires `schedule` triggers on the **default branch**, so the cron cannot be observed from a feature branch. Verifying via `workflow_dispatch` here is expected, not a workaround.
- [ ] Commit: `chore(ci): type-check against pi@latest on a schedule`

**Acceptance criteria:**
- [ ] `ci.yml` has a `schedule` trigger and a `workflow_dispatch` trigger.
- [ ] `pi-latest` runs `pnpm update -r` (or the `add` fallback) then `tsc --noEmit`, does not use `--frozen-lockfile`, and passes `--config.minimum-release-age=0` to **both** the install and the update — otherwise a same-day pi release is either rejected by the supply-chain policy or silently passed over in favour of the previous release.
- [ ] `typecheck` still uses `--frozen-lockfile` and still runs the tests.
- [ ] No commit in this task contains bumped dependency versions.

---

### Task 3: Screen mode primitive, capabilities, and the fullscreen gates

**Context:** pi 1.0.0 made `tuiMode: "fullscreen"` the default: components render into a clipped, height-allocated, wheel-routed viewport instead of terminal scrollback. The suite has zero awareness of this (`grep -rn "fullscreen\|tuiMode\|altScreen" packages meta` returns nothing) while patching the editor, tool rows, thinking renderer and startup listing. Screen mode is also mutable mid-session — `switchTuiMode()` (`interactive-mode.js:604`) stops the TUI, builds a new one, re-mounts every child, and rebinds extension input listeners — so a stored `tui` reference silently renders into a stopped renderer and nothing throws. We target fullscreen screen first and suppress the scrollback-native features there rather than half-rendering them. Decision: ADR 0027; terms in `CONTEXT.md`.

**Files:**
- Create: `packages/core/src/screen-mode.ts`, `packages/core/src/screen-mode.test.ts`
- Modify: `packages/core/package.json` — add `"./screen-mode": "./src/screen-mode.ts"` to the `exports` map. **`packages/core/src/index.ts` exports only `registerCore` and the default factory (`:8-24`); every cross-package consumer imports a subpath** (`@pi-archimedes/core/text`, `/overlay`, `/settings-io`, …), so a module that is not in the `exports` map is invisible to `ui`, `subagent`, `meta`.
- Modify: `packages/ui/src/index.ts` (`:209` `isIdle` wiring, `:195` header factory where `patchStartupListing` is invoked, `:198` `ctx.ui.setHeader()`), `packages/ui/src/startup/index.ts` (`patchStartupListing` install site), `packages/ui/src/startup/sections.ts:9`
- Create: `packages/core/src/screen-mode-discipline.test.ts` (the no-stored-`tui` guard)

**What to implement:**
In `packages/core/src/screen-mode.ts`:
```ts
import { isViewportTUI } from "@earendil-works/pi-tui";

export type ScreenMode = "regular" | "fullscreen";

/** Ask the renderer we were just handed. Never store the result or the `tui`. */
export function screenMode(tui: object): ScreenMode {
  return isViewportTUI(tui as never) ? "fullscreen" : "regular";
}

export interface ScreenCapabilities {
  /** May append into terminal scrollback. Off on fullscreen screen. */
  transcriptWrite: boolean;
  /** Must fit an allocated, wheel-routed viewport. On fullscreen screen. */
  frameBounded: boolean;
}

export function screenCapabilities(mode: ScreenMode): ScreenCapabilities {
  return mode === "fullscreen"
    ? { transcriptWrite: false, frameBounded: true }
    : { transcriptWrite: true, frameBounded: false };
}
```
Keep `screenCapabilities` taking the mode (not the `tui`) so it is unit-testable: `VIEWPORT_TUI` is not publicly exported, so a test cannot fabricate a viewport TUI. Do not add more capabilities — `transcriptWrite` and `frameBounded` are the only two that differ today. Import it elsewhere as `@pi-archimedes/core/screen-mode`.

In `packages/ui`, gate the scrollback-native startup work: the splash animation and the startup resource listing install only when `screenCapabilities(screenMode(tui)).transcriptWrite` is true, evaluated at the point the `tui` is handed to us (not at module load, not cached in a field). Header replacement via `ctx.ui.setHeader()` (`ui/src/index.ts:170`) stays — that API is unchanged and screen-mode independent. Gate the `addChild` patch in this task; **Task 8 removes it** via `quietStartup` + `setHeader`.

`packages/ui/src/startup/sections.ts:9` currently asserts `["Models","Context","Prompts","Skills","Extensions","Themes"]`. pi 0.99.0 removed the `[Themes]` startup section and 1.2.0 emits Context/Skills/Prompts/Extensions plus a model-scope line; derive the rendered sections from what was actually captured and drop the hardcoded phantom entries rather than editing the constant to a new guess.

Guard test (`screen-mode-discipline.test.ts`): walk `packages/*/src` and `meta/src` for `*.ts` (skip `*.test.ts`) and fail on any of `/(private|public|readonly)\s+\w*tui\w*\s*[:=]/`, `/\bthis\.\w*tui\w*\s*=/`, `/^(let|var)\s+\w*tui\w*\b/m`, or a module-scope `const \w*tui\w*\s*=`.

The `\w*tui\w*` widening is not pedantry: `packages/ui/src/index.ts:54` declares `let uiTui: TUI | undefined` and assigns `uiTui = tui` at `:188` — the exact stale-renderer hazard ADR 0027 is about, and a regex anchored on the bare word `tui` matches nothing in the tree, so the guard would pass while the rule is broken in a file this task edits. Assert the walker finds a non-empty file set, and seed the allow-list only with genuine cases (each with a one-line reason).

**Steps:**
- [ ] Write `packages/core/src/screen-mode.test.ts`: `screenMode({})` returns `"regular"`; `screenCapabilities("fullscreen")` is `{ transcriptWrite: false, frameBounded: true }`; `screenCapabilities("regular")` is the inverse.
- [ ] Write the discipline guard test.
- [ ] Run `npx vitest run packages/core/src/screen-mode.test.ts packages/core/src/screen-mode-discipline.test.ts`
  - Failed (module missing)? Good. If the guard test passes vacuously, verify the walker found files by asserting a non-zero file count.
- [ ] Implement `screen-mode.ts`, export from `packages/core/src/index.ts`.
- [ ] Re-run — green? Then `cd packages/core && npx tsc --noEmit`.
- [ ] Gate `packages/ui` startup on the capability; re-run `cd packages/ui && npx tsc --noEmit` and `pnpm test`.
- [ ] Manual check, both modes: `pi --tui-mode regular` shows splash + listing; plain `pi` (fullscreen default) shows the header but no splash/listing and no error. If the fullscreen run still shows a splash, the gate is reading a cached value — fix that, do not accept it.
- [ ] Commit: `feat(core,ui): screen mode primitive with fullscreen-first capability gates`

**Acceptance criteria:**
- [ ] `screenMode()` is the only place `isViewportTUI` is called in the suite.
- [ ] Splash and startup listing appear on regular screen and are absent on fullscreen screen, with no warning in either.
- [ ] Guard test present, walking a non-empty file set, with an empty allow-list.
- [ ] `sections.ts` no longer asserts a fixed section list.

---

### Task 4: Put frame width maths back on pi-tui

**Context:** `docs/tui.md` says to use pi-tui's terminal-width helpers instead of re-implementing them, and our re-implementation is wrong in ways fullscreen makes visible: `overlay.ts:44-47` strips only `\x1b[…m` and counts `.length`, so a line carrying `CURSOR_MARKER` measures about ten columns too wide; `:37-42` then `padEnd`s too little, `:70-98` `hardTruncate` copies only CSI-SGR sequences so it can cut mid-marker or split an OSC 8 hyperlink into visible text, and `:13-36` `wrapText` measures `word.length` instead of visible columns. These feed `OVERLAY_CHROME`, used by `packages/subagent/src/index.ts:314`, `meta/src/settings.ts:181`, `meta/src/plugin-manager.ts:92`, `meta/src/onboarding/index.ts:79`.

**Files:**
- Modify: `packages/core/src/overlay.ts`, `packages/core/src/text.ts`
- Modify (forced by the `clampLine` deletion): `packages/footer/src/index.ts` (`:15` import, `:141` call), `packages/ui/src/startup/sections.ts` (`:1` import, `:266`, `:277` calls)
- Test: `packages/core/src/overlay.test.ts`, `packages/core/src/text.test.ts`

**What to implement:**
Delete the local `visibleWidth`, the `padEnd`-based padding helper, `hardTruncate`, and `wrapText`; import `visibleWidth`, `truncateToWidth`, `wrapTextWithAnsi`, `sliceByColumn`, `compositeTuiLine`, `stripTerminalSequences` from `@earendil-works/pi-tui` (bare specifier only — a deep subpath import resolves to a nonexistent path through the loader's alias). Keep `overlay.ts`' **own exported names and signatures** stable (`OVERLAY_CHROME`, `wrapWithBorder`, etc.) and re-implement their bodies on the pi-tui helpers, so no consumer file needs editing in this task. In `packages/core/src/text.ts`: `stripAnsi` becomes a **wrapper**, not a delegation. pi-tui's `stripTerminalSequences` leaves DCS (`\x1b[P…\x07`), SOS/PM (`\x1b^…`, `\x1b\…`), APC (`\x1b\a…\x07`) and charset designators (`\x1b(B`, `\x1b)B`) intact and does not trim, while our `stripAnsi` (`:17-24`) strips all of those and trims — pure delegation breaks `packages/core/src/text.test.ts:26,30,38,43,44,60` and feeds different strings to the startup-section parser (`ui/src/startup/sections.ts:1`) and the footer. Keep our broader pattern set (or wrap: local strip → `stripTerminalSequences` → `trim()`) and say in a comment which side of the wrapper is load-bearing. Then delete `clampLine` (`:26-29`, already a one-line alias of `truncateToWidth`), switching the four consumer call sites listed above to `truncateToWidth`.

No colour logic in this task (Task 5 owns it). Overlay behaviour for consumers must be unchanged.

**Steps:**
- [ ] Add failing tests to `packages/core/src/overlay.test.ts`: a line containing `CURSOR_MARKER` measures at its visible width; a line with an OSC 8 hyperlink is not split mid-sequence by truncation; a CJK/wide-character line wraps at the right column; an ANSI-coloured line keeps its SGR codes across a wrap.
- [ ] Add tests for `stripAnsi` covering DCS/APC/charset sequences and trailing-whitespace trimming — these must **pass unchanged** before and after (they are the regression fence for the wrapper); confirm the six existing assertions at `text.test.ts:26,30,38,43,44,60` stay green.
- [ ] Run `npx vitest run packages/core/src/overlay.test.ts packages/core/src/text.test.ts packages/footer/src packages/ui/src/startup`
  - Failed with the too-wide marker measurement? Good. Unexpected pass → the fixture does not contain a real marker; fix the fixture, not the expectation.
- [ ] Implement in `overlay.ts` and `text.ts`.
- [ ] Re-run the vitest command — green? Then `cd packages/core && npx tsc --noEmit`, then `pnpm -r exec -- tsc --noEmit` (consumers must not break).
- [ ] Run `pnpm test`.
- [ ] Measure it for real: run pi with `PI_TUI_WRITE_LOG=/tmp/pi-width.log`, open `/agents`, `/archimedes` and the todo widget, then check no logged rendered line exceeds the frame width. Record the before/after numbers in the commit message — this closes the audit's unmeasured overlay gap.
- [ ] Commit: `fix(core): derive overlay width from pi-tui helpers (markers, links, wide chars)`

**Acceptance criteria:**
- [ ] No local width/truncation/wrap implementation remains in `overlay.ts` or `text.ts`.
- [ ] `OVERLAY_CHROME` renders as before; the only consumer edits are the four `clampLine` → `truncateToWidth` call sites in `footer/src/index.ts` and `ui/src/startup/sections.ts`.
- [ ] The `PI_TUI_WRITE_LOG` capture shows zero over-width lines for the three surfaces, on both screen modes.

---

### Task 5: Decide colour from the theme, not from an ANSI string

**Context:** pi 0.99.0 made `system` the default theme, generated from the terminal's reported colours, and allowed a theme token to be `""` meaning *terminal default* — `Theme.getBgAnsi()` renders that as `\x1b[49m` (`theme.js:135-140`), a **truthy** string. Our panel chrome does `panelBg = getBgAnsi(…) ?? … ?? FALLBACK_PANEL_BG` (`chrome.ts:73-82`), so the fallback can never fire, while `bgToFgAnsi` (`:62-67`) accepts only `48;2;`/`48;5;` and otherwise returns near-black `#101010`. The result is an untinted panel background with near-black edge slabs — visible as black borders on a light terminal at `packages/ui/src/editor/index.ts:176,250,367-372`. Separately `setThemeBg()` (`chrome.ts:90-93`) writes `theme.bgColors`, a map renamed to `fgAnsi`/`bgAnsi` in 1.2.0 (`theme.js:117-118`), so it is a silent no-op with no callers. The diff package has the same class of bug: `diff/src/ansi/colors.ts:11-14` matches only `38|48;2;r;g;b` and falls through to hardcoded `DEFAULT_DIFF_BG` (`:40`), and `codes.ts:117-122`'s `|| FG_*` fallback cannot fire for `""` tokens.

**Files:**
- Modify: `packages/core/src/chrome.ts` (`tryGetBgAnsi` `:37-43`, `bgToFgAnsi` `:62-67`, panelBg `:73-82`, delete `setThemeBg` `:90-93`), `packages/core/src/chrome.test.ts`
- Modify: `packages/diff/src/ansi/colors.ts` (`parseAnsiRgb` `:11-15`, the fallthroughs at `:35` and `:41`), `packages/diff/src/ansi/codes.ts` (`:117-122`), and their tests
- **Not modified: `packages/diff/package.json`.** Do not add `@pi-archimedes/core` as a dependency — AGENTS.md documents `diff` as standalone and the README presents it as installable on its own. The two parsers stay separate; that duplication is the accepted price of the standalone package and is worth a one-line comment in `diff/src/ansi/colors.ts` naming `core/src/color.ts` as the sibling implementation.

**What to implement:**
Rule for the whole suite: **never infer a colour by parsing an escape sequence.** Add a small predicate in `chrome.ts` (e.g. `isTerminalDefault(ansi: string): boolean`) returning true for `""`, `\x1b[39m`, `\x1b[49m` and their `0m`/reset forms, and treat "terminal default" as *no colour*: no tint, no derived edge, no fallback slab. When a light/dark decision is needed, read `theme.appearance` (0.99.0) — and prefer `theme.style({ fg, bg, bold })` / `theme.colors` for anything previously built by hand. Keep the hardcoded constants only for the no-theme-object-at-all path (tests, headless). Delete `setThemeBg()` outright rather than repairing it.

In `diff/src/ansi/colors.ts`, **extend the existing local parser** so `38;5;n`/`48;5;n` resolve through the same xterm-256 table `core/src/color.ts:137-155` uses, and so a terminal-default reset (`""`, `\x1b[39m`, `\x1b[49m`) means *no colour* rather than falling through to `DEFAULT_DIFF_BG`. Note the asymmetry that makes copying core's helper insufficient: `core`'s `parseAnsiFgToRgb` is anchored to `^\x1b[38;`, while diff deliberately matches `(?:38|48)` and applies it to **background** strings (`colors.ts:49-50`, fed by `theme.getBgAnsi(...)`). Delete the duplicated `DEFAULT_DIFF_BG` fallback path where "no colour" is now the honest answer. Do not add new colours, do not change the diff layout.

**Steps:**
- [ ] Failing tests in `chrome.test.ts`: `getBgAnsi()` returning `\x1b[49m` yields **no** panel tint and **no** near-black edge; `theme.appearance === "light"` yields the light-derived edge; a real truecolour bg still tints as before.
- [ ] Failing tests in the diff colour tests: a `38;5;<n>` fg is understood; a `""` token yields no background rather than `DEFAULT_DIFF_BG`.
- [ ] Run `npx vitest run packages/core/src/chrome.test.ts packages/diff/src`
  - Failed as expected? Fix the fixtures if they pass unexpectedly.
- [ ] Implement in `chrome.ts`, then `colors.ts`/`codes.ts`.
- [ ] `cd packages/core && npx tsc --noEmit`; `cd packages/diff && npx tsc --noEmit`; `pnpm test`.
- [ ] Manual, both screen modes: default theme on a light terminal shows no dark slabs around the editor; `settings.json` with `"terminal": { "trueColor": false }` shows diff colours that track the palette instead of hardcoded green/red.
- [ ] Commit: `fix(core,diff): derive panel and diff colour from theme tokens, not ANSI parsing`

**Acceptance criteria:**
- [ ] In `chrome.ts`, no tint, edge or panel decision comes from parsing a `getBgAnsi()` string: the theme token plus `theme.appearance` decide, and a terminal-default token means *no colour* (producers are exempt: `codes.ts:15-21,46-51` and `colors.ts:26` legitimately *emit* `38;2;`/`48;2;` palette codes — the rule is about parsing input, not building output). `diff/src/ansi/` is **not** covered by that prohibition: it keeps its escape-sequence decoder and this task extends it, so parsing there is expected — what changes is what a parse *yields* (`38;5;n`/`48;5;n` resolve through the xterm table, a reset means no colour), not whether strings are decoded.
- [ ] `setThemeBg` is gone and nothing references it.
- [ ] `38;5;`/`48;5;` and terminal-default resets are handled by the shared parser.
- [ ] Light-terminal + non-truecolour manual checks pass on both screen modes.

---

### Task 6: Stop writing to the console from render and event paths

**Context:** 36 non-test `console.*` calls (`footer/src/index.ts:145`, `ui/src/editor/index.ts:376`, `ui/src/thinking/patch.ts:55,73`, `ui/src/startup/index.ts:212,343,346`, `core/src/bus.ts:38-67`, `core/src/profiler.ts:42-48`, `session-name/src/index.ts:63,234,263`, `diff/src/index.ts:101`, …). Two independent reasons to remove them: on fullscreen screen a stray write lands inside the differential frame and smears the viewport until the next full redraw (on regular screen it scrolled away unseen), and inside a subagent child every one is silently discarded — `subagent/src/stream.ts:126-131` does `catch { return }` on any non-JSON stdout line, a guard written for pi's startup messages, so our own warnings vanish exactly when debugging a child.

**Files:**
- Create: `packages/core/src/log.ts`, `packages/core/src/log.test.ts`
- Modify: `packages/core/src/index.ts` (export), and every file listed by the census below
- Create: `packages/core/src/log-discipline.test.ts`

**What to implement:**
`packages/core/src/log.ts`:
```ts
/** Diagnostics only. Never user-facing, never stdout. */
export function diag(scope: string, message: string): void;
```
Body: no-op unless `process.env.PI_ARCHIMEDES_LOG` names a file; when set, append `[ISO-8601] [scope] message\n` with `appendFileSync`, wrapped in try/catch so logging can never throw. Nothing else writes files.

Replace every non-test `console.log`/`console.warn`/`console.error` in `packages/*/src` and `meta/src` with either `diag("<package>", …)` (developer diagnostics) or the existing user-facing notification path (a message the user must see). User-visible cases in this sweep: the `ui` patch-skip warnings and `footer`/`session-name` failure notices — route those through the same surface Task 7 aggregates, so a user sees one line rather than per-package noise. Keep behaviour identical otherwise: no new messages, no reworded copy beyond what the surface requires.

Discipline test: scan `packages/*/src` and `meta/src` for `*.ts` (excluding `*.test.ts`) and fail on `console.(log|warn|error)\(`, with `packages/core/src/log.ts` in the allow-list.

**Steps:**
- [ ] Run the census and paste it into the task notes: `grep -rn "console\.\(log\|warn\|error\)" packages/*/src meta/src --include=*.ts | grep -v "\.test\.ts"` (expect ~36).
- [ ] Write `log.test.ts` (env unset → no file written, does not throw; env set → line appended with scope) and `log-discipline.test.ts`.
- [ ] Run `npx vitest run packages/core/src/log.test.ts packages/core/src/log-discipline.test.ts` — expect failures.
- [ ] Implement `log.ts`; sweep the census list package by package, running `cd packages/<name> && npx tsc --noEmit` after each package.
- [ ] Run `pnpm -r exec -- tsc --noEmit` then `pnpm test`.
- [ ] Re-run the census — anything it prints must be in the discipline test's allow-list. Expect three entries at the end of this task: `packages/core/src/log.ts` (the implementation) and `packages/ui/src/startup/capture.ts` (six of the loose grep hits are comments/assignments in a file Task 8 deletes; do **not** rewrite `capture.ts:33` here — that is churn). Task 13 re-runs the census and requires the allow-list to be down to `log.ts` alone.
- [ ] Verify in a child: dispatch a subagent that triggers a `session-name` failure path with `PI_ARCHIMEDES_LOG=/tmp/arch.log` set; confirm the line is in the file, and that `pi --mode json --no-session -p hi` stdout stays pure JSON lines.
- [ ] Commit: `fix: route diagnostics to a log file instead of console`

**Acceptance criteria:**
- [ ] Census output outside the allow-list is empty (allow-list at this stage: `core/src/log.ts`, `ui/src/startup/capture.ts`).
- [ ] `diag` never throws and never writes when the env var is unset.
- [ ] A subagent child's diagnostics reach the log file; `--mode json` stdout is unchanged.
- [ ] No user-visible copy changed except where routed to the notify surface.

---

### Task 7: Runtime pi-support guard and `pi.getSettings()` read path

**Context:** Nothing at install time correlates a package's declared peer range with the pi that is actually running: `pi install` never installs or solves peers (`package-manager.js:1497-1526`) and the loader aliases host specifiers (`extensions/loader.js:37-84`), so a range cannot protect a user. A runtime check against the exported `VERSION` is the only mechanism that can reach them. In the same package, `core/src/settings-io.ts` re-reads `~/.pi/agent/settings.json` by hand and therefore cannot see project-scoped settings or overrides, which `pi.getSettings()` returns. Decisions: ADR 0026 (guard, warn-and-register); `getSettings()` keeps a file-read fallback so `core`'s peer floor stays `>=0.85.0` per ADR 0013.

**Files:**
- Create: `packages/core/src/pi-support.ts`, `packages/core/src/pi-support.test.ts`
- Modify: `packages/core/package.json` — add `"./pi-support": "./src/pi-support.ts"` to `exports` (same reason as Task 3: consumers reach core only through subpaths)
- Modify: `packages/core/src/settings-io.ts`; each package's `register()` entry point for the three floored packages (`packages/ui/src/index.ts`, `packages/diff/src/index.ts`, `packages/subagent/src/index.ts`) and `meta/src/index.ts` (aggregation)
- Modify: `packages/web/src/config.ts` (`loadConfig()` at `:13`, read at `:14`), `packages/web/src/tools.ts` (`:31`, `:69` call sites), `packages/web/src/command.ts` (`:19`, `:31` call sites)
- **Not modified:** `packages/ui/src/codemode/tool.ts` — its `readSettings(pi)` (`:82-96`) already does the `typeof pi.getSettings === "function"` capability check, and Task 10 deletes the whole file. Migrating it here is throwaway work.

**What to implement:**
`pi-support.ts`:
```ts
import { VERSION } from "@earendil-works/pi-coding-agent";
export interface PiSupport { ok: boolean; actual: string; min: string; }
/** Reuses the existing numeric comparator in ui/src/startup/version.ts:18 (move it to core). */
export function checkPiSupport(min: string): PiSupport;
/** Records a warning for meta to print once; never throws, never logs to console. */
export function reportPiSupport(pkg: string, min: string): void;
```
Floors: `ui`, `diff`, `subagent` → `"1.2.0"`; every other package keeps its current floor and does not call the guard unless its floor rises. Move the comparator out of `packages/ui/src/startup/version.ts:18` into `core` (it already compares `1.2.0 > 0.84.0` correctly) and have `ui` import it, so there is one implementation.

Behaviour is **warn and still register** — call `reportPiSupport()` at the top of `register()`, then continue registering. `meta` collects the reported warnings and prints one aggregated message once per session through the existing user-facing surface (Task 6's path), not per package. Refusing to register is explicitly wrong here: it makes `/plugins` report an enabled package that loaded nothing.

`settings-io.ts`: add `readEffectiveSettings(pi)` that returns `pi.getSettings()` when the function exists (`typeof pi.getSettings === "function"`) and otherwise falls back to the current file read. Note where the API lives: `getSettings()` is on **`ExtensionAPI`** (`types.d.ts:1286`, interface opens `:1186`), **not** on `ExtensionContext` — so a call site needs the `pi` handle, not `ctx`. `web`'s `loadConfig()` (`config.ts:13`) currently takes no arguments, which is why `tools.ts` and `command.ts` are in scope here: thread the `pi` handle (or an injected reader) in from the tool `execute`/command handlers, which do have it. Keep the **writer** exactly as is — pi exposes no public settings write API (`SettingsManager.save`/`updateProjectSettings` are private) and our symlink-preserving tmp+rename behaviour is documented in `docs/features/symlink-preserving-settings-writes.md`. Do not add locking.

**Steps:**
- [ ] Failing `pi-support.test.ts`: `checkPiSupport("1.2.0")` true for `"1.2.0"` and `"1.10.0"`, false for `"0.99.2"`; `reportPiSupport` is idempotent per package; no console output either way.
- [ ] Failing `settings-io` tests: `getSettings` present → its value wins; absent → file fallback used; malformed JSON → existing behaviour preserved.
- [ ] Run `npx vitest run packages/core/src/pi-support.test.ts packages/core/src/settings-io.test.ts` — expect failures.
- [ ] Implement; wire `reportPiSupport` into `register()` of `ui`, `diff`, `subagent`; aggregate in `meta`.
- [ ] `pnpm -r exec -- tsc --noEmit`; `pnpm test`.
- [ ] Manual: run with a stubbed old `VERSION` (temporarily monkey-patch in a scratch checkout, never in the repo) and confirm exactly one aggregated warning appears, all plugins still load, and nothing is printed to stdout.
- [ ] Commit: `feat(core): runtime pi-version support guard and effective-settings reader`

**Acceptance criteria:**
- [ ] One version comparator in the repo.
- [ ] Below-floor host produces one aggregated warning, and every package still registers.
- [ ] `getSettings()` is used when available; the file fallback still works and the writer is untouched.
- [ ] Project-scoped settings become visible to `web` (manual check with a project `.pi/settings.json` and an API key set there only).

---

### Task 8: Event, CLI and startup behaviour alignment

**Context:** Four behavioural drifts, none visible to `tsc` because they are event-shape and CLI-semantic. (a) `notify/src/index.ts:192` cancels pending notifications on `before_agent_start`, which 1.2.0 turned into a union on `messageType` and made fire for `pi.sendMessage(…, { triggerTurn: true })` too; `:207` cancels on *any* terminal input, and pi now sends far more protocol replies (1.1.0's OSC 7501 sentinel, 1.2.0's palette query at startup **and** on every theme switch). (b) The startup section list and the `console.log` scrape of `Model scope:` predate `quietStartup` and `ctx.scopedModels`. (c) Our own update check duplicates pi's. Decision: keep cancel-on-any-run-start (a starting run really does make a "task complete" notification stale) and pin it with a test.

**Files:**
- Modify: `packages/notify/src/index.ts` (`:192`, `:207`), `packages/notify/src/*.test.ts`
- Modify: `packages/ui/src/index.ts` (`:209` spinner wiring), `packages/ui/src/editor/index.ts` (`:376`)
- Modify (footer repaint on async refresh): `packages/footer/src/utils/git.ts`, `packages/footer/src/utils/jj.ts`, `packages/footer/src/index.ts` (`:46` is the `onBranchChange` → `requestRender` precedent to follow), `packages/footer/src/utils/git.test.ts`, `packages/footer/src/utils/jj.test.ts`
- Delete: `packages/ui/src/startup/capture.ts` (the `console.log` scrape), `fetchLatestVersion()` in `packages/ui/src/startup/version.ts:4-16`
- Modify: `packages/ui/src/startup/index.ts` — remove **only** the section-scrape half of `patchStartupListing`: `capture.ts`'s `console.log` patch, `findLoadedResourcesContainer()` (`:185-203`) and the `addChild` interception it feeds (`:340-355`, whose error paths are the `console.error` calls at `:349`/`:352`). **The function itself stays**, along with `renderHeader()`, the logo rows, the reveal/stagger frames and the animation timer (`:225-262`) — that machinery is our splash, not pi's listing, and it is what `ui/src/index.ts:195` hands to `setHeader()`. This is the removal Task 3 gated behind.
- Test: `packages/ui/src/startup/*.test.ts` — including `index.test.ts`'s `patchStartupListing animation timer` block, added in #92 (`stops redrawing once the logo settles when no sections arrive (quietStartup)`, `restarts the timer when sections are revealed after the logo settled`). Those two are the contract the trimmed function must keep satisfying; they are why this is a trim and not a deletion.

**What to implement:**
`notify`: keep the `before_agent_start` handler unconditional, add a comment naming the `messageType` union and why any run start cancels, and change the terminal-input cancel to require a decoded key — use pi-tui's `matchesKey`/`isKeyRelease`/`Key` (all exported at `pi-tui/dist/index.d.ts:23`) so protocol replies do not count as a keystroke. Get the rationale right in the comment: colour responses and colour-scheme reports are consumed **before** extension listeners run (`pi-tui/dist/tui.js:688-693`), so palette replies can never reach `notify`'s handler — what actually reaches it is forwarded DA1 replies (`pi-tui/dist/terminal.js:82`) and cell-size replies (`ESC[6;h;w t`, consumed only after listeners, `tui.js:710`). Keep the `ui_prompt_end` cancel scoping exactly as ADR 0013 describes.

`ui`: replace the `console.log` monkey patch with `ctx.scopedModels` (present in the 0.87 types already — same set `/scoped-models` shows); honour `quietStartup` (including `"header"`, which keeps the header and hides the model-scope line and the listing) instead of scraping it; delete `fetchLatestVersion()`'s `registry.npmjs.org` hit and rely on pi's own update check (`PI_SKIP_VERSION_CHECK`, `/changelog`). Confirm the border-spinner's `isIdle` wiring (`ui/src/index.ts:209`) still reads sensibly now that `ctx.isIdle()` is false during `before_agent_start` — the *Busy episode* definition in `CONTEXT.md` still holds; adjust the comment, not the behaviour, unless the spinner visibly starts early in a way users would call wrong.

Nothing in this task touches tool rendering (Task 10) or the thinking patch's prototype replacement (Task 10).

**Steps:**
- [ ] Failing notify tests: a forwarded DA1 reply (`\x1b[?62;1;9c`) and a cell-size reply (`\x1b[6;24;80t`) do **not** cancel a pending notification; a plain keystroke does; `before_agent_start` with `messageType: "custom"` still cancels.
- [ ] Failing startup tests: scoped models render from `ctx.scopedModels` with `console.log` untouched; `quietStartup: "header"` yields header without sections; no network call at startup; `patchStartupListing` is no longer installed and the `console.log`/`addChild` patch allow-list entries from Task 6 are gone.
- [ ] Footer staleness (new since #90/#91, and the one place screen mode bites the footer): `utils/git.ts` and `utils/jj.ts` now refresh their caches with `execFile` in the background and **nothing requests a frame when the reply lands** — pi draws only on host-driven events, so a `~N`/branch value that changed between frames stays stale until unrelated activity repaints it. Wire the refresh completion to a render request (a callback or subscriber the footer connects to `tui.requestRender()`, the way `footerData.onBranchChange` already does at `footer/src/index.ts:46`), with a test that a background refresh triggers exactly one repaint and that a refresh for a moved `cwd` does not.
- [ ] Run `npx vitest run packages/notify packages/ui` — expect failures.
- [ ] Implement; `cd packages/notify && npx tsc --noEmit`; `cd packages/ui && npx tsc --noEmit`; `pnpm test`.
- [ ] Manual: `grep` the process's outbound traffic is not needed — instead assert `console.log` is not patched by checking `console.log.name === "log"` from a scratch extension, and confirm startup makes no HTTP request to `registry.npmjs.org`.
- [ ] Commit: `fix(notify,ui): align with pi 1.x events, quietStartup and scoped models`
- [ ] Commit the footer repaint wiring **separately**: `fix(footer): repaint after background git/jj cache refresh` — unrelated to the pi 1.x event alignment, and #90/#91 are recent enough that a clean revert boundary matters.

**Acceptance criteria:**
- [ ] Terminal replies cannot cancel a notification; real keys still can.
- [ ] No `console.log` patch anywhere; no registry fetch at startup.
- [ ] `quietStartup` (`true`/`"header"`/`false`) all render correctly on both screen modes, and #92's two animation-timer tests still pass against the trimmed `patchStartupListing`.
- [ ] A background git/jj refresh repaints the footer without waiting for unrelated activity.
- [ ] ADR 0013's `ui_prompt_end` scoping behaviour unchanged.

---

### Task 9: Subagent — closed tool allowlist, validated tool names, three run outcomes, native cost

**Context:** `spawn.ts:227-233` joins `agent.tools` verbatim into `--tools`. pi 1.0.4 made `--tools` **retain** MCP tools unless an entry starts with `mcp__` (and added `--no-mcp`), and 1.1.0 made `+name`/`-name` **modifiers** — so a three-tool allowlist silently widens, and a `+web_search` entry typed into the `/agents` panel (`agent-panel.ts:469,1020`) changes the meaning of the whole list. 1.2.0 made print mode exit `1` when the final response hit the output token limit, and `stream.ts:206-210` reduces the child to `code ?? 1`, so a useful-but-truncated answer now reports as a generic failure. Cost is currently smuggled over `core/bus` (`subagent/src/cost.ts` → `footer/src/cost-accumulator.ts:11`) and therefore missing from `/session`. Decision: ADR 0028.

**Files:**
- Modify: `packages/subagent/src/spawn.ts` (`:227-233`), `packages/subagent/src/agents.ts` (**the parse path is `:49-83`; `:62-71` is `extraFields`, where an unknown `mcp:` key currently lands**), `packages/subagent/src/frontmatter-io.ts` (`:60-76` is `serializeAgent` — the **writer**, which must round-trip the new `mcp` key but is *not* where validation happens), `packages/subagent/src/agent-panel.ts` (`:469`, `:999-1022`), `packages/subagent/src/stream.ts` (`:197`, `:206-210`), `packages/subagent/src/index.ts` (tool result: `usage`, outcome), `packages/subagent/src/model-validation.ts` (pattern source), `packages/footer/src/index.ts` (`:65-76`, the accumulator merge into `mergedStats`) + `packages/footer/src/cost-accumulator.ts`
- Modify: `packages/subagent/package.json` — `peerDependencies` floors to `">=1.2.0"` (both pi packages, and `pi-ai` where declared)
- Test: `packages/subagent/src/*.test.ts`, `packages/footer/src/*.test.ts`

**What to implement:**
1. **Closed allowlist.** When `agent.tools` is non-empty, pass `--no-mcp` alongside `--tools`, unless the agent config opts in. Add an optional `mcp: true` to the agent config type, **parsed in `agents.ts`** (it currently falls into `extraFields`, `:62-71`), serialised by `serializeAgent` (`frontmatter-io.ts:60-76`), and surfaced in the `/agents` panel display (`agent-panel.ts:296-297`). Keep `--exclude-tools subagent` (`spawn.ts:233`).
2. **Validation, split by what each site can know.** At config read (`agents.ts`) and at panel edit, reject entries **lexically**: empty/whitespace, duplicates, and anything starting with `+` or `-` (pi 1.1.0 makes those modifiers, not names). No tool registry exists at config-read time — `discoverAgentsAll()` (`agents.ts:186`) is pure filesystem and `pi.getAllTools()` needs the `ExtensionAPI` handle — so **membership** checking belongs at dispatch, where the handle is available: compare against `pi.getAllTools()` names and **warn, do not fail**, because a legitimate name can be absent when an optional plugin is toggled off or an MCP server is disconnected (a hard error would make `tools: web_search` unusable whenever `web` is disabled). Message names the offending entry in both cases. Rejected input leaves the previous value intact. Follow the ADR 0008 precedent in `model-validation.ts` for shape and wording.
3. **Run outcomes.** Derive `completed` / `truncated` / `aborted` (names fixed in `CONTEXT.md`) from the child's `stopReason` and 1.1.0's `agent_settled.aborted`; stop concluding on `agent_end` (`stream.ts:197`). Keep cost accounting intact for all three. `truncated` is **not** an error; `aborted` is distinguishable from `completed`; a pre/during-run error remains a failure.
4. **Native cost.** Return `usage` on the tool result so pi folds nested usage into session totals — `agent-loop.js:618` persists `usage` onto the toolResult message and `agent-session.js:3436-3440` folds that into `getSessionStats()`. Then delete `subagent/src/cost.ts`'s bus emission and `footer/src/cost-accumulator.ts`'s `COST_UPDATE` listener: the footer's own `extractEntryUsage` (`footer/src/utils/stats.ts:26-28`) **already** counts toolResult usage, so leaving the accumulator in place would double-count, which is why this removal is required rather than merely tidy. Do not delete `core/bus.ts` in this task (Task 11 retires it) — just stop using it for cost.
5. Peer floors to `>=1.2.0` and `reportPiSupport("subagent", "1.2.0")` (Task 7).

**Steps:**
- [ ] Failing allowlist tests: with a non-empty allowlist, `--no-mcp` is present and disappears only when the agent opts in.
- [ ] Failing **lexical** validation tests (`agents.ts` parse path + `agent-panel.ts` edit): empty/whitespace entries, duplicates and entries starting with `+` or `-` are rejected with the entry named, at both sites, previous value preserved. No tool registry is involved in these tests — they must not assert anything about whether a name is a known tool.
- [ ] Failing **dispatch membership** test: a lexically valid name absent from `pi.getAllTools()` produces a warning naming the entry and the dispatch proceeds normally (assert on the success path too, not just the message).
- [ ] Failing stream tests: exit 1 + `stopReason: "length"` → `truncated` with cost preserved; `agent_settled.aborted: true` → `aborted`; clean finish → `completed`.
- [ ] Failing result/footer tests: the tool result carries `usage`; no `COST_UPDATE` emission; footer still shows the merged total.
- [ ] Run `npx vitest run packages/subagent packages/footer` — expect failures.
- [ ] Implement in the order above, committing separately: (a) allowlist + `--no-mcp`, (b) validation, (c) run outcomes, (d) native usage/footer — four commits so a revert can be surgical. `cd packages/subagent && npx tsc --noEmit` and `cd packages/footer && npx tsc --noEmit` after each.
- [ ] Manual with an MCP server connected: dispatch an agent with `tools: read, bash` and confirm no `mcp__*` tool reaches the child, and that `mcp: true` restores them. Force a truncated answer (tiny output limit or a long-generation task) and confirm the reported outcome is `truncated`. Run `/session` and confirm subagent cost is included.
- [ ] Commit: `fix(subagent): closed tool allowlists, validated names, three run outcomes, native usage`

**Acceptance criteria:**
- [ ] A non-empty `tools:` list yields exactly those tools in the child.
- [ ] Empty/whitespace entries, duplicates and leading-`+`/`-` entries are rejected at config read and at panel edit, previous value preserved.
- [ ] A lexically valid name that is not currently a known tool warns at dispatch and does **not** fail the dispatch (an optional plugin being off must not break `tools: web_search`).
- [ ] `completed` / `truncated` / `aborted` distinguishable in the result the model and the bridge see; cost correct in all three.
- [ ] `/session` totals include subagent cost; no `COST_UPDATE` bus traffic.
- [ ] `packages/subagent/package.json` peer floors are `>=1.2.0`.

---

### Task 10: Resolve tool presentation through `registerToolRenderer()`

**Context:** Four places re-register a tool in order to draw it differently, and the codemode one is the suite's worst coupling: `ui/src/codemode/tool.ts` re-creates pi's built-in tool with pi's own options purely to attach renderers, loading `dist/extensions/codemode/tool.js` from the running CLI, preserving schema-object identity because MCP recognises codemode that way (`extensions/mcp/index.js:405`), accepting the startup notice *"built-in extension `codemode` was not loaded"*, and silently dropping `getToolGuidelines` so per-tool prompt guidance disappears. `ui/src/bash/tool.ts:10-18` and `diff/src/tools/{edit,write}.ts:44,24` repeat the pattern at smaller scale. pi 1.0.1's `pi.registerToolRenderer()` exists exactly for this. Ordering matters and is observable: pi drops a built-in extension whose tool name a third-party claims (`omitReplacedExtensions`, ADR 0024), so each migration is **renderer first, override deleted in a later commit**. Decision: ADR 0029.

**Files:**
- Modify: `packages/ui/src/index.ts` (`:170`, renderer registration), `packages/ui/src/bash/tool.ts` (delete), `packages/ui/src/bash/renderer.ts` (`:225-281`), `packages/ui/src/codemode/{loader.ts,tool.ts}` (delete both), `packages/ui/src/codemode/renderer.ts` (`:318`), `packages/diff/src/tools/edit.ts:44-46`, `packages/diff/src/tools/write.ts:24-26`, `packages/core/src/tool-render.ts`
- Modify: `packages/ui/src/thinking/patch.ts` (`:36-62` guard, `:93+` replacement), `packages/ui/src/index.ts:222-227`
- Modify: `packages/ui/package.json`, `packages/diff/package.json` — peer floors `>=1.2.0`
- Test: renderer snapshot/behaviour tests beside each renderer

**What to implement:**
For **bash, codemode, edit, write** in that order, one pair of commits per tool:
1. Register a resolver — `pi.registerToolRenderer((toolName, next) => toolName === "bash" ? { renderShell, renderCall, renderResult } : next())` — with signatures from the API reference. Where our styling setting is off (`bashToolStyling`), return `next()`: that is the first time the setting can give back pi's native row. Verify rendering matches today's output, then commit.
2. Delete the `pi.registerTool()` take-over (and for codemode, `codemode/loader.ts` and `codemode/tool.ts` entirely, including the private-module load, the schema-identity preservation, the `isCodemodeTool` schema check and the `as never` cast). Verify the built-in loads — the *"built-in extension `codemode` was not loaded"* notice must be **absent** — that `pi mcp list` still treats codemode as reachable, and that prompt guidelines are back. Commit separately.

Also in this task, for every renderer we keep: read `ctx.durationMs` instead of local timers and apply `ctx.outputPad` where the renderer uses `renderShell: "self"`. Delete the three hand-rolled timing helpers where they actually live: `clearActiveBashIntervals` and `clearActiveCodemodeIntervals` are imported at `packages/ui/src/index.ts:30-31` and called at `:86-87`, and `parseWallTimeMs` lives in `packages/ui/src/codemode/renderer.ts` and is re-exported from `packages/ui/src/codemode/index.ts:14` — it is **not** referenced from `ui/src/index.ts`. Those deletions also require updating `packages/ui/src/index.test.ts:61,66,80,81,360-361`. Check `packages/core/src/tool-render.ts` for padding drift against native rows.

Thinking renderer: replace the label/colour and working-indicator code (`ui/src/index.ts:222-227`, the `spinFlag` machinery in `editor/index.ts`) with `ctx.ui.setHiddenThinkingLabel()` and `setWorkingIndicator({ frames, intervalMs })`, and leave `thinking/patch.ts` standing **only** for the muted Markdown theme, under four conditions: delegate to the original implementation for non-thinking content; keep pi's click-to-toggle `MouseRegion` (`assistant-message.js:117-125`); honour `ctx.outputPad`; and if the compatibility probe declines, surface it through the Task 6 diagnostics/user-facing path (never `console.warn`) — the probe currently passes on 1.2.0 while dropping pi's newer rendering, which is the failure this task exists to stop.

Peer floors `>=1.2.0` for `ui` and `diff`, plus `reportPiSupport("ui", "1.2.0")` / `reportPiSupport("diff", "1.2.0")`.

**Steps:**
- [ ] Baseline snapshot tests for the four tool rows (collapsed + expanded, running + finished, output truncated) before touching anything: `npx vitest run packages/ui packages/diff`.
- [ ] bash: add resolver → snapshot passes unchanged → commit `feat(ui): resolve bash rendering through pi's tool renderer API`.
- [ ] bash: delete `bash/tool.ts` + its `registerTool` call → snapshot still passes, `bashToolStyling: false` now yields pi's native row → commit `refactor(ui): drop the bash tool take-over`.
- [ ] codemode: resolver → commit; delete `loader.ts`/`tool.ts` → confirm the built-in loads and guidelines return → commit.
- [ ] edit/write in `diff`: same two-commit pattern.
- [ ] durationMs/outputPad sweep: failing test that "Took" survives a session reload and excludes wall-clock steps; delete the timer helpers; green.
- [ ] Thinking: label/indicator via the official `ctx.ui` calls; patch narrowed to the theme question with the four conditions; commit.
- [ ] `pnpm -r exec -- tsc --noEmit`; `pnpm test`.
- [ ] Manual, both screen modes: click-to-toggle on thinking blocks works; `Took` correct live and after `/reload`; four tool rows pixel-comparable to baseline; no "not loaded" notice; `ctrl+o` expansion unchanged.
- [ ] Commit each unit separately as above.

**Acceptance criteria:**
- [ ] No `pi.registerTool()` for `bash`, `codemode`, `edit` or `write` remains; no file in the repo reads a path inside pi's `dist/`.
- [ ] The "built-in extension `codemode` was not loaded" notice is absent, and MCP still treats codemode as reachable.
- [ ] `durationMs`-derived timings survive reload; the three timer helpers are gone.
- [ ] Thinking blocks keep pi's click-to-toggle and honour `outputPad`.
- [ ] `ui` and `diff` peer floors are `>=1.2.0`.

---

### Task 11: Adopt the remaining platform plumbing and retire `Bus`

**Context:** `core/src/bus.ts` is a `globalThis` pub/sub with a pre-subscriber queue that exists because pi had no cross-extension bus; `pi.events` (`{ emit, on }`) is now the documented mechanism, already used once in the suite (`ask/src/herdr.ts:19`). Several 1.x capabilities give us correctness or tokens for free: `outputSchema` + `structuredContent` (codemode callers currently get text where structure exists), `isError` instead of throwing, `annotations` so third-party permission gates recognise our tools, `exposure: "model-only"` for tools that orchestrate or ask, and pi-tui's `SettingsList`/`SelectList` in place of two hand-rolled settings chromes (`meta/src/settings-manager.ts` ~364 lines, `packages/subagent/src/agent-panel.ts` ~1442 lines — the latter is reached through the 66-line `agent-manager.ts` orchestrator, which is not itself the hand-rolled list). ADR 0029 records the `Bus` retirement and the deliberate non-adoptions.

**Files:**
- Delete: `packages/core/src/bus.ts`, `packages/core/src/bus.test.ts`
- Modify: `packages/core/package.json` — **delete the `"./bus": "./src/bus.ts"` entry** from `exports`
- Modify (every bus importer; there are 12 non-test files): `packages/core/src/index.ts`, `packages/ask/src/ipc-relay.ts`, `packages/ask/src/tool.ts`, `packages/core/src/bridge/events.ts`, `packages/core/src/bridge/index.ts`, `packages/core/src/bridge/self-usage.ts`, `packages/subagent/src/cost.ts`, `packages/subagent/src/spawn.ts`, `packages/subagent/src/stream.ts`, `packages/todo/src/index.ts`, `packages/todo/src/tool.ts`, plus the `footer`/`subagent` files Task 9 detached from `COST_UPDATE`
- Modify (schemas/hints/chrome): `packages/subagent/src/index.ts` (`:31`, `:108`, `:204`, `:226`), `packages/ask/src/tool.ts` (`:229`), `packages/web/src/tools.ts` (`:16`, `:57`), `packages/sudo/src/tool.ts`, `packages/ask/src/note.ts:4-5,32`, `meta/src/settings-manager.ts`, `packages/subagent/src/agent-panel.ts`
- Test: touch each package's tests as its transport or schema changes

**What to implement:**
1. **`pi.events` replaces `Bus` — and this is plumbing, not a rename.** `Bus` is a `globalThis` singleton reachable from anywhere; `pi.events` is a property of the `ExtensionAPI` handle (`types.d.ts:1406`), so every call site needs `pi` in scope. Four sites do not have it today and must have the handle (or an injected emitter) threaded through their signatures: `core/src/bridge/events.ts:86` (`start()`, called from `bridge/index.ts:156`), `todo/src/tool.ts:130` (inside `createManageTodoListTool(state, onUpdate)` at `:72`), `subagent/src/stream.ts:178,249` (`streamEvents(child, callbacks)`; `StreamCallbacks` at `:15-20` carries no `pi`), and `subagent/src/spawn.ts:107`. Keep the six channel names in `bus.ts:101-108` byte-identical — `COST_UPDATE` (`archimedes:cost_update`), `TODOS_UPDATE`, `TODOS_CLEAR`, `ASK_REQUEST`, **`ASK_RESPONSE`**, **`ASK_CANCEL`** — with `COST_UPDATE` already dead after Task 9. `ASK_RESPONSE`/`ASK_CANCEL` are load-bearing for the ask round-trip (`subagent/src/spawn.ts:107` writes child answers back over the socket; `core/src/bridge/events.ts:109,122,169,177` relay them to the desktop bridge) and must not be dropped. `pi.events` has no pre-subscriber queue: prove with a test whether the real call order still needs one, and if it does, keep a minimal ordering guard at the emitter rather than resurrecting `Bus`. Then delete `bus.ts`, its test, and the `"./bus"` entry in `packages/core/package.json`. `core/src/bridge/` keeps the socket transport untouched: `Bus` never crossed processes. **Floor check:** `pi.events` is present in the 0.87.0 declarations (`types.d.ts:1158`); confirm it predates `core`'s `>=0.85.0` peer floor, and if it does not, raise `core`'s floor to the version that introduced it and record that in ADR 0026 terms rather than shipping an undeclared requirement.
2. **`outputSchema` + `structuredContent` + `isError`.** Declare `outputSchema` on `ask`, `todo`, `web_search`, `fetch_content`, `get_search_content`, `subagent`; return matching `structuredContent` on success; return `isError: true` in the result instead of throwing where a handler currently throws. `subagent` already models `isError` (`index.ts:108`) — keep that shape. Do not change the human-readable `content` text.
3. **`annotations` + `exposure`.** `sudo_exec`: `destructiveHint: true`, `readOnlyHint: false`. `web_search`/`fetch_content`/`get_search_content`: `openWorldHint: true`. `subagent` and `ask`: `exposure: "model-only"`. **Do not** set `codemode`/`deferred` exposure on the web tools, and do not use `registerVirtualModel()` or `registerMcpServer()` (ADR 0029).
4. **`renderFakeCursor`.** `ask/src/note.ts` swaps hand-rolled `\x1b[7m`/`\x1b[27m` for pi-tui's `renderFakeCursor()` so `showHardwareCursor: true` shows one cursor, not two.
5. **`SettingsList`.** Rebuild `meta/src/settings-manager.ts`'s list (~364 lines) on pi-tui `SettingsList`/`SelectList`, then `packages/subagent/src/agent-panel.ts` (~1442 lines — the hand-rolled list; `agent-manager.ts` is a 66-line orchestrator that delegates to `createAgentPanel` and is *not* the target). Keep the archimedes item set, the `archimedes.*` namespaces, the editable-row behaviour added in #88, and the overlay chrome from `core`; keep both panels' current entry/exit keys and titles. The point is one settings chrome consistent with pi's own `/settings`, not a redesign.
6. Retire the **Bus** entry from `CONTEXT.md` in the final commit of this task (the glossary describes shipped reality, so this is the ship-time edit).

**Steps:**
- [ ] Failing tests: a `todo` update reaches a subscriber registered *before* the emitter (the queue behaviour `Bus` provided — `pi.events` has no queue, so prove whether it is still needed by the real call order and keep a minimal ordering guard if it is); `ask`/`web`/`subagent` results carry `structuredContent` matching their `outputSchema`; `sudo_exec` reports `destructiveHint`.
- [ ] Run `npx vitest run packages/todo packages/ask packages/web packages/subagent` — expect failures.
- [ ] Migrate transport; then grep with the relative forms included — `grep -rn "core/bus\|bus\.js" packages/*/src meta/src --include=*.ts | grep -v "\.test\.ts"` — and nothing may remain. A bare `core/bus` grep is insufficient: `core/src/bridge/events.ts:26` imports `"../bus.js"` relatively, so a grep that misses it goes green while the delete breaks the build.
- [ ] Delete `bus.ts`/`bus.test.ts`; `pnpm -r exec -- tsc --noEmit`; `pnpm test`.
- [ ] Add schemas/annotations/exposure; `pnpm -r exec -- tsc --noEmit`; `pnpm test`; confirm from a codemode script that structured content arrives.
- [ ] SettingsList rebuild, `meta` first then `subagent`: `cd meta && npx tsc --noEmit`; `cd packages/subagent && npx tsc --noEmit`; `pnpm test`; manual pass through `/archimedes` (every item, including the editable model row) and `/agents` (view, edit tools, edit model, save, cancel).
- [ ] Update `CONTEXT.md` (remove the **Bus** entry).
- [ ] Commit each numbered item separately (transport+delete, schemas, hints, cursor, settings chromes, glossary).

**Acceptance criteria:**
- [ ] `grep -rn "core/bus\|bus\.js" packages/*/src meta/src --include=*.ts | grep -v "\.test\.ts"` is empty, `packages/core/package.json` has no `"./bus"` entry, and `CONTEXT.md` has no **Bus** entry.
- [ ] Every declared `outputSchema` matches the `structuredContent` actually returned.
- [ ] `subagent` and `ask` are `model-only`; `sudo_exec` carries `destructiveHint`; web tools carry `openWorldHint`; no tool is `codemode`/`deferred`.
- [ ] `/archimedes` and `/agents` behave as before on the new components; one settings chrome remains.
- [ ] With `showHardwareCursor: true`, exactly one cursor is visible in the ask note field.

---

### Task 12: Native-overlap product calls and positioning docs

**Context:** pi binds `app.clipboard.pasteImage` to `ctrl+v` natively, and our first-run flow writes `~/.pi/agent/keybindings.json` containing `{ "app.clipboard.pasteImage": [] }` to switch it off (`image-paste/src/keybinding-offer.ts:9-24`). pi's action handles files, images and text; ours handled images only — pi additionally has `NativeClipboard.getFilePaths?()` (its "paste files on macOS") and clipboard text, both of which we do not implement, so accepting our offer silently cost users two pi behaviours to buy one. pi's dispatcher (`readClipboardImage`) is not exported, so we cannot delegate. Our genuinely additive half — attach as image blocks, multi-image queue with `[Image #n]` markers, inline preview — has no native equivalent (`user-message.js` renders no images). Decisions: ADR 0030 (superset, **plus its 2026-10-13 amendment — `suppressNativePaste: false` must restore pi's binding, not merely decline to suppress it**), ADR 0027 (screen-mode suppression already done), plus a documentation act for pi's shipped example twins.

**Files:**
- Modify: `packages/image-paste/src/clipboard.ts`, `packages/image-paste/src/index.ts` (`:58-64`, `:106`, `:108-112`, `:114-175`, `:180-184`, and the `session_start` registration at `:200-202`), `packages/image-paste/src/keybinding-offer.ts` (`:9-24`, `:19`, `:21-24`, `:44-58`, `:112-116`, `:130-146`, `:179-197`; **new exported `restoreNativePaste()`** lives here), `packages/image-paste/src/types.ts`, `packages/image-paste/src/keybinding-offer.test.ts` (the restoration cases below), their tests
- Modify: `packages/notify/src/index.ts` (docs/comment only), `packages/footer/src/index.ts` (comments on what is ours)
- Modify: `docs/features/first-run-keybinding-offer.md`, `docs/features/ui.md`, `docs/features/` files for `todo`, `ask`, `subagent`, `footer`, `image-paste`, `notify` (create where missing). The `image-paste` and first-run-offer docs must describe the restoration contract from item 2b — which file, which exact shape it will rewrite, what it refuses to touch, and **the one-time user-facing notice it emits when it refuses** (path plus the key to delete) — because that is the second time the suite writes a file in the user's config directory, and the first time it writes one the user created.
- Modify: `README.md` (see Task 13 for the settings table and theme note)

**What to implement:**
1. **`image-paste` becomes a superset on its key**, in this precedence: clipboard image → existing attach/queue/preview path; else `getNativeClipboard()?.getFilePaths?.()` non-empty → insert the paths at the cursor exactly as pi does (leading/trailing space logic per `interactive-mode.js:2505-2513`); else clipboard text → insert text. Use optional chaining on `getFilePaths` so the package stays runtime-safe below pi 1.2.0 (peer floor stays `>=0.86.0`). Add an `archimedes.imagePaste.suppressNativePaste` setting (default `true`, i.e. today's behaviour); when `false` it **takes back the suppression**, which means restoring pi's native binding, not merely declining to write the snippet — see item 2b.
2. **The snippet and the reversal.**
   a. **`$schema`.** Generated snippet gains `"$schema": "https://pi.dev/schemas/keybindings.schema.json"` (the schema is published there and declares `$schema`; be accurate in the commit message — pi 1.2.0 validates **themes** at startup, not keybindings: `KeybindingsSchema` in `dist/core/keybindings-schema.js` has no startup validator). Retarget the write itself at `keybinding-offer.ts:130-146`, which is plain `writeFileSync(tmp)` + `renameSync` — symlink preservation is **not** needed there because gate 4 only ever creates a *missing* file (`:112-116`); the symlink-preserving writer is `settings-io.ts:68-99`, used by `markPromptDone` (`:43-56`) for the settings flag, and stays untouched.
   b. **`restoreNativePaste()` — the flag must actually give the key back** (ADR 0030 Amendment 2026-10-13, which amends gate 4's "never rewrite an existing user keybindings file" rule for this one case). "Skip writing the snippet" cannot help the user who already accepted the offer: they hold `~/.pi/agent/keybindings.json` containing `{ "app.clipboard.pasteImage": [] }`, which leaves pi's native paste **unbound**, and that file is why the native action is dead. Export `restoreNativePaste()` from `keybinding-offer.ts` with this contract:
      - Called from `session_start` when `suppressNativePaste` is `false` (call sites: the `session_start` registration at `index.ts:200-202` for standalone installs, and `meta/src/index.ts:159-160` for the composed suite — restore from whichever path loaded the package, once per session; keep it out of any nested handler per the AGENTS.md top-level-registration rule). It **returns a status** the caller surfaces at most once per process (see the surfacing rule below); it never logs or notifies itself.
      - **Acts only on our own artefact:** if `~/.pi/agent/keybindings.json` parses to an object whose *only* key is `app.clipboard.pasteImage` and whose value is an empty array, write `{}` — i.e. the rewrite only ever *removes* that key — atomically via tmp+rename **preserving a symlinked path** (reuse `writeAtomicPreservingSymlinks` from `@pi-archimedes/core/settings-io`; the `:130-146` write path above is not symlink-safe and is not the one to reuse here). Any other shape returns "untouched".
      - **Never touch anything else:** a file with any additional key, a non-empty `app.clipboard.pasteImage` value, or unparseable content is left alone, and the return is a *distinct* status carrying the path plus the one-line manual edit the user must make.
      - **Surfacing rule: a user-actionable outcome gets a `ctx.ui.notify`; `diag` carries the detail.** The caller emits `ctx.ui.notify(message, "warning")` for that status, naming the file path and the exact key the user has to remove (`app.clipboard.pasteImage`), **at most once per process** — so the guard must be **reload-stable**, which rules out a module-level boolean. Store it on `globalThis` under a well-known symbol: `globalThis[Symbol.for("pi-archimedes:image-paste:restore-notified")]`. Module scope cannot work here because pi re-evaluates the extension module on every load: `loadExtensionModule()` builds a **fresh jiti with `moduleCache: false`** each time it imports an extension (`core/extensions/loader.js:477-481`; `moduleCache: false` at `:478`, the import at `:481`), and `ctx.reload()` clears the cached factory first (`core/resource-loader.js:359` calling `clearExtensionCache()`, defined at `core/extensions/loader.js:89-93`). So a `let` at module scope is re-created on `/reload`, and the user would be re-warned about the same untouched file.
        **Both codebases already use this exact technique for this exact reason.** pi keeps its theme instance on `globalThis` under a `Symbol.for` key — `const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme")` with the comment *"Use globalThis to share theme across module loaders (node + jiti in dev mode)"* (`modes/interactive/theme/theme.js:500-517`; the comment at `:502`, the key at `:503`, the `globalThis` read at `:509` and writes at `:516-517`) — and our own `packages/core/src/bus.ts` is a `globalThis` singleton for the same reason (`Symbol.for("archimedes:bus")` / `"archimedes:busQueue"` at `:3-4`, read/written through `getGlobal`/`setGlobal` at `:20-26`); Task 11 replaces that module with `pi.events`, which does not retire the precedent.
        **"Once per session" therefore means once per *process***: after `/reload` or `/new` the user must not be re-warned for the same untouched file. Skip the notify entirely when `ctx.hasUI` is false, since `restoreNativePaste()` runs in non-TUI modes too — that is the one thing to copy from `session-name/src/index.ts:298-299` (`if (ctx.hasUI && …) ctx.ui.notify(…, "warning")`). Cite `session-name` **only** for the `hasUI` skip and never for reload stability: its one-shot counters sit in the `registerSessionName()` closure and are reset by its `session_start` handler (`:271-277`), so they are per-session state, not a process-wide guard. `diag("image-paste", …)` from Task 6's `core/log` stays as the detailed diagnostic channel and both may fire, but `diag` cannot be the only channel: it is a no-op unless `PI_ARCHIMEDES_LOG` names a file, so a default install would give the user silence while pi's native paste stays dead. The edit is actionable — the user makes it and it applies before the next session — so a one-time session-start notice is the correct surface. Neither path uses `console.*` (Task 6 still governs that).
      - **No-op and idempotent:** missing file → nothing to restore, return that. A file already containing `{}` → return "already restored" without rewriting, so the flag cannot rewrite a user file on every session start.
      - **Apply it:** after a successful restore, reuse the existing reload path — the `ExtensionCommandContext.reload` presence guard with the two `CREATED_NOTIFY` / `CREATED_RELOAD_HINT` texts (`keybinding-offer.ts:21-24`, reload block `:179-197`) — so pi re-reads `keybindings.json` and the native `ctrl+v` action returns; on a ctx without `reload`, the status says `/reload` is required.
      - **Note for the implementer:** item 2a adds `$schema` to the snippet, so the artefact written *after* this task has two keys. Decide explicitly, in the same commit, whether restoration accepts the suite's own `$schema` + `app.clipboard.pasteImage: []` pair (recommended — that is literally what the suite writes) or whether `$schema` counts as a foreign key; do not resolve it by accident, and do not widen the accept-set to arbitrary extra keys either way. Record the choice in the test names.
3. **`notify` does not duplicate pi's OSC 7501 status.** pi already emits `working`/`blocked`/`done`/`error` (1.1.0, `PI_PROGRAM_STATUS`, `formatProgramStatus` from pi-tui). Add a comment + feature-doc note mapping *settled wait* ↔ `done` and *UI-prompt wait* ↔ `blocked`, and state that our value is the delayed desktop notification (OSC 777/9/99, Windows toast, tmux wrapping) plus the circuit breaker. Emit nothing new.
4. **Positioning docs.** Add a "vs pi's own" section to the feature docs for `todo` (vs `examples/extensions/todo.ts`: subagent-column visibility, auto-clear), `ask` (vs `questionnaire.ts`'s tab bar: bridge relay, headless path, inline notes), `subagent` (vs `examples/extensions/subagent/`: async dispatch, `/agents` manager, native `usage` cost, `agents.local.json`), `footer` (pi's model/context/cost information is native; ours is jj-bookmark, linked-worktree marker, merged subagent cost, adaptive packing, context bar), `image-paste` (pi's native paste: path insertion, single item, no preview; ours: attach, queue, preview — and the suppression trade plus its **restoration**, including what the extension will and will not rewrite in the user's `keybindings.json`), `notify` (OSC 7501 note above). These sections are the artefact a future ADR-0024-style deprecation decision gets made from — write them as facts, not as advocacy.

**Steps:**
- [ ] Precedence is deliberately **image → file paths → text**, differing from pi's native order (paths → image → text, `interactive-mode.js:2500-2530`): we own the key in order to attach images, so an image must win. State that in a code comment so nobody "fixes" it to match pi.
- [ ] Failing superset tests: with an image present the queue path wins even when file paths are also on the clipboard; with only file paths, `getFilePaths` results are inserted with pi's spacing rule; with only text, text is inserted; the snippet contains `$schema`.
- [ ] Failing restoration tests (`keybinding-offer.test.ts`, one per case): the suite-owned file (`{ "app.clipboard.pasteImage": [] }`) becomes `{}` and a reload is requested; a file with an extra user key is untouched, the status reports the path plus the manual-edit line, **and the caller notifies the user** — `ctx.ui.notify` is called exactly once with a message containing the file path and `app.clipboard.pasteImage`, the file is byte-for-byte untouched, and **the guard is proven reload-stable, not merely per-session**: assert no second `ctx.ui.notify` after a *re-import* of the module (`vi.resetModules()` then a dynamic `import("./keybinding-offer.js")`, mirroring how the suite already isolates module state — `packages/footer/src/utils/stats.test.ts:94-107`), which is what `/reload` does to the module registry, while `globalThis` survives it. Asserting a second `session_start` is **not** sufficient: a module-level flag passes that and still re-warns after `/reload`. With the flag on `globalThis` the re-import must be silent; also assert a plain second `session_start` stays silent for the same file; a non-empty `app.clipboard.pasteImage` value is untouched; content that does not parse is untouched; a missing file is a no-op; a second call on the already-restored `{}` writes nothing.
- [ ] Run `npx vitest run packages/image-paste` — expect failures.
- [ ] Implement 1, 2a and 2b; `cd packages/image-paste && npx tsc --noEmit`; `pnpm test`.
- [ ] Manual on macOS and on Linux/Wayland: image paste unchanged; a Finder/file-manager copy pastes paths; plain text pastes; on a machine that **already accepted** the first-run offer, setting `suppressNativePaste: false` and restarting puts `ctrl+v` back in pi's hands (native action fires, no hand-editing `keybindings.json`), and restarting again changes nothing (idempotent); a `keybindings.json` with an extra key of the user's survives the toggle untouched **and the session shows one warning naming that file and the key to delete; then run `/reload` in the same process and confirm the warning does not appear a second time** (that is the check for the `globalThis` guard — a module-scope flag shows the warning twice). The manual check is done with `PI_ARCHIMEDES_LOG` unset, which is exactly the case that was previously silent.
- [ ] Commit: `feat(image-paste): paste files and text like pi, keep images like us`
- [ ] Commit the restoration (item 2b) **separately**: `feat(image-paste): hand ctrl+v back to pi when suppressNativePaste is off` — it is the one change in this task that writes a file the suite did not create, so it needs its own revert boundary and its own ADR citation.
- [ ] Write docs items 3–4; commit `docs: state what pi provides natively and what the suite adds on top`

**Acceptance criteria:**
- [ ] `ctrl+v` handles image → file paths → text, in that order, on both screen modes.
- [ ] `suppressNativePaste: false` restores pi's native action on a machine that already accepted the offer, without hand-editing files: the suite-created `{ "app.clipboard.pasteImage": [] }` file becomes `{}` and the existing reload path is taken.
- [ ] A `keybindings.json` with an extra user key is left untouched, and the status names the path plus the one-line manual edit the user must make.
- [ ] That manual edit **reaches the user**: with a foreign key present, `ctx.ui.notify(…, "warning")` is called once with a message naming the file path and the `app.clipboard.pasteImage` key, and a second session in the same process does not notify again — including a session started by re-importing the module, i.e. what `/reload` does (the `globalThis` guard, not a module-scope flag).
- [ ] A non-empty `app.clipboard.pasteImage` value is left untouched.
- [ ] Content that does not parse is left untouched (no rewrite, no throw).
- [ ] A missing `keybindings.json` is a no-op (nothing written, no error).
- [ ] A second call after a successful restore rewrites nothing — the file is not touched every session.
- [ ] Nothing about the restoration reaches the console: the detail goes through Task 6's `core/log` diagnostics, and the untouched-file case is additionally surfaced to the user once per process (reload-stable) through `ctx.ui.notify` (a `diag`-only path fails this criterion, since `diag` is opt-in).
- [ ] Generated `keybindings.json` validates against the published schema.
- [ ] Six "vs pi's own" sections exist in `docs/features/`.

---

### Task 13: Document the new contracts and ship 2.11.0

**Context:** Five ADRs and three behaviour changes need present-tense documentation, and the release itself has strict conventions (AGENTS.md "Release Steps" and the release-notes rules: headline first, `## Other changes` one bullet per package, contributor thanks only, every change linked to a PR or full commit URL, no internal jargon, no reference to lineage projects). These are user-visible behaviour changes — children no longer inherit MCP tools, the splash is suppressed on pi's default screen mode, run outcomes are three-valued — so the bump is **minor**: `2.10.4 → 2.11.0`.

**Files:**
- Create: `docs/features/screen-mode.md` (front-matter `status: live`, `last-verified: 2026-10-<day>`)
- Modify: `docs/features/ui.md` (the two never-do rules: no ANSI parsing to decide colour; no `console.*` from a render or event path), `docs/features/first-run-keybinding-offer.md` (ADR 0030 trade + its reversal as actually implemented: what `suppressNativePaste: false` rewrites, the gate-4 exception that permits it, what the extension will never touch, and the once-per-process (reload-stable) notify the user gets in the never-touch case), `docs/features/session-name.md` (diagnostics path), `docs/features/symlink-preserving-settings-writes.md` (unchanged behaviour, note the `$schema` addition)
- Modify: `AGENTS.md` (the two never-do rules; pi 1.2.0 as the type-check target; the `@types/node` hold; the floating `pi@latest` job)
- Modify: `README.md` (settings row for `suppressNativePaste`, worded as "turning it off removes the suite's `app.clipboard.pasteImage` unbinding from `~/.pi/agent/keybindings.json` so pi's native paste returns" — not "pi keeps the key"; a note that pi 1.2.0 validates `theme.schema.json` with `additionalProperties: false`, which affects users whose custom `~/.pi/agent/themes/*.json` carry extra metadata; the `pi install` lines unchanged)
- Modify: all 13 `package.json` versions → `2.11.0`
- Delete: `docs/roadmap/pi-1-x-alignment.md` (this file — on ship, durable content is folded into `docs/features/`; history lives in git)

**What to implement:**
Write the feature docs first, then bump versions, then follow AGENTS.md exactly: bump all 13 versions together (root `package.json` is private and has no version) → `npx tsc --noEmit` in each of the 12 package directories → confirm CI green on the branch → tag `git tag -a v2.11.0 -m "Release v2.11.0"` → `git push origin main v2.11.0` → `gh release create v2.11.0 --title "v2.11.0" --target main --notes "…"`.

Release notes shape: a leading `## Pi 1.2.0 alignment` section (screen mode support, fullscreen-first suppression, frame-safe rendering, theme-derived colour, renderer resolution replacing tool take-overs, subagent tool-allowlist and run-outcome changes, native subagent cost in `/session`, the runtime pi-version warning, the pi 1.2.0 type-check target), then `## Other changes` with one or two lines per package (`core`, `ui`, `ask`, `footer`, `diff`, `image-paste`, `subagent`, `todo`, `notify`, `session-name`, `web`, `sudo`, `meta`), then `## Thanks to contributors` for external contributors only (gather with `git log v2.10.4..v2.11.0 --pretty='%an|%h|%s'`, cross-check `gh pr list --state merged --json number,title,author`; never thank the repo owner). Link every change to its PR (`#NN`) or, for direct commits, a full commit URL. Verify the workflow's "Verify all packages are on npm" step is green before calling the release done — `pi-archimedes` pins exact versions, so a failed component publish leaves `npm install pi-archimedes@2.11.0` unresolvable.

**Steps:**
- [ ] Write the five docs edits; commit `docs: document screen mode contracts and native overlap`.
- [ ] Add the AGENTS.md rules and README rows; commit `docs(agents,readme): pi 1.2.0 target and the two never-do rules`. The `suppressNativePaste` row must describe the restoration (ADR 0030 amendment), not "skip the write".
- [ ] Bump all 13 versions to `2.11.0`; `pnpm install` (refreshes the workspace lockfile) → `pnpm -r exec -- tsc --noEmit` → `pnpm test`; commit `chore: bump version to v2.11.0`.
- [ ] Push the branch, open the PR, wait for CI **including** `pi-latest` to be green; merge.
- [ ] Re-run all 12 package type-checks on `main`, then tag and push: `git tag -a v2.11.0 -m "Release v2.11.0" && git push origin main v2.11.0`.
- [ ] Watch the release workflow; confirm the "Verify all packages are on npm" step is green for all 13 packages.
- [ ] Create the GitHub release with the notes above; delete this roadmap doc and commit `docs: ship pi 1.x alignment`.

**Acceptance criteria:**
- [ ] Task 6's census re-run prints nothing and its discipline allow-list is down to `packages/core/src/log.ts` alone (the `ui/src/startup/capture.ts` entry left with Task 8's deletion).
- [ ] `docs/features/screen-mode.md` exists with `status: live` and a `last-verified` date.
- [ ] `AGENTS.md` records: pi 1.2.0 as the type-check target, the `@types/node` 22.19.19 hold, no-`console.*`-from-render, no-colour-from-ANSI-parsing.
- [ ] All 13 packages publish at 2.11.0 and the verify step is green.
- [ ] Release notes lead with the alignment, have one bullet per package, credit only external contributors, and link every change.
- [ ] `docs/roadmap/pi-1-x-alignment.md` is deleted on `main`.

---

## Sequencing and risk notes

- Line citations in this plan were re-verified against `main` after #89–#93 merged (footer git/jj/stats, `ui/src/startup/index.ts`); the earlier ones from the 2.10.4 snapshot that moved are `footer/src/index.ts:141`→`:145` (`clampLine`), `:70-80`→`:65-76` (accumulator merge) and `ui/src/startup/index.ts:343,346`→`:349,352` (`addChild` error paths). Re-check citations again if further PRs land before execution.
- Tasks 1 and 2 must come first (everything else assumes 1.2.0 types and drift detection). Any new module under `packages/core/src` needs its `exports` entry in `packages/core/package.json` in the same commit: `core/src/index.ts` exposes only `registerCore`, and every cross-package consumer imports a subpath.
- Task 3 gates Task 4/5 work behind screen mode; Task 6 must precede Tasks 7–10 because they add warnings that must not use `console.*`; **Task 8**, not Task 10, removes the startup `addChild` patch that Task 3 only gates.
- Tasks 9, 10, 11, 12 each own their own peer-floor move; Task 13 verifies the final set: `>=1.2.0` for `ui`, `diff`, `subagent`; `>=0.86.0` `image-paste`/`session-name`; `>=0.85.0` `core`; `>=0.84.4` `notify`; `>=0.1.0` elsewhere.
- Highest-risk single change: Task 10's codemode deletion (untyped couplings removed in one step). It is deliberately two commits with a snapshot baseline, and the acceptance check is behavioural (built-in loads, notice gone, guidelines back), not "tests pass".
- Not covered here by design: the `image-paste`/`footer` package deprecation question, first-class splash rendering inside a fullscreen viewport, `codemode`/`deferred` exposure for web tools, virtual models, and anything needing an upstream API that does not exist yet.
