import { createInterface } from "node:readline";
import type { ChildProcess } from "node:child_process";
import type { SubagentProgress, SubagentResult } from "./types.js";

export interface StreamCallbacks {
  agent?: string;
  task?: string;
  onProgress?: (progress: SubagentProgress) => void;
}

interface JsonEvent {
  type: string;
  [key: string]: unknown;
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
    let turnCount = 0;
    let toolCount = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let totalCost = 0;
    let currentTool: string | undefined;
    let currentToolArgs: string | undefined;
    let currentToolStartedAt: number | undefined;
    let finalOutput: string | undefined;
    let error: string | undefined;

    // Build initial progress
    const buildProgress = (): SubagentProgress => ({
      agent: callbacks.agent ?? "subagent",
      status: "running",
      task: callbacks.task ?? "",
      currentTool,
      currentToolArgs,
      currentToolStartedAt,
      toolCount,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      tokens: totalInput + totalOutput,
      cost: totalCost,
      durationMs: Date.now() - startTime,
      error,
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
          toolCount++;
          currentTool = event.toolName as string;
          currentToolArgs = JSON.stringify(event.args);
          currentToolStartedAt = Date.now();
          emitProgress();
          break;
        }
        case "tool_execution_end": {
          currentTool = undefined;
          currentToolArgs = undefined;
          currentToolStartedAt = undefined;
          emitProgress();
          break;
        }
        case "turn_start": {
          turnCount++;
          break;
        }
        case "message_end": {
          // Extract usage from assistant message_end events
          const message = event.message as Record<string, unknown> | undefined;
          if (message && message.role === "assistant" && message.usage) {
            const usage = message.usage as Record<string, unknown>;
            turnCount++;
            totalInput += (usage.input as number) || 0;
            totalOutput += (usage.output as number) || 0;
            totalCacheRead += (usage.cacheRead as number) || 0;
            totalCacheWrite += (usage.cacheWrite as number) || 0;
            const costObj = usage.cost as { total?: number } | undefined;
            totalCost += costObj?.total ?? 0;
            emitProgress();
          }
          break;
        }
        case "agent_end": {
          // Extract final output from messages
          const messages = event.messages as Array<Record<string, unknown>> | undefined;
          if (messages && messages.length > 0) {
            // Find last assistant message
            for (let i = messages.length - 1; i >= 0; i--) {
              const msg = messages[i];
              if (msg.role === "assistant") {
                const content = msg.content as Array<Record<string, unknown>> | string;
                if (typeof content === "string") {
                  finalOutput = content;
                } else if (Array.isArray(content)) {
                  const textParts = content
                    .filter((c) => c.type === "text")
                    .map((c) => c.text as string);
                  finalOutput = textParts.join("\n");
                }
                break;
              }
            }
          }
          break;
        }
      }
    });

    // Handle process exit
    child.on("close", (code) => {
      const durationMs = Date.now() - startTime;
      const exitCode = code ?? 1;

      if (stderrParts.length > 0 && exitCode !== 0) {
        error = stderrParts.join("").trim();
      }

      const result: SubagentResult = {
        agent: callbacks.agent ?? "subagent",
        task: callbacks.task ?? "",
        exitCode,
        usage: {
          input: totalInput,
          output: totalOutput,
          cacheRead: totalCacheRead,
          cacheWrite: totalCacheWrite,
          cost: totalCost,
          turns: turnCount,
        },
        finalOutput,
        error,
        progress: {
          ...buildProgress(),
          status: exitCode === 0 ? "completed" : "failed",
          durationMs,
        },
        progressSummary: {
          toolCount,
          tokens: totalInput + totalOutput,
          durationMs,
        },
      };

      // Final progress update
      callbacks.onProgress?.(result.progress!);

      resolve(result);
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}
