---
status: approved
done-when: Every custom surface behaves on both screen modes, 13/13 packages type-check against pi 1.2.0 with a scheduled `pi@latest` job guarding drift, no package depends on a pi private module or prototype, and 2.11.0 is released with subagent cost visible in `/session`.
---

# Align pi-archimedes with pi 1.x (0.87 → 1.2.0)

## Problem

The suite type-checks against pi **0.87.0** (lockfile-pinned; `^0.87.0` cannot even reach `0.87.1`) while users run pi **1.2.0** — eleven releases and one major boundary apart, across a discontinuity where 0.88–0.98 were never published. Nothing is broken at the symbol level: two independent scratch harnesses, each with a control run at 0.87.0, report 0 errors across all 13 projects against 1.2.0, and no pi export this suite imports was removed (pi-tui's sole removal, `parseOsc11BackgroundColor`, is unused).

The risk is what types cannot see. pi changed three defaults (`tuiMode` → fullscreen in 1.0.0; the `system` theme with terminal-default tokens in 0.99.0; print-mode exit `1` on truncation in 1.2.0), two contracts (`before_agent_start` became a union on `messageType`; busy state now begins before the run), and one CLI semantic (`--tools` retains MCP tools; `+name`/`-name` are modifiers). Six of our mechanisms additionally depend on pi internals that predate all of it.

Decisions: [ADR 0026](../decisions/0026-pi-version-contract-runtime-floor.md) version contract · [ADR 0027](../decisions/0027-fullscreen-first-screen-mode-stance.md) screen-mode stance · [ADR 0028](../decisions/0028-subagent-closed-allowlist-and-run-outcomes.md) subagent allowlist and run outcomes · [ADR 0029](../decisions/0029-presentation-via-renderer-resolution.md) presentation via renderer resolution · [ADR 0030](../decisions/0030-image-paste-superset-not-supplement.md) image-paste superset. Terminology: *screen mode*, *screen capability*, *run outcome* in `CONTEXT.md`.

## What changes for a user

- On fullscreen screen (pi's default since 1.0.0) the splash and startup listing are suppressed; everything else fits the viewport, and overlays, panels and footers stop over-running the frame or smearing on a stray write.
- Panel chrome and diff colours follow the terminal palette on 256-colour and non-truecolour terminals instead of falling back to hardcoded dark greys.
- `bash`, `codemode`, `edit` and `write` rows render through pi's renderer resolution. The startup notice *"built-in extension `codemode` was not loaded"* disappears and pi's per-tool prompt guidelines return to the prompt.
- "Took" is correct and survives a session reload; thinking blocks keep pi's click-to-toggle.
- Subagent children no longer inherit MCP tools from a three-tool allowlist, `+x`/`-x` tool entries are rejected with a message, runs report `completed` / `truncated` / `aborted`, and subagent cost appears in `/session`.
- `ctrl+v` pastes images (queue + preview), file paths, or text — nothing pi could do on that key is lost.
- A mismatched pi version produces one aggregated startup warning instead of silent misbehaviour.

## Design

### 1 · Version contract, guard, CI

devDeps pinned exactly at `1.2.0` for `pi-coding-agent`/`pi-tui`/`pi-ai` in all 13 packages; `@types/node` **held at 22.19.19** (pi 1.2.0 bundles 26.6.5, whose `ChildProcess extends InternalEventEmitter<…>` yields 3 false `Property 'on' does not exist` errors at `image-paste/src/clipboard.ts:208,216` and `sudo/src/tool.ts:55`); `pnpm-lock.yaml` regenerated in the same commit, since both `ci.yml` and `release.yml` run `pnpm install --frozen-lockfile`.

Peer floors move to `>=1.2.0` only where a missing API makes a feature absent or wrong — `ui` (1.0.1 renderer resolution, 1.1.0 `durationMs`), `diff` (renderer resolution), `subagent` (0.99 `usage`, 1.0.4 CLI, 1.1.0 `aborted`, 1.2.0 exit code). `notify` stays `>=0.84.4` and `core` `>=0.85.0`: their newer call sites fall back, so they remain runtime-safe below the floor per ADR 0013 — which makes those fallbacks load-bearing, not incidental.

`core` exports a `VERSION`-based support check called from each `register()`: it **warns and still registers**, messages aggregated by `meta`, never via `console.*`. CI keeps the pinned job (now the floor job) and adds a `pi@latest` float job that runs **on a schedule as well as on PRs** — under pi's stated policy (*minor = breaking, no major releases*) a float job that only runs on PRs is green precisely while the repo is untouched.

### 2 · Screen mode and capabilities

`core` exports `screenMode(tui)` over pi-tui's public `isViewportTUI` (`pi-tui/dist/index.d.ts:32`). Two rules: never store a `tui` reference, and re-derive per call — `switchTuiMode()` (`interactive-mode.js:604`) stops the TUI, builds a new one, re-mounts every child and rebinds extension input listeners, triggered in-session when the user flips `tuiMode` in `/settings` (`interactive-mode.js:4238`). `pi.getSettings().tuiMode` is intent; the predicate is fact, and the fact wins wherever a `tui` exists.

Two screen capabilities carry all policy: `transcriptWrite` (off on fullscreen) and `frameBounded` (on fullscreen). The splash animation and startup resource listing (`ui/src/startup/*`) gate off on fullscreen screen — a deliberate promise, not a defect. A guard test rejects assigning a `tui` to a class field or module binding.

### 3 · Rendering correctness

`core/src/overlay.ts`'s four width helpers (`visibleWidth` at `:44-47`, `padEnd` `:37-42`, `hardTruncate` `:70-98`, `wrapText` `:13-36`) are deleted in favour of pi-tui's `visibleWidth` / `truncateToWidth` / `wrapTextWithAnsi` / `sliceByColumn` / `compositeTuiLine`; `core/src/text.ts`'s `stripAnsi` and the `clampLine` alias (`:25-27`) likewise. Lines carrying `CURSOR_MARKER` (`subagent/src/agent-panel.ts:114,506,513,543,1060`) currently measure ~10 columns wide and can be cut mid-marker.

Colour is decided by `theme.appearance` / `theme.colors` / `theme.style()`, never by parsing ANSI. A token resolving to `\x1b[49m` means *no background* — the current `panelBg = getBgAnsi(…) ?? … ?? FALLBACK_PANEL_BG` (`chrome.ts:73-82`) can never reach its fallback because that is a truthy string, while `bgToFgAnsi` (`:62-67`) falls to near-black, painting dark edge slabs on light terminals at `ui/src/editor/index.ts:176,250,367-372`. `setThemeBg()` (`chrome.ts:90-93`) is deleted: it writes `theme.bgColors`, renamed to `fgAnsi/bgAnsi` in 1.2.0. `diff/src/ansi/colors.ts:11-14` gains 256-colour support by reusing `core/src/color.ts:137-155` rather than a second parser.

No `console.*` from a render or event path (36 non-test sites). New env-gated diagnostics logger in `core`; user-visible messages go through the notify surface. This also fixes a second bug: `subagent/src/stream.ts:126-131` discards any non-JSON stdout line, so every warning our packages emit inside a child is currently swallowed. `ask/src/note.ts:4-5,32` uses pi-tui's `renderFakeCursor()` instead of hand-rolled reverse video.

### 4 · Event and CLI alignment

`notify` (`index.ts:192`) keeps cancelling on any run start, pinned by a test and a comment naming the union. Its any-key cancel (`:207`) requires a decoded key rather than raw bytes — 1.1.0's status query and 1.2.0's palette query (startup, theme switch, colour-scheme notification) put far more reply traffic through `onTerminalInput`.

`subagent`: pass `--no-mcp` unless an agent config opts in; validate `tools:` entries on both edit (`agent-panel.ts:469,1020`) and spawn (`spawn.ts:227-233`), following ADR 0008's pre-validation precedent; derive `completed` / `truncated` / `aborted` from the child's `stopReason` and `agent_settled.aborted` instead of `code ?? 1` (`stream.ts:206-210`), with cost accounting preserved in all three.

The startup section list (`ui/src/startup/sections.ts:9`) stops asserting a fixed set — 0.99.0 removed `[Themes]`, 1.2.0 emits Context/Skills/Prompts/Extensions plus a `quietStartup`-gated scope line. Renderers read `ctx.durationMs` and apply `outputPad`; `clearActiveBashIntervals`, `clearActiveCodemodeIntervals` and `parseWallTimeMs` are deleted.

### 5 · Platform adoption and fragility retirement

Presentation goes through `pi.registerToolRenderer()` with a `next()` fallback; `pi.registerTool()` stays only for behaviour changes (`core/src/tool-render.ts` and both renderers also checked for `outputPad` drift). **Order is observable**: register the renderer first, delete the override in a later commit, because pi drops a built-in extension whose tool a third-party claims (`omitReplacedExtensions`, ADR 0024). Targets: `ui/src/bash/tool.ts:10-18`, `ui/src/codemode/tool.ts` (removing the private-module load, the schema-identity coupling and the dropped `getToolGuidelines`), `diff/src/tools/{edit,write}.ts:44,24`.

The thinking patch survives only for the muted Markdown theme, under four conditions: delegate to the original for non-thinking content, keep pi's click-to-toggle `MouseRegion` (`assistant-message.js:117-125`), honour `outputPad`, and version-fence with a visible warning rather than `console.warn`. Label, collapse and indicator move to `ctx.ui.setHiddenThinkingLabel()` / `setWorkingIndicator()`.

`ctx.scopedModels` replaces the `console.log` scrape (`ui/src/startup/capture.ts:4-35`); `quietStartup` + the existing `setHeader()` replaces the `addChild` patch (`ui/src/index.ts:97-140`); pi's own update check replaces `fetchLatestVersion()`. Tool-result `usage` deletes the cost-over-bus path (`subagent/src/cost.ts` → `core/bus` → `footer/src/cost-accumulator.ts:11`) and makes `/session` correct. `pi.events` replaces `core/bus.ts`; `core/bridge` keeps only the socket transport. `pi.getSettings()` with a file-read fallback; `outputSchema` + `structuredContent` + `isError` instead of throwing; `annotations` (`destructiveHint` on `sudo_exec`, `openWorldHint` on the web tools) and `exposure: "model-only"` for `subagent`/`ask`; pi-tui `SettingsList`/`SelectList` replace both hand-rolled settings chromes (`meta/src/settings-manager.ts`, `subagent/src/agent-manager.ts`).

### 6 · Duplication and positioning

`image-paste` becomes a superset on its key: images → attach + queue + preview; file paths → `NativeClipboard.getFilePaths?()` inserted at cursor; otherwise clipboard text. Plus a `suppressNativePaste` setting and `"$schema": "https://pi.dev/schemas/keybindings.schema.json"` in the generated snippet. `footer` sources from `footerData` / `ctx.getContextUsage()` / `ctx.sessionManager` instead of recomputing, keeping jj-bookmark, the linked-worktree marker, merged-cost display, adaptive packing and the context bar. `todo`/`ask`/`subagent` feature docs gain a "vs pi's own example" section naming what we add over pi's shipped twins (`todo.ts`, `questionnaire.ts`, `examples/extensions/subagent/`). `notify` does not duplicate pi's OSC 7501 program status: verify the state mapping (settled wait ↔ `done`, UI-prompt wait ↔ `blocked`) and document it.

**Not adopted:** exposure demotion for the web tools, `pi.registerVirtualModel()` (experimental), `pi.registerMcpServer()`, and keeping a splash on fullscreen screen.

## Verification

1. `tsc --noEmit` green in all 13 packages against pi 1.2.0 with `@types/node` 22.19.19; the float job green on schedule.
2. Smoke matrix — every custom surface × {regular screen, fullscreen screen}: splash, editor + border spinner, footer, todo widget, `ask` dialog/picker/note, sudo prompt, subagent panel + `/agents`, `/archimedes`, plugin manager, onboarding, image preview. Plus a mid-session `/settings` screen-mode switch with surfaces open (exercising the overlay-refusal interaction) and closed.
3. `PI_TUI_WRITE_LOG` capture over `/agents`, `/archimedes` and the todo widget with zero lines wider than the frame.
4. Dumb-terminal pass: `terminal.trueColor: false` and the no-colour-report path, diff and panel chrome tracking the palette.
5. Subagent matrix: allowlist with an MCP server connected, a token-limit-truncated run, an aborted run.
6. Renderer snapshots proving parity with the overrides gone, and the codemode "not loaded" notice absent.
7. `/session` totals include subagent cost; `grep -rn "core/bus" packages/*/src` empty and the `Bus` glossary entry retired in the ship commit.

## Docs and release

New `docs/features/screen-mode.md` (`status: live`, `last-verified`); updates to `docs/features/ui.md` (the two never-do rules: no ANSI-parsing for colour, no `console.*` from a render path) and `first-run-keybinding-offer.md` (the ADR 0030 trade and how to reverse it); README settings rows plus a note for users whose custom `~/.pi/agent/themes/*.json` carries extra metadata (1.2.0 validates `theme.schema.json` with `additionalProperties: false`); AGENTS.md gains the two never-do rules and the pi 1.2.0 floor.

One version bump across all 13 packages, **2.10.4 → 2.11.0** — minor, because MCP inheritance, splash suppression and the run outcomes are user-visible. Then the AGENTS.md sequence: bump every version → type-check the 12 package directories → CI green → annotated tag → `gh release create` with the pi 1.x alignment as the headline section.

## Out of scope

Retiring `image-paste`, `footer` or any other package; full first-class rendering of the splash inside a fullscreen viewport; making web tools `codemode`/`deferred`; virtual models; anything requiring an upstream API that does not exist yet (a thinking-block theme hook, an exported clipboard dispatcher, a customisable paste action).
