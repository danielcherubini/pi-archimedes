import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { cwd } from "node:process";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadConfig, saveConfig } from "@pi-archimedes/core/settings-io";
import type { McpConfig, McpFileConfig, ServerDef, HttpServerDef, ToolPrefix } from "./types.js";
import { DEFAULT_MCP_CONFIG, MCP_NAMESPACE } from "./types.js";

/** Load archimedes.mcp section from settings.json */
export function loadMcpConfig(): McpConfig {
  return loadConfig(MCP_NAMESPACE, DEFAULT_MCP_CONFIG);
}

export function saveMcpConfig(config: McpConfig): void {
  saveConfig(MCP_NAMESPACE, config);
}

/**
 * Auth-related HTTP fields that are bound to a server's url.
 * When a higher-precedence layer points the server at a different url,
 * inherited values of these fields are dropped so credentials are never
 * sent to an endpoint the user did not explicitly configure for them.
 */
export const URL_BOUND_AUTH_FIELDS = ["auth", "headers", "bearerTokenEnv"] as const;

/**
 * Strip line (//) and block comments and trailing commas from JSON text.
 * String literals are left untouched (e.g. "http://x" is preserved).
 * Zero dependencies — a single character scan.
 */
export function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (c === "\\") {
        i++;
        if (i < n) out += text[i]!;
      } else if (c === '"') {
        inString = false;
      }
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      i += 2;
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2; // skip closing */
      continue;
    }
    // Drop a trailing comma: if the next non-whitespace char outside a
    // string is `}` or `]` and the last emitted non-whitespace char is `,`,
    // back it out.
    if (c === "}" || c === "]") {
      let k = out.length - 1;
      while (k >= 0 && (out[k] === " " || out[k] === "\t" || out[k] === "\n" || out[k] === "\r")) k--;
      if (k >= 0 && out[k] === ",") out = out.slice(0, k);
    }
    out += c;
    i++;
  }
  return out;
}

