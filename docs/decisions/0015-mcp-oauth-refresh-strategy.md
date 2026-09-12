# ADR 0001: MCP OAuth token refresh strategy

**Status:** Accepted
**Date:** 2026-08-17
**Context:** plan-026 (MCP OAuth port)

## Decision

Use SDK-driven token refresh — call the MCP SDK's `auth(provider, { serverUrl })` and let its internal `refresh_token` grant run, reading tokens and client info from our `OAuthClientProvider`. Add a **lightweight config-stub guard**: if a server's OAuth config supplies a `clientId` but no `clientSecret` (a pre-registered public client) and the stored token is expired, do NOT attempt an automatic refresh — instead surface "run /mcp-auth to re-authenticate."

## Alternatives considered

1. **SDK-driven, no guard** — simplest, but silently fails with `invalid_client` when a config-registered secretless client's token expires (the auth server rejects the refresh grant).
2. **Explicit `refreshAuthorization()`** — the SDK's lower-level refresh call. More control, more code, unnecessary for our cases.
3. **Full `isConfigStub` guard (adapter parity)** — ports the adapter's elaborate stub detection (~50+ lines). Most robust but more than we need.

## Rationale

Our primary use case (Atlassian, Notion, most public MCP servers) uses **dynamic client registration**, where SDK-driven refresh works cleanly. The config-stub case only arises when a user hand-configures `clientId` in mcp.json. A single clear rule ("clientId without secret + expired → re-auth, don't refresh") prevents the confusing `invalid_client` failure with minimal code, and is easy to specify for a low-context builder.

## Consequences

- Refresh is handled by the SDK; we don't reimplement the token endpoint POST.
- Pre-registered public clients get a clear re-auth prompt instead of a cryptic failure.
- If richer refresh control is needed later, `refreshAuthorization()` remains available.
