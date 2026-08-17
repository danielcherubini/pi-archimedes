/** Strategy for prefixing exposed tool names */
export type ToolPrefix = "server" | "none" | "short" | "mcp";

/**
 * Lifecycle & tooling settings shared by both stdio and HTTP server defs.
 * These can appear per-server in mcp.json files.
 */
export interface SharedServerSettings {
  /** Connection lifecycle (default: keep-alive) */
  lifecycle?: "keep-alive" | "lazy" | "lazy-keep-alive" | "eager";
  /** Idle timeout in minutes; 0 disables */
  idleTimeout?: number;
  /** Per-request timeout in milliseconds */
  requestTimeoutMs?: number;
  /** Expose direct tools; true = all, string[] = subset of tool names */
  directTools?: boolean | string[];
  /** Only expose these tools (whitelist) */
  includeTools?: string[];
  /** Never expose these tools (blacklist) */
  excludeTools?: string[];
  /** Tool name prefix strategy (default: "server") */
  toolPrefix?: ToolPrefix;
  /** Expose resources as a list_resources tool */
  exposeResources?: boolean;
  /** Verbose logging for this server */
  debug?: boolean;
  /** Pin the MCP protocol version used for this server */
  protocolVersion?: string;
}

/** A stdio-based MCP server (spawns a child process) */
export interface StdioServerDef extends SharedServerSettings {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  disabled?: boolean;
}

/** An HTTP-based MCP server (Streamable HTTP or SSE) */
export interface HttpServerDef extends SharedServerSettings {
  type: "http" | "sse";
  url: string;
  auth?: { token: string }; // OAuth flow not yet supported — use { token: string } for bearer auth
  /** Extra HTTP headers sent with every request */
  headers?: Record<string, string>;
  /** Name of an environment variable holding the bearer token */
  bearerTokenEnv?: string;
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
  /** Tool name prefix strategy (default: "server") */
  toolPrefix: ToolPrefix;
  /** Idle timeout in minutes (default: 10) */
  idleTimeout: number;
  /** Warn when a server exposes many direct tools (default: true) */
  warnOnLargeDirectTools: boolean;
}

export const DEFAULT_MCP_CONFIG: McpConfig = {
  directTools: true,
  collapsedResultLines: 3,
  toolPrefix: "server",
  idleTimeout: 10,
  warnOnLargeDirectTools: true,
};

export const MCP_NAMESPACE = "archimedes.mcp";

/** A single cached tool definition from a server */
export interface CachedTool {
  name: string;
  description?: string;
  inputSchema: unknown;
}

/** Cached metadata for one server */
export interface ServerCacheEntry {
  /** Hash of the server definition at cache time */
  configHash: string;
  tools: CachedTool[];
  resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }>;
  prompts?: Array<{ name: string; description?: string }>;
  /** Server-level instructions from initialize */
  instructions?: string;
  /** Epoch milliseconds when the entry was written */
  cachedAt: number;
}

/** On-disk shape of the metadata cache */
export interface MetadataCache {
  version: number;
  servers: Record<string, ServerCacheEntry>;
}

export const CACHE_VERSION = 1;
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
