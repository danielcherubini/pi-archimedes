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
        : // Defensive: streamEvents should always return a progress, but if not,
          // synthesize one so the parallel renderer stays aligned with results.
          {
            agent: agentName,
            status: result.exitCode === 0 ? "completed" : "failed",
            task: options.task,
            currentTool: undefined,
            currentToolArgs: undefined,
            currentToolStartedAt: undefined,
            toolCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            tokens: 0,
            cost: 0,
            durationMs,
            error: undefined,
            output: undefined,
            recentOutput: undefined,
            toolCalls: undefined,
            model: result.model,
          },
      progressSummary: result.progressSummary
        ? { ...result.progressSummary, durationMs }
        : { toolCount: 0, tokens: 0, durationMs },
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startTime;
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
      error: errorMessage,
      // Always return a valid progress object so the parallel renderer's
      // `details.progress[i]` stays aligned with `details.results[i]`.
      // Returning undefined here would be filtered out and cause index
      // misalignment between results and progress in the parallel view.
      progress: {
        agent: agentName,
        status: "failed",
        task: options.task,
        currentTool: undefined,
        currentToolArgs: undefined,
        currentToolStartedAt: undefined,
        toolCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        tokens: 0,
        cost: 0,
        durationMs,
        error: errorMessage,
        output: undefined,
        recentOutput: undefined,
        toolCalls: undefined,
        model: undefined,
      },
      progressSummary: { toolCount: 0, tokens: 0, durationMs },
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
  // Pre-fill one pending slot per task, keyed by task index (NOT agent name).
  // This keeps all N lines stacked from t=0 in stable task order, with no
  // collisions when multiple subagents share an agent name (e.g. 8 x "general").
  const latestProgress: SubagentProgress[] = options.tasks.map((taskDef) => ({
    agent: taskDef.agent ?? "subagent",
    status: "running" as const,
    task: taskDef.task,
    currentTool: undefined,
    currentToolArgs: undefined,
    currentToolStartedAt: undefined,
    toolCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    tokens: 0,
    cost: 0,
    durationMs: 0,
    error: undefined,
    output: undefined,
    recentOutput: undefined,
    toolCalls: undefined,
    // Match the model executeSubagent will report for this task, so the
    // pending placeholder's model label matches the streaming label exactly.
    model: taskDef.model,
  }));

  const results = await Promise.all(
    options.tasks.map((taskDef, index) =>
      executeSubagent({
        ...taskDef,
        signal: options.signal,
        onUpdate: (progress: SubagentProgress) => {
          // Store latest progress in this task's stable slot (by index).
          latestProgress[index] = progress;
          // Emit all N entries in stable task order.
          options.onUpdate?.([...latestProgress]);
        },
      }),
    ),
  );
  return results;
}
