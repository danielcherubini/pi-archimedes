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
 * not cumulative), NOT gated on bridge mode. `reasoning` is excluded (a subset
 * of `output` — double-count).
 *
 * Who listens now (Task 9 of the pi 1.x alignment changed this): the bridge
 * forwarder in `./events.ts` relays it to the desktop as a `cost_update` frame.
 * The TUI's consumer is **gone** — the footer's `CostAccumulator` was deleted
 * with it, because the footer reads usage from the session entries and those
 * already carry the main agent's assistant usage; keeping the accumulator would
 * have counted the main session's money twice. So on a plain TUI this emit has
 * no in-suite subscriber left. Deleting the emitter is NOT part of that change:
 * `cost_update` is a frame the Archimedes Client may render, and retiring it is
 * the bridge-contract question Task 11 asks when it moves these channels to
 * `pi.events`.
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
