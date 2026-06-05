import { getBus, Events } from "@pi-archimedes/core/bus";

export function emitCostUpdate(agent: string, usage: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; cost?: number }): void {
  getBus().emit(Events.COST_UPDATE, {
    source: `subagent:${agent}`,
    ...usage,
  });
}
