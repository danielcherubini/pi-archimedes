import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadMcpConfig, loadServerDefs, loadAllServerDefs, resolveServerSettings } from "./config.js";
import { autoAuthenticate, needsAuthToolResult } from "./auto-auth.js";
import { registerMcpCommand } from "./commands.js";
import {
  filterDirectTools,
  pruneRegisteredNames,
  registerDirectTools,
} from "./direct-tools.js";
import { LifecycleManager } from "./lifecycle.js";
import { getCachedPrompts, getCachedTools, recordClientOutcome } from "./metadata-cache.js";
import { ServerManager } from "./server-manager.js";
import type { ServerClient } from "./server-client.js";
import {
  getServerPrefix,
  matchRawToolName,
  resolveServerFromToolName,
  resolveServerRef,
} from "./tool-naming.js";
import type { CachedTool, McpConfig, ServerDef } from "./types.js";
import { renderProxyCall, renderProxyResult, type RenderContext } from "./renderer.js";

// ── Module-level server manager (survives session restarts) ─────────────────

let manager = new ServerManager();
let _idleTimeoutMinutes = 10; // updated in session_start from config

// ── Test seams ──────────────────────────────────────────────────────────────
// Unit tests swap the module-level manager and the config loaders so the
// proxy's execute() can be exercised without touching real files or
// spawning real server processes.
let seamDefs: (() => Record<string, ServerDef>) | null = null;
let seamAllDefs: (() => Record<string, ServerDef>) | null = null;
let seamConfig: (() => McpConfig) | null = null;

/** Test-only: replace the module-level manager and/or config loaders. */
export function setIndexSeamsForTest(seams: {
  manager?: ServerManager;
  loadServerDefs?: () => Record<string, ServerDef>;
  loadAllServerDefs?: () => Record<string, ServerDef>;
  loadMcpConfig?: () => McpConfig;
} | null): void {
  if (seams) {
    if (seams.manager) manager = seams.manager;
    seamDefs = seams.loadServerDefs ?? null;
    seamAllDefs = seams.loadAllServerDefs ?? null;
    seamConfig = seams.loadMcpConfig ?? null;
  } else {
    seamDefs = null;
    seamAllDefs = null;
    seamConfig = null;
    // Fully restore initial state: discard any swapped-in manager (its fake
    // clients/state must not leak into subsequent tests) and rebind the
    // lifecycle to the fresh module-level manager so both agree again.
    manager = new ServerManager();
    lifecycle.setManager(manager);
  }
}

/** Config-loader indirection: seam overrides win, real loaders otherwise */
const loadDefs = (): Record<string, ServerDef> => seamDefs?.() ?? loadServerDefs();
const loadAllDefs = (): Record<string, ServerDef> => seamAllDefs?.() ?? loadAllServerDefs();
const loadCfg = (): McpConfig => seamConfig?.() ?? loadMcpConfig();

/**
 * Resolve a tool reference (raw name OR final prefixed name) to the owning
 * server and the raw server tool name. Prefixed lookups use each server's
 * OWN prefix mode, exactly as the call path does.
 */
function resolveToolRef(
  ref: string,
  defs: Record<string, ServerDef>,
  config: McpConfig,
  allTools: Array<CachedTool & { serverName: string }>,
): { serverName: string; rawName: string } | undefined {
  // 1. Exact raw name
  const rawHit = allTools.find((t) => t.name === ref);
  if (rawHit) return { serverName: rawHit.serverName, rawName: rawHit.name };
  // 2. Final prefixed name → owning server → format-match the raw tool name
  const servers = Object.entries(defs).map(([name, def]) => ({
    name,
    prefix: resolveServerSettings(def, config).toolPrefix,
  }));
  const serverName = resolveServerFromToolName(ref, servers);
  const def = serverName ? defs[serverName] : undefined;
  if (!serverName || !def) return undefined;
  const prefixMode = resolveServerSettings(def, config).toolPrefix;
  const rawName = matchRawToolName(
    ref,
    serverName,
    prefixMode,
    manager.getToolsForServer(serverName, def),
  );
  return rawName !== undefined ? { serverName, rawName } : undefined;
}

