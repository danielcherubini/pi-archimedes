import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getBus, Events } from "../bus.js";

/**
 * Minimal structural mirror of the pi-ai `Usage` type (core does not depend on
 * @earendil-works/pi-ai — keep the dependency surface unchanged).
 */
interface UsageLike {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
}

/**
 * Emit the session's OWN usage as a per-turn COST_UPDATE (source "main").
 * Per design decision 1-3: per-turn (turn_end), delta (the turn's usage is
 * not cumulative), NOT gated on bridge mode (the TUI footer's
 * CostAccumulator sums it — the footer's cost line becomes the true session
 * cost; in bridge mode the existing events.ts forwarder carries it to the
 * desktop). `reasoning` is excluded (a subset of `output` — double-count).
 */
export function registerSelfUsage(pi: ExtensionAPI): void {
  pi.on("turn_end", (event) => {
    const usage = (event.message as { usage?: UsageLike } | undefined)?.usage;
    if (!usage) return;
    getBus().emit(Events.COST_UPDATE, {
      source: "main",
      inputTokens: usage.input ?? 0,
      outputTokens: usage.output ?? 0,
      cacheReadTokens: usage.cacheRead ?? 0,
      cacheWriteTokens: usage.cacheWrite ?? 0,
      cost: usage.cost?.total ?? 0,
    });
  });
}
