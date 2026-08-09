import { describe, it, expect, vi, beforeEach } from "vitest";
import { Events } from "@pi-archimedes/core/bus";

// ── mock bus ────────────────────────────────────────────────────────────────

let mockEmit: ReturnType<typeof vi.fn>;

vi.mock("@pi-archimedes/core/bus", async (importOriginal) => {
  const actual = await importOriginal() as typeof import("@pi-archimedes/core/bus");
  return {
    ...actual,
    getBus: () => ({
      emit: mockEmit,
    }),
  };
});

const { emitCostUpdate } = await import("./cost.js");

describe("emitCostUpdate", () => {
  beforeEach(() => {
    mockEmit = vi.fn();
  });

  it("emits COST_UPDATE event with correct source prefix", () => {
    emitCostUpdate("my-agent", { inputTokens: 100, outputTokens: 50 });

    expect(mockEmit).toHaveBeenCalledWith(Events.COST_UPDATE, {
      source: "subagent:my-agent",
      inputTokens: 100,
      outputTokens: 50,
    });
  });

  it("passes through all usage fields", () => {
    emitCostUpdate("test-agent", {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheWriteTokens: 100,
      cost: 0.05,
    });

    expect(mockEmit).toHaveBeenCalledWith(Events.COST_UPDATE, {
      source: "subagent:test-agent",
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheWriteTokens: 100,
      cost: 0.05,
    });
  });

  it("works with partial usage fields", () => {
    emitCostUpdate("minimal", { cost: 0.01 });

    expect(mockEmit).toHaveBeenCalledWith(Events.COST_UPDATE, {
      source: "subagent:minimal",
      cost: 0.01,
    });
  });
});
