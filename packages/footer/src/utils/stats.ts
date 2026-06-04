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

export function getTokenUsageStats(ctx: ExtensionContext): TokenUsageStats {
  let totalInput = 0,
    totalOutput = 0,
    totalCacheRead = 0,
    totalCacheWrite = 0,
    totalCost = 0;

  for (const sessionEntry of ctx.sessionManager.getEntries()) {
    if (sessionEntry.type === "message" && sessionEntry.message.role === "assistant") {
      const assistantMessage = sessionEntry.message as AssistantMessage;
      totalInput += assistantMessage.usage.input;
      totalOutput += assistantMessage.usage.output;
      totalCacheRead += assistantMessage.usage.cacheRead;
      totalCacheWrite += assistantMessage.usage.cacheWrite;
      totalCost += assistantMessage.usage.cost.total;
    }
  }

  return { totalInput, totalOutput, totalCacheRead, totalCacheWrite, totalCost };
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
