# ADR 0002: MCP config write-back always targets .pi/mcp.json

**Status:** Accepted
**Date:** 2026-08-17
**Context:** plan-027 (MCP commands + panels port)

## Decision

When the `/mcp` command or the management panel writes config changes back (server `disabled` flag, per-server `directTools` selection), always write to the project-local Pi override file `<cwd>/<CONFIG_DIR_NAME>/mcp.json` (i.e. `.pi/mcp.json`) — the highest-precedence Pi layer. Only the single changed field is written under `mcpServers[serverName]`; credentials and other fields are never copied from other layers. Use `CONFIG_DIR_NAME` from `@earendil-works/pi-coding-agent` rather than hardcoding `.pi`.

## Alternatives considered

1. **Provenance-based write-back (adapter parity)** — track which config file "owns" each server and write the change back to that file. Matches user intuition but requires porting the provenance-tracking subsystem (~100+ lines).

## Rationale

Because `.pi/mcp.json` is the highest-precedence layer, writing an override there always wins the config merge, so the behavior is correct regardless of where the server is defined. This avoids the provenance subsystem entirely. The only downside is a mild surprise: a `directTools` value may live in a different file than its `mcpServers` entry.

## Consequences

- One write target, no provenance tracking — significantly less code.
- Changes always take effect (highest precedence).
- Documented divergence: users editing `.mcp.json` by hand won't see panel-written `directTools`/`disabled` overrides there — they live in `.pi/mcp.json`. This is called out in the README.
- Provenance-based write-back can be added later if the split-file behavior proves annoying.
