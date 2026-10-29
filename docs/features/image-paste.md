---
status: live
last-verified: 2026-10-14
verified-by: reading `packages/image-paste/src` (index.ts, clipboard.ts, keybinding-offer.ts, preview.ts) against pi 1.2.0's shipped native action (`dist/modes/interactive/interactive-mode.js` `handleClipboardPaste`, `dist/modes/interactive/components/custom-editor.js`, `dist/core/keybindings.js`, `dist/core/extensions/runner.js`; and, for how a keybinding file becomes keys, `KeybindingsManager.rebuild()` in the bundled `pi-tui/dist/keybindings.js` plus `loadRawConfig`/`loadFromFile` in `dist/core/keybindings.js` for the unparseable-file fallback) and its built-in message components (`dist/modes/interactive/components/user-message.js`), claim by claim, on 2026-10-14. The behaviour is guarded by the suite's tests (`npx vitest run` — 2430 tests / 145 files; `paste-dispatch.test.ts`, `clipboard.test.ts`, `shortcut-gate.test.ts`, `paste-mutex.test.ts`, `keybinding-offer.test.ts`), and `tsc --noEmit` is clean in all 13 workspace projects. The restoration contract was additionally captured live on pi 1.2.0 in a scratch `PI_CODING_AGENT_DIR` with a stubbed clipboard, as recorded in `docs/features/first-run-keybinding-offer.md`. Not verified in this pass: see the list at the end.
---

# Image paste (`@pi-archimedes/image-paste`)

One key, `ctrl+v` (`alt+v`/`ctrl+alt+v` too; on Windows `alt+v` and `ctrl+alt+v`): a clipboard image is attached to your message, copied file paths and plain text still paste as pi would paste them, and attached images are shown back inline.

## The paste dispatch

`dispatchClipboardPaste()` (`packages/image-paste/src/index.ts`) produces exactly one outcome per keypress, tried in this order:

1. **Image bytes** → `queueImage()` stores the image, inserts a `[Image #N] ` placeholder at the cursor with `ctx.ui.pasteToEditor()`, and notifies `Image attached from clipboard.` Images over 20 MiB are refused with a message and never queued.
2. **Copied file paths** → inserted as text, through `buildPathInsertion()` (`clipboard.ts`), which reproduces pi's own spacing rule (quote-and-space-join in `!` bash mode, newline-join otherwise, leading/trailing space only against a non-space neighbour) and keeps pi's control-character guard on the paths.
3. **Plain text** → inserted through `clipboardTextForEditor()`, because the insert an extension has is a bracketed paste and an escape byte arriving from the clipboard would otherwise close that paste mid-string.
4. **Nothing** → silence. pi has no final branch either, so an empty clipboard does not announce itself.

A failed image *reader* is not treated as an empty clipboard: the two later branches are independent of it, so they get their turn, and the reader's error is only reported if nothing else answered. Every clipboard read is bounded (`NATIVE_READ_TIMEOUT_MS`, `clipboard.ts`) because the handler holds a `_pasting` mutex for the lifetime of one dispatch — an unbounded read would take the key out of service for the rest of the session.

**Markers are the source of truth.** On submit, the `input` handler scans the text for the queued markers and returns `{ action: "transform", text, images }` for the ones still present, so deleting a marker means that image is not attached. Then, for each image that is attached, `sendPreviewMessage()` posts a custom message rendered inline by `pi.registerMessageRenderer` (`preview.ts`, images capped at 60 cells wide). A submit with no markers clears the queue.

## The key it takes, and the trade

pi owns this key natively as `app.clipboard.pasteImage` — `defaultKeys: windowsKeybindings ? "alt+v" : "ctrl+v"`, described as "Paste files on macOS, images, or text from clipboard" (`dist/core/keybindings.js`). Taking it is not additive by itself, so the suite says plainly what the trade is:

