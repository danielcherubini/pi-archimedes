import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CostAccumulator } from "./cost-accumulator.js";
import { getBus, Events } from "@pi-archimedes/core/bus";

// ── globalThis cleanup ──────────────────────────────────────────────────────

const BUS_KEY = Symbol.for("archimedes:bus");
const QUEUE_KEY = Symbol.for("archimedes:busQueue");

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[BUS_KEY];
  delete (globalThis as Record<symbol, unknown>)[QUEUE_KEY];
});

// ── CostAccumulator ─────────────────────────────────────────────────────────

describe("CostAccumulator", () => {
  let accumulator: CostAccumulator;

  beforeEach(() => {
    accumulator = new CostAccumulator();
    accumulator.subscribe();
  });

  it("accumulates input tokens from cost events", () => {
    getBus().emit(Events.COST_UPDATE, { inputTokens: 100, outputTokens: 50 });
    expect(accumulator.inputTokens).toBe(100);
    expect(accumulator.outputTokens).toBe(50);
  });

  it("accumulates cache read/write tokens", () => {
    getBus().emit(Events.COST_UPDATE, {
      cacheReadTokens: 200,
      cacheWriteTokens: 100,
    });
    expect(accumulator.cacheReadTokens).toBe(200);
    expect(accumulator.cacheWriteTokens).toBe(100);
  });

  it("accumulates cost", () => {
    getBus().emit(Events.COST_UPDATE, { cost: 0.015 });
    expect(accumulator.cost).toBe(0.015);
  });

  it("multiple cost updates accumulate correctly", () => {
    getBus().emit(Events.COST_UPDATE, { inputTokens: 100, cost: 0.01 });
    getBus().emit(Events.COST_UPDATE, { inputTokens: 200, cost: 0.02 });
    getBus().emit(Events.COST_UPDATE, { inputTokens: 300, cost: 0.03 });
    expect(accumulator.inputTokens).toBe(600);
    expect(accumulator.cost).toBe(0.06);
  });

  it("missing fields in payload default to 0", () => {
    getBus().emit(Events.COST_UPDATE, {});
    expect(accumulator.inputTokens).toBe(0);
    expect(accumulator.outputTokens).toBe(0);
    expect(accumulator.cacheReadTokens).toBe(0);
    expect(accumulator.cacheWriteTokens).toBe(0);
    expect(accumulator.cost).toBe(0);
  });

  it("reset zeroes all counters", () => {
    getBus().emit(Events.COST_UPDATE, { inputTokens: 100, cost: 0.01 });
    accumulator.reset();
    expect(accumulator.inputTokens).toBe(0);
    expect(accumulator.outputTokens).toBe(0);
    expect(accumulator.cacheReadTokens).toBe(0);
    expect(accumulator.cacheWriteTokens).toBe(0);
    expect(accumulator.cost).toBe(0);
  });

  it("dispose unsubscribes — subsequent events not accumulated", () => {
    getBus().emit(Events.COST_UPDATE, { inputTokens: 100 });
    accumulator.dispose();
    getBus().emit(Events.COST_UPDATE, { inputTokens: 500 });
    expect(accumulator.inputTokens).toBe(100);
  });

  it("subsequent events not accumulated after dispose", () => {
    getBus().emit(Events.COST_UPDATE, { cost: 0.01 });
    accumulator.dispose();
    getBus().emit(Events.COST_UPDATE, { cost: 0.05 });
    expect(accumulator.cost).toBe(0.01);
  });
});
