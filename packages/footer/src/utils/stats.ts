import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface MessageUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
}

export interface TokenUsageStats {
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalCost: number;
}

export function extractEntryUsage(sessionEntry: any): MessageUsage | null {
  if (sessionEntry?.type === "usage") {
    return sessionEntry.usage ?? null;
  }
  if (sessionEntry?.type === "message" && sessionEntry.message?.role === "assistant") {
    return sessionEntry.message.usage ?? null;
  }
  if (sessionEntry?.type === "message" && sessionEntry.message?.role === "toolResult" && sessionEntry.message.usage) {
    return sessionEntry.message.usage;
  }
  if ((sessionEntry?.type === "compaction" || sessionEntry?.type === "branch_summary") && sessionEntry.usage) {
    return sessionEntry.usage;
  }
  return null;
}

function snapshotUsage(usage: MessageUsage | null | undefined): MessageUsage | undefined {
  if (!usage) return undefined;
  return {
    input: usage.input ?? 0,
    output: usage.output ?? 0,
    cacheRead: usage.cacheRead ?? 0,
    cacheWrite: usage.cacheWrite ?? 0,
    cost: { total: usage.cost?.total ?? 0 },
  };
}

function usageEquals(a: MessageUsage | undefined, b: MessageUsage | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    (a.input ?? 0) === (b.input ?? 0) &&
    (a.output ?? 0) === (b.output ?? 0) &&
    (a.cacheRead ?? 0) === (b.cacheRead ?? 0) &&
    (a.cacheWrite ?? 0) === (b.cacheWrite ?? 0) &&
    (a.cost?.total ?? 0) === (b.cost?.total ?? 0)
  );
}

// Running total from initial scan — avoids re-scanning old entries
let runningTotal: TokenUsageStats | undefined;
let runningTotalEntryCount = 0;
let lastFirstEntryId: string | undefined;
let lastAnchorEntryId: string | undefined;
let lastTailUsage: MessageUsage | undefined;
let statsCache: TokenUsageStats | undefined;

