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
