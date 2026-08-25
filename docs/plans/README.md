# Plans

## Done

| # | Plan | Status | Created |
| 01 | [Create pi-archimedes](done/plan-001-create-pi-archimedes.md) | ✅ COMPLETED | 2026-06-04 |
| 02 | [Subagent package](done/plan-002-subagent.md) | ✅ COMPLETED (PR #1) | 2026-06-04 |
| 03 | [/agents command](done/plan-003-agents-command.md) | ✅ COMPLETED (PR #6) | 2026-06-13 |
| 04 | [README overhaul + hephaestus deprecation](done/plan-004-readme-overhaul.md) | ✅ COMPLETED (PRs #7 and #4) | 2026-06-14 |
| 05 | [Todo list with auto-clear + subagent visibility](done/plan-006-todo-plan.md) | ✅ COMPLETED (PR #8) | 2026-06-15 |
| 06 | [Ask tool](done/plan-007-ask-tool.md) | ✅ COMPLETED (PR #9) | 2025-06-17 |
| 07 | [Fork + IPC subagent communication](done/plan-008-fork-ipc-subagent.md) | ✅ COMPLETED (PR #10) | 2026-06-17 |
| 08 | [Notify package](done/plan-009-notify.md) | ✅ COMPLETED (PR #11) | 2026-06-28 |
| 09 | [Fix Core Bus Bug and Standardize Ask Package](done/plan-010-fix-core-and-ask.md) | ✅ COMPLETED | 2026-07-03 |
| 10 | [Stacked, flicker-free parallel subagent rendering](done/plan-011-stacked-parallel-subagents.md) | ✅ COMPLETED (PR #16) | 2026-07-04 |
| 11 | [Add Tests](done/plan-012-add-tests.md) | ✅ COMPLETED (PR #17) | 2026-07-05 |
| 12 | [Fix Windows Spawn and Terminal Clamping](done/plan-013-fix-windows-spawn-and-terminal-clamp.md) | ✅ COMPLETED (PR #18) | 2026-07-05 |
| 13 | [Lazy-load and profile startup](done/plan-014-lazy-load-and-profiling.md) | ✅ COMPLETED (PR #21) | 2026-07-20 |
| 14 | [Agents local JSON for model overrides](done/plan-015-agents-local-json.md) | ✅ COMPLETED | 2026-07-27 |
| 16 | [Subagent agent→model mirror fix + agent discovery](done/plan-016-subagent-model-mirror.md) | ✅ COMPLETED (squash `9ae002a`) | 2026-07-28 |
| 17 | [Splash Screen Pi 0.84.0 Compatibility](done/plan-017-splash-screen-pi-084.md) | ✅ COMPLETED | 2026-07-29 |
| 18 | [Expose subagent Pi session IDs](done/2026-08-05-subagent-session-id.md) | ✅ COMPLETED | 2026-08-05 |
| 19 | [README overhaul](done/plan-019-readme-overhaul.md) | ✅ COMPLETED (PR #27) | 2026-08-09 |
| 20 | [Pure logic tests](done/plan-020-pure-logic-tests.md) | ✅ COMPLETED (PR #28) | 2026-08-10 |
| 21 | [Auto session naming](done/plan-021-session-name.md) | ✅ COMPLETED (PR #29) | 2026-08-13 |
| 22 | [Subagent: thinking level in agents.local.json](done/plan-022-subagent-thinking-local-json.md) | ✅ COMPLETED (squash `c3cc7ab`) | 2026-08-15 |
| 23 | [Center-screen /archimedes settings (matching /agents)](done/plan-023-settings-center-overlay.md) | ✅ COMPLETED (squash `e535819`) | 2026-08-15 |
| 24 | [MCP package — full MCP client adapter replacing pi-mcp-adapter](done/plan-024-mcp-package.md) | ✅ COMPLETED (PR #31, squash `2de1831`) | 2026-08-17 |
| 25 | [MCP core reliability (port phase 1)](done/plan-025-mcp-core-reliability.md) | ✅ COMPLETED (squash `de324c6`) | 2026-08-17 |
| 26 | [MCP OAuth (port phase 2)](done/plan-026-mcp-oauth.md) | ✅ COMPLETED (squash `2861660`) | 2026-08-18 |
| 27 | [MCP commands + panels (port phase 3)](done/plan-027-mcp-commands-panels.md) | ✅ COMPLETED (squash `09dd105`) | 2026-08-17 |

> **Notes:****
> - Diff wide-character width overflow fix (PR #14, 2026-07-03) — no plan file.
> - [README overhaul (plan variant)](done/plan-005-readme-overhaul-plan.md) — supporting plan file, completed 2026-06-14.
> - Plan-023 follow-up (deferred): Kitty keyboard-protocol CSI-u text decoding — pre-existing gap in both `/agents` search and `/archimedes` prompt/search input on CSI-u terminals (Kitty/Ghostty/WezTerm/iTerm2); consider a follow-up using pi-tui's `decodePrintableKey`.

## Backlog

| # | Plan | Status | Created |
|---|------|--------|---------|
| 28 | [Codebase improvement — dead API, DRY, config patterns, file splits](plan-028-codebase-improvement.md) | 🟡 BACKLOG | 2026-08-25 |

## Quick Stats

- Total Plans: 28
- Completed: 27
- In Progress: 0
- Backlog: 1

> **MCP port (plans 025–027):** A three-phase port of `pi-mcp-adapter` into `@pi-archimedes/mcp`. Phase 1 = core reliability (cache, lifecycle, connection hardening); Phase 2 = OAuth (`/mcp-auth`, keyring, callback server); Phase 3 = `/mcp` command + panels. Design decisions in ADRs 0001–0003. Execute in order (026 needs 025; 027 needs both).
