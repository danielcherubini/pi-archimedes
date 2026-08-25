# @pi-archimedes/mcp

Full-featured MCP client adapter with a pi-native TUI — feature parity with pi-mcp-adapter.

Connect any MCP server (stdio or HTTP/SSE), call its tools through a single `mcp` proxy tool or per-server direct tools, manage servers and OAuth flows interactively, and browse cached tool metadata offline — all without leaving the terminal.

## What you get

- **`mcp` gateway tool** — search, describe, and call tools across all configured servers; also handles `status`, per-server tool listing, and eager `connect` without opening every server upfront
- **Per-server direct tools** — each server's tools registered as `{server}_{tool}` for token-efficient calls; a per-server `directTools` array narrows the set to named tools only
- **`/mcp` command family** — status, tools, prompts, reconnect, enable/disable, logout, auth, management panel, and setup panel — everything in one command namespace
- **OAuth 2.1 + PKCE** — browser auth flow for protected servers (Atlassian, Notion, GitHub, …), OS credential-store persistence, SDK-driven token refresh
- **Lifecycle management** — `keep-alive`, `lazy`, `lazy-keep-alive`, or `eager` per server, with configurable idle timeout
- **Metadata cache** — `~/.pi/agent/mcp-cache.json` (7-day validity) lets search/describe work offline and persists each server's last connection outcome so `needs-auth`/errors survive restarts
- **Compact two-line tool rendering** — `mcp <target>` header (cyan + orange) plus a key-arg summary; full args and output hidden until expanded with `ctrl+o`
- **Layered config** — six config files, lowest → highest precedence; safe single-field write-back that never touches credentials or unrelated servers

## Install

```bash
pi install npm:@pi-archimedes/mcp
```

Or install the full meta package:

```bash
pi install npm:pi-archimedes
```

## Quick start

1. Create or edit a config file — the project-shared one is usually the right place:

   ```bash
   # in your project root
   cat > .mcp.json <<'EOF'
   {
     "mcpServers": {
       "context7": {
         "command": "npx",
         "args": ["-y", "@upstash/context7-mcp"]
       }
     }
   }
   EOF
   ```

   Or use `/mcp setup` to scaffold it interactively (see below).

2. `/reload` to pick up the new config.

3. The `mcp` tool and direct tools (`context7_*`) are now available. Check with `/mcp status`.

## `/mcp` command reference

`/mcp` is the single command namespace for all MCP operations. Bare `/mcp` opens the management panel (or shows the text status list if no panel is available).

| Subcommand | Description |
|------------|-------------|
| `/mcp [status]` | One line per server: connected (tool count), needs auth, error, disabled, or not connected — persisted outcomes show an age suffix (e.g. `2m ago`) |
| `/mcp tools [server]` | Cached tools for one server or all — name + description, no connections opened |
| `/mcp prompts [server]` | Cached prompts for one server or all — name + description, no connections opened |
| `/mcp reconnect [server]` | Close and reconnect one or all servers; reports settled status per server |
| `/mcp enable <server>` | Clear the server's `disabled` flag (written to the Pi override file) — then `/reload` |
| `/mcp disable <server>` | Set `disabled` and tear down the live connection — then `/reload` |
| `/mcp logout <server>` | Delete the server's stored credentials from the OS credential store |
| `/mcp auth <server>` | Interactive OAuth flow: progress loader, browser + URL fallback, `esc` cancels |
| `/mcp panel` | Open the management panel (TUI overlay) |
| `/mcp setup` | Open the setup panel (TUI overlay) |

## Management panel (`/mcp panel`)

Browse and act on all your servers in one overlay.

**Status glyphs:** `●` connected · `⚠` needs auth · `✗` error · `⊘` disabled · `○` cached (offline data)

| Key | Action |
|-----|--------|
| `↑` / `↓` | Move between server rows and (expanded) tool rows |
| `enter` | Expand/collapse a server's tools — on a **needs-auth** server, runs the in-panel OAuth flow instead |
| `a` | Run the in-panel OAuth flow for the focused server |
| `space` | Toggle direct tools: server row = all tools as a group, tool row = that one tool |
| `e` | Enable / disable the focused server |
| `l` | Log out (delete stored credentials) for the focused server |
| `r` | Reconnect the focused server |
| `/` | Search filter over server names and tool names/descriptions |
| `ctrl+s` | Save direct-tool changes to the Pi override file |
| `esc` | Close panel (unsaved toggles discarded); cancels an in-panel OAuth flow cleanly |

With zero servers configured, `/mcp panel` (and bare `/mcp`) notifies you and redirects to the setup panel instead.

