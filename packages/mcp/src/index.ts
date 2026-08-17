import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { loadServerDefs } from "./config.js";
import { ServerManager } from "./server-manager.js";
import { renderProxyCall, renderProxyResult } from "./renderer.js";

// ── Module-level server manager (survives session restarts) ─────────────────

const manager = new ServerManager();

// ── Tool registration ───────────────────────────────────────────────────────

export function registerMcp(pi: ExtensionAPI): void {
  // session_shutdown must be registered at the TOP LEVEL of registerMcp,
  // NOT inside session_start — per AGENTS.md rule (prevents handler accumulation on /reload)
  pi.on("session_shutdown", async () => {
    await manager.closeAll();
  });

  pi.on("session_start", async () => {
    // Re-sync server definitions on every session start (picks up config changes)
    const defs = loadServerDefs();
    manager.sync(defs);
    // Direct tool registration (loadMcpConfig) will be added in Task 6
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
      "  Status:  mcp({}) — list all servers and their connection status",
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
      instructions: Type.Optional(
        Type.String({ description: "Server name to show usage instructions for" }),
      ),
    }),

    renderCall(args: unknown, theme: Theme, context: unknown) {
      const typedContext = context as { lastComponent?: Component; isError?: boolean };
      return renderProxyCall(args as Record<string, unknown>, theme, typedContext);
    },

    renderResult(result: unknown, options: unknown, theme: Theme, context: unknown) {
      const typedResult = result as { content: Array<{ type: string; text?: string }>; details?: Record<string, unknown> };
      const typedOptions = options as { expanded?: boolean; isPartial?: boolean };
      const typedContext = context as { lastComponent?: Component; isError?: boolean };
      return renderProxyResult(typedResult, typedOptions, theme, typedContext);
    },

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const p = params as {
        tool?: string;
        args?: string | Record<string, unknown>;
        search?: string;
        describe?: string;
        connect?: string;
        server?: string;
        action?: string;
        instructions?: string;
      };

      // ── status (no meaningful params) ────────────────────────────────────
      if (
        !p.tool &&
        !p.search &&
        !p.describe &&
        !p.connect &&
        !p.action &&
        !p.server &&
        !p.instructions
      ) {
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
        const client = manager.getClient(p.connect);
        if (!client) {
          return {
            content: [{ type: "text" as const, text: `Unknown server: ${p.connect}` }],
            details: {},
          };
        }
        await client.connect();
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
        // Auto-connect all servers to ensure tool lists are populated
        await Promise.allSettled(manager.getClients().map((c) => c.connect()));
        const results = manager.searchTools(p.search, p.server);
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
        await Promise.allSettled(manager.getClients().map((c) => c.connect()));
        const all = manager.getAllTools();
        const tool = all.find((t) => t.name === p.describe);
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
        const client = manager.getClient(p.server);
        if (!client) {
          return {
            content: [{ type: "text" as const, text: `Unknown server: ${p.server}` }],
            details: {},
          };
        }
        await client.connect();
        const lines = client.tools.map(
          (t) => `${t.name}: ${t.description ?? "(no description)"}`,
        );
        return {
          content: [{ type: "text" as const, text: lines.join("\n") || "(no tools)" }],
          details: { server: p.server, toolCount: client.tools.length },
        };
      }

      // ── call tool ────────────────────────────────────────────────────────
      if (p.tool) {
        // Connect all servers so tool discovery is complete
        await Promise.allSettled(manager.getClients().map((c) => c.connect()));

        // Find which server owns this tool
        const allTools = manager.getAllTools();
        const toolDef = allTools.find((t) => t.name === p.tool);
        const serverName = p.server ?? toolDef?.serverName;

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

        // Parse args: string → JSON, object → use as-is, undefined → {}
        const toolArgs: Record<string, unknown> =
          typeof p.args === "string"
            ? (JSON.parse(p.args) as Record<string, unknown>)
            : (p.args ?? {}) as Record<string, unknown>;

        const result = await client.callTool(p.tool, toolArgs, signal);
        // Cast MCP ContentBlock[] to pi's (TextContent | ImageContent)[]
        // Both are discriminated unions on `type`; we only surface text + image blocks
        const content = result.content as Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
        return {
          content,
          details: { server: serverName, tool: p.tool, isError: result.isError },
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
