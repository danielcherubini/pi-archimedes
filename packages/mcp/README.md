# @pi-archimedes/mcp

**Bring the tools you already use.**

Your MCP servers — stdio or HTTP/SSE — can talk to Pi without leaving the terminal. One `mcp` tool reaches every server (or per-server direct tools for token-efficient calls), `/mcp` is a single command namespace for management and auth, and the setup wizard imports server definitions from Cursor, Claude Code, Claude Desktop, and VS Code. Start with `/mcp setup`; manage with `/mcp`.

## Install

Standalone:

```bash
pi install npm:@pi-archimedes/mcp
```

Or the full suite instead:

```bash
pi install npm:pi-archimedes
```

New to Pi? Pi itself is a one-time global install and needs Node.js ≥ 22.19.0 — `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`; Pi's [quickstart](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/quickstart.md) covers authentication and [provider docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md) list the supported providers. After installing Pi, choose one installation command above, then `cd` into your project and run `pi`, and in the session use `/login` + `/model` — the [setup section](https://github.com/danielcherubini/pi-archimedes#setup) covers the first run. `/reload` picks up both new extensions and new server configs.

## What you get

- **`mcp` gateway tool** — search, describe, and call tools across all configured servers; also `status`, per-server tool listing, and eager `connect`, without opening every server upfront.
- **Per-server direct tools** — each server's tools registered as `{server}_{tool}` for direct, token-efficient calls; a per-server `directTools` array narrows the set to named tools.
- **`/mcp` command family** — status, tools, prompts, reconnect, enable/disable, logout, auth, management panel, setup panel — one namespace.
- **OAuth 2.1 + PKCE** — interactive browser auth for protected servers, with OS credential-store persistence and SDK-driven refresh.
- **Lifecycle management** — `keep-alive`, `lazy` (default), `lazy-keep-alive`, or `eager` per server, with an idle timeout.
- **Metadata cache** — `~/.pi/agent/mcp-cache.json` (7-day validity) lets search/describe work offline and persists each server's last connection outcome, so `needs-auth`/errors survive restarts.
- **Compact two-line tool rendering** — an `mcp <target>` header with a key-argument summary; full args and output expand with `ctrl+o`.
- **Layered config** — six config files, lowest → highest precedence, with a safe single-field write-back that never touches credentials or unrelated servers.

## Quick start

1. **`/mcp setup`** — the recommended path. It scaffolds `.mcp.json`, adds curated presets (context7, chrome-devtools, deepwiki, fetch), and imports server definitions from Cursor, Claude Code, Claude Desktop, and VS Code — with a preview of which names will be added before anything is written.
2. Or edit a config file by hand. The project-shared `<project>/.mcp.json` is usually the right place. **Merge deliberately — do not `cat > .mcp.json`**, which silently destroys settings for other servers:

   ```json
   {
     "mcpServers": {
       "context7": {
         "command": "npx",
         "args": ["-y", "@upstash/context7-mcp"]
       }
     }
   }
   ```

3. `/reload` to pick up the new config.
4. The `mcp` tool and direct tools (`context7_*`) are now available; check with `/mcp status`.

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
- **Import from another tool** — discovers MCP configs from Cursor, Claude Code, Claude Desktop, and VS Code. The six candidate files, in scan order, are `~/.cursor/mcp.json` and `<project>/.cursor/mcp.json` (`mcpServers` key), `~/.claude/mcp.json` and `~/.claude.json` (`mcpServers`), `~/.claude/claude_desktop_config.json` (`mcpServers`), and `<project>/.vscode/mcp.json` (its key is `servers`, not `mcpServers`); shows a preview of which server names will be added before writing; names already in `.mcp.json` are kept untouched

## OAuth

Three paths reach the same auth entry point:

- `/mcp auth <server>` — interactive browser flow with a progress loader; opens the URL in the browser and prints it as a fallback
- In-panel — `a` key, or `enter` on a needs-auth server in `/mcp panel`; `esc` cancels cleanly
- `autoAuth: true` setting — a tool call hitting a needs-auth server triggers the flow inline and retries once

Token details:

- Tokens persist in the OS credential store (macOS Keychain / Windows Credential Manager / Linux Secret Service). Storage is **fail-closed**: if the keyring is unavailable, auth operations throw a clear error — there is never a plaintext fallback.
- Token refresh is SDK-driven; a pre-registered public client (`clientId` without `clientSecret`) is never auto-refreshed — re-run `/mcp auth <server>` when its token expires.
- The `auth` field on http/sse servers accepts `{ "token": "…" }` (static bearer), `"oauth"`, or a full `McpOAuthConfig` object. `auth: "oauth"` (or a config object with at least one field below) is what enables OAuth with the default grant settings; a valid object can override them. **Omitting `auth` on a protected server means no authentication** — there is no implicit OAuth default:

| `McpOAuthConfig` field | Meaning |
|------------------------|---------|
| `grantType` | `"authorization_code"` (default) or `"client_credentials"` |
| `clientId` | client identifier |
| `clientSecret` | string, literal only — no `!command` resolution |
| `scope` | space-separated scopes |
| `redirectUri` | pre-registered clients only |
| `clientName` | human name, shown in consent screens |
| `authorizationServerUrl` | reserved — parsed but not yet used |

## Config files & write-back

Six layers load in order, lowest → highest precedence (per-server field-level merge):

| # | File | Scope |
|---|------|-------|
| 1 | `~/.config/mcp/mcp.json` | Global (standard MCP location) |
| 2 | `~/.agents/mcp.json` | Cross-agent (home) |
| 3 | `~/.agents/mcp/mcp.json` | Cross-agent (home, alternate) |
| 4 | `<agentDir>/mcp.json` (agent directory is `$PI_CODING_AGENT_DIR`, defaulting to `~/.pi/agent`) | Pi agent directory |
| 5 | `<project>/.mcp.json` | Project-shared (committable) |
| 6 | `<project>/.pi/mcp.json` | Pi override — highest precedence |

The `mcp.json` files (including layer 4's `<agentDir>/mcp.json`) accept `//` comments and trailing commas (**JSONC**). That does not apply to Archimedes settings — `~/.pi/agent/settings.json` is **strict JSON**, parsed without comment support. When a higher-precedence layer changes a server's `url`, inherited `auth`/`headers`/`bearerTokenEnv` from lower layers are dropped — credentials are never sent to an endpoint you didn't explicitly configure them for.

Write-back targets:

- **`disabled` and `directTools`** → `<project>/.pi/mcp.json` (Pi override only; existing fields preserved verbatim)
- **New server definitions** (from `/mcp setup`) → `<project>/.mcp.json` (add-if-absent, never overwrites)

Changes take effect on the next `/reload`.

## Settings

`~/.pi/agent/settings.json`, under `archimedes.mcp` (strict JSON):

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

In the [suite](https://github.com/danielcherubini/pi-archimedes), the MCP adapter is registered with the rest — tool rendering uses core's chrome and colour palette, and a blocking OAuth loader triggers the notify extension's prompts. Standalone, the full feature set works independently. On/off in the suite is managed by `/plugins` (`archimedes.mcp.enabled`, default on).

← [Back to pi-archimedes](https://github.com/danielcherubini/pi-archimedes)
