/**
 * Agent discovery and configuration loading.
 * Reads agent definitions from ~/.pi/agent/agents/*.md and .pi/agents/*.md
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  thinking?: string;
  systemPrompt: string;
  source: "user" | "project";
  filePath: string;
  // Extra fields preserved from frontmatter but not editable in TUI
  extraFields?: Record<string, string>;
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
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

    const tools = typeof frontmatter.tools === "string"
      ? frontmatter.tools.split(",").map((t: string) => t.trim()).filter(Boolean)
      : undefined;

    const knownKeys = new Set(["name", "description", "tools", "model", "thinking"]);
    const extraFields: Record<string, string> = {};
    for (const [key, value] of Object.entries(frontmatter)) {
      if (!knownKeys.has(key) && value != null && typeof value !== "object") {
        extraFields[key] = String(value);
      }
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
    if (tools && tools.length > 0) config.tools = tools;
    if (Object.keys(extraFields).length > 0) config.extraFields = extraFields;

    agents.push(config);
  }

  return agents;
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function findNearestProjectAgentsDir(cwd: string): string | null {
  let currentDir = cwd;
  while (true) {
    const candidate = path.join(currentDir, ".pi", "agents");
    if (isDirectory(candidate)) return candidate;

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

/**
 * Result of discovering agents — separated by source with directory paths.
 */
export interface AgentsDiscoveryResult {
  user: AgentConfig[];
  project: AgentConfig[];
  userDir: string;        // e.g., ~/.pi/agent/agents
  projectDir: string | null;  // e.g., .pi/agents or null if not found
}

/**
 * Discover all available agents from user and/or project directories.
 */
export function discoverAgents(cwd: string): AgentConfig[] {
  const userDir = path.join(getAgentDir(), "agents");
  const projectDir = findNearestProjectAgentsDir(cwd);

  const userAgents = loadAgentsFromDir(userDir, "user");
  const projectAgents = projectDir ? loadAgentsFromDir(projectDir, "project") : [];

  // Project agents override user agents with the same name
  const agentMap = new Map<string, AgentConfig>();
  for (const agent of userAgents) agentMap.set(agent.name, agent);
  for (const agent of projectAgents) agentMap.set(agent.name, agent);

  return Array.from(agentMap.values());
}

/**
 * Discover agents and return them separated by source with directory paths.
 */
export function discoverAgentsAll(cwd: string): AgentsDiscoveryResult {
  const userDir = path.join(getAgentDir(), "agents");
  const projectDir = findNearestProjectAgentsDir(cwd);

  const userAgents = loadAgentsFromDir(userDir, "user");
  const projectAgents = projectDir ? loadAgentsFromDir(projectDir, "project") : [];

  return {
    user: userAgents,
    project: projectAgents,
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