- With the defaults, the suite's handler answers the key and pi's native action does not run. That is not a race between two handlers: `app.clipboard.pasteImage` is **not** in pi's `RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS`, so the extension shortcut is kept and pi's editor branch returns before its own paste — exactly one handler runs, and it is ours. The first-run offer exists to make that split explicit and to remove the standing `[Extension issues]` conflict line; it is documented in `docs/features/first-run-keybinding-offer.md`, including its gates, its consent-only write, and its once-per-process reload-stable notice. One of those gates is the setting below: while `suppressNativePaste` is `false` the offer stays silent, because an install that will not hold the key has nothing to unbind.
- The condition attached to keeping the key is that our handler covers what pi's action covers on that key and then adds the image attach — images like us, file paths and text like pi (`docs/decisions/0030-image-paste-superset-not-supplement.md`). "Superset" is that ADR's word for the set of outcomes on the key, not a claim that every branch matches: the two things pi's version does better are listed under "What pi has that ours does not" below. The branch order is deliberately *not* pi's, because a macOS screenshot puts both a file URL and image bytes on the pasteboard and the image must win for the one additive branch to ever fire.

## Handing the key back: the restoration contract

`archimedes.imagePaste.suppressNativePaste: false` is a request for pi's own paste. Two halves, both required, and both read from the same setting per session (`suiteMayClaimPasteKey()` is the single predicate, so the file and the registration cannot disagree):

1. **The file.** `restoreNativePaste()` (`keybinding-offer.ts`) removes the suite's `app.clipboard.pasteImage` entry from `~/.pi/agent/keybindings.json`, leaving `{}`. It acts **only** on the artefact the suite wrote, in either of its two shapes: the single-key file `{ "app.clipboard.pasteImage": [] }`, or the current pair `{ "$schema": "https://pi.dev/schemas/keybindings.schema.json", "app.clipboard.pasteImage": [] }`. `$schema` counts as ours only with pi's published URL — the test is on the parsed object, not the bytes, so key order, indentation and whitespace are irrelevant. The write goes through `writeAtomicPreservingSymlinks`, so a `keybindings.json` that is a symlink to somewhere else stays a symlink; a dangling link is read as "no file" (`existsSync` follows it) and nothing is written through it. A file that already reads `{}` is reported without being rewritten, so the flag cannot touch anyone's file every session start.
2. **The key.** While the setting is `false`, `registerImagePaste()` registers **no** paste shortcut at all — the loop that binds `ctrl+v`, `alt+v` and `ctrl+alt+v` is the package's only entry point to the paste path, so nothing is left routing a keypress to our handler. Without this half the file restore would change nothing except the diagnostic: while an extension holds the shortcut, pi keeps it and never reaches its own paste branch. With both halves, pi's native `app.clipboard.pasteImage` runs. `/new` or `/reload` applies a change to the setting; no restart.

What stays registered while the flag is off: the submit-time marker attachment and the preview renderer. What you lose on those keys: image attach, the queue and the preview.

**When the file cannot be cleaned, the suite says so — and only some of those files leave the key dead.** Anything the accept-set refuses — an additional key, a different `$schema`, a non-empty `app.clipboard.pasteImage` value, JSON that does not parse, a file that cannot be read — is left byte-for-byte alone, and the suite has already stopped binding the key itself. What the key then does depends on what the refused file still says, because pi treats a user entry as the *complete* replacement for a command's default keys and `[]` as "unbound" (`KeybindingsManager.rebuild()` in `pi-tui/dist/keybindings.js`: `userKeys === undefined ? defaultKeys : userKeys`):