export function getTokenUsageStats(ctx: ExtensionContext): TokenUsageStats {
  const entries = ctx.sessionManager.getEntries();

  if (entries.length === 0) {
    resetStatsState();
    return {
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      totalCost: 0,
    };
  }

  const anchorMatch =
    runningTotal !== undefined &&
    runningTotalEntryCount > 0 &&
    entries[0]?.id === lastFirstEntryId &&
    entries[runningTotalEntryCount - 1]?.id === lastAnchorEntryId;

  if (anchorMatch && runningTotal) {
    if (entries.length === runningTotalEntryCount) {
      // Invariant: for unchanged entry count, only the tail entry's usage mutates during streaming.
      const currentTailUsage = extractEntryUsage(entries[entries.length - 1]);
      if (!usageEquals(currentTailUsage ?? undefined, lastTailUsage)) {
        const pIn = lastTailUsage?.input ?? 0;
        const pOut = lastTailUsage?.output ?? 0;
        const pCr = lastTailUsage?.cacheRead ?? 0;
        const pCw = lastTailUsage?.cacheWrite ?? 0;
        const pCost = lastTailUsage?.cost?.total ?? 0;

        const cIn = currentTailUsage?.input ?? 0;
        const cOut = currentTailUsage?.output ?? 0;
        const cCr = currentTailUsage?.cacheRead ?? 0;
        const cCw = currentTailUsage?.cacheWrite ?? 0;
        const cCost = currentTailUsage?.cost?.total ?? 0;

        runningTotal = {
          totalInput: runningTotal.totalInput + (cIn - pIn),
          totalOutput: runningTotal.totalOutput + (cOut - pOut),
          totalCacheRead: runningTotal.totalCacheRead + (cCr - pCr),
          totalCacheWrite: runningTotal.totalCacheWrite + (cCw - pCw),
          totalCost: runningTotal.totalCost + (cCost - pCost),
        };
        lastTailUsage = snapshotUsage(currentTailUsage);
        statsCache = runningTotal;
        return runningTotal;
      }

      if (statsCache !== undefined) {
        return statsCache;
      }
      statsCache = { ...runningTotal };
      return statsCache;
    }

    if (entries.length > runningTotalEntryCount) {
      let totalInput = runningTotal.totalInput;
      let totalOutput = runningTotal.totalOutput;
      let totalCacheRead = runningTotal.totalCacheRead;
      let totalCacheWrite = runningTotal.totalCacheWrite;
      let totalCost = runningTotal.totalCost;

      const prevTailUsage = extractEntryUsage(entries[runningTotalEntryCount - 1]);
      if (!usageEquals(prevTailUsage ?? undefined, lastTailUsage)) {
        const pIn = lastTailUsage?.input ?? 0;
        const pOut = lastTailUsage?.output ?? 0;
        const pCr = lastTailUsage?.cacheRead ?? 0;
        const pCw = lastTailUsage?.cacheWrite ?? 0;
        const pCost = lastTailUsage?.cost?.total ?? 0;

        const cIn = prevTailUsage?.input ?? 0;
        const cOut = prevTailUsage?.output ?? 0;
        const cCr = prevTailUsage?.cacheRead ?? 0;
        const cCw = prevTailUsage?.cacheWrite ?? 0;
        const cCost = prevTailUsage?.cost?.total ?? 0;

        totalInput += cIn - pIn;
        totalOutput += cOut - pOut;
        totalCacheRead += cCr - pCr;
        totalCacheWrite += cCw - pCw;
        totalCost += cCost - pCost;
      }

      for (let i = runningTotalEntryCount; i < entries.length; i++) {
        const u = extractEntryUsage(entries[i]);
        if (u) {
          totalInput += u.input ?? 0;
          totalOutput += u.output ?? 0;
          totalCacheRead += u.cacheRead ?? 0;
          totalCacheWrite += u.cacheWrite ?? 0;
          totalCost += u.cost?.total ?? 0;
        }
      }

      runningTotal = { totalInput, totalOutput, totalCacheRead, totalCacheWrite, totalCost };
      runningTotalEntryCount = entries.length;
      lastFirstEntryId = entries[0]?.id;
      lastAnchorEntryId = entries[entries.length - 1]?.id;
      lastTailUsage = snapshotUsage(extractEntryUsage(entries[entries.length - 1]));
      statsCache = runningTotal;
      return runningTotal;
    }
  }

  // Else (first run, entries truncated, or branch switch where anchor id mismatched):
  let totalInput = 0,
    totalOutput = 0,
    totalCacheRead = 0,
    totalCacheWrite = 0,
    totalCost = 0;

  for (const sessionEntry of entries) {
    const u = extractEntryUsage(sessionEntry);
    if (u) {
      totalInput += u.input ?? 0;
      totalOutput += u.output ?? 0;
      totalCacheRead += u.cacheRead ?? 0;
      totalCacheWrite += u.cacheWrite ?? 0;
      totalCost += u.cost?.total ?? 0;
    }
  }

  runningTotal = { totalInput, totalOutput, totalCacheRead, totalCacheWrite, totalCost };
  runningTotalEntryCount = entries.length;
  lastFirstEntryId = entries[0]?.id;
  lastAnchorEntryId = entries[entries.length - 1]?.id;
  lastTailUsage = snapshotUsage(extractEntryUsage(entries[entries.length - 1]));
  statsCache = runningTotal;
  return runningTotal;
}

/** Clear the stats cache — call when a new message arrives. */
export function invalidateStatsCache(): void {
  statsCache = undefined;
}

/** Reset all module-level stats state for clean isolation. */
export function resetStatsState(): void {
  runningTotal = undefined;
  runningTotalEntryCount = 0;
  lastFirstEntryId = undefined;
  lastAnchorEntryId = undefined;
  lastTailUsage = undefined;
  statsCache = undefined;
}

export interface ContextWindowInfo {
  percent: string;
  percentValue: number;
  windowSize: number;
}

export function getContextWindowInfo(ctx: ExtensionContext): ContextWindowInfo {
  const contextUsage = ctx.getContextUsage();
  const modelContextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
  const tokenStats = getTokenUsageStats(ctx);

  const percentValue =
    contextUsage?.percent ??
    (modelContextWindow > 0 ? ((tokenStats.totalInput + tokenStats.totalOutput) / modelContextWindow) * 100 : 0);

  return {
    percent: contextUsage?.percent != null ? percentValue.toFixed(1) : "?",
    percentValue,
    windowSize: modelContextWindow,
  };
}
