# pi-archimedes

Visual polish and useful context for the Pi coding agent TUI — a pnpm workspace monorepo of pi extensions providing subagents, structured questions, diff rendering, notifications, and more.

## Language

**Bus**:
The global pub/sub event system (`globalThis` Symbol) that packages use to communicate. Events include `COST_UPDATE`, `ASK_REQUEST`, `TODOS_UPDATE`, `TODOS_CLEAR`.
_Avoid_: Event bus, message bus, event emitter

**Meta**:
The orchestrator package (`pi-archimedes`) that depends on all component packages, wires cross-package concerns, and composes the settings UI.
_Avoid_: Umbrella, root, orchestrator package

**Subagent**:
A child pi process dispatched by the main agent to handle a delegated task. Can be sync (blocking until completion) or async (fire-and-forget). Communicates via IPC.
_Avoid_: Child agent, worker, spawned agent

**Agent**:
A named subagent configuration (e.g. `general`, `reviewer`, `explore`) with optional model, tool, and system prompt overrides. Stored in YAML frontmatter in config files.
_Avoid_: Agent config, agent profile, persona

**Extension**:
A pi extension entry point (`register(pi: ExtensionAPI)`) — each package exports one. Loaded by pi via `pi.extensions` in `package.json`.
_Avoid_: Plugin, module, package entry

**pi-package**:
An npm package tagged with `"keywords": ["pi-package"]` that is loadable by pi's extension system. Requires `"pi": { "extensions": ["./src/index.ts"] }` in `package.json`.
_Avoid_: Pi plugin, pi extension package

## MCP terminology

**Proxy tool**:
The single `mcp` tool registered with pi that gateways to all MCP servers (search/describe/call/connect/status). Keeps the LLM context small — one tool instead of hundreds.
_Avoid_: Gateway tool, mcp gateway, dispatcher tool

**Direct tool**:
An individual MCP server tool registered with pi under a prefixed name (`serverName_toolName`), callable directly by the LLM without going through the proxy tool. Opt-in per server via `directTools`.
_Avoid_: Named tool, exposed tool, flat tool

**Metadata cache**:
The persistent `~/.pi/agent/mcp-cache.json` storing tool/resource/prompt metadata per server keyed by a config hash. Lets search/describe/direct-tool-registration work without live server connections.
_Avoid_: Tool cache, offline cache, schema cache

**needs-auth**:
A first-class `ServerClient` connection status meaning the server returned HTTP 401 and requires OAuth. Distinct from a generic `error`. Resolved by `/mcp auth <server>` or in-panel auth (`[a]`/`enter` in `/mcp panel`).
_Avoid_: Unauthorized, auth-required, unauthenticated

**Callback server**:
The singleton local HTTP server (default port 19876) that receives the OAuth browser redirect during `/mcp auth`, in-panel auth, or auto-auth; validates the CSRF state, and hands the code back to the auth flow.
_Avoid_: Redirect server, OAuth server, local server

**Auth entry**:
The per-server credential record (tokens, client info, PKCE verifier) stored in the OS keyring under service `pi-archimedes-mcp.oauth`, keyed by `sha256-<hash of server name>`, chunked if over 1000 chars.
_Avoid_: Token record, credential entry, keyring entry

**Host config**:
Another agent tool's MCP configuration (Cursor, Claude Code, Claude Desktop, VSCode) that `/mcp setup` can discover and import into pi's config. JSON-only (Codex TOML deferred).
_Avoid_: Foreign config, external config, imported config

**Config write-back**:
Writing a changed field (`disabled`, `directTools`) back to the project-local `.pi/mcp.json` override — always that file, only the changed field, never copying credentials (see ADR 0002).
_Avoid_: Config save, config persist, config update
