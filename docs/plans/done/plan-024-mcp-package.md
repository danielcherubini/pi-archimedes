# MCP Package Plan

**Goal:** Build `@pi-archimedes/mcp` — a full MCP client adapter for pi that replaces `pi-mcp-adapter`, reads config from `settings.json` like every other pi-archimedes package, and renders tool calls with pi-native TUI styling (cyan tool name, orange target, dark background box, theme-aware).

**Architecture:** A standalone pi extension package under `packages/mcp/` that registers a single `"mcp"` proxy tool plus individual direct tools per MCP server. It manages server lifecycles (lazy stdio spawn / HTTP connect), discovers tools via `tools/list`, routes calls via `tools/call`, and renders everything using `Text(0, 0)` + `lastComponent` reuse against pi's default Box shell — the same pattern as `packages/subagent`. Config lives in `archimedes.mcp` in `~/.pi/agent/settings.json`; MCP server definitions live in `~/.config/mcp/mcp.json` (standard path, read-only by this package).

**Tech Stack:** `@modelcontextprotocol/sdk` (v1, stdio + HTTP transports), `@pi-archimedes/core` (settings-io, bus), `@earendil-works/pi-coding-agent` (ExtensionAPI, Theme), `@earendil-works/pi-tui` (Text, Container)

---

### Task 1: Scaffold the package

**Context:**
This task creates the bare package structure — `package.json`, `tsconfig.json`, and a stub `src/index.ts` — and wires it into the monorepo (meta, release workflow, AGENTS.md, README.md). Until this task is complete, none of the other tasks can run type-checks or be imported by meta. This mirrors exactly how every other package in the monorepo was added (see `packages/notify/` as the canonical reference).

**Files:**
- Create: `packages/mcp/package.json`
- Create: `packages/mcp/tsconfig.json`
- Create: `packages/mcp/src/index.ts`
- Modify: `meta/package.json` — add `"@pi-archimedes/mcp": "workspace:*"` to `dependencies`
- Modify: `meta/src/index.ts` — import and call `registerMcp` in `session_start` (lazy, parallel with diff/subagent/image-paste)
- Modify: `.github/workflows/release.yml` — add publish step for `@pi-archimedes/mcp` after `subagent` and before `meta`
- Modify: `AGENTS.md` — add `packages/mcp` to the Monorepo Structure list; bump the "all 10 package versions" count to 11; bump the "10 package directories" type-check count to 11; add to publish-order line
- Modify: `README.md` — add feature section, monorepo layout tree entry, install line, settings table entry

**What to implement:**

`packages/mcp/package.json`:
```json
{
  "name": "@pi-archimedes/mcp",
  "version": "2.2.0",
  "type": "module",
  "keywords": ["pi-package"],
  "description": "Full MCP client adapter with pi-native TUI rendering for pi-archimedes",
  "files": ["src"],
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.15.0",
    "@pi-archimedes/core": "workspace:*"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.1.0",
    "@earendil-works/pi-tui": ">=0.1.0",
    "typebox": ">=1.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typebox": "^1.1.38",
    "typescript": "^6.0.3"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

`packages/mcp/tsconfig.json`: copy from `packages/notify/tsconfig.json` (extends `../../tsconfig.json`, outDir `dist`, rootDir `src`, include `src`).

`packages/mcp/src/index.ts`: export a stub `registerMcp(pi: ExtensionAPI): void` function that registers a `session_start` handler and logs `"[mcp] loaded"`. No real logic yet — just enough to confirm wiring works.

`meta/src/index.ts`: add `import { registerMcp } from "@pi-archimedes/mcp"` to the lazy-load block inside `session_start`, alongside the existing `diff`/`image-paste`/`subagent` parallel imports:
```typescript
const [diffMod, ipMod, saMod, mcpMod] = await Promise.all([
  import("@pi-archimedes/diff").catch(...),
  import("@pi-archimedes/image-paste").catch(...),
  import("@pi-archimedes/subagent").catch(...),
  import("@pi-archimedes/mcp").catch((e) => { console.error("[archimedes] mcp load failed:", e); return null; }),
]);
// ...
if (mcpMod) {
  mcpMod.registerMcp(pi);
}
```

**Steps:**
- [ ] Create `packages/mcp/package.json` with the content above
- [ ] Create `packages/mcp/tsconfig.json` (copy from `packages/notify/tsconfig.json`)
- [ ] Create `packages/mcp/src/index.ts` with stub `registerMcp`
- [ ] Run `pnpm install` from the monorepo root to link the workspace dep
- [ ] Update `meta/package.json` — add `"@pi-archimedes/mcp": "workspace:*"` to `dependencies`
- [ ] Update `meta/src/index.ts` — add the lazy import and `registerMcp(pi)` call
- [ ] Run `npx tsc --noEmit` in `packages/mcp/` — must pass with 0 errors
- [ ] Run `npx tsc --noEmit` in `meta/` — must pass with 0 errors
- [ ] Update `.github/workflows/release.yml` — add publish step after subagent, before meta
- [ ] Update `AGENTS.md` — package list, counts, publish order
- [ ] Update `README.md` — feature section, tree, install line, settings table
- [ ] Commit: `feat(mcp): scaffold @pi-archimedes/mcp package`

**Acceptance criteria:**
- [ ] `packages/mcp/package.json` has `"pi": { "extensions": ["./src/index.ts"] }` and `"keywords": ["pi-package"]`
- [ ] `npx tsc --noEmit` passes in both `packages/mcp/` and `meta/`
- [ ] `pnpm install` succeeds with no workspace resolution errors
- [ ] `release.yml` has the mcp publish step in correct dependency order

---

### Task 2: Config and MCP server definition loading

**Context:**
Before any MCP server can be connected to, the package needs to know what servers exist and how to reach them. This task implements the config layer: reading the package's own settings from `archimedes.mcp` in `settings.json` (using the existing `loadConfig`/`saveConfig` from `@pi-archimedes/core/settings-io`), and reading MCP server definitions from the standard config file locations. The server definition format follows the MCP standard (`mcpServers` map with `command`/`args`/`env` for stdio, `url`/`auth` for HTTP).

Config files are read in precedence order (highest to lowest):
1. `.pi/mcp.json` (project override)
2. `~/.pi/agent/mcp.json` (pi global override)  
3. `.mcp.json` (project shared)
4. `~/.config/mcp/mcp.json` (user global shared)

Entries from higher-precedence files override same-named servers from lower-precedence files.

**Files:**
- Create: `packages/mcp/src/config.ts`
- Create: `packages/mcp/src/types.ts`

**What to implement:**

`packages/mcp/src/types.ts` — all shared TypeScript interfaces:
```typescript
/** A stdio-based MCP server (spawns a child process) */
export interface StdioServerDef {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
}

