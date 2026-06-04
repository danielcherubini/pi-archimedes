import { getBus, Events, type CostUpdatePayload } from "@pi-archimedes/core/bus";

export class CostAccumulator {
  inputTokens = 0;
  outputTokens = 0;
  cacheReadTokens = 0;
  cacheWriteTokens = 0;
  cost = 0;
  private unsubscribes: Array<() => void> = [];

  subscribe(): void {
    const unsub = getBus().on(Events.COST_UPDATE, (payload: unknown) => {
      const data = payload as CostUpdatePayload;
      this.inputTokens += data.inputTokens ?? 0;
      this.outputTokens += data.outputTokens ?? 0;
      this.cacheReadTokens += data.cacheReadTokens ?? 0;
      this.cacheWriteTokens += data.cacheWriteTokens ?? 0;
      this.cost += data.cost ?? 0;
    });
    this.unsubscribes.push(unsub);
  }

  reset(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cacheReadTokens = 0;
    this.cacheWriteTokens = 0;
    this.cost = 0;
  }

  dispose(): void {
    this.unsubscribes.forEach(unsub => unsub());
    this.unsubscribes = [];
  }
}
