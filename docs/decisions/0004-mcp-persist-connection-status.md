# ADR 0004: MCP connection outcome persists in the metadata cache

**Status:** Accepted
**Date:** 2026-08-19
**Context:** plan-027 (MCP commands + panels port)

## Problem

`/mcp status`, the management panel, and the proxy tool all report per-server state
(connected / cached / needs-auth / error / disabled). But in our cache-first design
(plan-025) `session_start` connects **nothing** — direct tools register from
`~/.pi/agent/mcp-cache.json`, so a fresh session has no live `ServerClient` for any
server. `ServerCacheEntry` persists only tools/resources/prompts/`configHash`, not
connection outcomes.

Consequence: a server that returned 401 yesterday shows as "cached (0 tools)" today —
its `needs-auth` state is invisible until the user re-hits the 401 by calling a tool.
That is the most undiscoverable state in the package: the fix (`/mcp auth <server>`)
is only reachable if the user already knows it's an OAuth server.

The reference adapter (pi-mcp-adapter) doesn't have this problem only because it
connects all servers eagerly on load and holds status in in-process state — a pattern
deliberately NOT ported (plan-025's no-connect-storm design).

## Decision

Persist the last connection outcome per server in the same cache file as an **additive
top-level map**:

```
MetadataCache.serverStatuses?: Record<
  string,
  { status: "connected" | "needs-auth" | "error"; error?: string; at: number }
>
```

- Written at every connection settle point (session_start background probe, on-demand
  connect, reconnect, panel auth/reconnect) via a single recorder function so the
  write path stays in one place.
- Readers treat a missing key/field as "not verified" — old cache files parse
  unchanged, so **no `CACHE_VERSION` bump**.
- **`loadMetadataCache` must round-trip the map** — the pre-existing implementation
  reconstructs only `version` + `servers` and would silently drop the field on every
  `saveServerCache`; both cache writers preserve each other's field (regression-tested).
- Status display includes the timestamp (e.g. "needs-auth (2d ago)") to make staleness
  explicit; the value is refreshed by the next settle, including a successful connect.

## Alternatives considered

1. **Lazy known-state (document only)** — report "cached (0 tools)" with docs that
   `needs-auth` appears after a connect attempt. Zero code, zero schema change, but
   keeps the 401 server invisible in status — the gap this ADR exists to close.
2. **On-demand probe** — `/mcp status` / the panel background-connect not-verified
   servers when the user explicitly asks. Always-fresh, but N connections per explicit
   status call and a race between the probe settling and the status rendering.

## Rationale

Persisting the outcome is the minimal state that makes `needs-auth` discoverable
across sessions. It is additive and backward-compatible (absent field = not verified),
so there is no migration, no new state file, and no cache-invalidation semantics to
change (`serverStatuses` is derived data, never consulted for cache validity or
config-hash matching).

## Consequences

- `mcp-cache.json` doubles as a status ledger — the file name refers to metadata that
  now also includes connection outcomes; noted in the README.
- Status can be stale between settle points — mitigated, not eliminated, by the
  timestamp in the display.
- One new recorder call site per settle point; without the single-function discipline
  the cache file gains scattered writers (review checklist item).
- Round-trip regression: `saveServerCache` and `recordServerOutcome` must each preserve
  the other's field (the erase trap is a real code path, not a theoretical one).
