/**
 * Agent discovery and configuration loading.
 * Reads agent definitions from ~/.pi/agent/agents/*.md and .pi/agents/*.md
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { readLocalConfig } from "./local-config.js";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  thinking?: string;
  systemPrompt: string;
  source: "global" | "user" | "project";
  filePath: string;
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
    if (typeof frontmatter.tools === "string") {
      parsedTools = frontmatter.tools.split(",").map((t: string) => t.trim()).filter(Boolean);
    }

    const knownKeys = new Set(["name", "description", "model", "thinking"]);
    const extraFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(frontmatter)) {
      if (key === "tools") continue; // tools is handled separately above/below
      if (!knownKeys.has(key) && value != null && typeof value !== "object") {
        extraFields[key] = String(value);
      } else if (!knownKeys.has(key) && value != null) {
        extraFields[key] = value;
      }
    }
    // If tools was non-string, store it in extraFields for round-trip preservation
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
 * Apply local model overrides from agents.local.json to a list of agents.
 * Reads the config once and mutates matching agents in place.
 */
export function applyLocalOverrides(agents: AgentConfig[]): void {
  const config = readLocalConfig();
  for (const agent of agents) {
    const local = config[agent.name];
    if (local?.model !== undefined) {
      agent.model = local.model;
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
    if (a.tools && a.tools.length > 0) extras.push(`${a.tools.length} tools`);
    if (extras.length > 0) line += ` (${extras.join(", ")})`;
    return line;
  });
  return `${agents.length} agent${agents.length === 1 ? "" : "s"}:\n${lines.join("\n")}`;
}
