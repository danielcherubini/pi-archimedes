# Pi 0.84.4 Sync Plan

**Goal:** Bring the repo up to date with Pi 0.84.4: re-base notify on pi-native lifecycle events (`agent_settled`, `ui_prompt_start`), delete the stale `Theme.fg` any-cast workaround in image-paste, and raise the pi dev type-check floor to 0.84.4.

**Architecture:** Two behavioral changes, both in favor of pi's own event system. notify's "task complete" trigger moves from `agent_end` to `agent_settled` (fires only when no queued follow-up/compaction will still run), and its "question needs your answer" trigger moves from the bus `ASK_REQUEST` event to `ui_prompt_start` (fires in the parent around *every* blocking extension prompt: ask direct and subagent-relayed, sudo password prompt + confirm, mcp OAuth loader). The bus event itself is untouched — it remains ask↔subagent transport. image-paste's renderer drops its `as any` cast now that `Theme.fg` is typed in pi 0.84.4's exported `Theme` class.

**Tech Stack:** TypeScript (`.ts` loaded at runtime by pi's jiti loader, no build step), vitest, pnpm workspace. Design authority: approved spec from 2026-08-28 discussion; `docs/adr/0013-notify-on-pi-native-events.md`; terms "settled wait" / "UI-prompt wait" in `CONTEXT.md`.

**Scope guard:** NO version bump of the shared package version (stays 2.4.0), NO git tag, NO publish, NO release notes. This plan ends at merged-ready commits on the branch. No footer waiting-indicator, no RPC `clear_queue` usage, no terminal capability overrides — all audited and rejected (see ADR 0013 and repo audit).

---

### Task 1: Bump pi dev floor to 0.84.4

**Context:** Tasks 2 and 3 use type-level surfaces from the newer pi release. Task 2's `ui_prompt_start` handler is strictly floor-dependent — the event and its `on()` overload exist only in 0.84.4 (verified absent from 0.84.2's type definitions), so that task cannot type-check without this bump. Task 3's `Theme.fg` is already typed at the current 0.84.2 floor; the refactor rides along with the same floor for consistency across the earendil-works release family (pi-ai included). This task raises the *devDependencies* (the `tsc --noEmit` type-check floor) of every workspace package so the rest of the plan type-checks. Peer dependencies stay exactly as they are except in Task 2 (notify) — the other 11 packages' new call sites are runtime-safe on older pi (`pi.on` is a plain handler map; `theme.fg` is a long-standing runtime method; only its typing is new).

**Files:**
- Modify: `packages/core/package.json`, `packages/ask/package.json`, `packages/footer/package.json`, `packages/diff/package.json`, `packages/image-paste/package.json`, `packages/mcp/package.json`, `packages/notify/package.json`, `packages/session-name/package.json`, `packages/subagent/package.json`, `packages/sudo/package.json`, `packages/todo/package.json`, `meta/package.json`
- Modify (pi-ai entry only): `packages/session-name/package.json`, `packages/subagent/package.json`, `packages/todo/package.json`

**What to implement:**
In each of the 12 files above, under `devDependencies`, change:
- `"@earendil-works/pi-coding-agent": "^0.84.2"` → `"@earendil-works/pi-coding-agent": "^0.84.4"`
- `"@earendil-works/pi-tui": "^0.84.2"` → `"@earendil-works/pi-tui": "^0.84.4"`

Both entries exist in every one of the 12 files (verified). In the three files that additionally carry a pi-ai devDep — `packages/session-name/package.json`, `packages/subagent/package.json`, `packages/todo/package.json` — also change:
- `"@earendil-works/pi-ai": "^0.84.2"` → `"@earendil-works/pi-ai": "^0.84.4"`

The other 9 files have no pi-ai entry. Do NOT touch `peerDependencies`, `dependencies`, workspace versions, or any other field.

**Steps:**
- [ ] Edit all 12 `package.json` files as above, including the `pi-ai` entry in the three files that have it
- [ ] Run `pnpm install` from the repo root
  - Did it succeed and update `pnpm-lock.yaml`? If not, fix and re-run.
- [ ] Run `npx tsc --noEmit` in each of the 11 `packages/*` directories and in `meta` (0.84.4 changed some type definitions — surfaces could appear as unrelated-package errors)
  - If any check fails: read the error, read the relevant file, fix, re-run. Loop-break: if a check fails twice without edits between, stop and report BLOCKED.
