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