/** An HTTP-based MCP server (Streamable HTTP or SSE) */
export interface HttpServerDef {
  type: "http" | "sse";
  url: string;
  auth?: "oauth" | { token: string };
  disabled?: boolean;
}

export type ServerDef = StdioServerDef | HttpServerDef;

export interface McpFileConfig {
  mcpServers?: Record<string, ServerDef>;
  settings?: McpFileSettings;
}

/** Settings that can appear in the mcp config files (not archimedes.mcp) */
export interface McpFileSettings {
  [key: string]: unknown;
}

/** Settings read from archimedes.mcp in settings.json */
export interface McpConfig {
  /** Show direct tools per server in the tool list (default: true) */
  directTools: boolean;
  /** Max collapsed result lines (default: 3) */
  collapsedResultLines: 1 | 2 | 3;
}

export const DEFAULT_MCP_CONFIG: McpConfig = {
  directTools: true,
  collapsedResultLines: 3,
};

export const MCP_NAMESPACE = "archimedes.mcp";
```

`packages/mcp/src/config.ts`:

```typescript
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { cwd } from "node:process";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadConfig, saveConfig } from "@pi-archimedes/core/settings-io";
import type { McpConfig, McpFileConfig, ServerDef } from "./types.js";
import { DEFAULT_MCP_CONFIG, MCP_NAMESPACE } from "./types.js";

/** Load archimedes.mcp section from settings.json */
export function loadMcpConfig(): McpConfig {
  return loadConfig(MCP_NAMESPACE, DEFAULT_MCP_CONFIG);
}

export function saveMcpConfig(config: McpConfig): void {
  saveConfig(MCP_NAMESPACE, config);
}

/** Parse one mcp.json file, returning null on error */
function parseFile(path: string): McpFileConfig | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as McpFileConfig;
  } catch {
    return null;
  }
}

/**
 * Load and merge all MCP server definitions from the standard config locations.
 * Higher-index entries override lower-index (later = higher precedence).
 * Disabled servers are excluded.
 */
