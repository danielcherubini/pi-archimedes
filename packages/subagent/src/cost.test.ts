import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Events } from "@pi-archimedes/core/bus";

// ── globalThis cleanup ──────────────────────────────────────────────────────

const BUS_KEY = Symbol.for("archimedes:bus");
const QUEUE_KEY = Symbol.for("archimedes:busQueue");

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[BUS_KEY];
  delete (globalThis as Record<symbol, unknown>)[QUEUE_KEY];
});

// ── mock bus ────────────────────────────────────────────────────────────────

let mockEmit: ReturnType<typeof vi.fn>;

vi.mock("@pi-archimedes/core/bus", () => ({
  getBus: () => ({
    emit: mockEmit,
  }),
  Events: {
    COST_UPDATE: "archimedes:cost_update",
    TODOS_UPDATE: "archimedes:todos_update",
    TODOS_CLEAR: "archimedes:todos_clear",
    ASK_REQUEST: "archimedes:ask_request",
    ASK_RESPONSE: "archimedes:ask_response",
  },
}));

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
