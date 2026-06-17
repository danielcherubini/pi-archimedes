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

// ── Child → Parent ──────────────────────────────────────────────────────────

export type ChildToParent =
  | {
      type: "event";
      event: Record<string, unknown>;
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