export function loadServerDefs(workingDir?: string): Record<string, ServerDef> {
  const wd = workingDir ?? cwd();
  const paths = [
    join(homedir(), ".config", "mcp", "mcp.json"),         // lowest precedence
    join(getAgentDir(), "mcp.json"),
    join(wd, ".mcp.json"),
    join(wd, ".pi", "mcp.json"),                            // highest precedence
  ];

  const merged: Record<string, ServerDef> = {};
  for (const p of paths) {
    const parsed = parseFile(p);
    if (!parsed?.mcpServers) continue;
    for (const [name, def] of Object.entries(parsed.mcpServers)) {
      merged[name] = def;
    }
  }

  // Filter out disabled servers
  return Object.fromEntries(
    Object.entries(merged).filter(([, def]) => def.disabled !== true)
  );
}
```

**Steps:**
- [ ] Create `packages/mcp/src/types.ts` with all interfaces above
- [ ] Create `packages/mcp/src/config.ts` with `loadMcpConfig`, `saveMcpConfig`, `loadServerDefs`
- [ ] Run `npx tsc --noEmit` in `packages/mcp/` — must pass with 0 errors
- [ ] Commit: `feat(mcp): config and server definition loading`

**Acceptance criteria:**
- [ ] `loadServerDefs()` merges configs in the right precedence order
- [ ] Disabled servers (`disabled: true`) are excluded
- [ ] Missing or malformed files are silently skipped (no throw)
- [ ] `loadMcpConfig()` returns defaults when `archimedes.mcp` is absent
- [ ] `npx tsc --noEmit` passes with 0 errors

---

### Task 3: MCP server client and lifecycle manager

**Context:**
This task implements the core MCP client layer — connecting to servers, discovering their tools, calling tools, and managing the server lifecycle (lazy connect on first use, reconnect on disconnect, graceful shutdown). Each server gets its own `ServerClient` instance. The `ServerManager` holds all clients and is the single object the rest of the package talks to.

Uses `@modelcontextprotocol/sdk` v1 (already in the npm ecosystem, stable). For stdio servers: `StdioClientTransport` from `@modelcontextprotocol/sdk/client/stdio`. For HTTP servers: `StreamableHTTPClientTransport` with `SSEClientTransport` fallback from `@modelcontextprotocol/sdk/client/index`.

SDK API (v1):
- `import { Client } from "@modelcontextprotocol/sdk/client/index.js"`
- `import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"`
- `import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"`
- `client.connect(transport)` — async, resolves when handshake complete
- `client.listTools()` — returns `{ tools: Tool[] }` where `Tool = { name, description?, inputSchema }`
- `client.callTool({ name, arguments })` — returns `{ content: ContentBlock[], isError?: boolean }`
- `client.close()` — async, shuts down transport

**Files:**
- Create: `packages/mcp/src/server-client.ts`
- Create: `packages/mcp/src/server-manager.ts`

**What to implement:**

`packages/mcp/src/server-client.ts`:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse";
import type { Tool } from "@modelcontextprotocol/sdk/types";
import type { ServerDef } from "./types.js";

export type ServerStatus = "disconnected" | "connecting" | "connected" | "error";

export interface McpTool extends Tool {
  serverName: string;
}

export class ServerClient {
  readonly name: string;
  private def: ServerDef;
  private client: Client | null = null;
  private _status: ServerStatus = "disconnected";
  private _tools: McpTool[] = [];
  private _error: string | null = null;
  private connectPromise: Promise<void> | null = null;

  constructor(name: string, def: ServerDef) {
    this.name = name;
    this.def = def;
  }

  get status(): ServerStatus { return this._status; }
  get tools(): McpTool[] { return this._tools; }
  get error(): string | null { return this._error; }

  /** Lazily connect — idempotent, safe to call multiple times */
  async connect(): Promise<void> {
    if (this._status === "connected") return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this._doConnect().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async _doConnect(): Promise<void> {
    this._status = "connecting";
    this._error = null;
    try {
      this.client = new Client({ name: "pi-archimedes-mcp", version: "1.0.0" }, {});

      let transport;
      if (!this.def.type || this.def.type === "stdio") {
        const def = this.def as import("./types.js").StdioServerDef;
        transport = new StdioClientTransport({
          command: def.command,
          args: def.args ?? [],
          env: { ...process.env, ...(def.env ?? {}) } as Record<string, string>,
        });
      } else {
        const def = this.def as import("./types.js").HttpServerDef;
        // Try StreamableHTTP first (modern standard), fall back to SSE for legacy servers
        try {
          transport = new StreamableHTTPClientTransport(new URL(def.url));
        } catch {
          transport = new SSEClientTransport(new URL(def.url));
        }
      }

      // Reconnect on close
      transport.onclose = () => {
        this._status = "disconnected";
        this.client = null;
      };

      await this.client.connect(transport);
      this._status = "connected";

      // Discover tools immediately after connect
      const result = await this.client.listTools();
      this._tools = result.tools.map((t) => ({ ...t, serverName: this.name }));
    } catch (e) {
      this._status = "error";
      this._error = e instanceof Error ? e.message : String(e);
      this.client = null;
      throw e;
    }
  }

  /** Call a tool by name with arguments */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>; isError: boolean }> {
    await this.connect();
    if (!this.client) throw new Error(`Server ${this.name} not connected`);

    // Check abort before calling
    signal?.throwIfAborted();

    const result = await this.client.callTool({ name: toolName, arguments: args });
    return {
      content: result.content as Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>,
      isError: result.isError === true,
    };
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close().catch(() => {});
      this.client = null;
    }
    this._status = "disconnected";
  }
}
```

`packages/mcp/src/server-manager.ts`:

```typescript
import type { ServerDef, McpConfig } from "./types.js";
import { ServerClient } from "./server-client.js";
import type { McpTool } from "./server-client.js";

