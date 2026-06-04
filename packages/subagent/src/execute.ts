import { spawnSubagent } from "./spawn.js";
import { streamEvents } from "./stream.js";
import { emitCostUpdate } from "./cost.js";
import type { SubagentProgress, SubagentResult, SubagentUsage } from "./types.js";

export interface ExecuteOptions {
  agent?: string;
  task: string;
  model?: string;
  cwd?: string;
  context?: "fresh" | "fork";
  signal?: AbortSignal;
  onUpdate?: (progress: SubagentProgress) => void;
}

/**
 * Execute a single subagent synchronously — blocks until completion.
 */
export async function executeSubagent(options: ExecuteOptions): Promise<SubagentResult> {
  const agentName = options.agent ?? "subagent";
  const startTime = Date.now();

  // Track cumulative usage
  let cumulativeInput = 0;
  let cumulativeOutput = 0;

  const child = spawnSubagent({
    task: options.task,
    model: options.model,
    cwd: options.cwd,
    context: options.context,
    signal: options.signal,
  });

  try {
    const result = await streamEvents(child, {
      onProgress: (progress: SubagentProgress) => {
        // Emit cost updates on each progress tick
        if (progress.tokens > 0) {
          emitCostUpdate(agentName, {
            inputTokens: Math.floor(progress.tokens * 0.4),
            outputTokens: Math.floor(progress.tokens * 0.6),
            cost: progress.cost,
          });
        }
        options.onUpdate?.(progress);
      },
    });

    // Enrich result with agent name and duration
    const durationMs = Date.now() - startTime;
    return {
      ...result,
      agent: agentName,
      task: options.task,
      progress: result.progress
        ? { ...result.progress, agent: agentName, durationMs }
        : undefined,
      progressSummary: result.progressSummary
        ? { ...result.progressSummary, durationMs }
        : { toolCount: 0, tokens: 0, durationMs },
    };
  } catch (err) {
    return {
      agent: agentName,
      task: options.task,
      exitCode: 1,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
        turns: 0,
      } as SubagentUsage,
      error: err instanceof Error ? err.message : String(err),
      progressSummary: { toolCount: 0, tokens: 0, durationMs: Date.now() - startTime },
    };
  }
}

/**
 * Execute multiple subagents in parallel.
 */
export async function executeParallel(options: {
  tasks: Array<{ agent?: string; task: string; count?: number; model?: string; cwd?: string; context?: "fresh" | "fork" }>;
  signal?: AbortSignal;
  onUpdate?: (progress: SubagentProgress[]) => void;
}): Promise<SubagentResult[]> {
  const results = await Promise.all(
    options.tasks.map((taskDef) =>
      executeSubagent({
        ...taskDef,
        signal: options.signal,
        onUpdate: (progress: SubagentProgress) => {
          // Collect all parallel progress updates
          // This is a simplified approach — each task fires independently
          options.onUpdate?.([progress]);
        },
      }),
    ),
  );
  return results;
}
