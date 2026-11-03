---
status: committed
issue: https://github.com/archimedes-codes/pi-archimedes/issues/147#issuecomment-6290421504
done-when: "`pnpm -r exec -- tsc --noEmit` and `pnpm test` are green, and in a scratch `PI_CODING_AGENT_DIR` where a sibling extension sets `setWorkingIndicator({ frames: [\"QQ\", \"WW\"], intervalMs: 100 })` on `session_start` alongside archimedes with `archimedes.ui.editorSpinBorder: false`, a real pi run in a pty shows the sibling's frames during a prompt (on `main` it shows pi's default braille frames instead)."
---

# Stop wiping other extensions' working indicator (ADR 0031, #147)

**Goal:** archimedes stops overwriting `ctx.ui` working-row state that no archimedes setting asked it to change, so another extension's customised pi spinner survives.

**Architecture:** `packages/ui/src/index.ts` currently asserts two pieces of pi-owned state on every `session_start` — an indicator (`setWorkingIndicator(undefined)`) and the row's visibility (`setWorkingVisible(!spinFlag)`, whose `true` direction is not ours to assert). pi's setters are unskeyed last-write-wins, so both wipe whatever a sibling extension configured. The fix removes the indicator calls entirely and narrows visibility to the single direction `editorSpinBorder` demands, relying on pi's own `resetExtensionUI()` for the resting state.

