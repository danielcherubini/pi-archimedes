import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";

// ── Helpers ─────────────────────────────────────────────────────────────────

interface MessageUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: { total: number };
}

interface AssistantMessage {
  role: "assistant";
  usage: MessageUsage;
}

interface UserMessage {
  role: "user";
  content: string;
}

interface SessionEntry {
  type: "message";
  message: AssistantMessage | UserMessage;
}

interface MockContext {
  sessionManager: {
    getEntries: () => SessionEntry[];
  };
  getContextUsage: () => { contextWindow?: number; percent?: number } | undefined;
  model?: { contextWindow?: number };
}

function makeAssistantEntry(usage: MessageUsage): SessionEntry {
  return {
    type: "message",
    message: { role: "assistant", usage },
  };
}

function makeUserEntry(): SessionEntry {
  return {
    type: "message",
    message: { role: "user", content: "hello" },
  };
}

function makeCtx(entries: SessionEntry[], contextUsage?: { contextWindow?: number; percent?: number }, modelContextWindow?: number): any {
  return {
    sessionManager: { getEntries: () => entries },
    getContextUsage: () => contextUsage,
    model: modelContextWindow ? { contextWindow: modelContextWindow } : undefined,
  };
}

// ── Tests (vi.resetModules + dynamic import to isolate module state) ────────

describe("getTokenUsageStats", () => {
  let getTokenUsageStats: typeof import("./stats.js").getTokenUsageStats;
  let invalidateStatsCache: typeof import("./stats.js").invalidateStatsCache;

  async function loadModule() {
    vi.resetModules();
    const mod = await import("./stats.js");
    getTokenUsageStats = mod.getTokenUsageStats;
    invalidateStatsCache = mod.invalidateStatsCache;
  }

  it("empty entries returns zero stats", async () => {
    await loadModule();
    const ctx = makeCtx([]);
    const result = getTokenUsageStats(ctx);
    expect(result).toEqual({
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      totalCost: 0,
    });
  });

  it("single assistant message accumulates correctly", async () => {
    await loadModule();
    const usage = { input: 100, output: 50, cacheRead: 200, cacheWrite: 100, cost: { total: 0.05 } };
    const ctx = makeCtx([makeAssistantEntry(usage)]);
    const result = getTokenUsageStats(ctx);
    expect(result).toEqual({
      totalInput: 100,
      totalOutput: 50,
      totalCacheRead: 200,
      totalCacheWrite: 100,
      totalCost: 0.05,
    });
  });

  it("multiple messages sum correctly", async () => {
    await loadModule();
    const ctx = makeCtx([
      makeAssistantEntry({ input: 100, output: 50, cacheRead: 10, cacheWrite: 5, cost: { total: 0.01 } }),
      makeAssistantEntry({ input: 200, output: 100, cacheRead: 20, cacheWrite: 10, cost: { total: 0.02 } }),
    ]);
    const result = getTokenUsageStats(ctx);
    expect(result).toEqual({
      totalInput: 300,
      totalOutput: 150,
      totalCacheRead: 30,
      totalCacheWrite: 15,
      totalCost: 0.03,
    });
  });

  it("non-assistant messages ignored", async () => {
    await loadModule();
    const ctx = makeCtx([
      makeUserEntry(),
      makeAssistantEntry({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } }),
      makeUserEntry(),
    ]);
    const result = getTokenUsageStats(ctx);
    expect(result.totalInput).toBe(100);
    expect(result.totalOutput).toBe(50);
  });

  it("cache returns same result within TTL", async () => {
    await loadModule();
    const ctx = makeCtx([
      makeAssistantEntry({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } }),
    ]);
    const first = getTokenUsageStats(ctx);
    const second = getTokenUsageStats(ctx);
    expect(first).toBe(second); // same reference (cached)
  });

  it("invalidateStatsCache clears cache", async () => {
    await loadModule();
    const ctx = makeCtx([
      makeAssistantEntry({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } }),
    ]);
    const first = getTokenUsageStats(ctx);
    invalidateStatsCache();
    const second = getTokenUsageStats(ctx);
    expect(first).toEqual(second);
    expect(first).not.toBe(second); // different reference (cache cleared)
  });

  it("property: stats are monotonic (adding entries never decreases totals)", async () => {
    await loadModule();
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            input: fc.nat({ max: 1000 }),
            output: fc.nat({ max: 1000 }),
            cacheRead: fc.nat({ max: 1000 }),
            cacheWrite: fc.nat({ max: 1000 }),
            cost: fc.double({ min: 0, max: 1 }),
          }),
        ),
        (usages) => {
          const entries: SessionEntry[] = [];
          let prev = { totalInput: 0, totalOutput: 0, totalCacheRead: 0, totalCacheWrite: 0, totalCost: 0 };
          for (const u of usages) {
            entries.push(makeAssistantEntry({ input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite, cost: { total: u.cost } }));
            const ctx = makeCtx(entries);
            const curr = getTokenUsageStats(ctx);
            // Monotonic: each total >= previous
            if (
              curr.totalInput < prev.totalInput ||
              curr.totalOutput < prev.totalOutput ||
              curr.totalCacheRead < prev.totalCacheRead ||
              curr.totalCacheWrite < prev.totalCacheWrite ||
              curr.totalCost < prev.totalCost
            ) {
              throw new Error(`Monotonicity violated: ${JSON.stringify(prev)} -> ${JSON.stringify(curr)}`);
            }
            prev = curr;
          }
        },
      ),
      { verbose: false },
    );
  });
});

describe("getContextWindowInfo", () => {
  let getContextWindowInfo: typeof import("./stats.js").getContextWindowInfo;

  async function loadModule() {
    vi.resetModules();
    const mod = await import("./stats.js");
    getContextWindowInfo = mod.getContextWindowInfo;
  }

  it("computes percentage correctly", async () => {
    await loadModule();
    const ctx = makeCtx(
      [makeAssistantEntry({ input: 500, output: 500, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } })],
      { contextWindow: 10000, percent: 10 },
    );
    const result = getContextWindowInfo(ctx);
    expect(result.percent).toBe("10.0");
    expect(result.percentValue).toBe(10);
    expect(result.windowSize).toBe(10000);
  });

  it("handles missing context window", async () => {
    await loadModule();
    const ctx = makeCtx([], undefined);
    const result = getContextWindowInfo(ctx);
    expect(result.percent).toBe("?");
    expect(result.percentValue).toBe(0);
    expect(result.windowSize).toBe(0);
  });

  it("computes percentage from tokens when contextUsage.percent missing", async () => {
    await loadModule();
    const ctx = makeCtx(
      [makeAssistantEntry({ input: 500, output: 500, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } })],
      { contextWindow: 10000 },
    );
    const result = getContextWindowInfo(ctx);
    expect(result.percent).toBe("?");
    expect(result.percentValue).toBe(10);
    expect(result.windowSize).toBe(10000);
  });
});
