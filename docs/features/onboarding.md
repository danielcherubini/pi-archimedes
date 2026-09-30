---
status: live
last-verified: 2026-09-30
verified-by: npx vitest run meta/src/onboarding/overlay.test.ts meta/src/onboarding/index.test.ts
---

# First-run onboarding

## What it is

A 4-step setup wizard (thinking style → tool style → plugins → editor
spinner) that appears on the first TUI session when `archimedes.meta.onboarded`
is unset. It is a single pure `ui.custom` overlay with an internal `step`
state (0 → 1 → 2 → 3), no open/close flicker between steps, and — on the
spinner step — live 4-cell spinner previews that animate on a 40 ms tick when
the TUI repaint hook is available. The thinking and tool styles are two
INDEPENDENT questions (each `Full` / `Compact`, with a short description per
option), so the user can mix — e.g. "Full thinking" + "Compact tools". The
spinner options are separated by a blank line for slight vertical spacing.

## What it writes

The write runs at most once per run (per-invocation idempotence):

- `archimedes.ui.thinkingStyle` — from the **thinking style** choice (Full or
  Compact).
- `archimedes.ui.toolStyle` — from the **tool style** choice (Full or Compact),
  written **independently** of `thinkingStyle`.
- `archimedes.ui.editorSpinStyle` — the chosen spinner.
- Changed plugin `enabled` flags — only the ones that differ from the current
  state (`setPluginEnabled` per changed plugin).
- `archimedes.meta.onboarded: true` — written **last**. If any write throws,
  the marker is NOT set, so the next session re-runs the onboarding (self-heal).

Unanswered steps (skipped via Esc) are left untouched: the wizard reports a
`*Answered` flag per step and only the confirmed steps are written.

## The next-session effect

The style choices are written to `archimedes.ui`, but the
`patchThinkingRenderer` / `patchToolRenderer` are configured from
`loadUIConfig()` in the **ui** `session_start` handler, which runs BEFORE the
onboarding writes anything. So a first-run user who picks "Full" sees
collapsed tools / compact thinking for the remainder of their first session;
the choice takes effect from the **NEXT** session. Mid-session re-application
of the patches is deliberately out of scope. The wizard states this up front:
every step renders the note `Choices apply from your next session.` directly
under the "Set up your preferences · N/4" header line, so the user's
expectations are set before they answer.

## Settings surface

| Key | Default | Notes |
|-----|---------|-------|
| `archimedes.meta.onboarded` | `false` (absent) | Set to `true` after a successful onboarding write. Delete to re-run the wizard. |
| `archimedes.ui.thinkingStyle` | `Full` | Seeded from the **thinking style** choice. |
| `archimedes.ui.toolStyle` | `Compact` | Seeded from the **tool style** choice, independently of `thinkingStyle`. |
| `archimedes.ui.editorSpinStyle` | `pendulum` | The chosen spinner. |
| plugin `enabled` flags | `true` (absent) | Only changed flags are written. |