- [ ] Commit with message: `chore: bump pi dev floor to 0.84.4` (include the 12 package.json files + pnpm-lock.yaml)

**Acceptance criteria:**
- [ ] `grep -rn '"@earendil-works/pi-\(coding-agent\|tui\|ai\)": "\^0\.84\.2"' packages/*/package.json meta/package.json` returns nothing
- [ ] All 12 `npx tsc --noEmit` runs pass
- [ ] One commit containing only the floor bump

---

### Task 2: Re-base notify on pi-native lifecycle events

**Context:** Today `packages/notify` fires "Task complete — waiting for input" on `pi.on("agent_end", …)` and "A question needs your answer" on a bus listener `getBus().on(Events.ASK_REQUEST, …)`. Two problems: (1) `agent_end` can fire while the run is *not* actually done — pi may still run queued continuations or compaction behind it; `agent_settled` (exists since pi 0.80.4) fires only when the run has fully settled, which is what the notification promises; (2) the bus listener covered only ask questions, and only consumed a nursery event the ask package emitted. Pi 0.84.4's `ui_prompt_start` extension event fires in the parent process around *every* blocking `ctx.ui` prompt (ask direct, ask relayed from a subagent, sudo password prompt + confirm dialog, mcp OAuth loader), so it is a strict superset. Design: ADR 0013. Replace, do not layer — the bus fallback is deliberately rejected (a 0.84.3 user would silently have no question notifications even for ask, which ask keeps on its own path anyway; see ADR "considered and rejected").

Config keys `notifyOnAgentEnd` and `notifyOnQuestion` keep their names and semantics. Notification copy ("Task complete — waiting for input" / "A question needs your answer") is unchanged. Cancel mechanics are unchanged.

**Files:**
- Modify: `packages/notify/src/index.ts`
- Modify: `packages/notify/src/default-export.test.ts`
- Modify: `packages/notify/package.json` (peer floor only)
- Modify: `packages/notify/README.md`
- Modify: `README.md` (root — the notify section bullet)
- Modify: `docs/plans/README.md` (plan 033 tracking row + Quick Stats)
- Commit (already written, currently untracked or with uncommitted edits): `docs/plans/plan-033-pi-0844-sync.md`, `docs/adr/0013-notify-on-pi-native-events.md`, `CONTEXT.md`

**What to implement:**

1. `packages/notify/src/default-export.test.ts` — in the existing `arrayContaining` assertion for the registered events, replace `"agent_end"` with `"agent_settled"` and add `"ui_prompt_start"` to the list. Do not change the rest of the test.

2. `packages/notify/src/index.ts`:
   - Trigger constants (lines ~10–11): change
     ```ts
     const TRIGGER = {
       AGENT_END: "agent_end",
       ASK_REQUEST: "ask_request",
     } as const;
     ```
     to
     ```ts
     const TRIGGER = {
       AGENT_SETTLED: "agent_settled",
       UI_PROMPT: "ui_prompt",
     } as const;
     ```
     This enum is internal (never persisted, never exposed). Update the two references in `scheduleNotify()` (`trigger === TRIGGER.AGENT_END` → `trigger === TRIGGER.AGENT_SETTLED`, gated by `config.notifyOnAgentEnd`; `trigger === TRIGGER.ASK_REQUEST` → `trigger === TRIGGER.UI_PROMPT`, gated by `config.notifyOnQuestion`) and the references in `fireNotification()` (the `AGENT_*` comparison chooses "Task complete — waiting for input", everything else "A question needs your answer" — copy stays verbatim).
   - Delete the import line `import { getBus, Events } from "@pi-archimedes/core/bus";` (keep the `@pi-archimedes/core/settings-io` import — it is still used).
   - In `registerNotify()`, replace
     ```ts
     pi.on("agent_end", () => scheduleNotify(TRIGGER.AGENT_END));
     ```
     with
     ```ts
     pi.on("agent_settled", () => scheduleNotify(TRIGGER.AGENT_SETTLED));
     ```
     and delete the whole bus block
     ```ts
     // Listen for ask requests from the bus (ask package emits this)
     const unsubAskRequest = getBus().on(Events.ASK_REQUEST, () =>
       scheduleNotify(TRIGGER.ASK_REQUEST),
     );
     ```
     replacing it with, alongside the other `pi.on` registrations at the top of `registerNotify()`:
     ```ts
     // Any blocking extension UI prompt (ask, sudo, mcp OAuth) — fires in the
     // parent process for direct and subagent-relayed prompts alike.
     pi.on("ui_prompt_start", (_event) => scheduleNotify(TRIGGER.UI_PROMPT));
     ```
   - Do NOT add a `ui_prompt_end` listener, do NOT touch `agent_start`/`before_agent_start`/`input`/`onTerminalInput`/`session_shutdown` handlers, do NOT put `event.title` into the notification copy, do NOT filter by `event.kind`.

