/**
 * Discovery of MCP server definitions owned by OTHER tools, for the
 * `/mcp setup` → "Import from another tool" flow (plan-027, Task 4).
 *
 * JSON-only (Codex/TOML is intentionally deferred). Candidate paths, in the
 * DOCUMENTED STABLE ORDER returned by `discoverHostConfigs`:
 *
 *   1. cursor         ~/.cursor/mcp.json                key `mcpServers`
 *   2. cursor         <cwd>/.cursor/mcp.json            key `mcpServers`
 *   3. claude-code    ~/.claude/mcp.json                key `mcpServers`
 *   4. claude-code    ~/.claude.json                    key `mcpServers`
 *   5. claude-desktop ~/.claude/claude_desktop_config.json  key `mcpServers`
 *   6. vscode         <cwd>/.vscode/mcp.json            key `servers`
 *
 * Notes:
 * - `~/.claude.json` is Claude's general state file with many unrelated
 *   top-level keys — only its `mcpServers` key is ever taken.
 * - VSCode's `.vscode/mcp.json` uses the top-level key `servers` (per
 *   VSCode docs), NOT `mcpServers` — do not "fix" this to mcpServers.
 * - DELIBERATE EXCLUSIONS: `~/.config/mcp/mcp.json` (pi's own global layer)
 *   and anything under `<cwd>/.pi/` (pi's own override layer) are never
 *   candidate paths — importing from them would be a self-import loop. The
 *   candidate list below is the single source of truth, so exclusions are
 *   inherent; the test suite asserts them anyway.
 * - Never throws: files that don't exist, don't parse, or have the wrong
 *   shape are skipped silently (they surface as "not found" in the panel).
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { stripJsonComments } from "./config.js";
import type { ServerDef } from "./types.js";

export type HostAgent = "cursor" | "claude-code" | "claude-desktop" | "vscode";

export interface HostConfig {
  agent: HostAgent;
  path: string;
  servers: Record<string, ServerDef>;
}

interface Candidate {
  agent: HostAgent;
  /** The top-level JSON key holding the server definitions for this host. */
  key: string;
  pathFor: (home: string, cwd: string) => string;
}

/** The candidate list — also the documented stable order of the results. */
const CANDIDATES: Candidate[] = [
  { agent: "cursor", key: "mcpServers", pathFor: (home) => join(home, ".cursor", "mcp.json") },
  { agent: "cursor", key: "mcpServers", pathFor: (_home, cwd) => join(cwd, ".cursor", "mcp.json") },
  { agent: "claude-code", key: "mcpServers", pathFor: (home) => join(home, ".claude", "mcp.json") },
  { agent: "claude-code", key: "mcpServers", pathFor: (home) => join(home, ".claude.json") },
  { agent: "claude-desktop", key: "mcpServers", pathFor: (home) => join(home, ".claude", "claude_desktop_config.json") },
  { agent: "vscode", key: "servers", pathFor: (_home, cwd) => join(cwd, ".vscode", "mcp.json") },
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse one candidate file into a server record, or null when the file is
 * missing, unparseable, or has the wrong shape (never throws). Server
 * entries that are not objects are dropped; the file still counts as found
 * when its key is a valid object.
 */
function readHostServers(path: string, key: string): Record<string, ServerDef> | null {
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(readFileSync(path, "utf-8")));
  } catch {
    return null; // malformed JSON — skip silently
  }
  if (!isPlainObject(parsed)) return null;
  const bucket = parsed[key];
  if (!isPlainObject(bucket)) return null;
  const servers: Record<string, ServerDef> = {};
  for (const [name, def] of Object.entries(bucket)) {
    if (isPlainObject(def)) servers[name] = def as unknown as ServerDef;
  }
  return servers;
}

/**
 * Discover MCP configs owned by other tools. `cwd` is the project root
 * (supplies the project-scoped candidates); `~` comes from `os.homedir()`
 * at call time. Returns found configs in the documented candidate order;
 * empty when nothing is found.
 */
export function discoverHostConfigs(cwd: string): HostConfig[] {
  const home = homedir();
  const found: HostConfig[] = [];
  for (const candidate of CANDIDATES) {
    const path = candidate.pathFor(home, cwd);
    // Hard guarantee for the documented exclusions even if the candidate
    // list ever drifts: never return pi's own layers.
    if (path.startsWith(join(cwd, ".pi") + sep)) continue;
    if (path === join(home, ".config", "mcp", "mcp.json")) continue;
    const servers = readHostServers(path, candidate.key);
    if (servers !== null) found.push({ agent: candidate.agent, path, servers });
  }
  return found;
}
