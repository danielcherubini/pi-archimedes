import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentConfig } from "./agents.js";
import { applyLocalOverrides, formatAgentList } from "./agents.js";

// Redirect getAgentDir() to a temp directory via PI_CODING_AGENT_DIR.
// This must happen before any function calls so readLocalConfig()
// resolves agents.local.json to our sandbox directory.
const testDir = join(tmpdir(), "pi-test-local-config-agents");
process.env.PI_CODING_AGENT_DIR = testDir;

function makeAgent(
  name: string,
  model?: string,
  thinking?: string,
): AgentConfig {
  return {
    name,
    description: `Agent ${name}`,
    systemPrompt: "hello",
    source: "global" as const,
    filePath: join(testDir, `${name}.md`),
    ...(model !== undefined ? { model } : {}),
    ...(thinking !== undefined ? { thinking } : {}),
  };
}

describe("applyLocalOverrides", () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("sets model from JSON override", () => {
    const path = join(testDir, "agents.local.json");
    writeFileSync(path, JSON.stringify({ codex: { model: "o1" } }), "utf-8");

    const agent = makeAgent("codex");
    applyLocalOverrides([agent]);
    expect(agent.model).toBe("o1");
  });

  it("leaves model unchanged when no JSON entry exists", () => {
    const agent = makeAgent("codex", "M1");
    applyLocalOverrides([agent]);
    expect(agent.model).toBe("M1");
  });

  it("leaves model unchanged when JSON entry has no model field", () => {
    const path = join(testDir, "agents.local.json");
    writeFileSync(path, JSON.stringify({ codex: {} }), "utf-8");

    const agent = makeAgent("codex", "M1");
    applyLocalOverrides([agent]);
    expect(agent.model).toBe("M1");
  });

  it("handles empty agent list", () => {
    expect(() => applyLocalOverrides([])).not.toThrow();
  });

  it("sets thinking from JSON override", () => {
    const path = join(testDir, "agents.local.json");
    writeFileSync(path, JSON.stringify({ codex: { thinking: "high" } }), "utf-8");

    const agent = makeAgent("codex");
    applyLocalOverrides([agent]);
    expect(agent.thinking).toBe("high");
  });

  it("leaves thinking unchanged when no JSON entry exists", () => {
    const agent = makeAgent("codex", undefined, "low");
    applyLocalOverrides([agent]);
    expect(agent.thinking).toBe("low");
  });

  it("leaves thinking unchanged when JSON entry has no thinking field (model still applied)", () => {
    const path = join(testDir, "agents.local.json");
    writeFileSync(path, JSON.stringify({ codex: { model: "o1" } }), "utf-8");

    const agent = makeAgent("codex", "M1", "low");
    applyLocalOverrides([agent]);
    expect(agent.thinking).toBe("low");
    expect(agent.model).toBe("o1");
  });

  it("applies model and thinking together when both are present", () => {
    const path = join(testDir, "agents.local.json");
    writeFileSync(path, JSON.stringify({ codex: { model: "o1", thinking: "high" } }), "utf-8");

    const agent = makeAgent("codex", "M1", "low");
    applyLocalOverrides([agent]);
    expect(agent.model).toBe("o1");
    expect(agent.thinking).toBe("high");
  });

  it("works with corrupt JSON file (agent model stays unchanged)", () => {
    const path = join(testDir, "agents.local.json");
    writeFileSync(path, "{ broken json", "utf-8");

    const agent = makeAgent("codex", "M1");
    applyLocalOverrides([agent]);
    expect(agent.model).toBe("M1");
  });
});

function mkAgent(overrides: Partial<AgentConfig> & Pick<AgentConfig, "name">): AgentConfig {
  return {
    name: overrides.name,
    description: overrides.description ?? "desc",
    systemPrompt: overrides.systemPrompt ?? "prompt",
    source: overrides.source ?? "user",
    filePath: overrides.filePath ?? "/x.md",
    ...(overrides.model !== undefined ? { model: overrides.model } : {}),
    ...(overrides.tools !== undefined ? { tools: overrides.tools } : {}),
  };
}

describe("formatAgentList", () => {
  it("reports no agents when empty", () => {
    expect(formatAgentList([])).toContain("No agents configured");
  });

  it("formats a single agent (singular)", () => {
    const out = formatAgentList([mkAgent({ name: "general" })]);
    expect(out).toContain("1 agent:");
    expect(out).toContain("• general [user] — desc");
  });

  it("formats multiple agents (plural)", () => {
    const out = formatAgentList([mkAgent({ name: "general" }), mkAgent({ name: "explore" })]);
    expect(out).toContain("2 agents:");
  });

  it("includes model and tools overrides only when set", () => {
    const withExtras = formatAgentList([mkAgent({ name: "reviewer", model: "anthropic/claude-sonnet-4-5", tools: ["read", "bash"] })]);
    expect(withExtras).toContain("(model: anthropic/claude-sonnet-4-5, 2 tools)");
    const withoutExtras = formatAgentList([mkAgent({ name: "general" })]);
    expect(withoutExtras).not.toMatch(/\(model:|tools\)/);
  });
});
