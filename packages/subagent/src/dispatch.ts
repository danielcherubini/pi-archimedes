// ── Bridge-mode dispatch (dispatch_subagent over the bridge channel) ────
//
// In bridge mode the subagent tool does NOT fork a child pi process — it
// sends a `dispatch_subagent` bridge request and the desktop (Client) runs
// the subagent session (a full ACP session on its worker runtime).
//
// Fallback rule (the BridgeTransportError distinction is the trigger):
//   - NO response frame (unreachable socket / ECONNREFUSED, a mid-connection
//     error, or a clean close before any response — the desktop is
//     effectively gone) → { fallback: true } — the fork path keeps the
//     subagent working (the main agent is still alive — its desktop
//     connection died, not the agent).
//   - A response-carrying `error` (the desktop answered — it is alive and
//     the outcome is authoritative, incl. the terminal `error: "cancelled"`
//     frame) → a FAILED SubagentResult, NEVER a fallback.
//   - A DETERMINISTIC LOCAL CANCEL (the tool's AbortSignal → the channel's
//     cancel() settles with a plain "bridge request cancelled" error — the
//     desktop is NOT gone, the user just cancelled) → a FAILED
//     SubagentResult with error "cancelled" (the same outcome as the
//     desktop's terminal `error: "cancelled" frame), NEVER a fallback — a
//     deliberate cancel must never fork.
//
// The pre-aborted-signal + unreachable-channel corner (cancel() is a no-op
// there — the executor's early return leaves `finish` as the safe no-op — so
// the rejection WOULD map to { fallback: true }) is closed at the EXECUTE
// layer: executeSubagent short-circuits an already-aborted signal to a
// FAILED result (error "cancelled") before dispatching (the execute layer
// already has the signal; the channel-level function must not know fork
// semantics).

import { dispatch, BridgeTransportError } from "@pi-archimedes/core/bridge";
import { resolveModel } from "./spawn.js";
import type { ExecuteOptions } from "./execute.js";
import type { SubagentProgress, SubagentResult } from "./types.js";

export type DispatchOutcome = SubagentResult | { fallback: true };

/**
 * Synthesize a FAILED SubagentResult (a task that never completed — a
 * response-carrying error, a deterministic local cancel, or a pre-aborted
 * signal). Shared by the bridge error path and executeSubagent's pre-abort
 * short-circuit (and fork-path catch) so the "cancelled" synthesis is not
 * duplicated. The progress is the same defensive synthesis executeSubagent
 * uses: zeros + the real durationMs (the desktop panel is the progress
 * surface in bridge mode; the TUI has none in RPC mode).
 */
export function buildFailedResult(
  agentName: string,
  task: string,
  error: string,
  model: string | undefined,
  durationMs: number,
): SubagentResult {
  return {
    agent: agentName,
    task,
    exitCode: 1,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
    model,
    finalOutput: undefined,
    error,
    progress: {
      agent: agentName,
      status: "failed",
      task,
      currentTool: undefined,
      currentToolArgs: undefined,
      currentToolStartedAt: undefined,
      toolCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      tokens: 0,
      cost: 0,
      durationMs,
      error,
      output: undefined,
      recentOutput: undefined,
      toolCalls: undefined,
      model,
    },
    progressSummary: { toolCount: 0, tokens: 0, durationMs },
  };
}

export function dispatchViaBridge(
  options: ExecuteOptions,
  signal: AbortSignal | undefined,
  toolCallId: string | undefined,
): Promise<DispatchOutcome> {
  const agentName = options.agent ?? "subagent";
  const model = resolveModel({ model: options.model, activeModel: options.activeModel, agent: options.agentConfig });
  const startTime = Date.now();

  // `cwd` is intentionally NOT sent — the subagent session's cwd is the
  // parent's Space folder (the wire contract; the tool's `cwd` param is
  // ignored in bridge mode).
  const params = {
    agentName,
    task: options.task,
    systemPrompt: options.agentConfig?.systemPrompt?.trim() || null,
    model: model ?? null,
    thinking: options.agentConfig?.thinking ?? null,
    tools: options.agentConfig?.tools?.length ? options.agentConfig.tools : null,
  };

  return dispatch(params, toolCallId, signal).then(
    (res) => {
      // Success → a SubagentResult with a synthesized progress (the same
      // defensive synthesis executeSubagent does; the desktop's panel is the
      // progress surface, so the fields are zeros + the real durationMs).
      const durationMs = res.metrics.durationMs;
      const progress: SubagentProgress = {
        agent: agentName,
        status: "completed",
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
        output: res.output,
        recentOutput: undefined,
        toolCalls: undefined,
        model,
      };
      return {
        agent: agentName,
        task: options.task,
        exitCode: 0,
        usage: {
          input: res.metrics.inputTokens,
          output: res.metrics.outputTokens,
          cacheRead: 0,
          cacheWrite: 0,
          cost: res.metrics.cost,
          turns: 0,
        },
        model,
        finalOutput: res.output,
        error: undefined,
        progress,
        progressSummary: {
          toolCount: 0,
          tokens: res.metrics.inputTokens + res.metrics.outputTokens,
          durationMs,
        },
      };
    },
    (err: unknown) => {
      // No response frame (the desktop is effectively gone) → the fork path
      // keeps the subagent working.
      if (err instanceof BridgeTransportError) {
        return { fallback: true };
      }
      // A response-carrying error (the desktop answered — authoritative,
      // incl. the terminal "cancelled" frame) or a DETERMINISTIC LOCAL CANCEL
      // (the tool's AbortSignal → channel.cancel() settles with a plain
      // "bridge request cancelled" error — the same outcome as the desktop's
      // terminal `error: "cancelled" frame) → a FAILED SubagentResult (the
      // shared failed-progress synthesis), NEVER a fallback (a deliberate
      // cancel must never fork).
      const isLocalCancel = err instanceof Error && err.message === "bridge request cancelled";
      const errorMessage = isLocalCancel ? "cancelled" : err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - startTime;
      return buildFailedResult(agentName, options.task, errorMessage, model, durationMs);
    },
  );
}
