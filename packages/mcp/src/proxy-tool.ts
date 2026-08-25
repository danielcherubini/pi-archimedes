/**
 * Factories for the `mcp` proxy tool's execute handler and session_start
 * direct-tool registration logic.
 *
 * Extracted from index.ts (plan-028, Task 6) so the inline action-dispatch
 * block no longer bloats the registration module.  Each factory receives the
 * runtime dependencies as closures and returns a function that the
 * registration module can consume directly.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { autoAuthenticate, needsAuthToolResult } from "./auto-auth.js";
import { resolveServerSettings } from "./config.js";
import {
  filterDirectTools,
  pruneRegisteredNames,
  registerDirectTools,
} from "./direct-tools.js";
import { getCachedTools, recordClientOutcome } from "./metadata-cache.js";
import type { ServerClient } from "./server-client.js";
import type { ServerManager } from "./server-manager.js";
import {
  getServerPrefix,
  matchRawToolName,
  resolveServerFromToolName,
  resolveServerRef,
} from "./tool-naming.js";
import type { CachedTool, McpConfig, ServerDef } from "./types.js";

// ── Types ──────────────────────────────────────────────────────────────────

type ExecuteParams = {
  tool?: string;
  args?: string | Record<string, unknown>;
  search?: string;
  describe?: string;
  connect?: string;
  server?: string;
  action?: string;
};

/** Shape of what pi.registerTool receives for the execute function. */
type ExecuteFn = Parameters<ExtensionAPI["registerTool"]>[0]["execute"];

// ── Helper ─────────────────────────────────────────────────────────────────

/**
 * Resolve a tool reference (raw name OR final prefixed name) to the owning
 * server and the raw server tool name. Prefixed lookups use each server's
 * OWN prefix mode, exactly as the call path does.
 */
function resolveToolRef(
  ref: string,
  defs: Record<string, ServerDef>,
  config: McpConfig,
  manager: ServerManager,
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

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Build the execute function for the `mcp` proxy tool.
 *
 * @param deps.getManager - returns the current module-level ServerManager
 * @param deps.loadDefs   - load enabled server definitions (seam-aware)
 * @param deps.loadCfg    - load the MCP config (seam-aware)
 */
export function buildProxyToolExecute(deps: {
  getManager: () => ServerManager;
  loadDefs: () => Record<string, ServerDef>;
  loadCfg: () => McpConfig;
}): ExecuteFn {
  const { getManager, loadDefs, loadCfg } = deps;

  return async function execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const manager = getManager();
    const p = params as ExecuteParams;

    // ── status (no meaningful params; action:'status' is an alias) ──────
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
        const ref = resolveToolRef(p.search, defs, config, manager, allTools);
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
        const ref = resolveToolRef(p.describe, defs, config, manager, allTools);
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
      const content = result.content as Array<
        { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
      >;
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
  };
}

// ── Session-start handler factory ─────────────────────────────────────────

/**
 * Build the session_start handler for direct-tool registration.
 *
 * @param deps.pi             - ExtensionAPI (for registerDirectTools)
 * @param deps.getManager     - returns the current module-level ServerManager
 * @param deps.loadDefs       - load enabled server definitions (seam-aware)
 * @param deps.loadCfg        - load the MCP config (seam-aware)
 * @param deps.setIdleTimeout - callback to update the module-level idle timeout
 */
export function buildSessionStartHandler(deps: {
  pi: ExtensionAPI;
  getManager: () => ServerManager;
  loadDefs: () => Record<string, ServerDef>;
  loadCfg: () => McpConfig;
  setIdleTimeout: (minutes: number) => void;
  startLifecycle: () => void;
}): () => Promise<void> {
  const { pi, getManager, loadDefs, loadCfg, setIdleTimeout, startLifecycle } = deps;

  return async function sessionStart() {
    const manager = getManager();
    // Re-sync server definitions on every session start (picks up config changes)
    const defs = loadDefs();
    manager.sync(defs);

    const config = loadCfg();
    setIdleTimeout(config.idleTimeout);
    startLifecycle(); // idempotent — safe across /reload

    // ── Cache-first direct tool registration ─────────────────────────────
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
  };
}
