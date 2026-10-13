import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { validateAgentName, serializeAgent, AGENT_NAME_REGEX } from "./frontmatter-io.js";
import type { AgentConfig } from "./agents.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "test-agent",
    description: "A test agent",
    systemPrompt: "You are a helpful test agent.",
    source: "user",
    filePath: "/tmp/test-agent.md",
    ...overrides,
  };
}

// ── validateAgentName ───────────────────────────────────────────────────────

describe("validateAgentName", () => {
  it("accepts valid names (3-50 chars, lowercase alnum + hyphens)", () => {
    expect(validateAgentName("abc")).toBeNull();
    expect(validateAgentName("test-agent")).toBeNull();
    expect(validateAgentName("a1b2c3")).toBeNull();
    expect(validateAgentName("my-long-agent-name-with-many-hyphens")).toBeNull();
  });

  it("accepts single char names", () => {
    expect(validateAgentName("a")).toBeNull();
    expect(validateAgentName("z")).toBeNull();
    expect(validateAgentName("0")).toBeNull();
    expect(validateAgentName("9")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(validateAgentName("")).toBe("Name is required");
  });

  it("rejects uppercase", () => {
    expect(validateAgentName("Abc")).not.toBeNull();
    expect(validateAgentName("ABC")).not.toBeNull();
  });

  it("rejects special chars", () => {
    expect(validateAgentName("test_agent")).not.toBeNull();
    expect(validateAgentName("test.agent")).not.toBeNull();
    expect(validateAgentName("test agent")).not.toBeNull();
  });

  it("rejects names starting/ending with hyphens", () => {
    expect(validateAgentName("-test")).not.toBeNull();
    expect(validateAgentName("test-")).not.toBeNull();
  });

  it("rejects two-char names (not single char, not 3+)", () => {
    expect(validateAgentName("ab")).not.toBeNull();
  });
});

// ── serializeAgent ──────────────────────────────────────────────────────────

describe("serializeAgent", () => {
  it("produces valid YAML frontmatter", () => {
    const agent = makeAgent();
    const output = serializeAgent(agent);
    expect(output).toMatch(/^---\n/);
    expect(output).toContain("name: test-agent");
    expect(output).toContain("description: A test agent");
    expect(output).toContain("You are a helpful test agent.");
  });

  it("quotes values that need quoting", () => {
    const agent = makeAgent({ description: "value with: colon" });
    const output = serializeAgent(agent);
    expect(output).toContain('description: "value with: colon"');
  });

  it("includes optional fields when present", () => {
    const agent = makeAgent({
      tools: ["read", "write"],
      model: "gpt-4o",
      thinking: "high",
    });
    const output = serializeAgent(agent);
    expect(output).toContain("tools: read, write");
    expect(output).toContain("model: gpt-4o");
    expect(output).toContain("thinking: high");
  });

  it("omits optional fields when absent", () => {
    const agent = makeAgent();
    const output = serializeAgent(agent);
    expect(output).not.toContain("tools:");
    expect(output).not.toContain("model:");
    expect(output).not.toContain("thinking:");
  });

  it("property: output starts with '---\\n' and contains closing '\\n---\\n' delimiter", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        (name, desc, prompt) => {
          const agent = makeAgent({ name, description: desc, systemPrompt: prompt });
          const output = serializeAgent(agent);
          if (!output.startsWith("---\n")) {
            throw new Error(`Output does not start with '---\\n': ${JSON.stringify(output.slice(0, 20))}`);
          }
          if (!output.includes("\n---\n")) {
            throw new Error(`Output does not contain closing '\\n---\\n' delimiter`);
          }
        },
      ),
      { verbose: false },
    );
  });
});

// ── mcp round-trip (the writer's half of ADR 0028) ──────────────────────────

describe("serializeAgent: mcp opt-in", () => {
  it("writes the mcp key when the agent opts in", () => {
    const output = serializeAgent(makeAgent({ tools: ["read", "bash"], mcp: true }));
    expect(output).toContain("mcp: true");
  });

  it("writes no mcp key when the field is absent or false (closed is the default)", () => {
    expect(serializeAgent(makeAgent({ tools: ["read"] }))).not.toContain("mcp:");
    expect(serializeAgent(makeAgent({ tools: ["read"], mcp: false }))).not.toContain("mcp:");
  });

  it("survives a write → read round trip as a real boolean, not a string", async () => {
    const { parseFrontmatter } = await import("@earendil-works/pi-coding-agent");
    const output = serializeAgent(makeAgent({ tools: ["read", "bash"], mcp: true }));
    const { frontmatter } = parseFrontmatter(output);
    expect(frontmatter.mcp).toBe(true);
  });

  it("keeps the tools list intact alongside the mcp key", () => {
    const output = serializeAgent(makeAgent({ tools: ["read", "bash"], mcp: true }));
    expect(output).toContain("tools: read, bash");
    expect(output).toContain("mcp: true");
  });
});

// ── One `tools:` key, whatever the config object looks like ───────────────

describe("serializeAgent: never writes two tools keys", () => {
  // The read path preserves an unreadable `tools:` in `extraFields` so a save
  // cannot delete a line the user typed, while `applyToolEntries` owns the real
  // `tools` field. If both are populated the file gets two `tools:` keys and the
  // last one wins on the next read — which is the broken one.
  const toolsKeys = (yaml: string): string[] =>
    yaml.split("\n").filter((line) => /^tools:/.test(line));

  it("writes the real field and drops the preserved raw value when both exist", async () => {
    const { parseFrontmatter } = await import("@earendil-works/pi-coding-agent");
    const output = serializeAgent(
      makeAgent({ tools: ["read"], extraFields: { tools: "read, +web_search", owner: "x" } }),
    );
    expect(toolsKeys(output)).toEqual(["tools: read"]);
    expect(parseFrontmatter(output).frontmatter.tools).toBe("read");
    // The unrelated extra still round-trips.
    expect(output).toContain("owner: x");
  });

  it("still writes a preserved raw value when there is no parsed list to replace it", () => {
    // This is the preservation the read path promised: an agent whose `tools:`
    // was rejected keeps its line on save, rather than being silently rewritten
    // without it.
    const output = serializeAgent(makeAgent({ extraFields: { tools: "read, +web_search" } }));
    expect(toolsKeys(output)).toEqual(["tools: read, +web_search"]);
  });
});
