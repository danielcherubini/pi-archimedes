import { getBridge } from "@pi-archimedes/core/bridge";
import { spawnSubagent, resolveModel } from "./spawn.js";
import { dispatchViaBridge, buildFailedResult } from "./dispatch.js";
import { streamEvents } from "./stream.js";
import type { AgentConfig } from "./agents.js";
import type { SubagentProgress, SubagentResult } from "./types.js";

export interface ExecuteOptions {
  agent: string | undefined;
  agentConfig: AgentConfig | undefined;
  task: string;
  model: string | undefined;
  activeModel: string | undefined;
  cwd: string | undefined;
  signal: AbortSignal | undefined;
  onUpdate: ((progress: SubagentProgress) => void) | undefined;
  /** The subagent tool-call id (the tool's `_id`) — rides the dispatch frame
   *  for Client correlation; `undefined` → the frame's `toolCallId` is absent.
   *  In `executeParallel` all N tasks share the single subagent tool-call's id. */
  toolCallId?: string;
}

/**
 * Execute a single subagent — waits for completion before resolving.
 */
export async function executeSubagent(options: ExecuteOptions): Promise<SubagentResult> {
  const agentName = options.agent ?? "subagent";
  const startTime = Date.now();

  // Bridge mode: dispatch to the desktop (Client) instead of forking a child
  // pi process. An UNREACHABLE bridge (no response frame — e.g. macOS, where
  // the desktop's listener is not started, or Windows, where it is a no-op
  // stub) falls back to the fork path so subagents keep working everywhere.
  if (getBridge().active) {
    const model = resolveModel({ model: options.model, activeModel: options.activeModel, agent: options.agentConfig });

    // A signal that is ALREADY aborted before dispatch: short-circuit to a
    // FAILED result (error "cancelled") — a deliberate cancel must never
    // fork, even in the corner where the channel is unreachable (the
    // executor's early return leaves `finish` as a safe no-op, so
    // `handle.cancel()` is a no-op and the rejection would map to
    // { fallback: true } → the fork path for an already-cancelled task).
    // This layer (not dispatchViaBridge) is the home: the execute layer
    // already has the signal; the channel-level function must not know fork
    // semantics. The short-circuit is BEFORE the "dispatched" placeholder —
    // a cancelled task does not claim it was dispatched — but the final
    // failure progress IS emitted (the same emit the catch block below does),
    // so executeParallel's progress slot updates from the pending placeholder
    // to "failed" instead of a stale "Starting...".
    if (options.signal?.aborted) {
      const result = {
        ...buildFailedResult(agentName, options.task, "cancelled", model, Date.now() - startTime),
        // Bridge mode: any usage this run ever had belongs to a desktop session.
        usageAccountedElsewhere: true,
      };
      options.onUpdate?.(result.progress!);
      return result;
    }

    // The TUI has no surface in bridge mode (RPC mode) and the desktop panel
    // is the progress surface — call onUpdate ONCE with a minimal "dispatched"
    // placeholder so the pi-acp tool_call_update frames stay well-formed, then
    // no further updates.
    options.onUpdate?.({
      agent: agentName,
      status: "running",
      task: options.task,
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
      model,
    });
    const outcome = await dispatchViaBridge(options, options.signal, options.toolCallId);
    if (!("fallback" in outcome)) {
      // Bridge used (success or a response-carrying error, incl. the terminal
      // "cancelled" frame — the desktop is alive, its outcome is authoritative):
      // return it, with no cost report of its own. The PARENT never reports a
      // child's usage for a run it did not perform: the subagent process emits
      // its OWN usage to its OWN bridge (the core self-usage emitter), which is a
      // different session's total. Every result `dispatchViaBridge` settles
      // carries `usageAccountedElsewhere`, which is how the tool knows to leave
      // it off the tool result — pi folds that `usage` into THIS session's
      // totals, so copying it across would bill the parent twice. The fork path
      // below does report, through the tool result's native `usage`.
      return outcome;
    }
    // { fallback: true } — unreachable bridge: fall through to the fork path.
  }

  // Progress is passed straight through: cost is reported once, on the tool
  // result's native `usage`, so there is no delta bookkeeping left to do here.
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
            status: result.outcome || result.exitCode === 0 ? "completed" : "failed",
            ...(result.outcome ? { outcome: result.outcome } : {}),
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
    // The shared failed-result synthesis (the same one the bridge error path
    // uses — model is undefined here: the fork never ran, so no model was
    // chosen). Always returns a valid progress object so the parallel
    // renderer's `details.progress[i]` stays aligned with `details.results[i]`
    // (returning undefined would be filtered out and cause index misalignment
    // between results and progress in the parallel view).
    const result = buildFailedResult(agentName, options.task, errorMessage, undefined, durationMs);
    // Emit final failure progress so executeParallel's progress slot updates
    // from the pending placeholder to "failed" (prevents stale "Starting..." display).
    options.onUpdate?.(result.progress!);
    return result;
  }
}

/**
 * Execute multiple subagents in parallel.
 */
export async function executeParallel(options: {
  tasks: Array<{ agent: string | undefined; agentConfig: AgentConfig | undefined; task: string; model: string | undefined; activeModel: string | undefined; cwd: string | undefined; toolCallId?: string }>;
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