## Setup panel (`/mcp setup`)

Onboarding for a new project. All writes target the project-shared `.mcp.json`.

- **Scaffold** — writes `{ "mcpServers": {} }` only when the file is absent
- **Add a known server** — curated preset list (context7, chrome-devtools, deepwiki, fetch); existing entries are never overwritten
- **Import from another tool** — discovers MCP configs from Cursor, Claude Code, Claude Desktop, and VSCode; shows a preview of which server names will be added before writing; names already in `.mcp.json` are kept untouched

## OAuth

Three paths reach the same auth entry point:

- `/mcp auth <server>` — interactive browser flow with a progress loader; opens the URL in the browser and prints it as a fallback
- In-panel — `a` key, or `enter` on a needs-auth server in `/mcp panel`; `esc` cancels cleanly
- `autoAuth: true` setting — a tool call hitting a needs-auth server triggers the flow inline and retries once

Token details:

- Tokens persist in the OS credential store (macOS Keychain / Windows Credential Manager / Linux libsecret) — no plaintext fallback
- Token refresh is SDK-driven; a pre-registered public client (`clientId` without `clientSecret`) is never auto-refreshed — re-run `/mcp auth <server>` when its token expires
- The `auth` field on http/sse servers accepts `{ "token": "…" }` (static bearer), `"oauth"` (defaults), or a full `McpOAuthConfig` object

## Config files & write-back

Six layers load in order, lowest → highest precedence (per-server field-level merge):

| # | File | Scope |
|---|------|-------|
| 1 | `~/.config/mcp/mcp.json` | Global (standard MCP location) |
| 2 | `~/.agents/mcp.json` | Cross-agent (home) |
| 3 | `~/.agents/mcp/mcp.json` | Cross-agent (home, alternate) |
| 4 | `~/.pi/agent/mcp.json` | Pi agent directory |
| 5 | `<project>/.mcp.json` | Project-shared (committable) |
| 6 | `<project>/.pi/mcp.json` | Pi override — highest precedence |

Files accept `//` comments and trailing commas. When a higher-precedence layer changes a server's `url`, inherited `auth`/`headers`/`bearerTokenEnv` from lower layers are dropped — credentials are never sent to an endpoint you didn't explicitly configure them for.

Write-back targets:

- **`disabled` and `directTools`** → `<project>/.pi/mcp.json` (Pi override only; existing fields preserved verbatim)
- **New server definitions** (from `/mcp setup`) → `<project>/.mcp.json` (add-if-absent, never overwrites)

Changes take effect on the next `/reload`.

## Settings

Settings are stored in `~/.pi/agent/settings.json` under the `archimedes.mcp` namespace.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `directTools` | bool | `true` | Register per-server direct tools (`{server}_{tool}`) in the tool list |
| `toolPrefix` | string | `"server"` | Tool name prefix strategy: `"server"` · `"none"` · `"short"` · `"mcp"` |
| `idleTimeout` | number | `10` | Minutes before idle connections close (`0` disables) |
| `autoAuth` | bool | `false` | Trigger OAuth inline on a needs-auth tool call and retry once |
| `warnOnLargeDirectTools` | bool | `true` | Reserved — parsed but not yet effective |

Per-server overrides (in the `mcp.json` server definition):

| Field | Type | Description |
|-------|------|-------------|
| `lifecycle` | string | `"keep-alive"` · `"lazy"` · `"lazy-keep-alive"` · `"eager"` (default `"lazy"`) |
| `idleTimeout` | number | Per-server idle timeout in minutes |
| `directTools` | bool \| string[] | `true` to expose all tools, or a list of tool names to expose |
| `includeTools` / `excludeTools` | string[] | Filter tools available to the `mcp` proxy |
| `toolPrefix` | string | Per-server prefix strategy |
| `disabled` | bool | Exclude from the live set without removing the definition |
| `debug` | bool | Route stdio server stderr to the terminal |
| `requestTimeoutMs` | number | Reserved — parsed but not yet effective |
| `protocolVersion` | string | Reserved — parsed but not yet effective |
| `exposeResources` | bool | Reserved — parsed but not yet effective |
| `auth` | object \| string | HTTP/SSE only — static bearer, `"oauth"`, or `McpOAuthConfig` |
| `headers` | object | HTTP/SSE only — additional request headers |
| `bearerTokenEnv` | string | HTTP/SSE only — env var name holding the bearer token |

## Integration

When installed via `pi-archimedes` (the meta package), the MCP adapter is automatically registered. Tool rendering uses Core's chrome and color palette. Standalone installation works independently — the full feature set is available without the meta package.

← Back to [pi-archimedes](../../README.md)
