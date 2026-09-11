# Plan 035: Pi, with the good stuff

**Status:** COMPLETED (PR #49)
**PR:** [#49](https://github.com/danielcherubini/pi-archimedes/pull/49)
**Branch:** `feature/improve-readmes` → `main`
**Goal:** Make Archimedes appealing to a new user through confident, personable, concrete copy, with immediate setup instructions and trustworthy reference documentation.
**Architecture:** Documentation-only revision of the root README, npm README in `meta/`, and eleven component READMEs. Root and npm landing pages share the approved user-facing copy; component READMEs own detailed usage and caveats. No new build step, README generator, or runtime changes.
**Format:** GitHub-flavoured Markdown, existing screenshots, package JSON description.

## Approved direction

The user rejected both corporate jargon and a dry list of supposed shortcomings of Pi. They chose “Pi, with the good stuff.”, requested fewer jokes, and approved the copy below. Preserve its voice rather than restarting copy exploration. Display substantive copy/review findings in chat; use `ask` only for the actual question and concise choices.

- Confident and personable, not jokey or inflated. Benefits first, technical details later.
- No “cockpit”, “enterprise-grade”, “ultimate”, “reactive nervous system”, “swarms”, or claims that other extensions cannot cooperate.
- Do not disparage Pi or invent limitations to make Archimedes look better.
- Installation immediately follows the opening, before screenshots, feature stories, command tables, or a “why” essay.
- No invented benchmarks, adoption statistics, guaranteed reliability, savings, or universal compatibility.
- Features sell the suite; factual qualifications still belong beside the relevant usage instructions.
- Follow `CONTEXT.md` terminology for reference material, but avoid exposing internal implementation terms in the opening.

### Approved landing-page copy

Use the following as the editorial baseline. Link the features to their component docs and add the verified qualifications listed later without changing the tone.

> # Archimedes
> ### Pi, with the good stuff.
>
> An extra pair of eyes on your code. Agents working in parallel. A terminal that keeps you in the loop—and looks good doing it.
>
> **Archimedes brings subagents, shared task lists, MCP tools, and a polished interface to Pi. Install them together, use what you like, and make the setup yours.**
>
> ## Give your agent some backup.
>
> Have one subagent explore the codebase while another reviews your changes. Choose their models and tools, watch their progress live, and see their tasks side by side.
>
> Their token usage and costs feed into the same status bar. More work happening at once, without losing sight of it.
>
> ## Keep the decisions. Delegate the work.
>
> When a subagent needs your input, it can ask directly in your session. Pick an option, add a note, or write your own answer. It gets your decision and carries on.
>
> You don't have to copy messages between terminals to stay involved.
>
> ## Bring the tools you already use.
>
> Connect MCP servers, browse their tools, and handle authentication inside Pi. Import server definitions from Cursor, Claude Code, Claude Desktop, or VS Code rather than rebuilding your setup.
>
> Start with `/mcp setup`. Manage it with `/mcp`.
>
> ## See what changed. Not just that something changed.
>
> Syntax-highlighted diffs, side by side when there's room and unified when there isn't. Word-level highlights draw your eye to the changes inside each line.
>
> The details are easier to catch when they're easier to read.
>
> ## A terminal worth spending your day in.
>
> Paste screenshots with inline previews. Keep your branch, model, context usage, and costs in view. Give sessions useful names automatically so they're easier to find later.
>
> A framed editor, animated working indicators, and configurable colours finish the picture. Small touches that make the whole setup feel considered.
>
> ## A little more care with root access.
>
> For tasks that need `sudo`, review the command and its reason before entering your password in a masked prompt—not the chat. Credentials are cached in memory with an expiry, and `/sudo forget` clears them.
>
> ## Step away without losing track.
>
> Get a notification when the agent finishes or a prompt needs your attention. Alerts wait before firing, and typing cancels anything pending.
>
> You can leave the terminal to do its thing.
>
> ## The whole suite. Or just your favourite parts.
>
> One install brings everything together. Switch optional extensions on or off with `/plugins`, then `/reload` to apply. Use `/archimedes` to adjust the available settings.
>
> Only want the diffs, footer, or MCP tools? Each component is available separately.
>
> **Start with the setup. Make it yours.**

## Evidence and boundaries

The existing PR contains inaccurate promises and removed reference information. Fix documentation, not implementation. Verify against source, not other README prose.

### Pi setup

- The installed and workspace Pi package is `0.85.1`; its `engines.node` is `>=22.19.0`, not just `>=22`. Verify again when executing; do not invent an Archimedes minimum Pi version from broad peer ranges.
- Read the installed Pi README and related setup docs completely before editing setup instructions. Base path: `/home/daniel/.local/lib/node_modules/@earendil-works/pi-coding-agent/`. Relevant files: `README.md`, `package.json`, `docs/quickstart.md`, `docs/providers.md`, `docs/packages.md`. Follow relevant cross-references for any additional claims.
- Current documented global Pi install: `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`.
- Then `pi install npm:pi-archimedes`, change into the intended project, and run `pi`. Inside Pi, use `/login` for a supported provider and `/model` to select a model. API-key/environment setup can link to Pi's provider docs instead of reproducing a provider catalogue.
- Include existing-user guidance to run `/reload` after installation and explain model access is supplied through Pi, not bundled with Archimedes. Do not imply all subscriptions include unlimited/free usage.
- `npm` here installs the global Pi CLI; repository development still uses `pnpm install`. Never run these install commands merely to validate documentation.

### Source-backed corrections

| Area | Required fact / qualification | Source to inspect |
|---|---|---|
| Suite controls | Eleven components; **ten optional** extensions, core always registered. `/plugins` toggles persist immediately; registration changes on `/reload`/fresh session. `/archimedes` uses arrows to change values, Enter for supported field edits, `s` to save, Escape to discard edits; use `/reload` for startup-captured settings. `/archimedes` and `/plugins` are suite-only; `/agents` is suite-only with subagent enabled. Not every setting has a panel control. | `meta/src/index.ts`, `meta/src/plugins.ts`, `meta/src/plugin-manager.ts`, `meta/src/settings.ts`, `meta/src/settings-manager.ts` |
| Standalone integrations | Describe the full suite as the supported connected setup; do not assert the bus can only work through meta or that unrelated extensions cannot communicate. | `packages/core/src/bus.ts`, `meta/src/index.ts` |
| Subagents | Omitted `agent` is config-less, not a default `general` agent. Execution waits for results; `async` is present in schema but ignored by implementation, so do not sell fire-and-forget or “keep coding in parallel with the main agent”. Model precedence is agent config → task/tool model → parent. Nested subagent tool excluded. Named agents must exist; don't imply reviewer/researcher agents are shipped presets. | `packages/subagent/src/index.ts`, `tool-schema.ts`, `spawn.ts`, `model-validation.ts` (the last three in the same directory) |
| Agent definitions | Restore discovery scopes, required name/description frontmatter, comma-separated `tools` string, markdown body as prompt, model/thinking fallback, local `agents.local.json` precedence, unknown-field preservation, and optional `childSessionId` result reference. TUI saves move model/thinking to local config. | `packages/subagent/src/agents.ts`, `local-config.ts`, `agent-store.ts`, `frontmatter-io.ts`, `stream.ts` |
| Diffs | Displays edit/write changes in the tool UI, including call previews; not an approval gate before applying changes. Standalone uses fixed defaults (`github-dark`, 150, 60), not settings-backed config. Meta supplies config reader. Do not promise every syntax colour automatically equals Pi's active theme. | `packages/diff/src/index.ts`, `packages/diff/src/tools/edit.ts`, `packages/diff/src/tools/write.ts`, `meta/src/config.ts` |
| Footer | Context bar shows consumption, not remaining space. Costs reflect usage/pricing reported through the tools, not a guaranteed exact provider invoice or all background model calls. | `packages/footer/src/index.ts`, `packages/footer/src/cost-accumulator.ts`, `packages/footer/src/utils/stats.ts` |
| Images | Clipboard markers appear on paste; image attachment/previews on submission. Remaining markers select attachments. 20 MiB per image. Terminal support affects display; model must support images to use them. Restore supported shortcuts and binding-conflict guidance. Linux clipboard backend/display requirements belong in package docs. Do not assert `terminal.showImages` control unless verified through Pi renderer. | `packages/image-paste/src/index.ts`, `clipboard.ts`, `preview.ts` |
| Notify | Starts a timer on `agent_settled` or `ui_prompt_start`; input cancels rather than restarting an inactivity tracker. No reading/focus detection. Delivery depends on terminal support. These native triggers also work standalone. | `packages/notify/src/index.ts` |
| Session names | Separate model call, potentially billed, current model by default unless configured; not necessarily cheap and not forwarded to footer by this package. First exchange, manual names respected, ephemeral sessions skipped, title capped at 80 chars. Avoid “never lose a session” and completely silent failure claims. | `packages/session-name/src/index.ts` |
| Sudo | Guard is a heuristic, not a sandbox or security boundary. Allowed flag list is scanner behavior, not proof no prompt can occur. Headless `sudo_exec` refused; ordinary guard still applies. Process-group cleanup cannot catch deliberately detached descendants. Literal-password output scrubbing is not universal leak protection. Ambiguous failures without reusable ticket use two-failure cache clearing. JSON-only settings. | `packages/sudo/src/guard.ts`, `tool.ts`, `index.ts`; `docs/adr/0010-archimedes-sudo-security.md` |
| MCP | Keep layered config, auth keyring requirements, no plaintext fallback, public-client refresh limitation, reserved settings and reload/write-back behavior. Avoid “any server” / feature-parity / maximum-token-efficiency promises. | `packages/mcp/README.md`, `packages/mcp/src/index.ts`, `config.ts`, `commands.ts`, `auth-flow.ts`, `auth-storage.ts` |
| Core/settings | `mutedTheme` is exposed/saved but not consulted by the current thinking renderer: mark currently ineffective, do not implement it. Check remaining spinner/thinking settings individually. Archimedes settings use strict JSON (`JSON.parse`), unlike MCP server configs, which accept JSONC. | `packages/core/src/index.ts`, `packages/core/src/config.ts`, `packages/core/src/thinking/patch.ts`, `packages/core/src/settings-io.ts` |
| Todo | `/todos` refreshes the widget and reports status, not a visibility toggle; `/todos clear` clears tasks. Writes replace the whole list. Verify auto-clear timing and subagent-column behavior. | `packages/todo/src/index.ts`, `packages/todo/src/tool.ts`, `packages/todo/src/state-manager.ts`, `packages/todo/src/ui/todo-widget.ts` |
| Ask | Verify single/multi-question navigation, notes, multi-select and custom answers from the actual dialogs. Do not promise mouse interaction or invented keybindings. Explain subagent relay only for supported Archimedes dispatch. | `packages/ask/src/tool.ts`, `packages/ask/src/ipc-relay.ts`, picker/dialog sources under `packages/ask/src/` |
| npm README | `meta/` is the published `pi-archimedes` directory. The missing file was the cause; npm normally includes a README even when absent from `files`. Keep explicit README entry and physical file. A local pack is not publication. | `meta/package.json`, `.github/workflows/release.yml` |

For removed reference material, compare both `git show 11cdbe1:README.md` and `git show 11cdbe1:packages/<name>/README.md`; restore only source-verified information, not old errors. Build a brief retention checklist mapping removed valid root reference content to a component README destination. In particular, restore the `McpOAuthConfig` object fields (`grantType`, `clientId`, `clientSecret`, `scope`, `redirectUri`, `clientName`, reserved/unused `authorizationServerUrl`) in `packages/mcp/README.md`, checking `packages/mcp/src/types.ts`, `packages/mcp/src/auth-flow.ts`, and `packages/mcp/src/oauth-provider.ts`. The landing page must link there, not duplicate this reference. Relative source shorthand above always means the same directory as the preceding fully qualified source path.

**Before implementation:** Commit this plan and its index entry on `feature/improve-readmes` before Task 1 (`chore: plan the approved README copy revision`). Stage only those two paths, preserve unrelated changes, and update existing PR #49 rather than creating a new branch/PR.

## Task 1: Rewrite the two landing pages and npm description

**Context:** These are the first pages prospective users see. They need a strong opening, a working start path, and proof of the connected experience—not eleven repeated specification sheets.

**Modify:** `README.md`, `meta/README.md`, `meta/package.json`.

**Steps:**
- [ ] Read the current three files, Pi setup references, and relevant source from the fact table. Note the current failures: buried install, unsupported Node badge, old jargon, missing provider setup, misleading suite controls.
- [ ] Preserve the existing splash asset and useful npm badge, but put the title/tagline and short opening before large images. Avoid adding a fabricated logo or artwork. Keep visual proof after setup so the hero image does not push setup down the page.
- [ ] Write setup immediately below the approved opening. Show the one-command suite install prominently for existing Pi users, then the full new-user path (Node requirement, Pi install, Archimedes install, project launch, `/login`, `/model`). Distinguish shell commands from in-session commands.
- [ ] Use the approved feature stories and existing subagent/todo, ask, and diff screenshots. Link all eleven packages at least once, including core, footer, image-paste, notify, session-name. Add a short extra-model-call usage note for session naming and terminal-dependent preview/notification qualification without overwhelming the opening.
- [ ] Keep a concise commands table with scope and reload qualifications. Replace the long duplicated JSON settings dump with namespace links to package reference docs; explain settings live in `~/.pi/agent/settings.json` and sudo is JSON-only. Don't promise `/archimedes` controls every setting.
- [ ] Keep a compact package table, an explicit standalone `pi install npm:@pi-archimedes/<actual-name>` example for each component (a single code block is fine), and the root monorepo layout/development instructions required by `AGENTS.md`. No build step; local symlink instructions must create the extensions directory and warn against loading local and npm suite copies together.
- [ ] Root links may be repository-relative. In `meta/README.md` use absolute GitHub links for documentation and raw GitHub image URLs. Same user-facing opening/setup/feature copy in both, with an npm-friendly short link to root development instructions instead of duplicating the monorepo developer guide.
- [ ] Update only `meta/package.json`'s description to: `Parallel agents, shared task lists, MCP tools, and a polished terminal for the Pi coding agent.` Preserve name, versions, dependencies, files, and Pi manifest. Don't alter release workflows or introduce README generation.
- [ ] Inspect the rendered reading order, all links, and `git diff --check`. Verify the previous content defects no longer appear. Documentation checks replace artificial unit tests for prose: no application behavior is being changed.
- [ ] Commit: `chore: give Archimedes a clearer and more inviting introduction`.

**Acceptance:** The first screen explains what Archimedes adds without disparaging Pi; setup precedes features; new users can install, authenticate, select a model, and run; all package docs reachable; npm presentation valid; feature claims match code.

## Task 2: Give component READMEs personality without losing the manual

**Context:** A package README is both an independent npm entry point and the detailed reference linked from the suite. Earlier edits removed useful configuration instructions and security caveats. A warmer voice must not reduce its usefulness.

**Modify:**
- `packages/core/README.md`
- `packages/footer/README.md`
- `packages/diff/README.md`
- `packages/image-paste/README.md`
- `packages/subagent/README.md`
- `packages/todo/README.md`
- `packages/ask/README.md`
- `packages/notify/README.md`
- `packages/session-name/README.md`
- `packages/mcp/README.md`
- `packages/sudo/README.md`

**Structure:** Package name → short benefit-led opening → install (before any screenshots) → concrete usage → settings/reference/caveats → related suite features.

**Opening directions:** Core: a terminal worth spending your day in. Footer: session details without scrolling. Diff: see what changed. Image-paste: show the screenshot rather than describing it. Subagent: give your agent some backup. Todo: keep the plan in view. Ask: keep the decisions, delegate the work. Notify: step away without losing track. Session-name: find the session you meant. MCP: bring the tools you already use. Sudo: a little more care with root access. These are directions, not jokes to force verbatim into every header.

**Steps:**
- [ ] Read each README, its relevant source from the fact table, and the pre-PR version. List omissions/inaccuracies before rewriting.
- [ ] Give each a distinct short introduction in the approved voice; no repeated “development cockpit” paragraphs, exaggerated friction claims, or unnecessary emojis.
- [ ] Include standalone install, launch/reload instruction, a clearly labelled optional global Pi install command, Node requirement or shared setup link, and `/login`/`/model` guidance via the root setup link. Present suite installation as an alternative, not a second required installation. Use absolute links/assets for npm.
- [ ] Retain or restore all useful source-backed reference material identified in the fact table. Especially preserve agent-file format/local config, `manage_todo_list` full-list replacement semantics, ask multi-select/custom answers, image markers/on-submit previews, notification cancellation, session naming cost, and sudo limitations.
- [ ] Make MCP quick start prefer `/mcp setup`. If showing `.mcp.json`, use a JSON example to merge deliberately, not `cat > .mcp.json` which can overwrite existing server settings. Retain command, settings, config precedence, auth, and reserved-field reference below the quick start.
- [ ] Label JSON versus JSONC accurately and ensure examples match source field types. Don't advertise `async` as working; describe parallel tasks without claiming main-agent fire-and-forget. Show a config-less dispatch example and a complete agent Markdown example before using named agents in examples.
- [ ] Correct suite-only command/settings references and standalone diff fixed-default behavior. Explain cross-package integrations as requiring the relevant loaded components, without inventing exclusivity to meta.
- [ ] Read each resulting page as a newcomer, then as someone looking for a specific setting. Check setup order, links, and factual qualifications. Run `git diff --check`.
- [ ] Commit: `chore: refresh component copy and restore practical reference details`.

**Acceptance:** All eleven pages are independently useful and consistent in voice. Setup precedes screenshots. Existing valid technical documentation is preserved. No package falsely claims suite-only tools or unsupported behavior.

## Task 3: Verify presentation and packaging, then update PR #49

**Context:** Type checks cannot catch misleading copy or npm links. Check the actual docs and package contents as well as repository health. Do not claim to have published anything.

**Modify:** `docs/plans/plan-035-readme-copy.md`, `docs/plans/README.md` at completion; any documentation corrections should be committed with the relevant logical task.
**Read:** `package.json`, `meta/package.json`, `.github/workflows/release.yml`, all thirteen READMEs, `AGENTS.md`.

**Steps:**
- [ ] Review the complete PR diff against its base, not just the latest commit. Have a reviewer check the new docs against code for regressions and unsupported claims. Display findings in chat, not inside `ask`.
- [ ] Validate every local link and fragment against the current tree; validate raw image paths against `docs/images/`. For npm docs, reject relative links that escape the package. Check the package table includes eleven real names and installation commands; inspect heading/anchor rendering and fenced examples. A temporary checker is acceptable; don't add a build/docs framework for this task.
- [ ] Compare root/meta user-facing sections after normalising link destinations to prevent accidental drift. Open/render Markdown if the available tooling supports it; otherwise report that visual rendering was not checked rather than claiming it was.
- [ ] Run `git diff --check` and parse `meta/package.json` as JSON.
- [ ] Following the repository's verification order, run `npx tsc --noEmit` separately in each component directory and `meta`, waiting for each result. Do not use concurrent `pnpm -r exec` for this check. Inspect and report failures; fix only issues caused by the permitted documentation/metadata edits. If a fix requires runtime source, dependency, test, or compiler-config changes, report BLOCKED and leave it for separately authorized work. If a check fails twice without intervening edits, report BLOCKED.
- [ ] Run `pnpm test` separately after type checks. Report actual counts/warnings; do not reuse earlier test results or claim coverage for suites the workspace excludes.
- [ ] From `meta/`, run `pnpm pack --pack-destination <fresh temporary directory>` (pnpm 10 has no `pack --dry-run`). Inspect the archive with `tar -tzf` and `tar -xOf`: confirm nonempty `package/README.md`, the intended description, and dependencies rewritten without `workspace:*`. Do not extract into the repository or run any publish/install command.
- [ ] From each component directory, use `pnpm pack --pack-destination <fresh temporary directory>` and confirm its archive contains a nonempty `package/README.md`. Record evidence without leaving archives in the working tree.
- [ ] When changes are verified, mark this plan and its index entry COMPLETED per repository convention; update index counts. Commit: `chore: complete the README copy revision plan`.
- [ ] Push only `feature/improve-readmes` to update existing PR #49. Replace the stale PR body (which still uses the rejected marketing jargon) with a short factual summary and fresh checks. Include rendered branch links to root README and `meta/README.md` so the user can read them without a diff.
- [ ] Do not merge, tag, bump versions, publish, or open a replacement PR. Confirm the PR's remote head matches the pushed commit and report the link.

**Acceptance:** Reviewable updated PR #49; all thirteen README files packaged/readable as appropriate; accurate fresh verification report; user can inspect rendered docs; no runtime changes or publication.
