import { createInterface } from "node:readline";
import type { ChildProcess } from "node:child_process";
import type { StreamState, SubagentProgress, SubagentResult } from "./types.js";
import { getBus, Events } from "@pi-archimedes/core/bus";
import { normalizeTodoItems } from "@pi-archimedes/todo/prepare-args";
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
 * Stream JSON events from a child `pi --mode json` process and build progress/result.
 *
 * The child writes one JSON object per line to stdout. We read each line via
 * readline, parse it, and dispatch to the same handler functions used previously.
 * stderr is drained silently (captured as the error string on non-zero exit).
 */
export function streamEvents(
  child: ChildProcess,
  callbacks: StreamCallbacks = {},
): Promise<SubagentResult> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    // Startup safeguard: if no JSON event arrives within 2 minutes, kill the child.
    const STARTUP_TIMEOUT_MS = 2 * 60 * 1000;
    let startupTimer: NodeJS.Timeout | undefined = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `subagent timed out: no output within ${STARTUP_TIMEOUT_MS / 60_000} minutes of startup`,
        ),
      );
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

    // Collect stderr for error reporting
    const stderrChunks: Buffer[] = [];
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    let error: string | undefined;

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
      output:
        state.accumulatedOutput.length > 0
          ? state.accumulatedOutput.join("\n\n")
          : undefined,
      recentOutput: state.recentOutput.length > 0 ? state.recentOutput : undefined,
      toolCalls: state.toolCalls.length > 0 ? state.toolCalls : undefined,
      model: state.model,
    });

    const emitProgress = () => callbacks.onProgress?.(buildProgress());

    // Periodic heartbeat for live duration display
    const heartbeat = setInterval(emitProgress, 1000);

    // Read stdout as newline-delimited JSON
    if (!child.stdout) {
      clearStartupTimer();
      clearInterval(heartbeat);
      reject(new Error("subagent child has no stdout pipe"));
      return;
    }

    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

    // toolCallId → raw todoList from tool_execution_start, consumed by the
    // matching tool_execution_end. pi emits tool_execution_start with the
    // raw (pre-prepareToolCall) arguments, so these may be unrepaired.
    const pendingTodoArgs = new Map<string, unknown[]>();
    let subagentSource = `subagent:${callbacks.agent ?? "general"}`;

    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let event: JsonEvent;
      try {
        event = JSON.parse(trimmed) as JsonEvent;
      } catch {
        // Non-JSON output — ignore (can happen from pi startup messages)
        return;
      }

      // First real event means model has engaged — cancel startup watchdog
      clearStartupTimer();

      switch (event.type) {
        case "session": {
          if (typeof event.id === "string" && event.id) {
            state.childSessionId = event.id;
            // A child with a session id gets a unique per-child todo source so
            // concurrent children sharing an agent name don't clobber each
            // other's accepted state when one clears on exit. Children without
            // a session id (e.g. tests) keep the legacy subagent:<agent> form.
            subagentSource = `subagent:${callbacks.agent ?? "general"}:${event.id}`;
          }
          break;
        }
        case "tool_execution_start": {
          handleToolStart(state, event);
          emitProgress();
          if (event.toolName === "manage_todo_list" && typeof event.toolCallId === "string") {
            const args = event.args as Record<string, unknown> | undefined;
            const todoList = args?.todoList;
            if (Array.isArray(todoList)) {
              pendingTodoArgs.set(event.toolCallId, todoList);
            }
          }
          break;
        }
        case "tool_execution_end": {
          if (event.toolName === "manage_todo_list") {
            const id = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
            const stowed = id ? pendingTodoArgs.get(id) : undefined;
            if (id) pendingTodoArgs.delete(id);
            const result = event.result as Record<string, unknown> | undefined;
            // Tool-level failure (todo's execute() RETURNS {isError:true} on validation
            // rejection — it does not throw) arrives as event.isError=false with
            // result.isError=true. Harness failures (abort, not-found, block, throw)
            // arrive as event.isError=true. Check BOTH — the same convention
            // handleToolResult in handlers.ts already uses.
            const failed = event.isError === true || result?.isError === true;
            if (!failed) {
              const detailsTodos = (result?.details as Record<string, unknown> | undefined)?.todos;
              const todos = normalizeTodoItems(Array.isArray(detailsTodos) ? detailsTodos : stowed);
              if (todos) {
                getBus().emit(Events.TODOS_UPDATE, { source: subagentSource, todos });
              }
            }
          }
          handleToolEnd(state);
          emitProgress();
          handleToolResult(state, event);
          emitProgress();
          break;
        }
        case "turn_start": {
          state.turnCount++;
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
        // Ignore: agent_start, message_start, message_update, turn_end, tool_execution_update
      }
    });

    // Handle process exit
    child.on("close", (code) => {
      clearStartupTimer();
      clearInterval(heartbeat);
      const durationMs = Date.now() - startTime;
      const exitCode = code ?? 1;

      // Surface stderr as error if the process failed and we have no other error
      if (exitCode !== 0 && !error) {
        const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();
        if (stderr) error = stderr;
      }

      const result: SubagentResult = {
        agent: callbacks.agent ?? "subagent",
        task: callbacks.task ?? "",
        ...(state.childSessionId ? { childSessionId: state.childSessionId } : {}),
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

      callbacks.onProgress?.(result.progress!);

      // Clear subagent todos from the bus on exit
      getBus().emit(Events.TODOS_CLEAR, {
        source: subagentSource,
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
