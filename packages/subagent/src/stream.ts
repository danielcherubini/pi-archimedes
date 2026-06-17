import { createInterface } from "node:readline";
import type { ChildProcess } from "node:child_process";
import { appendFileSync } from "node:fs";
import type { StreamState, SubagentProgress, SubagentResult } from "./types.js";
import { getBus, Events } from "@pi-archimedes/core/bus";
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

    // Startup safeguard: if the child produces no JSON event within
    // STARTUP_TIMEOUT_MS, kill it. This guards against hangs during pi
    // initialization (model never loads, auth fails, etc.) and is the only
    // automatic timeout. Once any event arrives the model is considered
    // active and runtime is controlled entirely by the user's abort
    // signal — a model that is REALLY thinking is left alone until the
    // user explicitly cancels.
    const STARTUP_TIMEOUT_MS = 2 * 60 * 1000;

    let startupTimer: NodeJS.Timeout | undefined = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(
        `subagent timed out: no model output within ${STARTUP_TIMEOUT_MS / 60_000} minutes of startup`,
      ));
    }, STARTUP_TIMEOUT_MS);

    const clearStartupTimer = (): void => {
      if (startupTimer) {
        clearTimeout(startupTimer);
        startupTimer = undefined;
      }
    };

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

    // Track pending ask requests (requestId → true)
    const pendingAskRequests = new Set<string>();

    // Listen for ask responses from the parent's ask package — write to child socket
    const unsubAskResponse = getBus().on(Events.ASK_RESPONSE, (payload: unknown) => {
      const data = payload as { requestId: string; cancelled: boolean; results: Array<{ id: string; selectedOptions: string[]; customInput?: string }> };
      appendFileSync("/tmp/pi-ask-debug.log", `[stream] ASK_RESPONSE requestId=${data?.requestId} pending=${pendingAskRequests.has(data?.requestId)}\n`);
      if (pendingAskRequests.has(data.requestId)) {
        pendingAskRequests.delete(data.requestId);
        const clientSocket = (child as ChildProcess & { clientSocket?: import("node:net").Socket }).clientSocket;
        appendFileSync("/tmp/pi-ask-debug.log", `[stream] writing to child socket, hasSocket=${!!clientSocket}\n`);
        if (clientSocket) {
          clientSocket.write(JSON.stringify({
            type: "ask_response",
            requestId: data.requestId,
            cancelled: data.cancelled,
            results: data.results,
          }) + "\n");
        }
      }
    });

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

    // Periodic progress updates for live duration display
    const heartbeat = setInterval(emitProgress, 1000);

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

      // First event received from the child means the model has engaged —
      // from here on, the user controls lifetime via the abort signal.
      clearStartupTimer();

      switch (event.type) {
        case "tool_execution_start": {
          handleToolStart(state, event);
          emitProgress();
          // Forward manage_todo_list writes to the bus for parent widget
          if (event.toolName === "manage_todo_list") {
            const args = event.args as Record<string, unknown> | undefined;
            const todoList = args?.todoList as Array<unknown> | undefined;
            if (Array.isArray(todoList)) {
              getBus().emit(Events.TODOS_UPDATE, {
                source: `subagent:${callbacks.agent ?? "general"}`,
                todos: todoList,
              });
            }
          }
          break;
        }
        case "ask_request": {
          // Custom event from child's ask tool — forward to parent bus for UI
          const reqQuestions = (event as { questions?: unknown }).questions as Array<unknown> | undefined;
          const reqRequestId = (event as { requestId?: unknown }).requestId as string | undefined;
          appendFileSync("/tmp/pi-ask-debug.log", `[stream] ask_request event requestId=${reqRequestId ?? "none"} qcount=${reqQuestions?.length}\n`);
          if (Array.isArray(reqQuestions) && reqRequestId) {
            pendingAskRequests.add(reqRequestId);
            getBus().emit(Events.ASK_REQUEST, {
              source: `subagent:${callbacks.agent ?? "general"}`,
              requestId: reqRequestId,
              questions: reqQuestions,
            });
          }
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
      clearStartupTimer();
      clearInterval(heartbeat);
      unsubAskResponse();
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

      // Clear subagent todos from the bus on process exit
      getBus().emit(Events.TODOS_CLEAR, {
        source: `subagent:${callbacks.agent ?? "general"}`,
      });

      resolve(result);
    });

    child.on("error", (err) => {
      clearStartupTimer();
      clearInterval(heartbeat);
      reject(err);
    });
  });
}