- **The file still carries a `[]` binding for `app.clipboard.pasteImage`** — the suite's own unbinding, or one the user wrote, sitting next to keys the suite may not touch. pi's action is unbound *and* ours is gone, so the key does nothing until that entry is deleted. This is the case the warning was written for.
- **The file does not disable the action** — it holds only `$schema`, or foreign keys with no `app.clipboard.pasteImage` entry, or it does not parse (pi's loader discards an unparseable file and runs on defaults: `loadRawConfig` → `loadFromFile` returning `{}`), or the user pointed `app.clipboard.pasteImage` at a key of their own. pi's native paste is **already live** in every one of those — on `ctrl+v`, or on the key the user named. Nothing needs deleting and the key is not dead.

The warning is the same in both cases, and its wording over-claims in the second one: it tells the user to remove "the `app.clipboard.pasteImage` entry" and says the key "does nothing until you do", which is true only for the first bullet. That is a flaw in the shipped string (`manualEditLine` and the `ctx.ui.notify` in `runNativePasteRestore`, both in `keybinding-offer.ts`), not in the accept-set — the file is correctly left alone either way. Narrowing the message is a behaviour change with a test attached to it, so it is recorded here as a follow-up rather than smuggled into a docs commit. What the message does get right in both cases: it names the path, names the entry, says image-paste is not binding the key either, and is spent once per process (the guard is `globalThis`-based, so `/reload` does not re-spend it). Nothing is logged to the console; the detail channel is the suite's diagnostics (`docs/features/ui.md`).

## vs pi's own

Unlike `todo`, `ask`, `subagent`, `footer` and `notify`, this package has no twin in pi's `examples/extensions/` — nothing there touches the clipboard. The comparison is with pi's **native action**, read from the shipped `dist`:

`InteractiveMode.handleClipboardPaste()` tries, in order: **file paths → image → text**. With paths it guards against control characters, joins them (quoted, space-separated in `!` bash mode; newline-separated otherwise), pads them with a leading/trailing space based on the characters on either side of the live caret, and calls `editor.insertTextAtCursor`. With an image it writes `os.tmpdir()/pi-clipboard-<uuid>.<ext>` and inserts **that path** as text. With text it inserts the text. One branch per press, and no `else` for an empty clipboard.

| | pi's native action | `@pi-archimedes/image-paste` |
|---|---|---|
| Branch order | paths → image → text | image → paths → text |
| A clipboard image | a temp file whose **path** is inserted | attached as an image block on submit |
| Several images | one per press | a queue, `[Image #1]`, `[Image #2]`… attached together |
| Seeing the image back | nothing in your own message — `user-message.js` renders text only | an inline preview posted as a custom message through pi's own `registerMessageRenderer`, drawn with pi-tui's `Image` |
| Copied file paths | inserted, caret-aware spacing | inserted, same rule and same control-character guard, computed from the draft text |
| Plain text | inserted at the caret | inserted as a bracketed paste, escape bytes stripped |
| Empty clipboard | silent | silent |
| Image size | not bounded by this path | refused above 20 MiB |

**What pi has that ours does not.** pi holds the editor and its cursor, so its spacing rule is exact wherever the caret sits; an extension is limited to `getEditorText()`/`pasteToEditor()` and has no cursor accessor, so our copy assumes the caret is at the end of the draft and the one case it can't get right — a trailing space when the caret is mid-line — is pinned as a known limitation in `paste-dispatch.test.ts` rather than papered over. pi's path leaves a real filename in the draft, so the text the model receives carries something it can read back later; ours leaves the `[Image #1]` marker in that text **and** attaches the bytes alongside it (the `input` handler returns the text unchanged plus `images`), so the model sees the marker and the image, not a path. And pi's action needs no file in `~/.pi/agent/`: keeping our version is what costs the `keybindings.json` entry described above.

One thing pi already has that our preview leans on: inline image rendering exists in pi — `tool-execution.js` uses pi-tui's `Image` for tool output — it just does not apply to an image you pasted. Our preview registers a message renderer and draws with that same `Image` component, capped at 60 cells.

Pi 1.4.0 introduced native Rex terminal detection (confirmed in the 1.4.0 changelog via #11131, #11150), detecting `TERM_PROGRAM=rex` as supporting partial Kitty graphics inline images, OSC 8 hyperlinks, and truecolor. Archimedes adds no Rex-specific logic and relies on host terminal detection.

## Not verified in this pass

- Live clipboard behaviour on macOS or Windows for this doc. The Linux capture referenced in `docs/features/first-run-keybinding-offer.md` is the recorded one; the branch order and the guards here are read from source and from `paste-dispatch.test.ts` / `clipboard.test.ts`.
- Whether every terminal in use renders the inline preview. The preview is sent unconditionally; on a terminal that cannot draw inline images the attachment still happens and only the preview falls back — quoted from `packages/image-paste/README.md`, not re-measured here. Rex terminal previews have not been independently verified.
- The exact wording of pi's conflict diagnostic and the once-per-process warning were taken from the shipped code and from `docs/features/first-run-keybinding-offer.md`, not re-triggered in a terminal for this doc.
- The two-case split of the refuse-set above is read from pi's own keybinding resolution (`pi-tui/dist/keybindings.js`, `KeybindingsManager.rebuild()`) and from `restoreNativePaste()`'s accept-set, not re-run for this doc: only the accepted-artefact case appears in the live capture recorded in `docs/features/first-run-keybinding-offer.md`. The over-broad warning sentence in the already-live cases is read from the string in `keybinding-offer.ts`; it was not observed on screen.