export class ServerManager {
  private clients = new Map<string, ServerClient>();

  /** Sync the client map to a new set of server definitions */
  sync(defs: Record<string, ServerDef>): void {
    // Close and remove servers that are gone
    for (const [name, client] of this.clients) {
      if (!(name in defs)) {
        void client.close();
        this.clients.delete(name);
      }
    }
    // Add new servers (don't connect yet — lazy)
    for (const [name, def] of Object.entries(defs)) {
      if (!this.clients.has(name)) {
        this.clients.set(name, new ServerClient(name, def));
      }
    }
  }

  getClient(name: string): ServerClient | undefined {
    return this.clients.get(name);
  }

  getClients(): ServerClient[] {
    return Array.from(this.clients.values());
  }

  /** All currently cached tools across all connected servers */
  getAllTools(): McpTool[] {
    return this.getClients().flatMap((c) => c.tools);
  }

  /** Search tools by name/description substring (case-insensitive) */
  searchTools(query: string, serverName?: string): McpTool[] {
    const q = query.toLowerCase();
    const clients = serverName
      ? [this.clients.get(serverName)].filter(Boolean) as ServerClient[]
      : this.getClients();
    return clients.flatMap((c) => c.tools).filter(
      (t) => t.name.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q)
    );
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.getClients().map((c) => c.close()));
    this.clients.clear();
  }
}
```

**Steps:**
- [ ] SDK is already declared in `package.json` from Task 1; run `pnpm install` from monorepo root to resolve it (no separate `pnpm add` needed)
- [ ] Create `packages/mcp/src/server-client.ts`
- [ ] Create `packages/mcp/src/server-manager.ts`
- [ ] Run `npx tsc --noEmit` in `packages/mcp/` — must pass with 0 errors
- [ ] Commit: `feat(mcp): server client and lifecycle manager`

**Acceptance criteria:**
- [ ] `ServerClient.connect()` is idempotent (multiple calls don't spawn multiple connections)
- [ ] `transport.onclose` sets status back to `"disconnected"` for reconnect on next call
- [ ] `callTool()` auto-connects if not already connected
- [ ] `ServerManager.sync()` closes removed servers and lazy-adds new ones
- [ ] `npx tsc --noEmit` passes with 0 errors

---

### Task 4: TUI rendering

**Context:**
This task implements the pi-native TUI rendering for both the proxy `mcp` tool and direct tools. The visual design: `mcp` label in bold cyan (`toolTitle`), action/target in orange (`accent`), args in muted (`muted`/`dim`), result output in `toolOutput`, errors in `error`, success checkmark in `success`. This matches the Dracula theme aesthetic of the subagent rendering (cyan tool name, orange agent name).

Uses Pattern A from the research: `Text(0, 0)` + `lastComponent` reuse, no `renderShell` (pi's default Box provides the dark background). This is the same pattern as `packages/subagent`.

The renderer lives in its own file so it can be unit-tested and reused for both proxy and direct tool registrations.

**Files:**
- Create: `packages/mcp/src/renderer.ts`

**What to implement:**

```typescript
import { Text } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";

import type { ToolRenderContext, ToolRenderResultOptions, Theme } from "@earendil-works/pi-coding-agent";

type ToolResult = {
  content: Array<{ type: string; text?: string }>;
  details?: Record<string, unknown>;
};

// Local convenience alias — the real ToolRenderContext has many more fields
// but we only use these in the renderer
type RenderContext = Pick<ToolRenderContext, "lastComponent" | "isError" | "expanded" | "isPartial" | "state">;

/** Format the mcp proxy tool call header line */
export function formatProxyCallTitle(args: {
  tool?: string;
  args?: unknown;
  search?: string;
  describe?: string;
  connect?: string;
  server?: string;
  action?: string;
}): string {
  if (args.tool) {
    const target = args.server ? `${args.tool} @ ${args.server}` : args.tool;
    return `call ${target}`;
  }
  if (args.search) return `search ${args.search}${args.server ? ` @ ${args.server}` : ""}`;
  if (args.describe) return `describe ${args.describe}`;
  if (args.connect) return `connect ${args.connect}`;
  if (args.action) return args.action;
  if (args.server) return `list ${args.server}`;
  return "status";
}

/** Render the mcp proxy tool call row */
export function renderProxyCall(
  args: Record<string, unknown>,
  theme: Theme,
  context: RenderContext,
): Component {
  const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
  const action = formatProxyCallTitle(args as Parameters<typeof formatProxyCallTitle>[0]);
  const argsStr = args.args
    ? "\n" + theme.fg("muted", formatArgs(args.args, 1200))
    : "";
  text.setText(
    theme.fg("toolTitle", theme.bold("mcp")) + " " + theme.fg("accent", action) + argsStr
  );
  return text;
}

