import type { StreamState } from "./types.js";

// Truncation limits for previews
const ARGS_PREVIEW_MAX = 120;
const TOOL_CALLS_MAX = 50;
const RECENT_OUTPUT_MAX = 50;

export interface JsonEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Extract a short args preview from tool arguments.
 * Generic: no hardcoded tool names.
 */
export function extractArgsPreview(args: unknown): string {
  if (typeof args === "string") return args.slice(0, ARGS_PREVIEW_MAX);
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const obj = args as Record<string, unknown>;
    const keys = Object.keys(obj);
    // Single-key object: just show the value
    if (keys.length === 1) {
      const v = obj[keys[0]!];
      if (typeof v === "string") return v.slice(0, ARGS_PREVIEW_MAX);
      if (typeof v === "number" || typeof v === "boolean") return String(v);
    }
    // Multi-key: find the longest string value (likely the main payload)
    let best: string | undefined;
    for (const v of Object.values(obj)) {
      if (typeof v === "string" && v.length > (best?.length ?? 0)) {
        best = v;
      }
    }
    if (best) return best.slice(0, ARGS_PREVIEW_MAX);
  }
  const serialized = JSON.stringify(args);
  return serialized?.slice(0, ARGS_PREVIEW_MAX) ?? "";
}

/**
 * Handle a tool_execution_start event.
 */
export function handleToolStart(state: StreamState, event: JsonEvent): void {
  state.toolCount++;
  state.currentTool = event.toolName as string;
  state.currentToolArgs = JSON.stringify(event.args);
  state.currentToolStartedAt = Date.now();
  // Record tool call with args preview
  const argsPreview = extractArgsPreview(event.args);
  state.toolCalls.push(`${state.currentTool}: ${argsPreview}`);
  if (state.toolCalls.length > TOOL_CALLS_MAX) {
    state.toolCalls.splice(0, state.toolCalls.length - TOOL_CALLS_MAX);
  }
}

/**
 * Handle a tool_execution_end event.
 */
export function handleToolEnd(state: StreamState): void {
  state.currentTool = undefined;
  state.currentToolArgs = undefined;
  state.currentToolStartedAt = undefined;
}

/**
 * Handle a tool_result_end event — capture tool output for live display.
 */
export function handleToolResult(state: StreamState, event: JsonEvent): void {
  const toolMessage = event.message as Record<string, unknown> | undefined;
  if (!toolMessage || toolMessage.role !== "toolResult") return;

  const toolContent = toolMessage.content as Array<Record<string, unknown>> | string | undefined;
  const toolName = (toolMessage.toolName as string) ?? "tool";

  if (typeof toolContent === "string" && toolContent.trim()) {
    const lines = toolContent.split("\n").filter((l) => l.trim());
    state.recentOutput.push(`[${toolName}] ${lines[0]?.slice(0, ARGS_PREVIEW_MAX)}`);
  } else if (Array.isArray(toolContent)) {
    for (const part of toolContent) {
      if (part.type === "text" && (part.text as string)?.trim()) {
        const text = part.text as string;
        const lines = text.split("\n").filter((l) => l.trim());
        state.recentOutput.push(`[${toolName}] ${lines[0]?.slice(0, ARGS_PREVIEW_MAX)}`);
        break;
      }
    }
  }

  if (state.recentOutput.length > RECENT_OUTPUT_MAX) {
    state.recentOutput.splice(0, state.recentOutput.length - RECENT_OUTPUT_MAX);
  }
}

/**
 * Handle a message_end event — extract usage and text from assistant messages.
 */
export function handleMessageEnd(state: StreamState, event: JsonEvent): void {
  const message = event.message as Record<string, unknown> | undefined;
  if (!message || message.role !== "assistant") return;

  // Capture model name
  if (!state.model && message.model) {
    state.model = message.model as string;
  }

  // Collect text output
  const content = message.content as Array<Record<string, unknown>> | string | undefined;
  if (typeof content === "string" && content.trim()) {
    state.accumulatedOutput.push(content);
    const lines = content.split("\n").filter((l) => l.trim());
    state.recentOutput.push(...lines.slice(-10));
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (part.type === "text" && (part.text as string)?.trim()) {
        const text = part.text as string;
        state.accumulatedOutput.push(text);
        const lines = text.split("\n").filter((l) => l.trim());
        state.recentOutput.push(...lines.slice(-10));
      }
    }
  }

  // Cap recentOutput
  if (state.recentOutput.length > RECENT_OUTPUT_MAX) {
    state.recentOutput.splice(0, state.recentOutput.length - RECENT_OUTPUT_MAX);
  }

  // Extract usage (turnCount tracked via turn_start in stream.ts)
  if (message.usage) {
    const usage = message.usage as Record<string, unknown>;
    state.totalInput += (usage.input as number) || 0;
    state.totalOutput += (usage.output as number) || 0;
    state.totalCacheRead += (usage.cacheRead as number) || 0;
    state.totalCacheWrite += (usage.cacheWrite as number) || 0;
    const costObj = usage.cost as { total?: number } | undefined;
    state.totalCost += costObj?.total ?? 0;
  }
}

/**
 * Handle an agent_end event — collect all assistant text for final output.
 */
export function handleAgentEnd(state: StreamState, event: JsonEvent): void {
  const messages = event.messages as Array<Record<string, unknown>> | undefined;
  if (!messages || messages.length === 0) return;

  const allText: string[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      const content = msg.content as Array<Record<string, unknown>> | string | undefined;
      if (typeof content === "string" && content.trim()) {
        allText.push(content);
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === "text" && (part.text as string)?.trim()) {
            allText.push(part.text as string);
          }
        }
      }
    }
  }
  state.finalOutput = allText.join("\n\n");
}
