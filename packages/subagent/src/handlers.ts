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
    // Single-key object: show the value directly (or serialize if complex)
    if (keys.length === 1) {
      const v = obj[keys[0]!];
      if (typeof v === "string") return v.slice(0, ARGS_PREVIEW_MAX);
      if (typeof v === "number" || typeof v === "boolean") return String(v);
      // Complex value (array/nested object) — serialize just this value
      const serialized = JSON.stringify(v);
      if (serialized) return serialized.slice(0, ARGS_PREVIEW_MAX);
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
 * Handle a tool_execution_end event — capture tool result output for live display.
 * The result is in event.result (the tool's return value).
 */
export function handleToolResult(state: StreamState, event: JsonEvent): void {
  const result = event.result as Record<string, unknown> | undefined;
  if (!result) return;

  const toolName = (event.toolName as string) ?? "tool";

  // Extract text content from tool result
  const content = result.content as Array<Record<string, unknown>> | string | undefined;

  if (typeof content === "string" && content.trim()) {
    const lines = content.split("\n").filter((l) => l.trim());
    state.recentOutput.push(`[${toolName}] ${lines[0]?.slice(0, ARGS_PREVIEW_MAX)}`);
  } else if (Array.isArray(content)) {
    for (const part of content) {
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

  // Collect text + thinking output
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
      } else if (part.type === "thinking" && (part.thinking as string)?.trim()) {
        const thinking = part.thinking as string;
        state.accumulatedOutput.push(`[thinking] ${thinking.trim()}`);
        const lines = thinking.split("\n").filter((l) => l.trim());
        state.recentOutput.push(...lines.slice(-5).map((l) => `[thinking] ${l}`));
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
 * Handle an agent_end event — extract final output from the last assistant message.
 */
export function handleAgentEnd(state: StreamState, event: JsonEvent): void {
  const messages = event.messages as Array<Record<string, unknown>> | undefined;
  if (!messages || messages.length === 0) return;

  // Use only the last assistant message for final output
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  if (!lastAssistant) return;

  const allText: string[] = [];
  const content = lastAssistant.content as Array<Record<string, unknown>> | string | undefined;
  if (typeof content === "string" && content.trim()) {
    allText.push(content);
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (part.type === "text" && (part.text as string)?.trim()) {
        allText.push(part.text as string);
      } else if (part.type === "thinking" && (part.thinking as string)?.trim()) {
        allText.push(`[thinking] ${(part.thinking as string).trim()}`);
      }
    }
  }
  state.finalOutput = allText.length > 0 ? allText.join("\n\n") : undefined;
}