// Health-check interval: reconnects downed keep-alive servers and closes
// idle non-keep-alive servers past their idleTimeout. unref'd, so it never
// keeps the process alive; stopped on session_shutdown.
const lifecycle = new LifecycleManager(manager, loadServerDefs, () => _idleTimeoutMinutes);

// ── Tool registration ───────────────────────────────────────────────────────

export function registerMcp(pi: ExtensionAPI): void {
  // The /mcp command family (plan-027 Task 2): /mcp [status|tools|prompts|
  // reconnect|enable|disable|logout|auth|panel|setup]. The command registry
  // contains ONLY "mcp" — the standalone /mcp-auth + /mcp-logout commands
  // are retired (their bodies live in commands-auth.ts, called via
  // /mcp auth / /mcp logout).
  registerMcpCommand(pi, {
    getManager: () => manager,
    // loadAllServerDefs includes disabled servers — they still have status.
    // seamAllDefs indirection: real loader in production, stable fixture in
    // tests (the same seam-discipline as loadDefs/loadCfg).
    getServerDefs: () => loadAllDefs(),
    getCachedTools,
    getCachedPrompts,
  });

  // session_shutdown must be registered at the TOP LEVEL of registerMcp,
  // NOT inside session_start — per AGENTS.md rule (prevents handler accumulation on /reload)
  pi.on("session_shutdown", async () => {
    lifecycle.stop();
    await manager.closeAll();
  });

  pi.on("session_start", async () => {
    // Re-sync server definitions on every session start (picks up config changes)
    const defs = loadDefs();
    manager.sync(defs);

    const config = loadCfg();
    _idleTimeoutMinutes = config.idleTimeout;
    lifecycle.start(); // idempotent — safe across /reload

    // ── Cache-first direct tool registration ───────────────────────────────
    // Register direct tools from the metadata cache: NO server is connected
    // at startup (no connect storm). Servers without a valid cache (first run)
    // are probed in the background, fire-and-forget — session_start does not
    // wait for them, and their tools register once each probe settles.
    const resolveClient = async (name: string): Promise<ServerClient> => {
      const client = manager.getClient(name);
      if (!client) throw new Error(`Server "${name}" is no longer configured`);
      try {
        await client.connect();
      } finally {
        // ADR 0004 settle point: direct-tool lazy connect.
        recordClientOutcome(client);
      }
      return client;
    };
    const registerFromTools = (serverName: string, def: ServerDef, tools: CachedTool[]): void => {
      const settings = resolveServerSettings(def, config);
      if (settings.directTools === false) return;
      registerDirectTools(pi, {
        serverName,
        prefix: settings.toolPrefix,
        tools: filterDirectTools(tools, settings),
        autoAuth: () => loadCfg().autoAuth,
        resolveClient,
      });
    };

    // Drop tracked names from servers that are no longer configured, so a
    // removed server cannot keep blocking a surviving server's identical
    // final name (e.g. under toolPrefix "none").
    pruneRegisteredNames(new Set(Object.keys(defs)));

    const probeTargets: Array<{ name: string; def: ServerDef }> = [];
    for (const [name, def] of Object.entries(defs)) {
      const cached = getCachedTools(name, def);
      if (cached) {
        registerFromTools(name, def, cached);
      } else {
        probeTargets.push({ name, def });
      }
    }

    if (probeTargets.length > 0) {
      void Promise.allSettled(
        probeTargets.map(async ({ name, def }) => {
          const client = manager.getClient(name);
          if (!client) return;
          try {
            await client.connect();
            // A concurrent session_start (e.g. /reload) may have replaced this
            // client while we were connecting: sync() closed it, so the
            // generation fence made connect() resolve normally with EMPTY
            // tools. Registering from that stale client would run a zero-tool
            // pass, evicting the names the current session's probe just
            // registered (and re-registering duplicates on the next start).
            if (manager.getClient(name) !== client) return; // superseded
            // A 401 surfaces as status 'needs-auth' (connect() does not
            // throw) — record it (ADR 0004) and warn clearly instead of
            // silently registering 0 tools.
            if (client.status === "needs-auth") {
              recordClientOutcome(client);
              console.warn(
                `[mcp] server "${name}" requires authentication (${client.error ?? "token missing or rejected"}) — no tools registered`,
              );
              return;
            }
            // ADR 0004 settle point: probe success.
            recordClientOutcome(client);
            const tools: CachedTool[] = client.tools.map((t) => {
              const cached: CachedTool = { name: t.name, inputSchema: t.inputSchema };
              if (t.description !== undefined) cached.description = t.description;
              return cached;
            });
            registerFromTools(name, def, tools);
          } catch (e) {
            // A connect failure settles the client into "error" — persist
            // that outcome (ADR 0004 settle point: probe error) so the
            // failure is visible in /mcp status across sessions.
            recordClientOutcome(client);
            // Probe failure is logged, not thrown — the proxy tool will still
            // surface the error on first use of a tool from this server.
            console.warn(
              `[mcp] background probe for server "${name}" failed: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }),
      );
    }
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
      "Other actions:",
      "  Status:  mcp({}) or mcp({ action: 'status' }) — list all servers and their connection status",
      "  List:    mcp({ server: 'name' }) — list all tools on a specific server",
      "  Connect: mcp({ connect: 'name' }) — eagerly connect to a server",
      "",
      "Use 'server' to disambiguate when two servers export a tool with the same name.",
    ].join("\n"),

    parameters: Type.Object({
      tool: Type.Optional(
        Type.String({ description: "Tool name to call" }),
      ),
      args: Type.Optional(
        Type.Union([
          Type.String({ description: "Tool arguments as a JSON string" }),
          Type.Object({}, { additionalProperties: true, description: "Tool arguments as an object" }),
        ]),
      ),
      search: Type.Optional(
        Type.String({ description: "Search tools by name/description keyword" }),
      ),
      describe: Type.Optional(
        Type.String({ description: "Tool name to show full parameter schema for" }),
      ),
      connect: Type.Optional(
        Type.String({ description: "Server name to eagerly connect" }),
      ),
      server: Type.Optional(
        Type.String({ description: "Filter to a specific server (for list, search, or disambiguating calls)" }),
      ),
      action: Type.Optional(
        Type.String({ description: "Action string (e.g. 'status')" }),
      ),
    }),

    renderCall(args: unknown, theme: Theme, context: unknown) {
      const typedContext = context as RenderContext;
      return renderProxyCall(args as Record<string, unknown>, theme, typedContext);
    },

    renderResult(result: unknown, options: unknown, theme: Theme, context: unknown) {
      const typedResult = result as { content: Array<{ type: string; text?: string }>; details?: Record<string, unknown> };
      const typedOptions = options as { expanded?: boolean; isPartial?: boolean };
      const typedContext = context as RenderContext;
      return renderProxyResult(typedResult, typedOptions, theme, typedContext);
    },

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const p = params as {
        tool?: string;
        args?: string | Record<string, unknown>;
        search?: string;
        describe?: string;
        connect?: string;
        server?: string;
        action?: string;
      };

      // ── status (no meaningful params; action:'status' is an alias) ────────────────────────────────────
      if (
        !p.tool &&
        !p.search &&
        !p.describe &&
        !p.connect &&
        !p.server &&
        (p.action === undefined || p.action === "status")
      ) {
        const defs = loadDefs();
        manager.sync(defs);
        const clients = manager.getClients();
        const lines =
          clients.length === 0
            ? ["No MCP servers configured."]
            : clients.map(
                (c) =>
                  `${c.name}: ${c.status}${c.error ? ` (${c.error})` : ""}`,
              );
        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: {},
        };
      }

      // ── connect ──────────────────────────────────────────────────────────
      if (p.connect) {
        const defs = loadDefs();
        manager.sync(defs);
        const client = manager.getClient(p.connect);
        if (!client) {
          return {
            content: [{ type: "text" as const, text: `Unknown server: ${p.connect}` }],
            details: {},
          };
        }
        // ADR 0004 settle point: proxy p.connect action — recorded in
        // `finally` so a failed connect ("error") persists too.
        try {
          await client.connect();
        } finally {
          recordClientOutcome(client);
        }
        // A 401 surfaces as status 'needs-auth' (connect() does not throw) —
        // reporting that as "Connected with 0 tools" would be a lie.
        if (client.status === "needs-auth") {
          return {
            content: [
              {
                type: "text" as const,
                text: `Server ${p.connect} requires authentication: ${client.error ?? "token missing or rejected"}`,
              },
            ],
            details: { server: p.connect, status: "needs-auth" },
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Connected to ${p.connect}. ${client.tools.length} tools available.`,
            },
          ],
          details: { server: p.connect, toolCount: client.tools.length },
        };
      }

      // ── search ───────────────────────────────────────────────────────────
      if (p.search) {
        // Served from live + metadata cache — no server connections
        const defs = loadDefs();
        manager.sync(defs);
        const config = loadCfg();
        const allTools = manager.getAllToolsWithCache(defs);
        const find = (query: string, serverFilter: string | undefined) =>
          allTools.filter(
            (t) =>
              (!serverFilter || t.serverName === serverFilter) &&
              (t.name.toLowerCase().includes(query) ||
                (t.description ?? "").toLowerCase().includes(query)),
          );
        let results = find(p.search.toLowerCase(), p.server);
        if (results.length === 0) {
          // The query may be a final prefixed name (e.g. "srv_a_b" for
          // tool "a.b"): resolve it and retry with the raw tool name.
          const ref = resolveToolRef(p.search, defs, config, allTools);
          if (ref) results = find(ref.rawName.toLowerCase(), ref.serverName);
        }
        if (results.length === 0) {
          return {
            content: [{ type: "text" as const, text: `No tools matching "${p.search}"` }],
            details: {},
          };
        }
        const text = results
          .map((t) => `${t.name} (${t.serverName})\n  ${t.description ?? "(no description)"}`)
          .join("\n\n");
        return { content: [{ type: "text" as const, text }], details: {} };
      }

      // ── describe ─────────────────────────────────────────────────────────
      if (p.describe) {
        // Served from live + metadata cache — no server connections
        const defs = loadDefs();
        manager.sync(defs);
        const config = loadCfg();
        const allTools = manager.getAllToolsWithCache(defs);
        let tool = allTools.find((t) => t.name === p.describe);
        // Also accept a final prefixed name (e.g. "srv_a_b" for tool "a.b")
        if (!tool) {
          const ref = resolveToolRef(p.describe, defs, config, allTools);
          if (ref) {
            tool = allTools.find(
              (t) => t.serverName === ref.serverName && t.name === ref.rawName,
            );
          }
        }
        if (!tool) {
          return {
            content: [{ type: "text" as const, text: `Tool not found: ${p.describe}` }],
            details: {},
          };
        }
        const schema = JSON.stringify(tool.inputSchema, null, 2);
        return {
          content: [
            {
              type: "text" as const,
              text: `${tool.name} (${tool.serverName})\n${tool.description ?? ""}\n\nSchema:\n${schema}`,
            },
          ],
          details: {},
        };
      }

      // ── list server (server param only, no tool) ─────────────────────────
      if (p.server && !p.tool) {
        const defs = loadDefs();
        manager.sync(defs);
        const config = loadCfg();
        let serverRef = p.server;
        let client = manager.getClient(serverRef);
        if (!client) {
          // Accept a prefixed tool-name reference instead of a bare server
          // name (e.g. "github" for server "github-mcp" under "short" mode)
          const servers = Object.entries(defs).map(([name, def]) => ({
            name,
            prefix: resolveServerSettings(def, config).toolPrefix,
          }));
          const resolved = resolveServerRef(serverRef, servers);
          if (resolved) {
            serverRef = resolved;
            client = manager.getClient(serverRef);
          }
        }
        if (!client) {
          return {
            content: [{ type: "text" as const, text: `Unknown server: ${p.server}` }],
            details: {},
          };
        }
        const def = defs[serverRef];
        // Live tools if connected, else valid cache
        const tools = def ? manager.getToolsForServer(serverRef, def) : client.tools;
        const lines = tools.map(
          (t) => `${t.name}: ${t.description ?? "(no description)"}`,
        );
        return {
          content: [{ type: "text" as const, text: lines.join("\n") || "(no tools)" }],
          details: { server: serverRef, toolCount: tools.length },
        };
      }

      // ── call tool ────────────────────────────────────────────────────────
      if (p.tool) {
        const defs = loadDefs();
        manager.sync(defs);
        const config = loadCfg();

        let serverName: string | undefined = p.server;
        let rawToolName: string = p.tool;

        if (!serverName) {
          // First: resolve the final prefixed name against each server's ACTUAL
          // prefix mode (per-server def, falling back to the global config).
          const servers = Object.entries(defs).map(([name, def]) => ({
            name,
            prefix: resolveServerSettings(def, config).toolPrefix,
          }));
          const resolved = resolveServerFromToolName(p.tool, servers);
          const resolvedDef = resolved ? defs[resolved] : undefined;
          if (resolved && resolvedDef) {
            const prefixMode = resolveServerSettings(resolvedDef, config).toolPrefix;
            serverName = resolved;
            // Resolve the RAW tool name by format-matching against the
            // owning server's tool list — never by slicing the prefixed
            // name. Slicing cannot reverse the `.`→`_` sanitization, so
            // tool "a.b" would be called as "a_b" and miss on the server.
            const tools = manager.getToolsForServer(resolved, resolvedDef);
            const raw = matchRawToolName(p.tool, resolved, prefixMode, tools);
            if (raw !== undefined) {
              rawToolName = raw;
            } else {
              // Last resort (tool missing from the live list/cache, e.g.
              // the server added it since the cache was written): strip
              // the prefix. Lossless only for dot-free tool names.
              const prefixStr = getServerPrefix(resolved, prefixMode);
              rawToolName = p.tool.slice(prefixStr.length + 1);
            }
          }
          // Fallback: raw (unprefixed) tool-name lookup across live + cached
          // metadata, so existing raw-name calls keep working.
          if (!serverName) {
            const toolDef = manager.getAllToolsWithCache(defs).find((t) => t.name === p.tool);
            serverName = toolDef?.serverName;
          }
        } else {
          // An explicit server was given — but the tool may STILL be a final
          // prefixed name (e.g. mcp({ tool: "srv_a_b", server: "srv" })). Try
          // format-matching against that server's own tool list first; if no
          // tool formats to it, use p.tool as the raw name (existing behavior).
          const def = defs[serverName];
          if (def) {
            const prefixMode = resolveServerSettings(def, config).toolPrefix;
            const tools = manager.getToolsForServer(serverName, def);
            const raw = matchRawToolName(p.tool, serverName, prefixMode, tools);
            if (raw !== undefined) rawToolName = raw;
          }
        }

        if (!serverName) {
          return {
            content: [{ type: "text" as const, text: `Tool not found: ${p.tool}` }],
            details: {},
          };
        }

        const client = manager.getClient(serverName);
        if (!client) {
          return {
            content: [{ type: "text" as const, text: `Server not found: ${serverName}` }],
            details: {},
          };
        }

        // Parse args: string → JSON (with error handling), object → use as-is, undefined → {}
        let toolArgs: Record<string, unknown>;
        if (typeof p.args === "string") {
          try {
            toolArgs = JSON.parse(p.args) as Record<string, unknown>;
          } catch (e) {
            return {
              content: [{ type: "text" as const, text: `Invalid JSON in args: ${e instanceof Error ? e.message : String(e)}` }],
              isError: true,
              details: {},
            };
          }
        } else {
          toolArgs = (p.args ?? {}) as Record<string, unknown>;
        }

        // Connect the owning server (callTool would connect lazily anyway)
        // so a 401 surfaces here as `needs-auth`: guidance by default,
        // inline auto-auth + one retry when autoAuth is on.
        // ADR 0004 settle point: proxy p.tool lazy connect — recorded in
        // `finally` so a failed connect ("error") persists too.
        try {
          await client.connect();
        } finally {
          recordClientOutcome(client);
        }
        if (client.status === "needs-auth") {
          if (!config.autoAuth) {
            return needsAuthToolResult(serverName);
          }
          const outcome = await autoAuthenticate(ctx, client);
          if (!outcome.proceed) {
            return needsAuthToolResult(serverName, outcome.error);
          }
        }

        // The call below is the (single) retry after a successful auto-auth
        const result = await client.callTool(rawToolName, toolArgs, signal);
        // Cast MCP ContentBlock[] to pi's (TextContent | ImageContent)[]
        // Both are discriminated unions on `type`; we only surface text + image blocks
        const content = result.content as Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
        return {
          content,
          details: { server: serverName, tool: rawToolName },
          isError: result.isError,
        };
      }

      // ── fallback ─────────────────────────────────────────────────────────
      return {
        content: [{ type: "text" as const, text: "Unknown action" }],
        details: {},
      };
    },
  });
}
