---
status: committed
issue: #154
done-when: `gh workflow run ci.yml` on the fix branch turns the `pi-latest` job green (the whole suite type-checks against `@earendil-works/pi-*@latest`), `typecheck` against the pinned train stays green, and no package in the suite takes `Type` or `Static` from `@earendil-works/pi-ai` any more.
---

# todo schema: stop taking typebox symbols from pi-ai (issue #154)

**Goal:** Make `packages/todo` compile against `@earendil-works/pi-ai@latest` by importing `Type`/`Static` from `typebox` directly, the way the suite's four other schema-bearing packages already do.

**Architecture:** pi 1.5.0 stopped re-exporting typebox (`export type { Static, TSchema } from "typebox"` / `export { Type } from "typebox"` were deleted from `dist/index.d.ts`; `typebox` was dropped from its dependencies in favour of a new `@earendil-works/pi-schema`). Only `packages/todo/src/tool.ts` imported `Static`/`Type` through pi-ai, so it is the only file that broke; `ask`, `sudo`, `subagent` and `web` import `typebox` directly and were unaffected. We port `todo` to the sibling idiom and hand-roll the one pi-ai-only helper (`StringEnum`) that it also used.

**Tech Stack:** TypeScript with `verbatimModuleSyntax`, typebox 1.x (declared as peer `>=1.1.0` + dev `^1.1.38` in `packages/todo`), pnpm workspace, vitest, GitHub Actions (`ci.yml`: `typecheck` + `pi-latest`).

---

## Facts this plan is built on

All verified against **`origin/main` = `0a72cbf`** (the execution base). The local checkout's `main` is at `a601dfe`, **7 commits behind**, where the pi pins still read `1.2.0`; on `origin/main` commit `bd787d9` bumped all 13 manifests' pi dev-pins to **`1.4.0`**. Task 1 Step 1 creates the branch from `origin/main`, not from the stale local `main`.

- `packages/todo/src/tool.ts:1` (origin/main, verbatim):
  `import { type Static, StringEnum, Type } from "@earendil-works/pi-ai";`
  `StringEnum` is used at lines 15, 24, 54, 60; `Static<` at line 34 (`export type ManageTodoListInput = Static<typeof ManageTodoListParams>;`); `Type.Array` at line 62 (`todos: Type.Array(TodoItemOutputSchema)`).
