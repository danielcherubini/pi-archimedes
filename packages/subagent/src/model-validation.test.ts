import { describe, it, expect } from "vitest";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { validateModel, firstError } from "./model-validation.js";

function mockRegistry(models: Array<{ provider: string; id: string }>): ModelRegistry {
  return { getAll: () => models } as unknown as ModelRegistry;
}

const REGISTRY = mockRegistry([
  { provider: "anthropic", id: "claude-sonnet-4-5" },
  { provider: "openai", id: "gpt-5" },
  { provider: "openrouter", id: "claude-sonnet-4-5" }, // ambiguous bare id across providers
]);

describe("validateModel", () => {
  it("accepts a valid canonical provider/id", () => {
    expect(validateModel("anthropic/claude-sonnet-4-5", REGISTRY)).toEqual({ ok: true });
  });

  it("accepts case-insensitive provider/id", () => {
    expect(validateModel("Anthropic/Claude-Sonnet-4-5", REGISTRY)).toEqual({ ok: true });
  });

  it("accepts a valid unique bare id", () => {
    expect(validateModel("gpt-5", REGISTRY)).toEqual({ ok: true });
  });

  it("rejects an ambiguous bare id (>=2 providers)", () => {
    const r = validateModel("claude-sonnet-4-5", REGISTRY);
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown string", () => {
    const r = validateModel("general", REGISTRY);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("not found");
  });

  it("accepts a thinking suffix by matching the prefix", () => {
    expect(validateModel("gpt-5:high", REGISTRY)).toEqual({ ok: true });
  });

  it("accepts provider/id with a thinking suffix", () => {
    expect(validateModel("anthropic/claude-sonnet-4-5:high", REGISTRY)).toEqual({ ok: true });
  });

  it("returns ok for empty/undefined model", () => {
    expect(validateModel(undefined, REGISTRY)).toEqual({ ok: true });
    expect(validateModel("", REGISTRY)).toEqual({ ok: true });
    expect(validateModel("   ", REGISTRY)).toEqual({ ok: true });
  });

  it("returns ok when the registry is empty (defer to child)", () => {
    expect(validateModel("anything", mockRegistry([]))).toEqual({ ok: true });
  });

  it("emits the agent-name hint when model equals agentName", () => {
    const r = validateModel("general", REGISTRY, { agentName: "general" });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("looks like an agent name");
  });

  it("emits the config-pointing message when agentFilePath is set", () => {
    const r = validateModel("bogus", REGISTRY, {
      agentName: "reviewer",
      agentFilePath: "/home/u/.agents/agents/reviewer.md",
    });
    expect(r.ok).toBe(false);
    const err = (r as { error: string }).error;
    expect(err).toContain("/home/u/.agents/agents/reviewer.md");
    expect(err).toContain("Fix the model field");
  });
});

describe("firstError", () => {
  it("returns undefined when all ok", () => {
    expect(firstError({ ok: true }, { ok: true })).toBeUndefined();
  });
  it("returns the first error string", () => {
    expect(firstError({ ok: true }, { ok: false, error: "boom" }, { ok: false, error: "later" })).toBe("boom");
  });
});