3. `packages/notify/package.json` — under `peerDependencies` ONLY: `"@earendil-works/pi-coding-agent": ">=0.1.0"` → `"@earendil-works/pi-coding-agent": ">=0.84.4"`. Leave the `pi-tui` peer and all devDeps at their Task-1 values. This is the one package whose behavior depends on an event missing below the floor (ADR 0013).

4. `packages/notify/README.md` — fix the three now-false "bus-driven" claims:
   - "What you get" bullet: replace `**Bus-driven** — listens for `agent_end` and `ASK_REQUEST` bus events, so it works with any package that emits them` with `**Pi-native triggers** — keyed on pi's `agent_settled` and `ui_prompt_start` lifecycle events, so task completion works and *any* blocking extension prompt (ask, sudo, mcp OAuth) can hold your attention`
   - "Usage" paragraph: replace `When the agent finishes a task (`agent_end`) or a question is asked (`ASK_REQUEST`)` with `When the agent's run has settled (`agent_settled`) or an extension opens a blocking prompt (`ui_prompt_start` — ask, sudo, mcp OAuth)`
   - "Integration" paragraph's closing sentence: replace `any package emitting `agent_end` or `ASK_REQUEST` bus events will trigger notifications` with `any blocking extension UI prompt will trigger the question notification`

5. `README.md` (root), notify section: replace the bullet `- Delayed notification on task complete or unanswered questions` with `- Delayed notification on settled tasks or when any extension prompt (ask, sudo, mcp OAuth) needs your attention`

6. Plan tracking (required by AGENTS.md): plan authoring already set up the tracking, and the plan file itself (`docs/plans/plan-033-pi-0844-sync.md`) is untracked by default — it must be committed. `docs/plans/README.md` was already updated when this plan was written: a row for plan 033 ("Pi 0.84.4 sync", status `IN PROGRESS`) in the `## Backlog` table plus `Quick Stats` at `Total Plans: 33` / `In Progress: 1`. Verify that row and stats are present (restore them if anything removed them); they must be part of the docs commit from the Steps section. The plan file, this README, the ADR, and `CONTEXT.md` ride together into ONE docs commit.

**Steps:**
- [ ] Edit `packages/notify/src/default-export.test.ts` as in step 1 above
- [ ] Run `pnpm vitest run packages/notify`
  - Did it FAIL with a missing `agent_settled` / `ui_prompt_start` assertion? If it passed unexpectedly, stop and investigate why.
- [ ] Edit `packages/notify/src/index.ts` as in step 2 above
- [ ] Run `pnpm vitest run packages/notify`
  - Did all tests pass? If not, fix the failures and re-run before continuing.
- [ ] Run `npx tsc --noEmit` in `packages/notify`
  - Did it succeed? If not (e.g. a leftover `TRIGGER.AGENT_END` reference), fix and re-run.
- [ ] Edit the remaining files as in steps 3–5: the peer in `packages/notify/package.json`, `packages/notify/README.md`, the root `README.md`; verify the plan-tracking row/stats in `docs/plans/README.md` are present (step 6).
- [ ] Run `pnpm vitest run packages/notify` to confirm still green
- [ ] Build the docs commit (ADR 0013 + glossary + plan tracking ride together; skip a path only if `git status` shows it already clean — normally all four participate: ADR untracked, `CONTEXT.md` modified, plan file untracked, `docs/plans/README.md` modified):
  `git add docs/adr/0013-notify-on-pi-native-events.md CONTEXT.md docs/plans/plan-033-pi-0844-sync.md docs/plans/README.md && git commit -m "docs: ADR 0013 + glossary + plan 033 — notify on pi-native events"`
