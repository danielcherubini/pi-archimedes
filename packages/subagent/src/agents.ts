/**
 * Agent discovery and configuration loading.
 * Reads agent definitions from ~/.pi/agent/agents/*.md and .pi/agents/*.md
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { readLocalConfig } from "./local-config.js";
import { readToolEntries, validateToolEntries } from "./tool-validation.js";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  /**
   * Opt this agent's child back in to connecting its MCP servers.
   *
   * pi 1.0.4 stopped a non-empty `--tools` filtering MCP tools: they stay
   * registered (reachable from codemode and `tool_search`) unless the list names
   * an `mcp__` entry (ADR 0028). The suite therefore passes `--no-mcp` alongside
   * a non-empty allowlist; `mcp: true` is the one way a config asks for the
   * servers back. Absent or false means the closed reading. Note the honest
   * limit, verified against a live 1.2.0 child: pi does not *declare* MCP tools
   * to a model whose allowlist does not match them, so with a non-empty `tools:`
   * list the child sees the same declared set with or without this flag — what
   * the flag changes is whether the servers connect at all (ADR 0028
   * verification note). Parsed in `loadAgentsFromDir`, written by
   * `serializeAgent`, shown on the `/agents` detail screen.
   */
  mcp?: boolean;
  model?: string;
  thinking?: string;
  systemPrompt: string;
  source: "global" | "user" | "project";
  filePath: string;
  /**
   * Set when the `tools:` list was **rejected at config read** — an entry pi
   * cannot read as a tool name (empty, duplicated, or a `+`/`-` modifier), or a
   * value that is not a tool list in any spelling pi's YAML parser produces
   * (comma string, block list, inline list) — a number, a mapping, or a list
   * holding something that is not a name.
   *
   * The list is never applied in that case: a rejected allowlist that falls back
   * to "no allowlist" would hand the child a *wider* tool set than the config
   * asked for. Dispatch refuses such an agent (naming the entry and the file),
   * and the `/agents` panel and `list_agents` report it. The raw value stays in
   * `extraFields.tools` so saving the agent does not silently delete the line.
   */
  toolsError?: string;
  // Extra fields preserved from frontmatter but not editable in TUI
  extraFields?: Record<string, unknown>;
}

function loadAgentsFromDir(dir: string, source: "global" | "user" | "project"): AgentConfig[] {
  const agents: AgentConfig[] = [];

  if (!fs.existsSync(dir)) return agents;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return agents;
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);

    if (!frontmatter.name || !frontmatter.description) continue;

    // Handle tools specially — preserve non-string values in extraFields
    let parsedTools: string[] | undefined;
    let toolsError: string | undefined;
    if (frontmatter.tools !== undefined) {
      // Every YAML spelling is read (comma string, block list, inline list);
      // anything that is not a list of names is rejected loudly rather than
      // dropped, because an unread allowlist means an unrestricted child.
      const read = readToolEntries(frontmatter.tools, {
        agentName: String(frontmatter.name),
        agentFilePath: filePath,
      });
      if ("error" in read) {
        toolsError = read.error;
      } else {
        const check = validateToolEntries(read.entries, {
          agentName: String(frontmatter.name),
          agentFilePath: filePath,
        });
        if (check.ok) {
          parsedTools = read.entries;
        } else {
          toolsError = check.error;
        }
      }
    }

    // `mcp: true` opts the child back in to MCP tools (ADR 0028). Quoted YAML
    // gives the string "true", which means the same thing to a human reader.
    const mcpOptIn = frontmatter.mcp === true || frontmatter.mcp === "true";

    const knownKeys = new Set(["name", "description", "model", "thinking", "mcp"]);
    const extraFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(frontmatter)) {
      if (key === "tools") continue; // tools is handled separately above/below
      if (!knownKeys.has(key) && value != null && typeof value !== "object") {
        extraFields[key] = String(value);
      } else if (!knownKeys.has(key) && value != null) {
        extraFields[key] = value;
      }
    }
    // If tools was non-string, store it in extraFields for round-trip preservation.
    // A rejected string list is preserved for the same reason: the writer must not
    // quietly delete a line the user typed.
    if (frontmatter.tools !== undefined && !parsedTools && "tools" in frontmatter) {
      extraFields.tools = frontmatter.tools;
    }

    const config: AgentConfig = {
      name: frontmatter.name as string,
      description: frontmatter.description as string,
      systemPrompt: body,
      source,
      filePath,
    };
    if (frontmatter.model) config.model = frontmatter.model as string;
    if (frontmatter.thinking) config.thinking = frontmatter.thinking as string;
    if (mcpOptIn) config.mcp = true;
    if (toolsError) config.toolsError = toolsError;
    if (parsedTools && parsedTools.length > 0) config.tools = parsedTools;
    if (Object.keys(extraFields).length > 0) config.extraFields = extraFields;

    agents.push(config);
  }

  return agents;
}