- `packages/ask/src/tool.ts:2` — the reference idiom, verbatim: `import { Type, type Static } from "typebox";`
- `packages/todo/src/tool.output-schema.test.ts:18` already imports `import { Value } from "typebox/value";` and calls `Value.Check(tool.outputSchema as never, value)` — the test is **already typebox-native**. It is not touched by this plan; it passing unmodified after the port is itself the regression signal.
- `packages/todo/package.json` (origin/main) declares `typebox` as peer `">=1.1.0"` and dev `">=1.1.38"`-style `^1.1.38`, and `@earendil-works/pi-ai` as peer `">=0.99.0"` / dev `"1.4.0"`. **No manifest change is needed for Task 1** — therefore **no `pnpm-lock.yaml` regeneration** is needed for Task 1 (ADR 0026 only requires the lockfile in the same commit as a *range* change).
- **No package in the suite ships typebox as a runtime `dependency`** — it is peer + dev everywhere; the runtime copy comes transitively from pi's own tree. `StringEnum` exists **only** in pi-ai (never in typebox 1.3.27), so it cannot simply be re-pointed at `typebox`.
- `@earendil-works/pi-schema` is referenced by **zero** manifests today. Deliberately not adopted here — see Rejected alternatives.
- `docs/roadmap/` holds one other live plan, `working-indicator-ownership.md` (`status: committed`, issue #147). It owns `packages/ui/src/index.ts` and `docs/features/ui.md`; nothing in this plan touches either.

---

## Parallelisation

**Verdict:** SERIAL — Task 2 dispatches CI against Task 1's pushed branch, Task 3 rewrites the shared `pnpm-lock.yaml` (gate 3: shared mutable artifact) which is exactly what Task 2's dispatch compiles, and Task 4's wording depends on whether Task 3 removes a peer. No two tasks have both disjoint files and independent provability.

---

### Task 1: Port `packages/todo/src/tool.ts` to typebox-direct

**Parallel:** none — serial chain; Task 2 verifies this branch, Task 3 edits this package's manifest.

**Context:** `todo` is the only one of the suite's five schema-bearing packages that obtains `Type`/`Static` by re-export through `@earendil-works/pi-ai`. pi 1.5.0 deleted those re-exports, so the pinned `typecheck` job (1.4.0) stays green while the scheduled `pi-latest` drift detector is red with `error TS2305: Module '"@earendil-works/pi-ai"' has no exported member 'Static'` / `'Type'`. The fix is parity with the four siblings, not a new abstraction. `StringEnum` was pi-ai's own convenience helper (`packages/todo/src/tool.ts` is its only use anywhere in the repo), so it moves in as a local helper that produces the identical JSON Schema.

**Files:**
- Modify: `packages/todo/src/tool.ts`
- Test: `packages/todo/src/tool.test.ts` (add both new guards — runtime and compile-time)
- Test: `packages/todo/src/tool.output-schema.test.ts` (**not modified** — it already does `Value.Check(tool.outputSchema as never, …)`, so it passing untouched after the port is the regression signal)

**What to implement:**

1. Replace the import on line 1 with two lines, matching the sibling idiom:
   ```ts
   import { StringEnum } from "@earendil-works/pi-ai";   // DELETE this symbol
   ```
   becomes
   ```ts
   import { Type, type Static } from "typebox";
   ```
   i.e. after the change line 1 imports `Type` and `type Static` from `"typebox"` and **nothing** is imported from `"@earendil-works/pi-ai"` by this file. Keep `type` on `Static` — `verbatimModuleSyntax` is on and a value import of a type-only symbol will fail.

2. Add a module-local `StringEnum` helper immediately above the first schema that uses it (`TodoItemSchema`, line ~11), with an inferred return type (do **not** annotate the return type — that is what keeps `TUnsafe` out of the import list):
   ```ts
   /**
    * pi-ai shipped this helper; typebox has no equivalent, and pi 1.5.0 dropped
    * pi-ai's typebox re-exports, so the suite no longer takes schema symbols from
    * the host. Emits the identical JSON Schema: { type: "string", enum: [...] }.
    * pi-ai's version also accepted a `default`; no caller here does, so it is not
    * carried.
    */
   function StringEnum<T extends readonly string[]>(
     values: readonly [...T],
     options?: { description?: string },
   ) {
     return Type.Unsafe<T[number]>({
       type: "string",
       enum: [...values],
       ...(options?.description ? { description: options.description } : {}),
     });
   }
   ```
   `Type.Unsafe<T[number]>(schema)` is how pi-ai implemented it, and because the return type is inferred, nothing needs to import typebox's `TUnsafe`. `Static<T>` is declared as `T extends TUnsafe<infer Type> ? Type : …`, so `Static<typeof ManageTodoListParams>` keeps producing the narrow string union — **verify that**, do not assume it (see the step below). **Do not** switch this to `Type.Union(values.map(Type.Literal))` — mapping over `readonly string[]` widens the literals to `string` and silently degrades `ManageTodoListInput` from a union to `string`, which no test in this package would catch.

   The four call sites on `origin/main` are lines 15 (`status`, with `{ description }`), 24 (`operation`, with `{ description }`), 54 (`status`, no options) and 60 (`operation`, no options). The `description` option **is** used by two of them, so keep it. The `default` option is used by **none** — do not carry it (deliberate divergence from pi-ai's signature, recorded in the comment above).

3. Leave every schema definition (`TodoItemSchema`, `ManageTodoListParams`, the output schema around lines 54–63, including `todos: Type.Array(TodoItemOutputSchema)`) and every `Static<>`-derived type **textually unchanged**. Only the import source and the helper's home move. If `Static<typeof ManageTodoListParams>` resolves differently after the switch, that is a finding to stop on, not something to paper over with a cast.

4. What **not** to change: `packages/todo/src/tool.output-schema.test.ts` (its `Value` import and its `tool.outputSchema as never` cast stay exactly as they are), `packages/todo/package.json` (Task 3 owns it), `pnpm-lock.yaml`, `@types/node` (held at `22.19.19` — see AGENTS.md), and the pi dev-pins (`"1.4.0"` exact).

**Steps:**
- [ ] Create the work base from the remote tip, not the stale local `main`: `git fetch origin && git switch -c fix/todo-schema-typebox-parity origin/main` in `/home/daniel/Coding/Javascript/pi-archimedes`. Confirm `git rev-parse HEAD` = `0a72cbf…` and that `packages/todo/package.json` shows pi dev-pins of `1.4.0`.
  - Note: this plan doc was committed to local `main` as `b4fcb8e` so it survives; that commit is **not** on `origin/main`, so the file will not be present on the fresh branch. That is fine — Task 4 re-adds it at ship time. Do not cherry-pick `b4fcb8e` onto the fix branch.
- [ ] Write the guards first, in `packages/todo/src/tool.test.ts` (so `packages/todo/src/tool.output-schema.test.ts` stays untouched — its existing `Value.Check` assertions passing unchanged is the regression signal). Two guards, both added **before** the port:
  1. **Runtime:** the emitted schema must still reject an out-of-vocabulary enum value. Import `Value` from `"typebox/value"` and assert `expect(Value.Check(ManageTodoListParams, { operation: "nope" })).toBe(false)` and that a valid `{ operation: "read" }` still checks `true`.
     - Run `cd packages/todo && npx vitest run src/tool.test.ts`. This **passes** before the change — expected, it is a parity guard, not a bug repro. Its job is to go red if the port drops the `enum` keyword.
  2. **Compile-time:** a widened union is invisible to every runtime test in this package, so prove narrowness at the type level too, using `ManageTodoListInput` (`packages/todo/src/tool.ts:34`, `Static<typeof ManageTodoListParams>`, whose `operation` comes from a `StringEnum`):
     ```ts
     const good: ManageTodoListInput = { operation: "read" };
     // @ts-expect-error "nope" is not a member of the operation union
     const bad: ManageTodoListInput = { operation: "nope" };
     void good; void bad;
     ```
     Run `cd packages/todo && npx tsc --noEmit`. Expect success **with** the `@ts-expect-error` present. An **"Unused '@ts-expect-error' directive"** error is the failure signal here, not a lint nit — it means the port widened the union to `string`.
- [ ] Apply the import swap and the local `StringEnum` helper in `packages/todo/src/tool.ts` as specified above.
- [ ] Run `cd packages/todo && npx tsc --noEmit`.
  - Expect success. `TS2305` on `Static`/`Type` means the import swap was incomplete; a widened `string` where a union was expected means the helper was written with `Type.Union`/`map` — go back to `Type.Unsafe`.
- [ ] Run `cd packages/todo && npx vitest run`. Expect the same pass count as before the change (the CI run on `adc20a53` reported 2532 tests suite-wide; this package's own count must not drop).
- [ ] Run the full type-check the way CI does: `pnpm -r exec -- tsc --noEmit` from the repo root. Expect success.
- [ ] Run `pnpm test` from the repo root. Expect success.
- [ ] Confirm no lockfile churn: `git status --porcelain` must list **only** `packages/todo/src/tool.ts` and `packages/todo/src/tool.test.ts`. If `pnpm-lock.yaml` or `packages/todo/src/tool.output-schema.test.ts` appears, something overreached — revert it (the output-schema test is not this plan's to touch; a manifest edit is Task 3's job).
- [ ] Commit on the branch: `fix(todo): take Type/Static from typebox, not pi-ai re-exports (#154)`
- [ ] `git push -u origin fix/todo-schema-typebox-parity`

**Acceptance criteria:**
- [ ] `packages/todo/src/tool.ts` contains no `from "@earendil-works/pi-ai"` import.
- [ ] `grep -rn "Static\|Type" packages/*/src/*.ts packages/*/src/**/*.ts | grep '@earendil-works/pi-ai'` returns nothing repo-wide.
- [ ] `cd packages/todo && npx tsc --noEmit` and `pnpm -r exec -- tsc --noEmit` both succeed against the pinned 1.4.0.
- [ ] `packages/todo/src/tool.output-schema.test.ts` is **byte-identical** to `origin/main` and still passes.
- [ ] `packages/todo/src/tool.test.ts` carries both guards, and `tsc` does **not** report an unused `@ts-expect-error`.
- [ ] `pnpm-lock.yaml` untouched in this commit.

---

### Task 2: Prove the whole suite against `pi@latest` via `workflow_dispatch`

**Parallel:** none — runs on Task 1's pushed branch; nothing to fan out.

**Context:** Task 1 fixes the one symbol we know about. The rest of the pi-ai surface was read off published `.d.ts` tarballs, not compiled: `packages/subagent` (`import type { Usage }`), `packages/session-name` (`clampThinkingLevel`, `ModelThinkingLevel`, `ThinkingLevel`, and `thinkingBudgetForLevel` from the `@earendil-works/pi-ai/api/simple-options` subpath) and `packages/ui` all declare pi-ai but were **not** verified against 1.5.0 by a real compile. `pnpm update -r` mutates `pnpm-lock.yaml`, so this cannot be proven in a local checkout — the sanctioned reproduction is the `pi-latest` job itself, which is gated to `schedule`/`workflow_dispatch` precisely so it cannot turn a PR red for a reason the author cannot fix. This task is the authoritative whole-surface proof.

**Files:**
- Modify: `packages/todo/src/tool.ts` **only if** the compiler surfaces a second offender; otherwise no file changes (this task's output is a verified CI result).

**What to implement:** Trigger the drift detector on the branch and read its verdict. If it finds more than `todo`, fix each offender the same way (sibling idiom, no new abstraction) in follow-up commits on the same branch and re-dispatch, until green or a genuine upstream blocker is proven.

**Steps:**
- [ ] Dispatch: `gh workflow run ci.yml --repo danielcherubini/pi-archimedes --ref fix/todo-schema-typebox-parity`
- [ ] Find the run: `gh run list --repo danielcherubini/pi-archimedes --branch fix/todo-schema-typebox-parity --workflow ci.yml --limit 3 --json databaseId,status,conclusion,jobsCount`
- [ ] Poll to terminal, then read **both** jobs separately: `gh run view <run-id> --json jobs --jq '.jobs[] | {name,conclusion}'`.
  - `typecheck` green **and** `pi-latest` green = done.
  - `pi-latest` red with a `TS2305`/`TS2307` naming another file → `gh run view <run-id> --log-failed`, apply the same port in that file, commit (`fix(<pkg>): take <symbol> from typebox, not pi-ai re-exports (#154)`), push, re-dispatch. Loop.
  - `pi-latest` red on a symbol with **no** typebox-direct equivalent (a genuinely removed host API, e.g. `clampThinkingLevel` or the `api/simple-options` subpath disappearing) → **STOP**, do not improvise a replacement. Report BLOCKED with the exact error and the file:line; that is a new issue, not this plan.
  - `typecheck` red while `pi-latest` is green → the port broke the pinned train. Revert to Task 1 and fix there; do not "fix" it by touching the pins.
- [ ] Record the run URL and both job conclusions for the PR body / issue comment.

**Acceptance criteria:**
- [ ] A `workflow_dispatch` run on the branch shows `typecheck: success` **and** `pi-latest: success`.
- [ ] No pi dev-pin, `@types/node` version, or `pnpm-lock.yaml` entry changed in order to get there.
- [ ] `pi-latest` remains `SKIPPED` on the PR itself — that is correct by design, not a failure.

---

### Task 3: Drop `todo`'s now-unused `@earendil-works/pi-ai` declarations

**Parallel:** none — rewrites the shared `pnpm-lock.yaml` (gate 3) and edits the manifest Task 1's package owns.

**Context:** ADR 0026's rule is that a peer floor is "the oldest published train whose declarations provide every host symbol the shipped code touches at runtime", and peer ranges are never installed or solved — so a peer for a package the shipped code no longer imports is a floor that asserts nothing true. After Task 1, `packages/todo` may import nothing from `@earendil-works/pi-ai` at all, in which case its pi-ai peer `>=0.99.0` and dev-pin `"1.4.0"` are dead declarations. This task is conditional and **must verify before deleting** — if anything else in `packages/todo` still touches pi-ai, the declarations stay and the task is a no-op that reports that fact.

**Files:**
- Modify: `packages/todo/package.json` (conditional)
- Modify: `pnpm-lock.yaml` (regenerated in the same commit as any manifest change — ADR 0026)

**What to implement:**

1. Check for remaining reachability, including tests (they are type-checked: every package tsconfig is `include: ["src"]` with no `*.test.ts` exclude):
   `grep -rn "@earendil-works/pi-ai" packages/todo/ --include='*.ts' --include='*.json'`
2. Check the runtime support guard before deleting anything: `grep -rn "reportPiSupport" packages/todo/src/`. `reportPiSupport(pkg, min)` (`packages/core/src/pi-support.ts`) is the only mechanism that can actually warn a user, and it takes a floor argument. If `todo` calls it, the floor it passes is a **separate** decision from the manifest peer and must not be edited here — record what it passes and leave it.
3. If **and only if** step 1 returns no `.ts` hits: remove `"@earendil-works/pi-ai"` from `packages/todo`'s `peerDependencies` and `devDependencies`. Leave `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui` (both `"1.4.0"` dev, `">=0.99.0"` peer) and `typebox` (`">=1.1.0"` peer / `"^1.1.38"` dev) exactly as they are.
4. Regenerate the lockfile with `pnpm install --lockfile-only` and confirm `pnpm install --frozen-lockfile` still succeeds — that is precisely what both CI jobs run first, and ADR 0026 records that a range change without a regenerated lockfile fails both.
5. If step 1 found any `.ts` hit, change nothing, and report the file:line so the plan gets amended.

**Steps:**
- [ ] Run the two greps in steps 1–2 and record their full output.
- [ ] If no `.ts` hits: edit `packages/todo/package.json` per step 3.
- [ ] Run `pnpm install --lockfile-only`, then `pnpm install --frozen-lockfile`.
  - `ERR_PNPM_OUTDATED_LOCKFILE` means the lockfile was not regenerated with the manifest — fix before continuing.
- [ ] Run `pnpm -r exec -- tsc --noEmit` and `pnpm test`. Expect success on both.
- [ ] Commit: `chore(todo): drop unused pi-ai peer and dev-pin (#154)` — or, if the declarations were kept, make **no** commit and report why.
- [ ] `git push`

**Acceptance criteria:**
- [ ] Either `packages/todo/package.json` has no `@earendil-works/pi-ai` entry, **or** this task reported the file:line that still needs it and changed nothing.
- [ ] `pnpm install --frozen-lockfile` succeeds with the committed `pnpm-lock.yaml`.
- [ ] `@types/node` is still exactly `22.19.19` and appears at exactly one version: `pnpm why @types/node | grep -o "2[0-9]\.[0-9]*\.[0-9]*" | sort -u` prints one line.

---

### Task 4: Record the rule so this cannot recur

**Parallel:** none — its wording depends on Task 3's outcome.

**Context:** The drift detector did its job; the reason it was needed is that one package reached a host symbol through a re-export instead of at its source. That is a durable, suite-wide trap (pi ships in one lockstep train and does not follow semver, so a re-export can vanish in a patch release), and per AGENTS.md persistent knowledge belongs in `docs/features/<feature>.md` (present tense, `status: live` + `last-verified`), not in this plan file — which is deleted when the work ships.

**Files:**
- Modify: `AGENTS.md` — one bullet in the existing **Conventions → Imports** list
- Modify: `docs/features/todo.md` — present-tense note on where the schema symbols come from (create only if the file does not already exist; check first with `ls docs/features/`)
- Delete: `docs/roadmap/todo-schema-typebox-parity.md` — this plan, at ship time (AGENTS.md: no plan index, no `done/` graveyard; history lives in git)

**What to implement:**

1. In `AGENTS.md`'s Conventions → Imports section, add one bullet in the existing style:
   > **Never take schema symbols (`Type`, `Static`, `TSchema`) from `@earendil-works/pi-ai`'s re-exports — import them from `typebox` at their source.** pi 1.5.0 deleted pi-ai's typebox re-exports in a patch-level train release; the packages that imported `typebox` directly were unaffected and the one that imported through the host broke. A host re-export is not a stable surface (ADR 0026).
   Do **not** add it to the "Two Never-Do Rules" section — those two are mechanically guarded by tests, and this rule has no guard; claiming one would be a false advertisement.
2. In `docs/features/todo.md`, state where `packages/todo/src/tool.ts` gets `Type`/`Static` and why `StringEnum` is local. Update `last-verified`. If Task 3 dropped the pi-ai peer, say so here too — the doc must match the manifest.
3. Do not open a new ADR. ADR 0026 already owns the pi-version/floor contract; the next free number is 0032 and this does not need it. If the work in Task 2 turned up a genuine removed host API (BLOCKED case), that *would* warrant its own ADR or issue — do not create one pre-emptively.

**Steps:**
- [ ] Read the current `AGENTS.md` Conventions → Imports list and `docs/features/todo.md` (or `ls docs/features/` to confirm whether it exists) before editing, so the new bullet matches local style.
- [ ] Apply both edits.
- [ ] Commit this plan file too — it is currently untracked, and `docs/roadmap/` is **not** gitignored here (`git check-ignore -q docs/roadmap/todo-schema-typebox-parity.md` exits 1 = not ignored), so it would otherwise be lost. Include `docs/roadmap/todo-schema-typebox-parity.md` in the commit below.
- [ ] Commit: `docs: record the pi-ai schema re-export rule (#154)`
- [ ] `git push`
- [ ] **At ship time only** (after the PR merges, via the `finish` skill), delete the plan: `git rm docs/roadmap/todo-schema-typebox-parity.md` — it is tracked by then, so `git rm` is correct. Never delete it before merge.

**Acceptance criteria:**
- [ ] `AGENTS.md` carries the rule in Conventions → Imports and **not** in the Two Never-Do Rules section.
- [ ] `docs/features/todo.md` matches the shipped manifest (says whether `todo` still declares a pi-ai peer).
- [ ] No new ADR file was created.

---

## Rejected alternatives

- **Migrate to `@earendil-works/pi-schema`** (`obj`/`str`/`opt`/`arr`/`oneOf` + its `Static`) — pi's own 1.5.0 idiom, and `StringEnum` disappears because `oneOf([...])` covers it. Rejected for now: it would add a dependency no package in the suite uses yet, make `todo` the only package on the new API while four sit on typebox, and per ADR 0026 raise `todo`'s documented floor to `>=1.5.0` — the oldest train carrying pi-schema. Worth revisiting as a suite-wide migration with its own plan, not smuggled into a CI fix.
- **Compat shim keeping `Type`/`Static` from pi-ai with a local fallback** — smallest diff, but it preserves the exact indirection that broke and adds a compat layer ADR 0026 argues against.
- **Do nothing until the next scheduled run** — `pi-latest` is the only drift detector available (pi does not follow semver), so leaving it red means flying blind on every subsequent pi train.

## UNVERIFIED — carried forward deliberately

1. **`pi-ai@1.5.0` still exporting `clampThinkingLevel` / `thinkingBudgetForLevel` / `Usage`** — inferred from published `.d.ts` subpaths, never compiled. **Task 2 resolves this authoritatively.** If they are gone, that is a blocker outside this plan's scope.
2. **The actual `pi-latest` failure log for #154** was never read — the run history for the failing scheduled run is `action_required`-adjacent and no log was fetched. The break is proven structurally instead (1.5.0's `dist/index.d.ts` lacks the two re-export lines that 1.2.0 and 1.4.0 both have). Task 2's dispatch produces the real log either way.
3. **Whether `Type.Unsafe` exists in typebox 1.1.38** — `todo` resolves typebox `1.3.27` today under its `^1.1.38` specifier (three different resolutions share that string across importers: 1.1.38 in `ask`, 1.3.7 in `sudo`, 1.3.27 in `todo`/`subagent`/`web` — tracked separately as #119). If `todo`'s resolution ever shifts to 1.1.38, Task 1 Step 2's helper needs re-checking. Not in scope; #119 owns it.
4. **Whether `todo` still needs a pi-ai peer after Task 1** — deliberately left to Task 3's greps rather than assumed here.
