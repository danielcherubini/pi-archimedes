import { describe, it, expect } from "vitest";
import {
  splitToolEntries,
  validateToolEntries,
  applyToolEntries,
  unknownToolEntries,
  formatUnknownToolsWarning,
} from "./tool-validation.js";
import type { AgentConfig } from "./agents.js";

// ── The split this module encodes ───────────────────────────────────────────
//
// Two questions, asked at two different moments:
//
//   * Can this string be a tool name at all? — **lexical**. Answerable anywhere,
//     including at config read, where there is no tool registry: `discoverAgents()`
//     is pure filesystem. Rejects here.
//   * Does pi have this tool right now? — **membership**. Needs the ExtensionAPI
//     handle (`pi.getAllTools()`), so it can only be asked at dispatch, and the
//     answer is a warning, never a refusal: a legitimate name is absent whenever
//     its plugin is toggled off or its MCP server is disconnected.
//
// Nothing in this file asserts that a name is or is not a known tool except in
// the `unknownToolEntries` block, which is the membership half.

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "reviewer",
    description: "d",
    systemPrompt: "p",
    source: "user",
    filePath: "/tmp/agents/reviewer.md",
    ...overrides,
  };
}

const CTX = { agentName: "reviewer", agentFilePath: "/tmp/agents/reviewer.md" };

describe("splitToolEntries", () => {
  it("keeps empty entries so they can be reported instead of filtered away", () => {
    expect(splitToolEntries("read,,bash")).toEqual(["read", "", "bash"]);
    expect(splitToolEntries("read, bash ")).toEqual(["read", "bash"]);
    expect(splitToolEntries(" ")).toEqual([""]);
    expect(splitToolEntries("")).toEqual([]);
  });
});

describe("validateToolEntries (lexical only)", () => {
  it("accepts a plain list of names", () => {
    expect(validateToolEntries(["read", "bash", "mcp__radius__query"], CTX)).toEqual({ ok: true });
    expect(validateToolEntries([], CTX)).toEqual({ ok: true });
  });

  it("rejects an empty entry and names it", () => {
    const result = validateToolEntries(["read", "", "bash"], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('""');
      expect(result.error).toContain("reviewer");
      expect(result.error).toContain("/tmp/agents/reviewer.md");
    }
  });

  it("rejects a whitespace-only entry as the empty entry it parses to", () => {
    const result = validateToolEntries(splitToolEntries("read,   , bash"), CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('""');
      expect(result.error).toMatch(/empty/i);
    }
  });

  it("rejects a leading-+ entry as a modifier and names it", () => {
    const result = validateToolEntries(["read", "+web_search"], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("+web_search");
      // The reason matters: pi reads it as a modifier, not a name.
      expect(result.error).toMatch(/modifier/i);
    }
  });

  it("rejects a leading-- entry as a modifier and names it", () => {
    const result = validateToolEntries(["-bash"], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("-bash");
  });

  it("rejects a duplicated entry and names it", () => {
    const result = validateToolEntries(["read", "bash", "read"], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("read");
      expect(result.error).toMatch(/twice|more than once/i);
    }
  });

  it("reports the first problem it finds, in list order", () => {
    const result = validateToolEntries(["read", "read", "+bash"], CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain("+bash");
  });

  it("says the field and file when both are known, and degrades to a generic message when not", () => {
    const named = validateToolEntries(["read", "read"], { agentName: "explore" });
    expect(!named.ok && named.error).toContain("explore");
    const bare = validateToolEntries(["read", "read"]);
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.error).toContain("read");
  });
});

describe("applyToolEntries (the edit-site half: reject leaves the previous value alone)", () => {
  it("applies a valid list", () => {
    const agent = makeAgent({ tools: ["bash"] });
    const error = applyToolEntries(agent, ["read", "bash"], CTX);
    expect(error).toBeNull();
    expect(agent.tools).toEqual(["read", "bash"]);
  });

  it("an empty list means no allowlist, and clears the field", () => {
    const agent = makeAgent({ tools: ["bash"] });
    expect(applyToolEntries(agent, [], CTX)).toBeNull();
    expect(agent.tools).toBeUndefined();
  });

  it("a rejected entry leaves the previous list intact", () => {
    const agent = makeAgent({ tools: ["read", "bash"] });
    const error = applyToolEntries(agent, ["read", "+bash"], CTX);
    expect(error).toBeTruthy();
    expect(agent.tools).toEqual(["read", "bash"]);
  });

  it("a rejected empty entry leaves the previous list intact", () => {
    const agent = makeAgent({ tools: ["read"] });
    expect(applyToolEntries(agent, ["read", "  "], CTX)).toBeTruthy();
    expect(agent.tools).toEqual(["read"]);
  });

  it("a rejected duplicate leaves the previous list intact", () => {
    const agent = makeAgent();
    expect(applyToolEntries(agent, ["read", "read"], CTX)).toBeTruthy();
    expect(agent.tools).toBeUndefined();
  });
});

describe("unknownToolEntries (membership, asked at dispatch)", () => {
  const KNOWN = ["read", "bash", "mcp__radius__query"];

  it("reports entries pi does not currently have", () => {
    expect(unknownToolEntries(["read", "web_search"], KNOWN)).toEqual(["web_search"]);
  });

  it("reports nothing when every entry is available", () => {
    expect(unknownToolEntries(["read", "bash"], KNOWN)).toEqual([]);
  });

  it("treats a * entry as a pattern over the tools pi actually has", () => {
    expect(unknownToolEntries(["mcp__radius__*"], KNOWN)).toEqual([]);
    expect(unknownToolEntries(["mcp__nope__*"], KNOWN)).toEqual(["mcp__nope__*"]);
  });

  it("names every offending entry in the warning", () => {
    const warning = formatUnknownToolsWarning("reviewer", ["web_search", "sudo_exec"]);
    expect(warning).toContain("web_search");
    expect(warning).toContain("sudo_exec");
    // The whole point of warn-not-fail: the run still happens.
    expect(warning).toMatch(/proceed|continues/i);
  });
});
