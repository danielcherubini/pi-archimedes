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
export function parseFile(path: string): McpFileConfig | null {
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
    join(homedir(), ".config", "mcp", "mcp.json"),  // lowest precedence
    join(getAgentDir(), "mcp.json"),
    join(wd, ".mcp.json"),
    join(wd, ".pi", "mcp.json"),                     // highest precedence
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
