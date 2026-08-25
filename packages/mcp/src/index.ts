import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadMcpConfig, loadServerDefs, loadAllServerDefs } from "./config.js";
import { registerMcpCommand } from "./commands.js";
import { LifecycleManager } from "./lifecycle.js";
import { getCachedTools, getCachedPrompts } from "./metadata-cache.js";
import { ServerManager } from "./server-manager.js";
import type { McpConfig, ServerDef } from "./types.js";
import { renderProxyCall, renderProxyResult, type RenderContext } from "./renderer.js";
import { buildProxyToolExecute, buildSessionStartHandler } from "./proxy-tool.js";

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

  pi.on(
    "session_start",
    buildSessionStartHandler({
      pi,
      getManager: () => manager,
      loadDefs,
      loadCfg,
      setIdleTimeout: (m) => { _idleTimeoutMinutes = m; },
      startLifecycle: () => lifecycle.start(),
    }),
  );

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
      tool: Type.Optional(Type.String({ description: "Tool name to call" })),
      args: Type.Optional(
        Type.Union([
          Type.String({ description: "Tool arguments as a JSON string" }),
          Type.Object({}, { additionalProperties: true, description: "Tool arguments as an object" }),
        ]),
      ),
      search: Type.Optional(Type.String({ description: "Search tools by name/description keyword" })),
      describe: Type.Optional(Type.String({ description: "Tool name to show full parameter schema for" })),
      connect: Type.Optional(Type.String({ description: "Server name to eagerly connect" })),
      server: Type.Optional(Type.String({ description: "Filter to a specific server (for list, search, or disambiguating calls)" })),
      action: Type.Optional(Type.String({ description: "Action string (e.g. 'status')" })),
    }),

    renderCall(args: unknown, theme: Theme, context: unknown) {
      return renderProxyCall(args as Record<string, unknown>, theme, context as RenderContext);
    },

    renderResult(result: unknown, options: unknown, theme: Theme, context: unknown) {
      const typedResult = result as { content: Array<{ type: string; text?: string }>; details?: Record<string, unknown> };
      const typedOptions = options as { expanded?: boolean; isPartial?: boolean };
      return renderProxyResult(typedResult, typedOptions, theme, context as RenderContext);
    },

    execute: buildProxyToolExecute({
      getManager: () => manager,
      loadDefs,
      loadCfg,
    }),
  });
}
