# Prompt-slot spinner replaces the standalone "Working" line

We decided (2026-09, pi 0.85.1) to replace pi's standalone "Working (⛟ …)" status line with a spinner animation in the `>` prefix slot of the custom editor: while the agent is busy, the 2-column prefix animates through braille frames at 80 ms (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`), and the static `>` repaints exactly once on the busy→idle transition (the frame must NOT freeze on screen — an idle→no-op would). The feature is gated by `archimedes.core.editorSpinPrompt` (default **on**; settings item "Editor Spin Prompt"), and while on we hide the "working" indicator kind via `ctx.ui.setWorkingVisible(false)` on `session_start`, restoring it on `session_shutdown`.

Context: pi 0.85.0 moved the working indicator *into* the default editor's top border. Custom editors keep the old standalone status line unless they opt into `embedWorkingStatus` — but our `HephaestusEditor` fully re-renders its chrome, so the embedded indicator would be silently swallowed by the re-render. The native position was therefore effectively unavailable to us, and the standalone line (with its "Working ⛟ …" text and "esc to interrupt" label) is the only surviving native option. A prompt-slot spinner keeps the busy signal on screen, keeps the terminal quiet, and matches the chrome we already own; the plan file ([`docs/roadmap/prompt-slot-spinner.md`](../roadmap/prompt-slot-spinner.md)) and the 0.85.x changelog review it cites document the review that led here.

The mechanism is a self-driven 80 ms interval owned by the editor and hoisted to module scope in core's extension hooks — not `embedWorkingStatus` plus access to private editor internals. Verified against the 0.85.1 bundle: `setCustomEditorComponent` does **not** `dispose()` the replaced editor, so the shutdown/`/reload` paths explicitly reap the module-scoped timer (`clearSpinInterval()` re-runs on every `session_start`, including a `/reload` rebind); the `dispose()` override is a safety net only. `setWorkingVisible` affects only the "working" kind, so the other indicator lines (retry, compaction, branch summary) continue to render as their own lines.

Trade-offs accepted: we lose the "esc to interrupt" label and the "Working (⛟ …)" text while a turn runs (the animation itself is the signal, and esc still works). The retry/compaction/branch-summary indicator lines remain standalone lines rather than being folded into the chrome — they are a different indicator kind from "working" and `setWorkingVisible` does not reach them.

Reversal path: no hot-swap — toggle "Editor Spin Prompt" **Off** (or `archimedes.core.editorSpinPrompt: false`) and start the next session (a `/reload` also re-applies it). The off path is fully inert — no timer, no hide call, unconditional `setWorkingVisible(true)` on session start — so pi's default "Working" line returns.

Consequences:
- Core's `session_start` loads config before registering the editor factory (the `loadCoreConfig` call moved up), hides the "working" kind conditionally (`setWorkingVisible(!spinFlag)` — the unconditional form double-recovers a carried-over hidden state even when off), and passes the timer handle up via `onSpinInterval`; `session_shutdown` restores visibility (enabled only), reaps the timer, and resets the flag so a second shutdown is a no-op. The editor never imports the extension index (no circular import) — the callback keeps the gap one-way.
- The editor's `dispose()` override is declared **without `override`** (verified: no pi-tui base class declares `dispose()` at 0.85.1) — do not "fix" it.
- East-Asian-width terminals (any braille frame's `visibleWidth()` is 2) fall back to `|/-\` frames; the 2-column slot and the autocomplete indent (`PI_SYMBOL_COL = 2`) are preserved either way.
- The spinner frame renders via a dedicated `spin` palette entry (`accent` → `borderMuted` fallback), so the animation can be recolored independently of the static `>` (the `prefix` palette entry, `borderMuted` → `border`).

Manual verification checklist:
- [ ] Start a turn — spinner animates in the `>` slot, the standalone "Working (⛟ …)" line is gone.
- [ ] Turn ends — the static `>` returns within one tick (~80 ms); no frozen frame.
- [ ] `/compact` mid-run — the compaction indicator line shows **and** the spinner keeps animating.
- [ ] Toggle "Editor Spin Prompt" Off + `/reload` — pi's default "Working" line is back; no orphaned timer (devtools: no leaked interval).
- [ ] East-Asian-width terminal — `|/-\` frames, 2-column slot intact, autocomplete line aligned under the prefix.
