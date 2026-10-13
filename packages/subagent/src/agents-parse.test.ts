/**
 * The agent-config **read** path: frontmatter on disk → AgentConfig.
 *
 * `discoverAgents()` is pure filesystem (no ExtensionAPI handle, no tool
 * registry), so this is where a config can be rejected on **lexical** grounds
 * and nowhere that a name's membership in the tool set could be checked.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverAgents } from "./agents.js";

// Redirect getAgentDir() (and therefore the user agents dir) into a sandbox.
const testDir = join(tmpdir(), "pi-test-agents-parse");
process.env.PI_CODING_AGENT_DIR = testDir;

const agentsDir = join(testDir, "agents");

function writeAgent(file: string, frontmatter: string, body = "prompt"): void {
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(
    join(agentsDir, `${file}.md`),
    `---\nname: ${file}\ndescription: desc for ${file}\n${frontmatter}---\n${body}\n`,
    "utf-8",
  );
}

/** Discover the named agent from the sandbox user dir. */
function readAgent(name: string) {
  return discoverAgents(testDir).find((a) => a.name === name);
}

describe("agent config read: mcp opt-in", () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("mcp: true is parsed onto the config, not left in extraFields", () => {
    writeAgent("closed", "tools: read, bash\nmcp: true\n");
    const agent = readAgent("closed");
    expect(agent?.mcp).toBe(true);
    expect(agent?.extraFields ?? {}).not.toHaveProperty("mcp");
  });

  it("an absent mcp key leaves the config untouched (the closed default needs no key)", () => {
    writeAgent("quiet", "tools: read, bash\n");
    const agent = readAgent("quiet");
    expect(agent?.mcp).toBeUndefined();
    expect(agent?.extraFields ?? {}).not.toHaveProperty("mcp");
  });

  it("mcp: false is not an opt-in and is not kept as an unknown field", () => {
    writeAgent("off", "tools: read\nmcp: false\n");
    const agent = readAgent("off");
    expect(agent?.mcp).not.toBe(true);
    expect(agent?.extraFields ?? {}).not.toHaveProperty("mcp");
  });

  it("a quoted mcp: \"true\" still means opted in (frontmatter strings survive quoting)", () => {
    writeAgent("quoted", "tools: read\nmcp: \"true\"\n");
    expect(readAgent("quoted")?.mcp).toBe(true);
  });

  it("mcp without a tools allowlist is parsed but changes nothing downstream", () => {
    writeAgent("noallow", "mcp: true\n");
    expect(readAgent("noallow")?.mcp).toBe(true);
  });
});