- [ ] Commit the feature: `git add packages/notify/src/index.ts packages/notify/src/default-export.test.ts packages/notify/package.json packages/notify/README.md README.md && git commit -m "feat(notify): key triggers on pi-native agent_settled / ui_prompt_start"`

**Acceptance criteria:**
- [ ] `grep -n "getBus\|ASK_REQUEST\|agent_end" packages/notify/src/index.ts` returns nothing
- [ ] `grep -n "agent_settled\|ui_prompt_start" packages/notify/src/index.ts` shows both registrations
- [ ] Notification copy strings are byte-identical to before ("Task complete — waiting for input", "A question needs your answer")
- [ ] `pnpm vitest run packages/notify` green; `npx tsc --noEmit` green in `packages/notify`
- [ ] `packages/notify/package.json` peer says `">=0.84.4"` for pi-coding-agent and `">=0.1.0"` for pi-tui
- [ ] Two commits: docs, then feature

---

### Task 3: Typed `Theme.fg` in image-paste + full-suite verification

**Context:** `packages/image-paste/src/preview.ts` carries a workaround written against an older pi where `Theme.fg` was not in the type definition:
```ts
// Theme.fg is runtime-available but not exposed in the Theme type definition
const fg = (theme as any).fg?.bind(theme) as ((color: string, text: string) => string) | undefined;
if (!fg) return undefined;
```
Pi 0.84.4 exports the `Theme` class with `fg(color: ThemeColor, text: string): string` typed (see `dist/modes/interactive/theme/theme.d.ts`) and the renderer's `theme` parameter is that class. The method has always existed at runtime, so this is a pure type-cleanup: call it directly, keep the renderer's existing `try/catch → undefined` guard as the runtime safety net. Then run the full verification sweep for the whole plan.

**Files:**
- Modify: `packages/image-paste/src/preview.ts`

**What to implement:**

In `packages/image-paste/src/preview.ts`, inside `registerImagePreview`'s renderer:
- Delete the comment line, the `const fg = (theme as any).fg?.bind(theme) ...` declaration, and the `if (!fg) return undefined;` guard (the whole block at the top of the `try`, lines 15–17).
- The `Image` child becomes:
  ```ts
  container.addChild(
    new Image(item.data, item.mimeType, {
      fallbackColor: (text: string) => theme.fg("toolOutput", text),
    }, {
      maxWidthCells: 60,
    }),
  );
  ```
- `"toolOutput"` is a valid `ThemeColor` member. Keep the `try { … } catch { return undefined; }` wrapper and everything else in the file untouched.

There is no behavioral change, so there is no new failing test to write; the existing export test and the type-checker are the verification of this refactor.

**Steps:**
- [ ] Edit `packages/image-paste/src/preview.ts` as above
- [ ] Run `npx tsc --noEmit` in `packages/image-paste`
  - Did it succeed? If not (e.g. a remaining `fg` reference or a typing surprise from 0.84.4), read the error, read the file, fix, re-run. Loop-break: two fails without edits → stop and report BLOCKED.
- [ ] Run `pnpm vitest run packages/image-paste`
  - Did it pass? If not, fix and re-run.
- [ ] Final sweep for the whole plan — run INDEPENDENTLY, waiting for each:
  - `npx tsc --noEmit` in every one of the 11 `packages/*` directories and in `meta` (12 runs)
  - `pnpm test` from the repo root (vitest, entire suite)
  - If anything fails: fix, then re-run only the failed check plus this final line — do not report success until both are green.
- [ ] Commit with message: `refactor(image-paste): use typed Theme.fg, drop any-cast workaround`

**Acceptance criteria:**
- [ ] `grep -n "as any\|\.fg?.bind" packages/image-paste/src/preview.ts` returns nothing
- [ ] `grep -n 'theme.fg("toolOutput", text)' packages/image-paste/src/preview.ts` matches
- [ ] All 12 tsc runs and `pnpm test` green at the repo root
- [ ] Exactly four commits from this plan on the branch (Task 1 floor bump; Task 2 docs commit + notify feat commit; Task 3 image-paste)
