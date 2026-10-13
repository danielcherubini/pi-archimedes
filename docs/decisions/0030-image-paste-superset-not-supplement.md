---
status: accepted
date: 2026-10-13
superseded-by:
---

# Keep the paste key by being a superset of pi's clipboard action, not a supplement to it

pi has a native clipboard action, `app.clipboard.pasteImage`, bound to `ctrl+v` (`alt+v` on Windows/WSL), documented as "Paste files on macOS, images, or text from clipboard". `@pi-archimedes/image-paste` binds the same key, and its first-run flow writes `~/.pi/agent/keybindings.json` containing `{ "app.clipboard.pasteImage": [] }` to switch the native action off (`packages/image-paste/src/keybinding-offer.ts:9-24`) — we edit a file in the user's configuration directory to suppress a host feature, then reimplement part of it. We decided to keep both the binding and that suppression, on the condition that our handler becomes a **superset** of what pi's action does on the key: images → attach as image blocks with the multi-image queue and inline preview; file paths → insert at the cursor via `NativeClipboard.getFilePaths?()`, matching pi; otherwise → clipboard text, matching pi. A `suppressNativePaste` setting hands the key back to pi on request.

The audit that prompted this found the asymmetry plainly: pi's action handles three things (files, images, text) and ours handled one, so a user who accepted the first-run offer silently *lost* two behaviours to gain one — and the loss is invisible, because the key still appears to work. The genuinely additive half is real and has no native equivalent: attaching an image to the message rather than writing a path, keeping a queue of several images with `[Image #n]` markers, and rendering a preview. There is nothing to reuse in either direction — pi's dispatcher `readClipboardImage` (`dist/utils/clipboard-image.js`) is not publicly exported, so we cannot delegate to it, and both implementations sit on the same public primitive anyway (`getNativeClipboard()`, ours at `clipboard.ts:74-79`). Given that, the honest framing is that whoever owns the key must implement the whole behaviour of the key, which is a condition we can meet in our own code.

**Considered Options**

- **Hand `ctrl+v` back to pi and rebind ours** (e.g. `ctrl+alt+v`) — the cleanest structure, and the one to revisit if upstream ever makes the clipboard action customisable or exported. Rejected because it changes a headline gesture for existing users in order to fix a gap we can close ourselves, and it leaves the two implementations permanently competing for the same clipboard semantics on adjacent keys.
- **Leave the handler as it is** — rejected: it keeps a silent feature regression that users cannot discover, which is worse than either alternative and is exactly the "the host feature is quietly dead" pattern ADR 0024 was written about.
- **Deprecate the package in favour of pi's native paste** — rejected, and worth contrasting with ADR 0024, where deprecation was right because pi's built-in MCP strictly dominated ours. Here it does not: pi's action writes a temp-file path into the editor (`interactive-mode.js:2515-2525`) and pi's own user-message component renders no images (`user-message.js` contains no `Image`/`showImages` usage), so the queue, the attachment and the preview would simply disappear.
- **Keep the suppression but ask upstream to export the clipboard helper** — rejected as a plan, kept as a wish: it blocks the fix on someone else's release, and if the helper is exported later, collapsing our capture code becomes a small cleanup, not a reversal.

**Consequences**

- We now own the full meaning of `ctrl+v`, including two branches pi already had. If pi adds a third (it added `getFilePaths?()` in the 1.x line), our key silently loses it again — so the parity check is a standing test, not a one-time task, and the floating `pi@latest` job (ADR 0026) is where a change surfaces.
- The generated `keybindings.json` snippet gains `"$schema": "https://pi.dev/schemas/keybindings.schema.json"`. pi 1.2.0 published the configuration schemas and now validates them at startup (and validates theme files with `additionalProperties: false`), so a bad snippet is now something the user can see rather than something that silently misbehaves.
- The first-run flow stays, and with it the fact that the suite writes into `~/.pi/agent/`. `docs/features/first-run-keybinding-offer.md` must state plainly what the file is for and that `suppressNativePaste` reverses it, because "why is there a keybindings.json I didn't write?" is a fair question.
- The `1.2.0` fix that expands `~` in `extensions`/`skills`/`prompts`/`themes` settings entries means some users' `!~/…` entries now match where they previously matched nothing, so plugin enablement can shift for them on upgrade independent of anything in this decision.

## Amendment (2026-10-13)

The decision above left `suppressNativePaste` as an abstention rather than a reversal. As specified it meant "skip writing the keybinding snippet", which only ever applies to a file that does not exist yet — gate 4 of the first-run offer refuses to touch a file that is already there. The user who wants the key back is precisely the user who already accepted the offer, and they hold `~/.pi/agent/keybindings.json` containing `{ "app.clipboard.pasteImage": [] }`, which leaves pi's native paste action **unbound**. Declining a future write does nothing to that file. So "hands the key back to pi on request" was a promise the mechanism could not keep, and PR #95's review said so.

**Decided:** turning `archimedes.imagePaste.suppressNativePaste` off must restore pi's native binding, by removing the suite's own unbinding from that file.

**The exception this requires.** Gate 4's rule is "never merge into or rewrite an existing user keybindings file", and restoration is by definition a rewrite of a file that exists. This amends that rule narrowly and deliberately: the extension may rewrite `~/.pi/agent/keybindings.json` **only** when the file is byte-shape-identical to the artefact the suite created — an object whose sole key is `app.clipboard.pasteImage` with an empty array as its value — and the rewrite only ever *removes* that key, leaving `{}`. Anything else is off-limits: any additional key, a non-empty value for `app.clipboard.pasteImage`, or content that does not parse. In those cases the extension touches nothing and tells the user the one-line edit to make itself.

**Consequences.**

- The extension now writes a user file it did not create, in the sense that it must preserve it. The write therefore uses the same discipline as `writeAtomicPreservingSymlinks` in `packages/core/src/settings-io.ts` — tmp + rename, following an existing symlink so a `keybindings.json` that points elsewhere stays a link instead of becoming a regular file in the agent directory. The offer's own `writeFileSync` + `renameSync` pair does not do this and stays as it is, because it only ever creates a *missing* file.
- It must never touch an unrelated key, in the successful path or any other: the rewrite is "delete our key", not "rewrite the object we think the user meant".
- The restore is idempotent by content — once the file reads `{}` there is nothing to do, so it cannot rewrite a user file on every session start.
- The user is told which case they are in: restored, nothing-to-do, or "this file is yours, here is the line to delete", surfaced through the `core/log` diagnostics path (no `console.*` from a startup path — `docs/features/ui.md`), never a stdout write.
- The original decision stands: the superset condition, the first-run offer, and the `$schema` addition are unchanged by this amendment. What changed is only that reversal became something the code does instead of something it declines to do.
