import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentConfig } from "./agents.js";
import { applyLocalOverrides } from "./agents.js";

// Redirect getAgentDir() to a temp directory via PI_CODING_AGENT_DIR.
// This must happen before any function calls so readLocalConfig()
// resolves agents.local.json to our sandbox directory.
const testDir = join(tmpdir(), "pi-test-local-config-agents");
process.env.PI_CODING_AGENT_DIR = testDir;

function makeAgent(
  name: string,
  model?: string,
): AgentConfig {
  return {
    name,
    description: `Agent ${name}`,
    systemPrompt: "hello",
    source: "global" as const,
    filePath: join(testDir, `${name}.md`),
    ...(model !== undefined ? { model } : {}),
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

  it("works with corrupt JSON file (agent model stays unchanged)", () => {
    const path = join(testDir, "agents.local.json");
    writeFileSync(path, "{ broken json", "utf-8");

    const agent = makeAgent("codex", "M1");
    applyLocalOverrides([agent]);
    expect(agent.model).toBe("M1");
  });
});