/** Parse one mcp.json file (JSON with comments/trailing commas), returning null on error */
export function parseFile(path: string): McpFileConfig | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(stripJsonComments(readFileSync(path, "utf-8"))) as McpFileConfig;
  } catch (e) {
    console.warn(`[archimedes/mcp] Failed to parse ${path}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

function isHttpDef(def: ServerDef): def is HttpServerDef {
  return "url" in def && typeof (def as HttpServerDef).url === "string";
}

/**
 * Field-level merge of two server defs (override wins per field).
 * Security rule: if both are HTTP defs and the override changes the url,
 * inherited URL_BOUND_AUTH_FIELDS from the base are dropped.
 */
function mergeServerDef(base: ServerDef, override: ServerDef): ServerDef {
  const merged: ServerDef = { ...base, ...override };
  if (isHttpDef(base) && isHttpDef(override) && override.url !== base.url) {
    const record = merged as unknown as Record<string, unknown>;
    for (const field of URL_BOUND_AUTH_FIELDS) {
      if (!(field in override)) delete record[field];
    }
  }
  return merged;
}

/**
 * Merge server definition layers from lowest to highest precedence.
 * Later layers override earlier ones per server (field-level merge).
 */
export function mergeServerDefs(layers: Array<Record<string, ServerDef>>): Record<string, ServerDef> {
  const merged: Record<string, ServerDef> = {};
  for (const layer of layers) {
    for (const [name, def] of Object.entries(layer)) {
      const existing = merged[name];
      merged[name] = existing ? mergeServerDef(existing, def) : def;
    }
  }
  return merged;
}

/**
 * Effective settings for one server: per-server SharedServerSettings
 * resolved over the global archimedes.mcp config defaults.
 */
export interface EffectiveServerSettings {
  lifecycle: "keep-alive" | "lazy" | "lazy-keep-alive" | "eager";
  /** Idle timeout in minutes; 0 disables */
  idleTimeout: number;
  toolPrefix: ToolPrefix;
  /** Expose direct tools; true = all, string[] = subset of tool names */
  directTools: boolean | string[];
  includeTools?: string[];
  excludeTools?: string[];
  requestTimeoutMs?: number;
  exposeResources?: boolean;
  debug?: boolean;
  protocolVersion?: string;
}

/** Resolve per-server settings over the global McpConfig defaults */
export function resolveServerSettings(def: ServerDef, globalConfig: McpConfig): EffectiveServerSettings {
  const result: EffectiveServerSettings = {
    lifecycle: def.lifecycle ?? "lazy",
    idleTimeout: def.idleTimeout ?? globalConfig.idleTimeout,
    toolPrefix: def.toolPrefix ?? globalConfig.toolPrefix,
    directTools: def.directTools ?? globalConfig.directTools,
  };
  if (def.includeTools !== undefined) result.includeTools = def.includeTools;
  if (def.excludeTools !== undefined) result.excludeTools = def.excludeTools;
  if (def.requestTimeoutMs !== undefined) result.requestTimeoutMs = def.requestTimeoutMs;
  if (def.exposeResources !== undefined) result.exposeResources = def.exposeResources;
  if (def.debug !== undefined) result.debug = def.debug;
  if (def.protocolVersion !== undefined) result.protocolVersion = def.protocolVersion;
  return result;
}

export interface LoadServerDefsOptions {
  /** Override the home directory (`~`) — for tests */
  homeDir?: string;
  /** Override the agent directory (`<agentDir>`) — for tests */
  agentDir?: string;
}

/**
 * Config file paths in precedence order (lowest → highest):
 *   ~/.config/mcp/mcp.json
 *   ~/.agents/mcp.json
 *   ~/.agents/mcp/mcp.json
 *   <agentDir>/mcp.json
 *   <cwd>/.mcp.json
 *   <cwd>/.pi/mcp.json
 */
export function getConfigPaths(options?: LoadServerDefsOptions & { workingDir?: string }): string[] {
  const home = options?.homeDir ?? homedir();
  const agent = options?.agentDir ?? getAgentDir();
  const wd = options?.workingDir ?? cwd();
  return [
    join(home, ".config", "mcp", "mcp.json"), // lowest precedence
    join(home, ".agents", "mcp.json"),
    join(home, ".agents", "mcp", "mcp.json"),
    join(agent, "mcp.json"),
    join(wd, ".mcp.json"),
    join(wd, ".pi", "mcp.json"), // highest precedence
  ];
}

/**
 * Load and merge all MCP server definitions from the standard config
 * locations, including disabled servers (their `disabled: true` flag is
 * intact). Higher-precedence files override lower ones per server
 * (field-level merge, with the url-bound credential drop rule).
 */
export function loadAllServerDefs(workingDir?: string, options?: LoadServerDefsOptions): Record<string, ServerDef> {
  const opts: LoadServerDefsOptions & { workingDir?: string } = { ...options };
  if (workingDir !== undefined) opts.workingDir = workingDir;
  const paths = getConfigPaths(opts);

  const layers: Array<Record<string, ServerDef>> = [];
  for (const p of paths) {
    const parsed = parseFile(p);
    if (parsed?.mcpServers) layers.push(parsed.mcpServers);
  }
  return mergeServerDefs(layers);
}

/**
 * Load and merge all MCP server definitions from the standard config locations.
 * Higher-precedence files override lower ones per server (field-level merge,
 * with the url-bound credential drop rule). Disabled servers are excluded.
 */
export function loadServerDefs(workingDir?: string, options?: LoadServerDefsOptions): Record<string, ServerDef> {
  const merged = loadAllServerDefs(workingDir, options);

  // Filter out disabled servers and warn about unsupported auth types
  return Object.fromEntries(
    Object.entries(merged).filter(([name, def]) => {
      if (def.disabled === true) return false;
      // Warn on unsupported auth (e.g. legacy "oauth" string in existing configs)
      if (
        "auth" in def &&
        def.auth !== undefined &&
        typeof def.auth !== "object"
      ) {
        console.warn(
          `[archimedes/mcp] Server "${name}" uses unsupported auth type "${String(def.auth)}". ` +
          `Only { token: string } (bearer) is supported. The server will connect without auth.`
        );
      }
      return true;
    })
  );
}
