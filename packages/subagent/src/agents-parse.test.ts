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

// ── The lexical half of validation (ADR 0028) ───────────────────────────────
//
// This read path has no tool registry — `discoverAgents()` touches only the
// filesystem — so nothing here may depend on whether a name is a real tool.
// A rejected `tools:` list is never applied (an allowlist that silently becomes
// a wider one is the failure this exists to prevent); the reason rides on the
// config so dispatch refuses it and the panel can show it.

describe("agent config read: malformed tools entries are rejected", () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("accepts a well-formed list, unchanged", () => {
    writeAgent("good", "tools: read, bash\n");
    const agent = readAgent("good");
    expect(agent?.tools).toEqual(["read", "bash"]);
    expect(agent?.toolsError).toBeUndefined();
  });

  it("rejects an empty entry and names it on the config", () => {
    writeAgent("empty", "tools: read, , bash\n");
    const agent = readAgent("empty");
    expect(agent?.tools).toBeUndefined();
    expect(agent?.toolsError).toContain('""');
  });

  it("rejects a trailing comma (the empty entry it creates)", () => {
    writeAgent("trailing", "tools: read, bash,\n");
    const agent = readAgent("trailing");
    expect(agent?.tools).toBeUndefined();
    expect(agent?.toolsError).toBeTruthy();
  });

  it("rejects a duplicated entry and names it", () => {
    writeAgent("dupe", "tools: read, bash, read\n");
    const agent = readAgent("dupe");
    expect(agent?.tools).toBeUndefined();
    expect(agent?.toolsError).toContain("read");
  });

  it("rejects a +name entry and names it", () => {
    writeAgent("mod", "tools: read, +web_search\n");
    const agent = readAgent("mod");
    expect(agent?.tools).toBeUndefined();
    expect(agent?.toolsError).toContain("+web_search");
  });

  it("rejects a -name entry and names it", () => {
    writeAgent("neg", "tools: read, -bash\n");
    const agent = readAgent("neg");
    expect(agent?.tools).toBeUndefined();
    expect(agent?.toolsError).toContain("-bash");
  });

  it("still preserves a rejected list in extraFields, so saving the agent does not delete the user's line", () => {
    writeAgent("mod2", "tools: read, +web_search\n");
    const agent = readAgent("mod2");
    // Preserved verbatim for the writer's benefit; nothing downstream reads
    // extraFields as a tool list, and dispatch refuses the agent outright.
    expect(agent?.extraFields?.tools).toBe("read, +web_search");
  });

  it("the rejection message names the agent and the file it came from", () => {
    writeAgent("dupe2", "tools: read, read\n");
    const agent = readAgent("dupe2");
    expect(agent?.toolsError).toContain("dupe2");
    expect(agent?.toolsError).toContain(join(agentsDir, "dupe2.md"));
  });

  it("a rejected tools list does not disturb the rest of the config", () => {
    writeAgent("mixed", "tools: read, read\nmodel: anthropic/claude-opus-4.5\n", "body text");
    const agent = readAgent("mixed");
    expect(agent?.model).toBe("anthropic/claude-opus-4.5");
    expect(agent?.systemPrompt).toContain("body text");
    expect(agent?.toolsError).toBeTruthy();
  });

  it("list_agents says which agents have a rejected tools list", async () => {
    const { formatAgentList } = await import("./agents.js");
    writeAgent("broken", "tools: read, +bash\n");
    writeAgent("fine", "tools: read\n");
    const out = formatAgentList(discoverAgents(testDir));
    const brokenLine = out.split("\n").find((l) => l.includes("broken"));
    const fineLine = out.split("\n").find((l) => l.includes("fine "));
    expect(brokenLine).toMatch(/invalid tools|tools rejected/i);
    expect(fineLine).not.toMatch(/invalid tools|tools rejected/i);
  });
});

describe("agent config read: `tools:` written as a YAML list", () => {
  // pi's own frontmatter parser turns both `tools: a, b`-style block lists and
  // inline lists into real arrays, and a hand-written agent file is far more
  // likely to use one than the comma form this suite's writer emits. Reading
  // only the string form meant a list-shaped allowlist was dropped on the floor:
  // no allowlist, no error, and a child that runs with every tool the host has —
  // the exact "wider than the config asked for" outcome the read path exists to
  // prevent (and which a live dispatch reproduced: `tools: [read]` + MCP on).
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("applies a block list as the allowlist", () => {
    writeAgent("blocky", "tools:\n  - read\n  - bash\nmcp: true\n");
    const agent = readAgent("blocky");
    expect(agent?.tools).toEqual(["read", "bash"]);
    expect(agent?.toolsError).toBeUndefined();
    // The list is an allowlist, so the MCP opt-in still has to survive next to it.
    expect(agent?.mcp).toBe(true);
  });

  it("applies an inline list the same way", () => {
    writeAgent("inliney", "tools: [read, bash]\n");
    expect(readAgent("inliney")?.tools).toEqual(["read", "bash"]);
  });

  it("applies a one-entry list (which YAML reads as a bare string only when written that way)", () => {
    writeAgent("single", "tools:\n  - read\n");
    expect(readAgent("single")?.tools).toEqual(["read"]);
  });

  it("rejects a list entry pi cannot read as a name, and applies nothing", () => {
    writeAgent("blockbad", "tools:\n  - read\n  - +web_search\n");
    const agent = readAgent("blockbad");
    expect(agent?.tools).toBeUndefined();
    expect(agent?.toolsError).toContain("+web_search");
    // Preserved for the writer, same contract as the comma form.
    expect(agent?.extraFields?.tools).toEqual(["read", "+web_search"]);
  });

  it("rejects a duplicate inside a list", () => {
    writeAgent("blockdupe", "tools:\n  - read\n  - read\n");
    const agent = readAgent("blockdupe");
    expect(agent?.tools).toBeUndefined();
    expect(agent?.toolsError).toContain("read");
  });

  it("rejects a list holding something that is not a name at all", () => {
    writeAgent("mixed", "tools:\n  - read\n  - count: 2\n");
    const agent = readAgent("mixed");
    expect(agent?.tools).toBeUndefined();
    expect(agent?.toolsError).toBeTruthy();
  });

  it("rejects a tools value that is neither a list nor a list of names, instead of ignoring it", () => {
    // `tools: 42` used to be preserved in extraFields and otherwise ignored —
    // silently unbounded again. A config that means something by the key gets an
    // error, not a shrug.
    writeAgent("scalar", "tools: 42\n");
    const agent = readAgent("scalar");
    expect(agent?.tools).toBeUndefined();
    expect(agent?.toolsError).toBeTruthy();
    expect(agent?.extraFields?.tools).toBe(42);
  });
});