/** Render the mcp proxy tool result row */
export function renderProxyResult(
  result: ToolResult,
  options: { expanded?: boolean; isPartial?: boolean },
  theme: Theme,
  context: RenderContext,
): Component {
  const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);

  if (options.isPartial) {
    text.setText(theme.fg("warning", "Running…"));
    return text;
  }

  if (context.isError) {
    const errText = result.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n")
      .slice(0, 2000);
    text.setText(theme.fg("error", errText || "Error"));
    return text;
  }

  const lines = result.content
    .filter((b) => b.type === "text")
    .flatMap((b) => (b.text ?? "").split("\n"));

  const maxLines = options.expanded ? lines.length : 3;
  const shown = lines.slice(0, maxLines);
  const truncated = lines.length > maxLines;

  let out = shown.map((l) => theme.fg("toolOutput", l)).join("\n");
  if (truncated) out += "\n" + theme.fg("dim", `… ${lines.length - maxLines} more lines (Ctrl+O to expand)`);

  text.setText(out || theme.fg("muted", "(empty result)"));
  return text;
}

/** Render a direct tool call row (e.g. atlassian_searchJiraIssuesUsingJql) */
export function renderDirectCall(
  displayName: string,
  args: Record<string, unknown>,
  theme: Theme,
  context: RenderContext,
): Component {
  const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
  const hasArgs = Object.keys(args).length > 0;
  const argsStr = hasArgs ? "\n" + theme.fg("muted", formatArgs(args, 1200)) : "";
  // Split displayName into serverPrefix and toolName for two-tone colouring:
  // e.g. "atlassian_searchJiraIssuesUsingJql" → "atlassian" cyan, "_searchJiraIssuesUsingJql" orange
  const under = displayName.indexOf("_");
  const [prefix, rest] = under > 0
    ? [displayName.slice(0, under), displayName.slice(under)]
    : ["mcp", "_" + displayName];
  text.setText(
    theme.fg("toolTitle", theme.bold(prefix)) + theme.fg("accent", rest) + argsStr
  );
  return text;
}

/** Render a direct tool result row */
export function renderDirectResult(
  result: ToolResult,
  options: { expanded?: boolean; isPartial?: boolean },
  theme: Theme,
  context: RenderContext,
): Component {
  // Reuse proxy result renderer — same logic
  return renderProxyResult(result, options, theme, context);
}

/** Format args as compact JSON, truncated to maxChars */
function formatArgs(args: unknown, maxChars: number): string {
  try {
    const s = typeof args === "string" ? args : JSON.stringify(args, null, 2);
    return s.length > maxChars ? s.slice(0, maxChars) + "…" : s;
  } catch {
    return String(args).slice(0, maxChars);
  }
}
```

**Steps:**
- [ ] Create `packages/mcp/src/renderer.ts` with all functions above
- [ ] Run `npx tsc --noEmit` in `packages/mcp/` — must pass with 0 errors
- [ ] Commit: `feat(mcp): pi-native TUI renderer`

**Acceptance criteria:**
- [ ] `renderProxyCall` shows `mcp` in `toolTitle` (cyan in Dracula), action in `accent` (orange)
- [ ] `renderDirectCall` shows server prefix in `toolTitle`, tool name in `accent`
- [ ] `renderProxyResult` respects `expanded` — collapsed shows 3 lines with truncation hint
- [ ] `isPartial: true` shows warning-coloured "Running…"
- [ ] `isError: true` shows error-coloured content
- [ ] All functions reuse `context.lastComponent` — no allocation if component already exists
- [ ] No `renderShell` — pi's default Box provides the dark background
- [ ] `npx tsc --noEmit` passes with 0 errors

---

### Task 5: Proxy tool registration and execute logic

**Context:**
This task wires together the config, server manager, renderer, and pi's `registerTool` API into the main proxy `"mcp"` tool. The proxy tool is the single entry point the LLM calls — it dispatches to the correct server based on `args.tool`, `args.search`, `args.describe`, etc.

The tool is registered with a rich description that tells the LLM how to use it: search first, then call. Direct tool registration (per-server individual tools) is handled in Task 6.

The `ServerManager` is created once per extension load and shared across sessions. It is re-synced on each `session_start` in case config changed.

**Files:**
- Modify: `packages/mcp/src/index.ts` — replace stub with full implementation

**What to implement:**

Replace the stub `src/index.ts` with the full implementation:

```typescript
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext, ToolRenderContext, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadMcpConfig, loadServerDefs } from "./config.js";
import { ServerManager } from "./server-manager.js";
import { renderProxyCall, renderProxyResult } from "./renderer.js";

const manager = new ServerManager();

