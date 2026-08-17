# ADR 0003: MCP panels use the shared pi-archimedes overlay chrome

**Status:** Accepted
**Date:** 2026-08-17
**Context:** plan-027 (MCP commands + panels port)

## Decision

The MCP management panel (`/mcp panel`) and setup panel (`/mcp setup`) use the shared overlay chrome from `@pi-archimedes/core/overlay` and follow the same mode-based `string[]` rendering pattern as the `/agents` manager (`packages/subagent/src/agent-manager.ts`) and the `/archimedes` settings panel (`meta/src/settings.ts`). They do NOT use generic pi-tui `SelectList`/`DynamicBorder` components.

Concretely:
- Open via `ctx.ui.custom(fn, { overlay: true, overlayOptions: OVERLAY_CHROME })` — centered, width 84, maxHeight 80%.
- A mode state machine (e.g. `list` → `tools` → `confirm`); each mode has a render function returning `string[]`.
- `renderHeader(" MCP Servers [N] ", width, theme)` at top (accent), `renderFooter(" [space] toggle  [enter] expand  [a] auth  [r] reconnect  [ctrl+s] save  [esc] close ", width, theme)` at bottom (dim, bracket-style hints).
- All content wrapped by `wrapWithBorder(lines, width, theme)`.
- Content width via `borderContentWidth(width)`; truncate with `hardTruncate`.
- Filter is a self-managed string in `handleInput` (printable-char capture + backspace), matching `agent-manager`'s `[/] search`.

## Alternatives considered

1. **Generic pi-tui components** (`SelectList`, `DynamicBorder`, `Container`) — the pattern from `docs/tui.md`. Works, but produces a look inconsistent with the rest of pi-archimedes, and `SelectList` (single-select picker) is a poor fit for an expandable server→tools tree with per-row toggles.
2. **Raw ANSI `string[]`** (the pi-mcp-adapter approach) — full control but reimplements border/width math the shared chrome already provides, and doesn't theme-adapt cleanly.

## Rationale

pi-archimedes deliberately shares overlay chrome so `/agents` and `/archimedes` look identical (see `overlay.ts` module doc). The MCP panels are new surfaces in the same product and must match. The shared chrome already solves border rendering, width math, truncation, and theme-correct header/footer. The mode-based `string[]` + manual cursor pattern is proven in the 1730-line `agent-manager.ts` and handles exactly the expandable-tree-with-toggles shape the MCP panel needs.

## Consequences

- MCP panels are visually consistent with `/agents` and `/archimedes`.
- No dependency on `SelectList`/`DynamicBorder` for these panels.
- Builders port the established `agent-manager.ts` structure rather than inventing a layout.
- The self-managed filter decision (from discussion) fits this pattern natively.