function findNearestProjectAgentsDir(cwd: string): string | null {
  // Walk up looking for a git repo, even if .pi/agents doesn't exist yet
  let currentDir = cwd;
  while (true) {
    const gitPath = path.join(currentDir, ".git");
    if (fs.existsSync(gitPath)) {
      return path.join(currentDir, ".pi", "agents");
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

function findNearestAgentsDir(cwd: string): string | null {
  // Walk up looking for .agents/agents inside a git repo
  let currentDir = cwd;
  while (true) {
    const gitPath = path.join(currentDir, ".git");
    if (fs.existsSync(gitPath)) {
      const projectAgentsDir = path.join(currentDir, ".agents", "agents");
      if (fs.existsSync(projectAgentsDir)) return projectAgentsDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  // Fallback: ~/.agents/agents
  const homeAgentsDir = path.join(os.homedir(), ".agents", "agents");
  if (fs.existsSync(homeAgentsDir)) return homeAgentsDir;
  return null;
}

/**
 * Result of discovering agents — separated by source with directory paths.
 */
export interface AgentsDiscoveryResult {
  global: AgentConfig[];
  user: AgentConfig[];
  project: AgentConfig[];
  globalDir: string | null;  // e.g., .agents/agents or null if not found
  userDir: string;           // e.g., ~/.pi/agent/agents
  projectDir: string | null; // e.g., .pi/agents or null if not found
}

/**
 * Apply local overrides from agents.local.json (model and thinking) to a list of agents.
 * Reads the config once and mutates matching agents in place. JSON takes
 * precedence over the agent's .md values; a missing entry or field leaves the
 * agent's value untouched.
 */
export function applyLocalOverrides(agents: AgentConfig[]): void {
  const config = readLocalConfig();
  for (const agent of agents) {
    const local = config[agent.name];
    if (local?.model !== undefined) {
      agent.model = local.model;
    }
    if (local?.thinking !== undefined) {
      agent.thinking = local.thinking;
    }
  }
}

/**
 * Discover all available agents from global, user and/or project directories.
 * Precedence (highest last): global < user < project
 */
export function discoverAgents(cwd: string): AgentConfig[] {
  const globalDir = findNearestAgentsDir(cwd);
  const userDir = path.join(getAgentDir(), "agents");
  const projectDir = findNearestProjectAgentsDir(cwd);

  const globalAgents = globalDir ? loadAgentsFromDir(globalDir, "global") : [];
  const userAgents = loadAgentsFromDir(userDir, "user");
  const projectAgents = projectDir ? loadAgentsFromDir(projectDir, "project") : [];

  // Later sources override earlier: global < user < project
  const agentMap = new Map<string, AgentConfig>();
  for (const agent of globalAgents) agentMap.set(agent.name, agent);
  for (const agent of userAgents) agentMap.set(agent.name, agent);
  for (const agent of projectAgents) agentMap.set(agent.name, agent);

  const all = Array.from(agentMap.values());
  applyLocalOverrides(all);
  return all;
}

/**
 * Discover agents and return them separated by source with directory paths.
 */
export function discoverAgentsAll(cwd: string): AgentsDiscoveryResult {
  const globalDir = findNearestAgentsDir(cwd);
  const userDir = path.join(getAgentDir(), "agents");
  const projectDir = findNearestProjectAgentsDir(cwd);

  const globalAgents = globalDir ? loadAgentsFromDir(globalDir, "global") : [];
  const userAgents = loadAgentsFromDir(userDir, "user");
  const projectAgents = projectDir ? loadAgentsFromDir(projectDir, "project") : [];

  applyLocalOverrides(globalAgents);
  applyLocalOverrides(userAgents);
  applyLocalOverrides(projectAgents);

  return {
    global: globalAgents,
    user: userAgents,
    project: projectAgents,
    globalDir,
    userDir,
    projectDir,
  };
}

/**
 * Look up an agent config by name.
 */
export function findAgent(agents: AgentConfig[], name: string): AgentConfig | undefined {
  return agents.find((a) => a.name === name);
}

/**
 * Format discovered agents as a compact, readable listing for the `list_agents`
 * tool. Standard detail: name, source, description, and model/tools overrides
 * only when set.
 */
export function formatAgentList(agents: AgentConfig[]): string {
  if (agents.length === 0) {
    return "No agents configured. Create one in ~/.pi/agent/agents/ or .agents/agents/.";
  }
  const lines = agents.map((a) => {
    let line = `• ${a.name} [${a.source}] — ${a.description}`;
    const extras: string[] = [];
    if (a.model) extras.push(`model: ${a.model}`);
    if (a.toolsError) {
      // The list was rejected at read, so no allowlist is in force — say so here
      // rather than letting the agent look like an unconfigured one.
      extras.push("tools rejected — fix the tools: field");
    } else if (a.tools && a.tools.length > 0) {
      extras.push(`${a.tools.length} tools`);
    }
    if (extras.length > 0) line += ` (${extras.join(", ")})`;
    return line;
  });
  return `${agents.length} agent${agents.length === 1 ? "" : "s"}:\n${lines.join("\n")}`;
}
