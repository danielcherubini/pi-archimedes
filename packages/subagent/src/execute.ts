import { spawnSubagent } from "./spawn.js";
import { streamEvents } from "./stream.js";
import { emitCostUpdate } from "./cost.js";
import type { AgentConfig } from "./agents.js";
import type { SubagentProgress, SubagentResult, SubagentUsage } from "./types.js";

export interface ExecuteOptions {
  agent: string | undefined;
  agentConfig: AgentConfig | undefined;
  task: string;
  model: string | undefined;
  activeModel: string | undefined;
  cwd: string | undefined;
  signal: AbortSignal | undefined;
  onUpdate: ((progress: SubagentProgress) => void) | undefined;
}

/**
 * Execute a single subagent synchronously — blocks until completion.
 */
export async function executeSubagent(options: ExecuteOptions): Promise<SubagentResult> {
  const agentName = options.agent ?? "subagent";
  const startTime = Date.now();

  // Track previously emitted values to only emit deltas
  let lastEmittedInput = 0;
  let lastEmittedOutput = 0;
  let lastEmittedCost = 0;

  try {
    const child = spawnSubagent({
      task: options.task,
      model: options.model,
      activeModel: options.activeModel,
      cwd: options.cwd,
      signal: options.signal,
      agent: options.agentConfig,
    });

    const result = await streamEvents(child, {
      agent: agentName,
      task: options.task,
      onProgress: (progress: SubagentProgress) => {
        // Emit only deltas to avoid double-counting in CostAccumulator
        const deltaInput = progress.inputTokens - lastEmittedInput;
        const deltaOutput = progress.outputTokens - lastEmittedOutput;
        const deltaCost = progress.cost - lastEmittedCost;
        if (deltaInput > 0 || deltaOutput > 0 || deltaCost > 0) {
          emitCostUpdate(agentName, {
            inputTokens: deltaInput,
            outputTokens: deltaOutput,
            cost: deltaCost,
          });
          lastEmittedInput = progress.inputTokens;
          lastEmittedOutput = progress.outputTokens;
          lastEmittedCost = progress.cost;
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
      model: undefined,
      finalOutput: undefined,
      error: err instanceof Error ? err.message : String(err),
      progress: undefined,
      progressSummary: { toolCount: 0, tokens: 0, durationMs: Date.now() - startTime },
    };
  }
}

/**
 * Execute multiple subagents in parallel.
 */
export async function executeParallel(options: {
  tasks: Array<{ agent: string | undefined; agentConfig: AgentConfig | undefined; task: string; model: string | undefined; activeModel: string | undefined; cwd: string | undefined }>;
  signal: AbortSignal | undefined;
  onUpdate: ((progress: SubagentProgress[]) => void) | undefined;
}): Promise<SubagentResult[]> {
  // Collect latest progress per agent for aggregated reporting
  const latestProgress = new Map<string, SubagentProgress>();

  const results = await Promise.all(
    options.tasks.map((taskDef) =>
      executeSubagent({
        ...taskDef,
        signal: options.signal,
        onUpdate: (progress: SubagentProgress) => {
          // Store latest progress keyed by agent name
          latestProgress.set(progress.agent, progress);
          // Emit aggregated progress across ALL agents
          options.onUpdate?.([...latestProgress.values()]);
        },
      }),
    ),
  );
  return results;
}
