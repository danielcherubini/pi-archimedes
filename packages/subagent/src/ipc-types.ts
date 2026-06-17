/**
 * Shared IPC message types for fork+IPC subagent architecture.
 *
 * Parent sends "init" first, then "ask_response" / "abort".
 * Child sends "ready" after init, then "event" / "ask_request" / "error".
 */

// ── Parent → Child ──────────────────────────────────────────────────────────

export type ParentToChild =
  | {
      type: "ask_response";
      requestId: string;
      cancelled: boolean;
      results: Array<{
        id: string;
        selectedOptions: string[];
        customInput?: string;
      }>;
    }
  | {
      type: "abort";
    }
  | {
      type: "init";
      task: string;
      model?: string;
      agentName?: string;
      agentSystemPrompt?: string;
      agentTools?: string[];
      agentModel?: string;
      agentThinking?: string;
      cwd?: string;
    };

// ── Serialized agent events ─────────────────────────────────────────────────
// Matches the event types forwarded by stream.ts. Nested fields use `unknown`
// because they contain complex objects (AgentMessage, etc.) serialized via
// JSON.parse(JSON.stringify()). The key point is typing the `type` discriminator
// and the top-level field names.

export type SerializedAgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: unknown[]; willRetry?: boolean }
  | { type: "turn_start" }
  | { type: "turn_end"; message: unknown; toolResults: unknown[] }
  | { type: "message_start"; message: unknown }
  | { type: "message_update"; message: unknown; assistantMessageEvent: unknown }
  | { type: "message_end"; message: unknown }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean };

// ── Child → Parent ──────────────────────────────────────────────────────────

export type ChildToParent =
  | {
      type: "event";
      event: SerializedAgentEvent;
    }
  | {
      type: "ask_request";
      requestId: string;
      questions: Array<{
        id: string;
        question: string;
        description?: string;
        options: Array<{ label: string }>;
        multi?: boolean;
        recommended?: number;
      }>;
    }
  | {
      type: "ready";
    }
  | {
      type: "error";
      message: string;
    };
