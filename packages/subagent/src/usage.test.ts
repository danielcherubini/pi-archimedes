import { describe, it, expect } from "vitest";
import { toNativeUsage, sumNativeUsage } from "./usage.js";
import type { SubagentResult, SubagentUsage } from "./types.js";

// pi folds a tool result's `usage` into the session totals, and it reads exactly
// these fields (`addUsageToTotals`: input/output/cacheRead/cacheWrite and
// `cost.total`). A field it has to dereference and finds missing is a NaN in the
// session's cost, so the shape is the contract these tests pin.

function usage(overrides: Partial<SubagentUsage> = {}): SubagentUsage {
  return {
    input: 4000,
    output: 1500,
    cacheRead: 512,
    cacheWrite: 8,
    cost: 0.2,
    turns: 3,
    ...overrides,
  };
}

function result(withUsage: SubagentUsage): SubagentResult {
  return {
    agent: "reviewer",
    task: "t",
    exitCode: 0,
    usage: withUsage,
    model: undefined,
    finalOutput: "x",
    error: undefined,
    progress: undefined,
    progressSummary: undefined,
  };
}

describe("toNativeUsage", () => {
  it("carries every field pi dereferences, with the cost under cost.total", () => {
    const native = toNativeUsage(usage());
    expect(native.input).toBe(4000);
    expect(native.output).toBe(1500);
    expect(native.cacheRead).toBe(512);
    expect(native.cacheWrite).toBe(8);
    expect(native.cost.total).toBeCloseTo(0.2);
    expect(typeof native.cost.input).toBe("number");
    expect(typeof native.cost.output).toBe("number");
    expect(typeof native.cost.cacheRead).toBe("number");
    expect(typeof native.cost.cacheWrite).toBe("number");
  });

  it("totalTokens is the sum of the four token kinds, as pi defines it", () => {
    expect(toNativeUsage(usage()).totalTokens).toBe(4000 + 1500 + 512 + 8);
  });

  it("a zero run produces zeros, not undefined", () => {
    const native = toNativeUsage(usage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }));
    expect(native.totalTokens).toBe(0);
    expect(native.cost.total).toBe(0);
  });
});

describe("sumNativeUsage", () => {
  it("adds a parallel batch into one usage (one tool call, one toolResult message)", () => {
    const total = sumNativeUsage([result(usage()), result(usage())])!;
    expect(total.input).toBe(8000);
    expect(total.output).toBe(3000);
    expect(total.cost.total).toBeCloseTo(0.4);
    expect(total.totalTokens).toBe(2 * (4000 + 1500 + 512 + 8));
  });

  it("returns undefined when there is nothing to report", () => {
    expect(sumNativeUsage([])).toBeUndefined();
  });
});
