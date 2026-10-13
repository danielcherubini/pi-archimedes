import type { Usage } from "@earendil-works/pi-ai";
import type { SubagentResult, SubagentUsage } from "./types.js";

// ── Native cost reporting (ADR 0028) ────────────────────────────────────────
//
// A tool result may carry `usage`, and pi does the accounting from there: the
// field is copied onto the toolResult message it persists
// (`pi-agent-core/dist/agent-loop.js`, `createToolResultMessage` — `usage:
// finalized.result.usage`) and `AgentSession.getSessionStats()` folds every
// toolResult message's usage into the session totals
// (`pi-coding-agent/dist/core/agent-session.js`, the `message.role ===
// "toolResult"` branch). So a subagent that returns `usage` is counted by
// `/session`, by the footer's own session scan, and by anything else that reads
// session stats — with no side channel involved.
//
// That is why the old bus route (`subagent/src/cost.ts` → `COST_UPDATE` →
// `footer/CostAccumulator`) had to go rather than just stop being used: the
// footer already counts toolResult usage, so leaving the accumulator in place
// would add the same money twice.

/**
 * The child's summed usage in pi's own `Usage` shape.
 *
 * The child's JSON stream reports one cost **total** per message, which is what
 * pi adds up (`addUsageToTotals` reads `usage.cost.total`); the per-kind split is
 * not observable from out here, so it is reported as zero rather than guessed at.
 * `totalTokens` follows pi's own definition — input + output + both cache kinds.
 */
export function toNativeUsage(usage: SubagentUsage): Usage {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    totalTokens: usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: usage.cost,
    },
  };
}

/**
 * Sum the usage of several runs into the one `usage` a single tool result can
 * carry — a parallel batch is one tool call, so it has one toolResult message.
 */
export function sumNativeUsage(results: SubagentResult[]): Usage | undefined {
  const counted = results.filter(
    (r): r is SubagentResult & { usage: SubagentUsage } => r.usage !== undefined,
  );
  if (counted.length === 0) return undefined;
  const zero: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  return counted.reduce<Usage>((total, result) => {
      const next = toNativeUsage(result.usage);
      return {
        input: total.input + next.input,
        output: total.output + next.output,
        cacheRead: total.cacheRead + next.cacheRead,
        cacheWrite: total.cacheWrite + next.cacheWrite,
        totalTokens: total.totalTokens + next.totalTokens,
        cost: {
          input: total.cost.input + next.cost.input,
          output: total.cost.output + next.cost.output,
          cacheRead: total.cost.cacheRead + next.cost.cacheRead,
          cacheWrite: total.cost.cacheWrite + next.cost.cacheWrite,
          total: total.cost.total + next.cost.total,
        },
      };
    },
    zero,
  );
}
