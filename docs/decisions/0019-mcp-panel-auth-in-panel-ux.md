# ADR 0005: MCP panel authentication uses in-panel UX over the shared loader

**Status:** Accepted
**Date:** 2026-08-19
**Context:** plan-027 (MCP commands + panels port)

## Problem

The management panel (`/mcp panel`, Task 3) must trigger OAuth for `needs-auth`
servers. Plan-026 settled on `runAuthWithLoader` (a screen-replacing
`BorderedLoader` with esc=abort, URL announce, and `reconnectAfterAuth`) as the
single in-process auth presentation, shared by the `/mcp auth` subcommand and the
inline auto-auth in tool call paths.

The mechanical option for the panel was to call `runAuthWithLoader` from its
`enter` handler.

## Decision

The panel does **not** reuse `runAuthWithLoader`. It authenticates in-panel:

- The panel enters an `authing` substate whose progress is rendered as a
  transient notice line in its own body (`Authenticating <name>… (esc to cancel)`,
  updated when the authorization URL arrives).
- It reuses only the UX-neutral shared plumbing that plan-026 already exported:
  `ServerClient.authenticate` (the single flow entry point), `openAuthUrl`
  (browser open, headless-swallowed), and `reconnectAfterAuth` / `AuthRunOutcome`
  (post-auth close + reconnect + structured result).
- `esc` during `authing` aborts via the flow's `AbortController` (surfaces as a
  cancellation, not an error); `ctrl+c` aborts and closes the panel; all other
  keys are ignored until the settle.
- `runAuthWithLoader` stays as the presentation for the `/mcp auth` subcommand and
  the auto-auth tool-retry path, unchanged.

## Alternatives considered

1. **Reuse `runAuthWithLoader` from the panel** — one presentation everywhere, zero
   duplication. Rejected because its `BorderedLoader` is a screen-replacing
   `ctx.ui.custom` (nested custom over the panel's open overlay — untested), and
   because it is a *command-layer* UX idiom: it is the only places in the monorepo
   that use `BorderedLoader`, while every pi-archimedes panel (ask, agent-manager)
   is self-contained in-panel mode UI.

## Rationale

This plan's scope, per its owners, is "the UI/UX, done and on track with the rest
of pi-archimedes" — plan-026's job was making authentication work, not defining
panel idiom. Forcing the loader into the panel would import a second visual
language into one panel. Sharing just the plumbing keeps the two presentation
paths from diverging on the actual auth mechanics (URL opening, abort,
reconnect semantics all live in one place).

## Consequences

- Two presentations of one flow coexist: `/mcp auth` subcommand (loader) and
  `/mcp panel` (notice line) — intentional, not incidental duplication.
- The panel gains an `authing` substate and its input rules (esc=abort, keys
  ignored, ctrl+c=abort+close); that state machine must be covered by the panel's
  manual test list.
- If the loader UX is ever reworked for commands, the panel does not follow it —
  and vice versa. The seam to keep aligned is `AuthRunOutcome`'s shape.
