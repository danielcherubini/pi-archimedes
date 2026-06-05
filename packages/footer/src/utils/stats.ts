import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

interface MessageUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: { total: number };
}

interface AssistantMessage {
  usage: MessageUsage;
}

export interface TokenUsageStats {
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalCost: number;
}

// Cache TTL: 500ms — stats don't change more frequently than message_end events
const STATS_CACHE_TTL_MS = 500;

interface StatsCacheEntry {
  value: TokenUsageStats;
  timestamp: number;
  entryCount: number;
}

let statsCache: StatsCacheEntry | undefined;

export function getTokenUsageStats(ctx: ExtensionContext): TokenUsageStats {
  const entries = ctx.sessionManager.getEntries();

  // Return cached result if entry count hasn't changed and cache is fresh
  if (
    statsCache &&
    statsCache.entryCount === entries.length &&
    Date.now() - statsCache.timestamp < STATS_CACHE_TTL_MS
  ) {
    return statsCache.value;
  }

  let totalInput = 0,
    totalOutput = 0,
    totalCacheRead = 0,
    totalCacheWrite = 0,
    totalCost = 0;

  for (const sessionEntry of entries) {
    if (sessionEntry.type === "message" && sessionEntry.message.role === "assistant") {
      const assistantMessage = sessionEntry.message as AssistantMessage;
      totalInput += assistantMessage.usage.input;
      totalOutput += assistantMessage.usage.output;
      totalCacheRead += assistantMessage.usage.cacheRead;
      totalCacheWrite += assistantMessage.usage.cacheWrite;
      totalCost += assistantMessage.usage.cost.total;
    }
  }

  const result: TokenUsageStats = { totalInput, totalOutput, totalCacheRead, totalCacheWrite, totalCost };
  statsCache = { value: result, timestamp: Date.now(), entryCount: entries.length };
  return result;
}

/** Clear the stats cache — call when a new message arrives. */
export function invalidateStatsCache(): void {
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
