import { createInterface } from "node:readline";
import type { ChildProcess } from "node:child_process";
import type { StreamState, SubagentProgress, SubagentResult } from "./types.js";
import {
  type JsonEvent,
  handleToolStart,
  handleToolEnd,
  handleToolResult,
  handleMessageEnd,
  handleAgentEnd,
} from "./handlers.js";

export interface StreamCallbacks {
  agent?: string;
  task?: string;
  onProgress?: (progress: SubagentProgress) => void;
}

/**
 * Stream JSON events from a child pi process and build progress/result.
 */
export function streamEvents(
  child: ChildProcess,
  callbacks: StreamCallbacks = {},
): Promise<SubagentResult> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("subagent timed out after 5 minutes"));
    }, 5 * 60 * 1000);

    const state: StreamState = {
      toolCount: 0,
      turnCount: 0,
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      totalCost: 0,
      currentTool: undefined,
      currentToolArgs: undefined,
      currentToolStartedAt: undefined,
      model: undefined,
      accumulatedOutput: [],
      recentOutput: [],
      toolCalls: [],
      finalOutput: undefined,
    };
    let error: string | undefined;

    // Build progress from state
    const buildProgress = (): SubagentProgress => ({
      agent: callbacks.agent ?? "subagent",
      status: "running",
      task: callbacks.task ?? "",
      currentTool: state.currentTool,
      currentToolArgs: state.currentToolArgs,
      currentToolStartedAt: state.currentToolStartedAt,
      toolCount: state.toolCount,
      inputTokens: state.totalInput,
      outputTokens: state.totalOutput,
      tokens: state.totalInput + state.totalOutput,
      cost: state.totalCost,
      durationMs: Date.now() - startTime,
      error,
      output: state.accumulatedOutput.length > 0 ? state.accumulatedOutput.join("\n\n") : undefined,
      recentOutput: state.recentOutput.length > 0 ? state.recentOutput : undefined,
      toolCalls: state.toolCalls.length > 0 ? state.toolCalls : undefined,
      model: state.model,
    });

    const emitProgress = () => {
      callbacks.onProgress?.(buildProgress());
    };

    // Collect stderr
    const stderrParts: string[] = [];
    child.stderr?.on("data", (data: Buffer) => {
      stderrParts.push(data.toString());
    });

    // Parse JSON lines from stdout
    const rl = createInterface({
      input: child.stdout!,
      crlfDelay: Infinity,
    });

    rl.on("line", (line: string) => {
      let event: JsonEvent;
      try {
        event = JSON.parse(line);
      } catch {
        return; // Skip non-JSON lines
      }

      switch (event.type) {
        case "tool_execution_start": {
          handleToolStart(state, event);
          emitProgress();
          break;
        }
        case "tool_execution_end": {
          handleToolEnd(state);
          emitProgress();
          break;
        }
        case "turn_start": {
          state.turnCount++;
          break;
        }
        case "tool_result_end": {
          handleToolResult(state, event);
          emitProgress();
          break;
        }
        case "message_end": {
          handleMessageEnd(state, event);
          emitProgress();
          break;
        }
        case "agent_end": {
          handleAgentEnd(state, event);
          break;
        }
      }
    });

    // Handle process exit
    child.on("close", (code) => {
      clearTimeout(timeout);
      const durationMs = Date.now() - startTime;
      const exitCode = code ?? 1;

      if (stderrParts.length > 0 && exitCode !== 0) {
        error = stderrParts.join("").trim();
      }

      const result: SubagentResult = {
        agent: callbacks.agent ?? "subagent",
        task: callbacks.task ?? "",
        exitCode,
        model: state.model,
        usage: {
          input: state.totalInput,
          output: state.totalOutput,
          cacheRead: state.totalCacheRead,
          cacheWrite: state.totalCacheWrite,
          cost: state.totalCost,
          turns: state.turnCount,
        },
        finalOutput: state.finalOutput,
        error,
        progress: {
          ...buildProgress(),
          status: exitCode === 0 ? "completed" : "failed",
          durationMs,
        },
        progressSummary: {
          toolCount: state.toolCount,
          tokens: state.totalInput + state.totalOutput,
          durationMs,
        },
      };

      // Final progress update
      callbacks.onProgress?.(result.progress!);

      resolve(result);
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