export function registerMcp(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, _ctx: ExtensionContext) => {
    // Re-sync server definitions on every session start (picks up config changes)
    const defs = loadServerDefs();
    manager.sync(defs);
  });

  pi.on("session_shutdown", async () => {
    await manager.closeAll();
  });

  pi.registerTool({
    name: "mcp",
    label: "MCP",
    description: [
      "Gateway to MCP (Model Context Protocol) servers. Use this tool to discover and call tools from connected MCP servers.",
      "",
      "Workflow:",
      "1. Search: mcp({ search: 'keyword' }) — find available tools",
      "2. Describe: mcp({ describe: 'tool_name' }) — see full parameters",
      "3. Call: mcp({ tool: 'tool_name', args: { ... } }) — execute the tool",
      "",
      "Other actions: list (mcp({ server: 'name' })), status (mcp({})), connect (mcp({ connect: 'name' }))",
    ].join("\n"),
    parameters: Type.Object({
      tool:     Type.Optional(Type.String({ description: "Tool name to call" })),
      args:     Type.Optional(Type.Union([Type.String(), Type.Object({}, { additionalProperties: true })])),
      search:   Type.Optional(Type.String({ description: "Search tools by name/description" })),
      describe: Type.Optional(Type.String({ description: "Tool name to get full parameter schema" })),
      connect:  Type.Optional(Type.String({ description: "Server name to eagerly connect" })),
      server:   Type.Optional(Type.String({ description: "Filter to a specific server" })),
      action:   Type.Optional(Type.String({ description: "Action: 'status'" })),
    }),

    renderCall(args, theme, context) {
      return renderProxyCall(args as Record<string, unknown>, theme as { fg: (t: string, s: string) => string; bold: (s: string) => string }, context as { lastComponent?: import("@earendil-works/pi-tui").Component });
    },

    renderResult(result, options, theme, context) {
      return renderProxyResult(
        result as { content: Array<{ type: string; text?: string }>; details?: Record<string, unknown> },
        options,
        theme as { fg: (t: string, s: string) => string; bold: (s: string) => string },
        context as { lastComponent?: import("@earendil-works/pi-tui").Component; isError?: boolean },
      );
    },

    async execute(toolCallId, params, signal, onUpdate) {
      // ── status ──────────────────────────────────────────────────────────
      if (!params.tool && !params.search && !params.describe && !params.connect && !params.action) {
        const clients = manager.getClients();
        const lines = clients.length === 0
          ? ["No MCP servers configured."]
          : clients.map((c) => `${c.name}: ${c.status}${c.error ? ` (${c.error})` : ""}`);
        return { content: [{ type: "text", text: lines.join("\n") }], details: {} };
      }

      // ── connect ──────────────────────────────────────────────────────────
      if (params.connect) {
        const client = manager.getClient(params.connect);
        if (!client) return { content: [{ type: "text", text: `Unknown server: ${params.connect}` }], details: {} };
        await client.connect();
        return { content: [{ type: "text", text: `Connected to ${params.connect}. ${client.tools.length} tools available.` }], details: {} };
      }

      // ── search ──────────────────────────────────────────────────────────
      if (params.search) {
        // Auto-connect all servers to ensure tool lists are populated
        await Promise.allSettled(manager.getClients().map((c) => c.connect()));
        const results = manager.searchTools(params.search, params.server);
        if (results.length === 0) {
          return { content: [{ type: "text", text: `No tools matching "${params.search}"` }], details: {} };
        }
        const text = results.map((t) =>
          `${t.name}\n  ${t.description ?? "(no description)"}`
        ).join("\n\n");
        return { content: [{ type: "text", text }], details: {} };
      }

      // ── describe ─────────────────────────────────────────────────────────
      if (params.describe) {
        await Promise.allSettled(manager.getClients().map((c) => c.connect()));
        const all = manager.getAllTools();
        const tool = all.find((t) => t.name === params.describe);
        if (!tool) return { content: [{ type: "text", text: `Tool not found: ${params.describe}` }], details: {} };
        const schema = JSON.stringify(tool.inputSchema, null, 2);
        return { content: [{ type: "text", text: `${tool.name} (${tool.serverName})\n${tool.description ?? ""}\n\nSchema:\n${schema}` }], details: {} };
      }

      // ── list server ───────────────────────────────────────────────────────
      if (params.server && !params.tool) {
        const client = manager.getClient(params.server);
        if (!client) return { content: [{ type: "text", text: `Unknown server: ${params.server}` }], details: {} };
        await client.connect();
        const lines = client.tools.map((t) => `${t.name}: ${t.description ?? "(no description)"}`);
        return { content: [{ type: "text", text: lines.join("\n") || "(no tools)" }], details: {} };
      }

      // ── call tool ─────────────────────────────────────────────────────────
      if (params.tool) {
        // Find which server owns this tool
        await Promise.allSettled(manager.getClients().map((c) => c.connect()));
        const allTools = manager.getAllTools();
        const toolDef = allTools.find((t) => t.name === params.tool);
        const serverName = params.server ?? toolDef?.serverName;
        if (!serverName) {
          return { content: [{ type: "text", text: `Tool not found: ${params.tool}` }], details: {} };
        }
        const client = manager.getClient(serverName);
        if (!client) {
          return { content: [{ type: "text", text: `Server not found: ${serverName}` }], details: {} };
        }

        const toolArgs = typeof params.args === "string"
          ? JSON.parse(params.args) as Record<string, unknown>
          : (params.args ?? {}) as Record<string, unknown>;

        const result = await client.callTool(params.tool, toolArgs, signal);
        return {
          content: result.content,
          details: { server: serverName, tool: params.tool, isError: result.isError },
          ...(result.isError ? {} : {}),
        };
      }

      return { content: [{ type: "text", text: "Unknown action" }], details: {} };
    },
  });
}
```

**Steps:**
- [ ] Replace `packages/mcp/src/index.ts` with the full implementation above
- [ ] Run `npx tsc --noEmit` in `packages/mcp/` — must pass with 0 errors
- [ ] Run `npx tsc --noEmit` in `meta/` — must pass with 0 errors
- [ ] Restart pi and test: type a message asking pi to use the `mcp` tool to list servers — it should show the configured servers from `~/.config/mcp/mcp.json`
- [ ] Test search: ask pi to search for "jira" — should return Atlassian tools after lazy-connecting
- [ ] Test call: ask pi to call `atlassian_searchJiraIssuesUsingJql` via the proxy — should return results
- [ ] Verify rendering: the `mcp` label should appear in cyan (bold), the action in orange, dark background box around the whole row
- [ ] Commit: `feat(mcp): proxy tool registration and execute logic`

**Acceptance criteria:**
- [ ] `npx tsc --noEmit` passes in both `packages/mcp/` and `meta/`
- [ ] `mcp({})` returns server status list
- [ ] `mcp({ search: "jira" })` returns matching tools
- [ ] `mcp({ tool: "...", args: {...} })` calls the tool and returns results
- [ ] Tool call row renders with cyan `mcp` label and orange action (verified visually in pi)
- [ ] Dark background box appears around the tool call (default Box shell)

---

### Task 6: Direct tool registration

**Context:**
Direct tools are individually named entries in pi's tool registry — one per MCP tool, named `{serverName}_{toolName}`. The LLM can call them directly without going through the proxy. This is more token-efficient for common tools since the schema is directly in the tool definition. Direct tools are registered lazily after a server connects and its tools are discovered.

Each direct tool's `execute` just calls `client.callTool(originalName, args)` with no proxy overhead. Rendering uses `renderDirectCall` and `renderDirectResult` from the renderer.

The `McpConfig.directTools` setting (default `true`) controls whether direct tools are registered at all. When `directTools: false`, only the proxy `mcp` tool exists.

**Files:**
- Create: `packages/mcp/src/direct-tools.ts`
- Modify: `packages/mcp/src/index.ts` — call `registerDirectTools` after server connects

**What to implement:**

`packages/mcp/src/direct-tools.ts`:

```typescript
import type { ExtensionAPI, ToolRenderContext, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ServerClient, McpTool } from "./server-client.js";
import { renderDirectCall, renderDirectResult } from "./renderer.js";

