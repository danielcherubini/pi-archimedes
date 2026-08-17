import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { ServerClient } from "./server-client.js";
import { renderDirectCall, renderDirectResult } from "./renderer.js";

/** Track which tool names have already been registered to avoid re-registration on /reload */
const registeredDirectTools = new Set<string>();

/** Sanitise a server name into a safe tool name prefix: keep [A-Za-z0-9_], replace rest with _ */
export function sanitizePrefix(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

/** Build the prefixed tool name: {serverPrefix}_{toolName} with dots → underscores */
export function buildDirectToolName(serverName: string, toolName: string): string {
  return `${sanitizePrefix(serverName)}_${toolName.replace(/\./g, "_")}`;
}

/**
 * Register all tools from a connected server as individual pi tools.
 * Returns the list of registered prefixed tool names so they can be tracked.
 */
export function registerDirectTools(
  pi: ExtensionAPI,
  client: ServerClient,
  getCollapsedLines: () => number,
): string[] {
  const registered: string[] = [];

  for (const tool of client.tools) {
    const prefixedName = buildDirectToolName(client.name, tool.name);

    // Skip if already registered (prevents re-registration on /reload)
    if (registeredDirectTools.has(prefixedName)) {
      registered.push(prefixedName);
      continue;
    }
    registeredDirectTools.add(prefixedName);

    // Accept any object — we let the MCP server validate args against its own schema
    const parameters = Type.Object({}, { additionalProperties: true });

    pi.registerTool({
      name: prefixedName,
      label: `MCP: ${tool.name}`,
      description: `[${client.name}] ${tool.description ?? "(no description)"}`,
      parameters,

      renderCall(args: unknown, theme: Theme, context: unknown) {
        const typedContext = context as { lastComponent?: Component; isError?: boolean };
        return renderDirectCall(
          prefixedName,
          args as Record<string, unknown>,
          theme,
          typedContext,
        );
      },

      renderResult(result: unknown, options: unknown, theme: Theme, context: unknown) {
        const typedResult = result as {
          content: Array<{ type: string; text?: string }>;
          details?: Record<string, unknown>;
        };
        const typedOptions = options as { expanded?: boolean; isPartial?: boolean };
        const typedContext = context as { lastComponent?: Component; isError?: boolean };
        return renderDirectResult(typedResult, typedOptions, theme, typedContext, getCollapsedLines());
      },

      async execute(_toolCallId, params, signal) {
        const args = params as Record<string, unknown>;
        const result = await client.callTool(tool.name, args, signal);
        // Cast MCP ContentBlock[] to pi's (TextContent | ImageContent)[]
        // Both are discriminated unions on `type`; we only surface text + image blocks
        const content = result.content as Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        >;
        return {
          content,
          details: { server: client.name, tool: tool.name },
          isError: result.isError,
        };
      },
    });

    registered.push(prefixedName);
  }

  return registered;
}