**Tech Stack:** TypeScript (no build step, pi's jiti loader), vitest 3, `tsc --noEmit` for verification, real pi 1.3.0 in a pty for the behavioural proof.

## Parallelisation

**Verdict:** PARALLEL — 2 waves

- **Wave 1:** Task 1 (`packages/ui/src/index.ts`, `packages/ui/src/index.test.ts`) and Task 2 (`docs/features/ui.md`) — disjoint file sets, no shared artifact, neither reads the other's symbols. Task 2 edits prose only and runs no test command, so it cannot disturb Task 1's `node_modules/.vite-temp` or lockfile.
- **Wave 2:** Task 3 — the pty proof, which must run against Task 1's committed behaviour.

Task 1 and Task 2 must both be green and committed (by the orchestrator) before Task 3 starts.

---

### Task 1: Stop asserting the working indicator; assert only the direction `editorSpinBorder` asks for

**Parallel:** wave 1 — disjoint from Task 2 (`docs/features/ui.md`); Task 3 runs after this task's commit

**Context:**

Issue #147: a user running `pi-archimedes@2.11.1` next to their own extension that calls `ctx.ui.setWorkingIndicator({ frames, intervalMs })` gets pi's default spinner instead of theirs. The cause is `packages/ui/src/index.ts` calling `ctx.ui.setWorkingIndicator(undefined)` unconditionally in `session_start` (`:327`) and in `session_shutdown` (`:148`).

In pi 1.3.0 that setter is an unskeyed overwrite (`node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js:1831-1837`):

```js
setWorkingIndicator(options) {
    this.workingIndicatorOptions = options;
    if (this.activeStatusIndicator?.kind === "working") {
        this.activeStatusIndicator.setIndicator(options);
    }
    this.ui.requestRender();
}
```

`undefined` means "pi's default animated spinner" and there is no key or scoping, so last writer wins. Verified by experiment on real pi: two extensions in one `extensions/` dir, one setting frames and one clearing them, produced pi's braille frames and 0 sibling frames, with the handler log proving the setter ran second.

**Why we simply stop calling it.** The suite never configures an indicator — both call sites pass `undefined`, and no key in `archimedes.ui` (`packages/ui/src/config.ts`) touches `frames` or `intervalMs`. And pi already performs the handback without us: `resetExtensionUI()` calls `setWorkingIndicator()` (`:1922`) and `workingVisible = true` (`:1921`), and it runs on startup defaults, on every session replacement (`/new`, `/resume`, `/fork`, via `beforeSessionInvalidate` → `agent-session-runtime.js:111`) and on `/reload` (`interactive-mode.js:5378`). So a sibling extension must re-apply its indicator per session regardless of what we do; our call was not enforcing anything.

**Why the `true` direction of visibility goes too.** `setWorkingVisible(false)` while the border spinner runs is legitimately ours — `editorSpinBorder` on means our border owns the busy announcement (ADR 0014). `setWorkingVisible(true)` when it is off is not: it un-hides pi's row for a user who never asked, and for any extension that deliberately hid the row to draw its own spinner. Reproduction confirms the two are the same bug — with `editorSpinBorder: false` our code still calls `setWorkingVisible(true)`.

**Handler order is not a lever.** pi does not sort extension files — zero `sort()` calls in `dist/core/extensions/loader.js`; discovery is raw `readdirSync` order over project `extensions/`, then global `extensions/`, then configured paths (`loader.js:677-695`). Any design that depends on archimedes running last is unsound, so the fix must be "don't write state we don't own", never "write it later".

**Do NOT change:** `setHiddenThinkingLabel` (neither call site — `labelText` is a real archimedes setting, see ADR 0031's deliberate limitation), `setEditorComponent`, `setHeader`, and the whole splash/`quietStartup` block. This task touches two call sites and their comments.

**Files:**
- Modify: `packages/ui/src/index.ts` (the `session_shutdown` block at `:142-148`, the `session_start` block at `:304-327`)
- Test: `packages/ui/src/index.test.ts`

**What to implement:**

1. `session_start` — replace the comment block beginning `// One announcement, in one place.` and ending with the two setter calls (`:305-327`), so lines `:326-327` (the two setter calls) become one conditional line:

```ts
      // One announcement, in one place. pi's working row writes "Working" above
      // the editor and our border spinner writes its label — `editorSpinLabel`
      // defaults to "Working" as well — into the editor's own top border, so with
      // both on screen the word appeared twice. The border is ours, so while it
      // spins the row is hidden through pi's own switch (`setWorkingVisible()`,
      // `types.d.ts:88`).
      //
      // Only the direction this setting asks for is written. `setWorkingIndicator`
      // is never called, and the row is never asserted visible: pi restores both
      // itself wherever they could have been altered (`resetExtensionUI()`:
      // `workingVisible = true` at `interactive-mode.js:1921`, `setWorkingIndicator()`
      // at `:1922`, reached by startup defaults and by `/new`, `/resume`, `/fork`
      // and `/reload`), and asserting either would overwrite another extension's
      // choice — pi's working-row setters are an unskeyed last-write-wins
      // (`:1831-1837`). Writing `setWorkingIndicator(undefined)` unconditionally is
      // how 2.11.1 deleted a user's customised spinner (#147, ADR 0031).
      //
      // Read per session rather than remembered: `editorSpinBorder` can change
      // between sessions, and every `pi` handle gets its own handler.
      if (spinFlag) ctx.ui.setWorkingVisible(false);
```

2. `session_shutdown` — replace lines `:142-148` (both comments, `setWorkingVisible(true)` at `:144`, and `setWorkingIndicator(undefined)` at `:148`) with:

```ts
      // Give back what this session took: the row we hid for the border spinner,
      // and only if we hid it. pi resets the indicator and the row's visibility
      // itself before the next session starts (`resetExtensionUI()`), and asserting
      // a default here would overwrite another extension's choice — so the
      // indicator is not touched on the way out either (#147, ADR 0031).
      if (spinFlag) targetCtx.ui.setWorkingVisible(true);
      // These two ARE ours to hand back: `labelText` is an archimedes setting and
      // the editor component is ours outright, so both calls undo state this
      // session demonstrably took rather than asserting a default.
      targetCtx.ui.setHiddenThinkingLabel(undefined);
      targetCtx.ui.setEditorComponent(undefined);
```

   The guard must be evaluated **before** `spinFlag = false;` (`:153`), which it already is. Keep `clearSpinInterval()` and the splash teardown exactly as they are.

3. Update the six existing assertions in `packages/ui/src/index.test.ts` that pin the old behaviour as intended. Each is listed with its current line and its replacement:

   | line | now | becomes |
   |---|---|---|
   | 370 | `expect(ui.setWorkingIndicator).toHaveBeenCalledWith(undefined);` | `expect(ui.setWorkingIndicator).not.toHaveBeenCalled();` |
   | 434-435 | `expect(ui.setWorkingVisible).toHaveBeenCalledWith(true);` + the indicator assertion | `expect(ui.setWorkingVisible).not.toHaveBeenCalled();` + `expect(ui.setWorkingIndicator).not.toHaveBeenCalled();` |
   | 476 | `expect(ui.setWorkingIndicator).toHaveBeenLastCalledWith(undefined);` | `expect(ui.setWorkingIndicator).not.toHaveBeenCalled();` |
   | 499-500 | `toHaveBeenCalledWith(undefined)` + `not.toHaveBeenCalledWith({ frames: [] })` | a single `expect(ui.setWorkingIndicator).not.toHaveBeenCalled();` |
   | 510-511 | `expect(ui.setWorkingVisible).toHaveBeenLastCalledWith(true);` + indicator assertion | `expect(ui.setWorkingVisible).not.toHaveBeenCalled();` + `expect(ui.setWorkingIndicator).not.toHaveBeenCalled();` |
   | 514-531 | the whole `"re-reads the setting for every session, so a replaced session gets the row back"` test | rewritten — see below |

   Rename two tests whose names now describe the opposite of what happens:
   - `:503` `"shows pi's working row, with pi's own indicator, when the spinner is off"` → `"leaves pi's working row and indicator entirely alone when the spinner is off"`.
   - `:420` `"respects editorSpinBorder: false by leaving pi's indicator running and installing no editor component"` — the name still holds (nothing is touched, so pi's indicator does run); keep the name, fix the body.

   Rewrite `:514-531` as `"reads the setting per session and asserts only the direction it asks for"`, keeping its two-session structure (`editorSpinBorder: true` then `false`, two fresh `makeCtx(true)` sessions) and changing the expectation to: first session's `setWorkingVisible` calls equal `[false]`, second session's equal `[]` (no call at all). Move the "the row comes back on its own" claim into the test's comment, naming `resetExtensionUI()` (`interactive-mode.js:1921`) as the owner of the handback — it can no longer be asserted from here, and the test name must not claim it.

4. Add two tests inside the existing `describe("pi's working row and the border spinner", …)` block (`:487`). Both use the existing `makePi()`/`makeCtx()` helpers — no new harness.

   **a. The #147 regression.** Register a sibling's `session_start` handler on the same `pi` handle *before* `registerUI(pi)`, so it runs first exactly as it does in pi:

   ```ts
   it("leaves a sibling extension's custom working indicator alone (#147)", () => {
     vi.mocked(loadUIConfig).mockReturnValue({ ...DEFAULT_UI_CONFIG, editorSpinBorder: false });
     const { pi, listeners } = makePi();
     const { ctx, ui } = makeCtx(true);

     // Stands in for another extension in `~/.pi/agent/extensions/`: it configures
     // pi's spinner on session start, and pi gives no key or scoping to that call.
     pi.on("session_start", (_event, siblingCtx) => {
       siblingCtx.ui.setWorkingIndicator({ frames: ["◐"], intervalMs: 80 });
     });
     registerUI(pi);

     for (const handler of listeners["session_start"] ?? []) handler(null, ctx);

     // Exactly one call — the sibling's — and nothing of ours after it. Asserting
     // the count (not just "never called with undefined") is what catches a
     // handback written as `setWorkingIndicator()` with no argument at all.
     expect(ui.setWorkingIndicator).toHaveBeenCalledTimes(1);
     expect(ui.setWorkingIndicator).toHaveBeenCalledWith({ frames: ["◐"], intervalMs: 80 });
   });
   ```

   `makePi()` returns `{ pi, listeners, renderers }` (`:130-150`); note `setupHarness` cannot be used here because it registers ours first. Confirm this test is RED before the implementation step: on `main` it fails with `expected "spy" to be called 1 times, but got 2 times`.

   **b. Shutdown does not un-hide what we never hid:**

   ```ts
   it("does not assert the working row visible on shutdown when the spinner was never on", () => {
     vi.mocked(loadUIConfig).mockReturnValue({ ...DEFAULT_UI_CONFIG, editorSpinBorder: false });
     const { triggerStart, triggerShutdown } = setupHarness();
     const { ctx, ui } = makeCtx(true);

     triggerStart(ctx);
     triggerShutdown(ctx);

     // Nothing was taken, so nothing is returned — an unconditional
     // `setWorkingVisible(true)` here is the second half of the same overwrite bug.
     expect(ui.setWorkingVisible).not.toHaveBeenCalled();
   });
   ```

**Verified blast radius (measured on this tree, so it is a check on your work, not a guess):** with only step 1 + step 2 applied and the assertions untouched, `cd packages/ui && npx vitest run` fails **exactly 6 tests**, all in `src/index.test.ts`, and passes 506:

```
× configures the header, editor and thinking renderer
× respects editorSpinBorder: false by leaving pi's indicator running and installing no editor component
× gives the working row and the thinking label back to pi on shutdown
× pi's working row and the border spinner > hides pi's working row while the border spinner carries the announcement
× pi's working row and the border spinner > shows pi's working row, with pi's own indicator, when the spinner is off
× pi's working row and the border spinner > re-reads the setting for every session, so a replaced session gets the row back
```

Any *other* failure means the change reached further than planned — stop and reassess rather than editing more tests. After step 3 and step 4 the file is 37 tests (`35 - 0 + 2`), and the whole package is 514. Both new tests were also confirmed RED on `main` before the implementation, with `expected "spy" to be called 1 times, but got 2 times` (#147) and `expected "spy" to not be called at all, but actually been called 2 times` (shutdown), and `npx tsc --noEmit` is clean on the code as dictated.

**Acceptance criteria:**
- [ ] `setWorkingIndicator` appears nowhere in `packages/ui/src/index.ts` (`grep -c "setWorkingIndicator" packages/ui/src/index.ts` → `0`)
- [ ] `setWorkingVisible` appears exactly twice in that file, both guarded by `spinFlag` (`grep -n "setWorkingVisible" packages/ui/src/index.ts`)
- [ ] `setHiddenThinkingLabel` still called at both `session_start` (`config.labelText.trim() || undefined`) and `session_shutdown` (`undefined`); `setEditorComponent(undefined)` unchanged in `session_shutdown`
- [ ] `cd packages/ui && npx vitest run` green, including `startup-splash-gate.test.ts:350` (`setWorkingVisible` called with `false` on the default config) and `index.screen-mode.test.ts`, which declare an indicator spy but never assert on it
- [ ] `cd packages/ui && npx tsc --noEmit` clean
- [ ] `cd packages/ui && npx vitest run src/index.test.ts -t "#147"` fails on `main` and passes after

**Commit:** `fix(ui): leave pi's working indicator and row visibility to their owners (#147)`

---

### Task 2: Rewrite the working-row feature doc to the ownership rule

**Parallel:** wave 1 — disjoint from Task 1 (`packages/ui/src/**`); prose only, runs no test command

**Context:**

`docs/features/ui.md` documents the wipe as the feature. Its "One busy announcement, in one place" bullet (`:39`) says the row is handed back — "`setWorkingVisible(true)`, indicator restored with `setWorkingIndicator(undefined)`, so pi's default spinner runs" — which after Task 1 is false on all three counts. `docs/features/*.md` is present-tense persistent knowledge, so it must describe the shipped rule, not the old one. The two decisions are already written and committed: ADR 0031 (`docs/decisions/0031-assert-only-ui-state-our-settings-ask-for.md`, the suite-wide rule) and the 2026-10-20 amendment at the end of `docs/decisions/0014-prompt-slot-spinner.md`. Do not restate them — link them.

ADR files are append-only: **do not edit** `docs/decisions/0014-prompt-slot-spinner.md`, `0029-*` (whose consequences line mentions `setWorkingIndicator()` as the API to use *when* customising thinking — still true as advice about API choice; ADR 0031 is the later word on *whether*), or any other decision.

**Files:**
- Modify: `docs/features/ui.md` (the bullet at `:39`, and front-matter `last-verified`)

**What to implement:**

1. Rewrite the `**One busy announcement, in one place.**` bullet at `:39`. Keep its opening (the duplicate-"Working" problem and why the row is hidden while `editorSpinBorder` is on — both unchanged), then replace the handback sentence with the ownership rule in present tense. It must state, precisely:
   - While the spinner is on the row is hidden with `ctx.ui.setWorkingVisible(false)`; when it is off **nothing is written at all** — the row's resting state is pi's.
   - `ctx.ui.setWorkingIndicator()` is **never called by this package**; pi restores its own indicator (`resetExtensionUI()`, `interactive-mode.js:1922`) on startup, on `/new` `/resume` `/fork` and on `/reload`.
   - `session_shutdown` gives the row back **only if this package hid it** (`if (spinFlag)`), because pi resets the row before the next session starts anyway and asserting a default would overwrite another extension's choice.
   - The answer is still read from the config on every `session_start`.
   - Cite `(ADR 0031, ADR 0014's 2026-10-20 amendment, #147)`.
2. Immediately after that bullet, add one bullet recording the deliberate limitation: another extension's `ctx.ui.setHiddenThinkingLabel` still loses to our `labelText` default at `session_start`; the only guard expressible today would duplicate pi's private `defaultHiddenThinkingLabel = "Thinking..."` (`interactive-mode.js:272`, no accessor) as a literal, which silently inverts if pi changes the string; revisit if pi ever exposes it. Name it as a known limitation, not a TODO.
3. Add the rule to the "Never-do rules" section at the top of the file (`:4-13`, which carries two numbered rules that "bind the whole suite"). Add it as rule **3**, in the same voice and length as rules 1 and 2: never assert `ctx.ui` state no archimedes setting asked for — pi's `setWorkingIndicator`/`setWorkingVisible`/`setHiddenThinkingLabel` are unskeyed last-write-wins, so an unconditional handback is a wipe of any sibling extension's choice; write only the direction your setting demands, and restore rather than assert what you took. Cite ADR 0031 and #147.
4. Bump front-matter `last-verified` to `2026-10-20`. **Do not** rewrite the `verified-by:` line — Task 3 owns what gets recorded there.

**Acceptance criteria:**
- [ ] `grep -n "setWorkingIndicator" docs/features/ui.md` returns only lines that say we never call it (no prose describing us calling it)
- [ ] The file has three numbered never-do rules, rule 3 naming ADR 0031
- [ ] The thinking-label limitation is present and reads as a limitation, not a task
- [ ] `git diff --name-only` for this task lists `docs/features/ui.md` only — no file under `docs/decisions/` is modified
- [ ] Markdown renders sanely: fenced blocks balanced, table at `:39` region untouched, links relative (`[ADR 0031](../decisions/0031-assert-only-ui-state-our-settings-ask-for.md)`)

---

### Task 3: Prove the fix on real pi in a pty

**Parallel:** none — depends on Task 1's committed behaviour and runs no in-repo commands until the final full-suite check

**Context:**

The unit tests prove we stop calling the setter; only a real run proves that is *sufficient*. This procedure was executed successfully against `main` on 2026-10-20 and reproduced #147 exactly, so the "before" numbers below are real and the executor is confirming a known-good method, not inventing one.

Two findings from that run shape this task, and both are load-bearing:

- **Count frames in ANSI-stripped text, never in raw bytes.** pi repaints the status line incrementally, so raw-byte counting reports `0` for frames that are plainly on screen. The first attempt at this probe gave a false "wiped" reading until the escape sequences were stripped.
- **Do NOT load archimedes with `--extension <path>`.** In that arrangement the sibling's frames survived on `main` even though a log confirmed our `session_start` handler ran afterwards — i.e. `-e` does **not** reproduce the bug, so a run driven that way goes green before the fix and proves nothing. The arrangement that does reproduce is both extensions discovered from the same `extensions/` directory, which is also what a real user has (`pi install` drops archimedes into `~/.pi/agent/extensions/` next to their own file).
- A model must actually answer — a scratch agent dir with no provider silently falls back to a default that 429s, and the run produces no spinner at all.

**Files:**
- Create: `/tmp/wio/probe.py` (scratch, outside the repo — nothing here is committed)
- Test: none in-repo; the probe output is the evidence

**What to implement:** the exact scratch fixture and probe below. Frames are `QQ`/`WW` on purpose: pure ASCII, so ANSI splitting cannot hide them and they can never occur in pi's own default braille set (`⠋⠙⠹⠸⠼⠴⠦⠇…`, `DEFAULT_FRAMES` in pi's bundle).

1. Build the scratch dir. Symlink your real `auth.json`, and seed `settings.json` from your real one so the provider/model resolve — then force the spinner off, `regular` screen and quiet startup:

   ```bash
   rm -rf /tmp/wio && mkdir -p /tmp/wio/extensions
   ln -s ~/.pi/agent/auth.json /tmp/wio/auth.json
   python3 - <<'EOF'
   import json
   d = json.load(open('/home/daniel/.pi/agent/settings.json'))
   d['archimedes.ui'] = {**(d.get('archimedes.ui') or {}), 'editorSpinBorder': False}
   d['tuiMode'] = 'regular'; d['quietStartup'] = True
   json.dump(d, open('/tmp/wio/settings.json', 'w'), indent=1)
   EOF
   ```

2. The sibling extension — it must log that it ran, so a silent zero-extension run cannot be mistaken for a pass:

   ```bash
   cat > /tmp/wio/extensions/a-sentinel.ts <<'EOF'
   import { appendFileSync } from "node:fs";
   export default function (pi: any): void {
     pi.on("session_start", (_e: any, ctx: any) => {
       appendFileSync("/tmp/wio/order.txt", "sentinel set frames\n");
       ctx.ui.setWorkingIndicator({ frames: ["QQ", "WW"], intervalMs: 100 });
     });
   }
   EOF
   ln -s /home/daniel/Coding/Javascript/pi-archimedes /tmp/wio/extensions/pi-archimedes
   ```

   The repo-root symlink is the arrangement `AGENTS.md` documents for local testing, and root `package.json` advertises `pi.extensions → meta/src/index.ts`, so archimedes loads through its real entry point. Confirm archimedes really loaded from the captured screen (its footer shows cost/context glyphs, e.g. `↑1.7k ↓19`) — a run where only the sentinel loaded is worthless.

3. `probe.py` — `os.forkpty`, wait for the screen to settle, type the prompt, collect until 7 s after output goes quiet, then strip escapes and count:

   ```python
   #!/usr/bin/env python3
   import os, pty, select, time, re, json

   env = dict(os.environ)
   env["PI_CODING_AGENT_DIR"] = "/tmp/wio"
   env["TERM"] = "xterm-256color"
   argv = ["pi", "--tui-mode", "regular", "--no-session", "--no-tools"]

   pid, fd = pty.fork()
   if pid == 0:
       os.execvpe("pi", argv, env)

   buf, deadline, sent, last = b"", time.time() + 30, False, 0.0
   try:
       while time.time() < deadline:
           r, _, _ = select.select([fd], [], [], 0.1)
           if r:
               try:
                   chunk = os.read(fd, 65536)
               except OSError:
                   break
               if not chunk:
                   break
               buf += chunk
               last = time.time()
           if not sent and buf and (time.time() - last) > 1.5:
               os.write(fd, b"say hi\r")
               sent = True
           if sent and (time.time() - last) > 7:
               break
   finally:
       try:
           os.kill(pid, 9)
       except OSError:
           pass
       os.close(fd)

   t = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", buf.decode("utf-8", "replace"))
   t = re.sub(r"\x1b\][^\x07]*\x07", "", t)
   print(json.dumps({"sent_prompt": sent,
                     "sentinel_frames": t.count("QQ") + t.count("WW"),
                     "default_braille_frames": len(re.findall(r"[\u2800-\u28ff]", t))}))
   ```

   Do not add `--extension` to `argv`. Note `--no-session` and `--no-tools` are what the verified run used.

4. Run it. **Expected on the fixed tree:** `sentinel_frames` well above 0 (the verified `main` run of the *no-archimedes* control gave 13; anything in the same ballpark is a pass) and the sibling's frames visible in the screen dump. Also confirm the second half of the fix on the same run: with `editorSpinBorder: false` the row is *shown* while busy — pi's `Working` text must appear, so our never-asserting-`true` did not accidentally hide it.
5. Control (only if cheap, and only to prove the probe is not vacuous): `git stash` nothing — instead re-point the symlink at `main` (`git -C /home/daniel/Coding/Javascript/pi-archimedes stash` is forbidden mid-plan; use a second worktree or skip this step) and expect `sentinel_frames: 0` with `default_braille_frames` around 12, matching the recorded `main` run. If a control is impractical, say so in the report rather than claiming a comparison you did not make.
6. Full suite, once, serially: `cd /home/daniel/Coding/Javascript/pi-archimedes && pnpm test` and `pnpm -r exec -- tsc --noEmit`.
7. Record the result in `docs/features/ui.md`'s front-matter `verified-by:` line — append a sentence naming the real pi version, the scratch dir, `editorSpinBorder: false`, the sentinel frames surviving, and the arrangement that does *not* reproduce (`--extension`). Do not paste raw frame counts into the body.

**Acceptance criteria:**
- [ ] `/tmp/wio/order.txt` is non-empty (the sentinel really ran)
- [ ] `sentinel_frames` > 0 on the fixed tree, and pi's `Working` row is visible while busy
- [ ] The captured screen shows evidence archimedes loaded (its footer, not pi's bare one)
- [ ] `pnpm test` green across all 13 projects; `pnpm -r exec -- tsc --noEmit` clean
- [ ] `docs/features/ui.md` front-matter records the run, including the `-e` caveat
- [ ] Nothing under `/tmp/wio` is committed, and the repo working tree contains no probe files

---

## After the plan

- **Do not push or open the PR from a task** — one PR back to `main`, titled for #147, referencing the issue so the reporter is notified. The branch `bugfix/147-working-indicator-ownership` already exists with the spec/ADR commit (`32a809f`).
- **Release is separate work.** 2.11.1 is already published carrying the regression, so this wants its own `2.11.2` — that is the `release` skill's job (13 version bumps, type-check all packages, tag, verify on npm), not a task here. Release notes: "your customised pi spinner survives when archimedes is installed" with the PR link.
- **On ship**, delete this roadmap doc (history in git); the durable content already lives in `docs/features/ui.md` and ADR 0031.

## Out of scope

- Any guard on `setHiddenThinkingLabel` at `session_start` — see ADR 0031's deliberate limitation.
- Upstream requests (asking pi for a keyed/scoped `setWorkingIndicator`, or for sorted extension discovery). Worth a comment on #147 eventually; not blocking this fix.
- The other issues in the 2026-10-14 cluster (#113, #116, #124) — unrelated to the working row.
