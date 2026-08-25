# Codebase Improvement Report — 2026-08-25

## Summary

14 findings across 8 lenses. 2 high, 7 medium, 5 low.

## Context

- **CONTEXT.md:** loaded (domain vocabulary + MCP terminology)
- **ADRs reviewed:** 8 (0001–0008)
- **Plans reviewed:** 10 most recent (plan-014 through plan-027)
- **Engineering Rules section:** not present in CONTEXT.md — defaults applied (200-line threshold)

---

## Findings

### 🔴 High Severity

#### 1. `agent-manager.ts` is a 1730-line god file
- **Lens:** File Length + Structure
- **Files:** `packages/subagent/src/agent-manager.ts`
- **Severity:** High
- **Confidence:** High
- **Problem:** 1730 lines handling agent CRUD, the `/agents` TUI panel, model picker, tool picker, search/filter, keyboard navigation, dirty tracking, and file I/O. At least 5 distinct responsibilities live in one file. Makes it hard to test any single concern in isolation and has already led to a `compact.ts` spillover (309 lines of formatting logic extracted but still tightly coupled).
- **Proposal:** Extract into: `agent-store.ts` (CRUD + file I/O), `agent-panel.ts` (TUI rendering), `model-picker.ts` (already conceptually separate), `tool-picker.ts` (ditto). `agent-manager.ts` becomes a thin orchestrator importing the four. Each piece becomes testable independently.

#### 2. `mcp/src/index.ts` handles registration, command routing, tool dispatch, AND direct-tool management (597 lines)
- **Lens:** File Length + Structure
- **Files:** `packages/mcp/src/index.ts`
- **Severity:** High
- **Confidence:** High
- **Problem:** The MCP package entry point is 597 lines doing extension registration, session lifecycle, the `mcp` proxy tool implementation, `/mcp` command routing, direct-tool registration, and the metadata cache warm-up. Deeply nested closures make tracing the session-start path difficult.
- **Proposal:** Extract `proxy-tool.ts` (the `mcp` tool handler), `direct-tool-registry.ts` (registration + lifecycle), and `command-router.ts` (the `/mcp` dispatch table). `index.ts` becomes a thin entry that wires them together.

---

### 🟡 Medium Severity

#### 3. `SEP_W = 3` and `" · "` separator duplicated across 3 files
- **Lens:** DRY Violations
- **Files:** `packages/footer/src/index.ts:22`, `packages/footer/src/utils/render-smoke.test.ts:25,32,36`, `packages/footer/src/utils/layout.ts:38` (default arg comment)
- **Severity:** Medium
- **Confidence:** High
- **Problem:** The visible separator width (`3`) and the separator string `" · "` are hardcoded independently in `index.ts`, `render-smoke.test.ts`, and as a default-arg comment in `layout.ts`. If the separator ever changes, at least 3 places break silently — and the smoke test would diverge from the real implementation.
- **Proposal:** Export `SEP_W = 3` and `SEPARATOR = " · "` as named constants from `layout.ts`. Import them in `index.ts` and `render-smoke.test.ts`.

#### 4. `measureChunks` exported but never used outside tests
- **Lens:** Dead Code
- **Files:** `packages/footer/src/utils/layout.ts`
- **Severity:** Medium
- **Confidence:** High
- **Problem:** `measureChunks` is exported from `layout.ts` and used only in `layout.test.ts`. No production code calls it. It was useful during development but is now dead public API. (Same pattern that led to the `WorktreeInfo` cleanup earlier today.)
- **Proposal:** Either make it unexported (`function measureChunks`) and keep it as a test-internal helper, or keep it exported only if a future caller is imminent (add a comment). Given today's precedent, unexport it.

#### 5. `clampLines` exported from core/text but only used in a test
- **Lens:** Dead Code
- **Files:** `packages/core/src/text.ts:32`, `packages/footer/src/utils/render-smoke.test.ts:2`
- **Severity:** Medium
- **Confidence:** High
- **Problem:** `clampLines` is exported from `@pi-archimedes/core/text` and its only non-test consumer is a footer render-smoke test. No production code uses it. Public API with no production caller.
- **Proposal:** Either make it unexported in `text.ts`, or — since `render-smoke.test.ts` is the only caller — inline the trivial `lines.map(l => clampLine(l, w))` in the test and remove the export.

#### 6. Config-loading pattern inconsistent across packages
- **Lens:** Inconsistent Patterns
- **Files:** `packages/footer/src/config.ts`, `packages/diff/src/config.ts`, `packages/notify/src/index.ts`, `packages/session-name/src/index.ts`
- **Severity:** Medium
- **Confidence:** High
- **Problem:** Footer and diff have dedicated `config.ts` files with `loadConfig`/`saveConfig` helpers. Notify and session-name call `loadConfig` directly inline inside `index.ts` with no wrapper. This means config shape, defaults, and namespace are spread across different locations with no consistent pattern, making it harder to add validation or migration later.
- **Proposal:** Give every package a `config.ts` with `load<Package>Config()` / `get<Package>SettingsItems()`, matching the footer/diff pattern. Move the inline config calls in notify and session-name into their own `config.ts`.