/** Sanitise a server name into a safe tool name prefix: keep [A-Za-z0-9_], replace rest with _ */
function sanitizePrefix(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

/** Build the prefixed tool name: {serverPrefix}_{toolName} with dots → underscores */
export function buildDirectToolName(serverName: string, toolName: string): string {
  return `${sanitizePrefix(serverName)}_${toolName.replace(/\./g, "_")}`;
}

/**
 * Register all tools from a connected server as individual pi tools.
 * Returns the list of registered tool names so they can be tracked.
 */
export function registerDirectTools(
  pi: ExtensionAPI,
  client: ServerClient,
): string[] {
  const registered: string[] = [];

  for (const tool of client.tools) {
    const prefixedName = buildDirectToolName(client.name, tool.name);

    // Build a TypeBox schema from the JSON Schema inputSchema
    // For simplicity, accept any object (we let the MCP server validate args)
    const parameters = Type.Object({}, { additionalProperties: true });

    pi.registerTool({
      name: prefixedName,
      label: `MCP: ${tool.name}`,
      description: `[${client.name}] ${tool.description ?? "(no description)"}`,
      parameters,

      renderCall(args, theme, context) {
        return renderDirectCall(
          prefixedName,
          args as Record<string, unknown>,
          theme as { fg: (t: string, s: string) => string; bold: (s: string) => string },
          context as { lastComponent?: import("@earendil-works/pi-tui").Component },
        );
      },

      renderResult(result, options, theme, context) {
        return renderDirectResult(
          result as { content: Array<{ type: string; text?: string }>; details?: Record<string, unknown> },
          options,
          theme as { fg: (t: string, s: string) => string; bold: (s: string) => string },
          context as { lastComponent?: import("@earendil-works/pi-tui").Component; isError?: boolean },
        );
      },

      async execute(_toolCallId, params, signal) {
        const args = params as Record<string, unknown>;
        const result = await client.callTool(tool.name, args, signal);
        return {
          content: result.content,
          details: { server: client.name, tool: tool.name },
          ...(result.isError ? {} : {}),
        };
      },
    });

    registered.push(prefixedName);
  }

  return registered;
}
```

Modify `packages/mcp/src/index.ts` — in `session_start`, after `manager.sync(defs)`, eagerly connect all servers and register their direct tools if `config.directTools` is true:

```typescript
// After manager.sync(defs):
const config = loadMcpConfig();
if (config.directTools) {
  // Connect all servers in parallel and register direct tools
  await Promise.allSettled(
    manager.getClients().map(async (client) => {
      try {
        await client.connect();
        registerDirectTools(pi, client);
      } catch {
        // Server failed to connect — skip direct tools, proxy will show error
      }
    })
  );
}
```

**Steps:**
- [ ] Create `packages/mcp/src/direct-tools.ts`
- [ ] Modify `packages/mcp/src/index.ts` to import and call `registerDirectTools` in `session_start`
- [ ] Run `npx tsc --noEmit` in `packages/mcp/` — must pass with 0 errors
- [ ] Restart pi and verify: `atlassian_searchJiraIssuesUsingJql` (and other Atlassian tools) appear as directly callable tools
- [ ] Call one directly from pi — verify it works end-to-end
- [ ] Verify rendering: server prefix in cyan, tool name in orange, dark background box
- [ ] Test with `archimedes.mcp.directTools: false` in `settings.json` — direct tools should NOT be registered
- [ ] Commit: `feat(mcp): direct tool registration per server`

**Acceptance criteria:**
- [ ] Direct tools are registered with name format `{server}_{tool}` (dots → underscores)
- [ ] Each direct tool calls through to the correct server client
- [ ] `directTools: false` in settings suppresses registration
- [ ] `npx tsc --noEmit` passes with 0 errors
- [ ] Visual rendering matches the two-tone cyan/orange design

---

### Task 7: Monorepo wiring, type-check all packages, release prep

**Context:**
Final task: ensure all packages type-check clean, remove `pi-mcp-adapter` from `settings.json` packages (since this package replaces it), clean up the `toolResultRendering: "boxed"` workaround from `~/.config/mcp/mcp.json` (no longer needed — the new package uses pi's native default Box), and update the plan README.

**Files:**
- Modify: `~/.pi/agent/settings.json` — remove `"npm:pi-mcp-adapter"` from `packages`, add `"npm:@pi-archimedes/mcp"` (after publishing, or use the symlinked local version during dev)
- Modify: `~/.config/mcp/mcp.json` — remove the `settings.toolResultRendering` key (no longer needed)
- Modify: `docs/plans/README.md` — move plan-024 from Backlog to In Progress, then to Done

**What to implement:**

Run `npx tsc --noEmit` in each of the 11 package directories:
- `packages/core`
- `packages/ask`
- `packages/footer`
- `packages/diff`
- `packages/image-paste`
- `packages/subagent`
- `packages/todo`
- `packages/notify`
- `packages/session-name`
- `packages/mcp` ← new
- `meta`

Fix any errors before proceeding.

Remove `pi-mcp-adapter` from `~/.pi/agent/settings.json` packages array (since the new package is loaded via `pi-archimedes` meta, not installed separately).

Remove `settings.toolResultRendering` from `~/.config/mcp/mcp.json` — the new package doesn't use this file for rendering config; it reads from `settings.json` via `loadMcpConfig`.

**Steps:**
- [ ] Run `npx tsc --noEmit` in all 11 package directories — fix any errors
- [ ] Remove `"npm:pi-mcp-adapter"` from `~/.pi/agent/settings.json` packages
- [ ] Remove `"settings": { "toolResultRendering": "boxed" }` from `~/.config/mcp/mcp.json`
- [ ] Restart pi and verify everything works end-to-end (Jira search, tool calls, rendering)
- [ ] Update `docs/plans/README.md`
- [ ] Commit: `chore(mcp): full type-check pass, remove pi-mcp-adapter, clean up config`

**Acceptance criteria:**
- [ ] All 11 `npx tsc --noEmit` runs pass with 0 errors
- [ ] `pi-mcp-adapter` is no longer in `settings.json`
- [ ] MCP tool calls render with dark background, cyan label, orange target — without any config file workarounds
- [ ] `~/.config/mcp/mcp.json` contains only server definitions, no `settings` block
