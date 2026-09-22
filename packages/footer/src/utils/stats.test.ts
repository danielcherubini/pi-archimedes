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

interface ToolResultMessage {
  role: "toolResult";
  usage?: MessageUsage | undefined;
}

interface SessionEntry {
  id: string;
  type: "message" | "usage" | "compaction" | "branch_summary";
  message?: AssistantMessage | UserMessage | ToolResultMessage | undefined;
  usage?: MessageUsage | undefined;
}

interface MockContext {
  sessionManager: {
    getEntries: () => SessionEntry[];
  };
  getContextUsage: () => { contextWindow?: number; percent?: number } | undefined;
  model?: { contextWindow?: number };
}

let idCounter = 1;

function makeAssistantEntry(idOrUsage: string | MessageUsage, maybeUsage?: MessageUsage): SessionEntry {
  const id = typeof idOrUsage === "string" ? idOrUsage : `asst-${idCounter++}`;
  const usage = typeof idOrUsage === "string" ? maybeUsage! : idOrUsage;
  return {
    id,
    type: "message",
    message: { role: "assistant", usage },
  };
}

function makeUserEntry(id = `user-${idCounter++}`): SessionEntry {
  return {
    id,
    type: "message",
    message: { role: "user", content: "hello" },
  };
}

function makeUsageEntry(id: string, usage: MessageUsage): SessionEntry {
  return {
    id,
    type: "usage",
    usage,
  };
}

function makeToolResultEntry(id: string, usage?: MessageUsage): SessionEntry {
  return {
    id,
    type: "message",
    message: usage !== undefined ? { role: "toolResult", usage } : { role: "toolResult" },
  };
}

function makeCompactionEntry(id: string, usage?: MessageUsage): SessionEntry {
  return usage !== undefined
    ? { id, type: "compaction", usage }
    : { id, type: "compaction" };
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
  let resetStatsState: typeof import("./stats.js").resetStatsState;

  async function loadModule() {
    vi.resetModules();
    const mod = await import("./stats.js");
    getTokenUsageStats = mod.getTokenUsageStats;
    invalidateStatsCache = mod.invalidateStatsCache;
    resetStatsState = mod.resetStatsState;
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

  it("accumulates tokens and cost from UsageEntry (cache warming)", async () => {
    await loadModule();
    const ctx = makeCtx([
      makeAssistantEntry("a1", { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, cost: { total: 0.01 } }),
      makeUsageEntry("u1", { input: 0, output: 0, cacheRead: 500, cacheWrite: 200, cost: { total: 0.005 } }),
    ]);
    const result = getTokenUsageStats(ctx);
    expect(result).toEqual({
      totalInput: 100,
      totalOutput: 50,
      totalCacheRead: 510,
      totalCacheWrite: 205,
      totalCost: 0.015,
    });
  });

  it("accumulates usage from ToolResultMessage", async () => {
    await loadModule();
    const ctx = makeCtx([
      makeAssistantEntry("a1", { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } }),
      makeToolResultEntry("t1", { input: 200, output: 80, cacheRead: 50, cacheWrite: 20, cost: { total: 0.02 } }),
      makeToolResultEntry("t2"), // toolResult without usage ignored
    ]);
    const result = getTokenUsageStats(ctx);
    expect(result).toEqual({
      totalInput: 300,
      totalOutput: 130,
      totalCacheRead: 50,
      totalCacheWrite: 20,
      totalCost: 0.03,
    });
  });

  it("accumulates usage from CompactionEntry and branch_summary", async () => {
    await loadModule();
    const ctx = makeCtx([
      makeCompactionEntry("c1", { input: 1000, output: 200, cacheRead: 100, cacheWrite: 50, cost: { total: 0.04 } }),
      {
        id: "bs1",
        type: "branch_summary",
        usage: { input: 500, output: 100, cacheRead: 50, cacheWrite: 25, cost: { total: 0.02 } },
      } as SessionEntry,
    ]);
    const result = getTokenUsageStats(ctx);
    expect(result).toEqual({
      totalInput: 1500,
      totalOutput: 300,
      totalCacheRead: 150,
      totalCacheWrite: 75,
      totalCost: 0.06,
    });
  });

  it("detects branch switch: changing entry IDs at anchor position triggers clean re-scan", async () => {
    await loadModule();
    // Branch 1: entries [a1, a2]
    const branch1 = [
      makeAssistantEntry("a1", { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } }),
      makeAssistantEntry("a2", { input: 200, output: 100, cacheRead: 0, cacheWrite: 0, cost: { total: 0.02 } }),
    ];
    let ctx = makeCtx(branch1);
    let result = getTokenUsageStats(ctx);
    expect(result.totalInput).toBe(300);
    expect(result.totalOutput).toBe(150);

    // Branch switch: second entry is different id/usage (a2_alt instead of a2)
    const branch2: SessionEntry[] = [
      branch1[0]!,
      makeAssistantEntry("a2_alt", { input: 50, output: 25, cacheRead: 0, cacheWrite: 0, cost: { total: 0.005 } }),
    ];
    ctx = makeCtx(branch2);
    result = getTokenUsageStats(ctx);
    // Should NOT be 350 (accumulated on old running total); must re-scan branch2 cleanly
    expect(result).toEqual({
      totalInput: 150,
      totalOutput: 75,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      totalCost: 0.015,
    });
  });

  it("detects branch switch: changing first entry ID triggers clean re-scan even if tail anchor matches", async () => {
    await loadModule();
    // Branch 1: entries [a1, a2]
    const branch1 = [
      makeAssistantEntry("a1", { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } }),
      makeAssistantEntry("a2", { input: 200, output: 100, cacheRead: 0, cacheWrite: 0, cost: { total: 0.02 } }),
    ];
    let ctx = makeCtx(branch1);
    let result = getTokenUsageStats(ctx);
    expect(result.totalInput).toBe(300);

    // Branch switch where tail ID 'a2' happens to match, but head entry is 'a1_replaced'
    const branch2: SessionEntry[] = [
      makeAssistantEntry("a1_replaced", { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 0.001 } }),
      branch1[1]!,
    ];
    ctx = makeCtx(branch2);
    result = getTokenUsageStats(ctx);
    expect(result).toEqual({
      totalInput: 210,
      totalOutput: 105,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      totalCost: 0.021,
    });
  });

  it("updates total when tail entry usage mutates in-place with unchanged entry count", async () => {
    await loadModule();
    const tailEntry = makeAssistantEntry("a1", { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } });
    const entries = [tailEntry];
    const ctx = makeCtx(entries);

    const initial = getTokenUsageStats(ctx);
    expect(initial.totalOutput).toBe(50);
    expect(initial.totalCost).toBe(0.01);

    // In-place mutation of streaming assistant message
    (tailEntry.message as AssistantMessage).usage = {
      input: 100,
      output: 120, // increased during streaming finalization
      cacheRead: 0,
      cacheWrite: 0,
      cost: { total: 0.025 },
    };

    const updated = getTokenUsageStats(ctx);
    expect(updated.totalOutput).toBe(120);
    expect(updated.totalCost).toBe(0.025);
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

  it("resetStatsState clears module state completely", async () => {
    await loadModule();
    const ctx = makeCtx([
      makeAssistantEntry("a1", { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } }),
    ]);
    const first = getTokenUsageStats(ctx);
    expect(first.totalInput).toBe(100);
    resetStatsState();
    const second = getTokenUsageStats(ctx);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
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