#### 7. `ask/src/index.ts` (450 lines) mixes tool registration, IPC relay, and full dialog rendering
- **Lens:** File Length + Structure
- **Files:** `packages/ask/src/index.ts`
- **Severity:** Medium
- **Confidence:** Medium
- **Problem:** The ask entry point handles tool registration, the subagent IPC relay channel, and large chunks of dialog orchestration (tab navigation, multi-question flow). `dialog.ts` (664 lines) is even larger. Together they're 1100+ lines of tangled rendering and logic.
- **Proposal:** Extract the IPC relay into `ipc-relay.ts` and the tool schema/registration into `tool.ts`, leaving `index.ts` as a thin wiring file. The `dialog.ts` split is more complex (UI state is deeply intertwined) — defer to a separate plan.

#### 8. `mcp/src/auth-storage.ts` uses raw `sha256-<hash>` keyring key construction in two places
- **Lens:** DRY Violations
- **Files:** `packages/mcp/src/auth-storage.ts`
- **Severity:** Medium
- **Confidence:** Medium
- **Problem:** The keyring key format (`pi-archimedes-mcp.oauth` service + `sha256-<hash>` key) is constructed inline in at least two spots. If the key format changes (e.g. for multi-tenant support), it would need updating in multiple places with no compile-time guarantee they stay in sync.
- **Proposal:** Extract `keyringSvc()` and `keyringKey(serverName: string)` as private helpers at the top of `auth-storage.ts`. All read/write paths go through them.

#### 9. `mcp/src/panel.ts` (925 lines) handles rendering, keyboard nav, search, OAuth flow, AND direct-tool toggle state
- **Lens:** File Length + Structure
- **Files:** `packages/mcp/src/panel.ts`
- **Severity:** Medium
- **Confidence:** Medium
- **Problem:** The management panel is a single 925-line file covering: the full render tree, all keyboard event handling, in-panel OAuth flow, search/filter state, direct-tool toggle state, and write-back. Changing the OAuth in-panel flow requires navigating the same file as the keyboard handler.
- **Proposal:** Extract `panel-state.ts` (all state types and reducers), `panel-oauth.ts` (in-panel OAuth flow logic), and keep `panel.ts` as the TUI rendering + keyboard wiring only. Reduces the file to ~400 lines and makes the OAuth flow independently testable.

---

### 🟢 Low Severity

#### 10. Commented-out code in `mcp/src/config.ts` and `mcp/src/server-client.ts`
- **Lens:** Dead Code
- **Files:** `packages/mcp/src/config.ts`, `packages/mcp/src/server-client.ts`
- **Severity:** Low
- **Confidence:** Medium
- **Problem:** Several commented-out code blocks remain from development iterations. These add noise and give future readers false signals about planned-but-deferred behaviour.
- **Proposal:** Remove commented-out blocks. If the intent is to document deferred work, replace with a `// TODO(ADR-NNNN):` comment referencing the relevant decision.

#### 11. `ask/src/dialog.ts` uses `tmp` as a variable name for intermediate state in several places
- **Lens:** Naming
- **Files:** `packages/ask/src/dialog.ts`
- **Severity:** Low
- **Confidence:** Medium
- **Problem:** Variable names like `tmp`, `res`, and `cur` appear in the dialog state machine. These names make the render path difficult to trace.
- **Proposal:** Rename to intent-expressing names: `pendingAnswer`, `selectedIndex`, `activeTab`, etc. Pure rename — no logic change.

#### 12. `subagent/src/index.ts` (361 lines) contains inline tool schema that could live in `tool.ts`
- **Lens:** Inconsistent Patterns
- **Files:** `packages/subagent/src/index.ts`
- **Severity:** Low
- **Confidence:** Medium
- **Problem:** The subagent tool JSON schema is defined inline in `index.ts`. Other packages (ask, mcp) separate tool schema from registration logic. Minor inconsistency but makes the entry point harder to skim.
- **Proposal:** Move the schema to `tool-schema.ts` and import it. Three-line change.

#### 13. `notify/src/index.ts` uses `"agent_end"` and `"ask_request"` as raw strings in 6+ places
- **Lens:** DRY Violations
- **Files:** `packages/notify/src/index.ts`
- **Severity:** Low
- **Confidence:** High
- **Problem:** The trigger names `"agent_end"` and `"ask_request"` appear as string literals 6+ times in the same file. A typo is a silent runtime bug with no compile-time guard.
- **Proposal:** Define `const TRIGGER = { AGENT_END: "agent_end", ASK_REQUEST: "ask_request" } as const` at the top of the file and use `TRIGGER.AGENT_END` throughout.

#### 14. `core/src/startup/sections.ts` (284 lines) — startup section rendering mixed with measurement logic
- **Lens:** Weak Abstractions
- **Files:** `packages/core/src/startup/sections.ts`
- **Severity:** Low
- **Confidence:** Low
- **Problem:** The startup section renderers mix visual string building with line-width measurement. Not severe, but the measurement concerns could be extracted to make the render logic easier to test in isolation.
- **Proposal:** Low priority — only worth doing if startup rendering becomes a pain point.

---

## Top Recommendation

**Finding 1 (`agent-manager.ts` — 1730-line god file)** is the highest-leverage target. It's the largest file in the monorepo by 2×, it has the most distinct responsibilities, and splitting it would immediately create testable units for agent CRUD, the model picker, and the tool picker — all of which currently have no dedicated tests.

Finding 2 (`mcp/src/index.ts`) is a close second but the MCP package is newer and the structure is still settling; doing Finding 1 first makes more sense.
