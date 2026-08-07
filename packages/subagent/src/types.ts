export interface SubagentUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  turns: number;
}

export interface SubagentToolCall {
  name: string;
  argsPreview: string;
  error: boolean;
}

export interface SubagentProgress {
  agent: string;
  status: "running" | "completed" | "failed";
  task: string;
  currentTool: string | undefined;
  currentToolArgs: string | undefined;
  currentToolStartedAt: number | undefined;
  toolCount: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  cost: number;
  durationMs: number;
  error: string | undefined;
  /** Model used by the subagent */
  model: string | undefined;
  /** Accumulated assistant text output during streaming */
  output: string | undefined;
  /** Last N lines of assistant text for live display */
  recentOutput: string[] | undefined;
  /** History of tool calls with status tracking */
  toolCalls: SubagentToolCall[] | undefined;
}

export interface SubagentResult {
  agent: string;
  task: string;
  /** Logical Pi session UUID for this spawned subagent process. */
  childSessionId?: string;
  exitCode: number;
  usage: SubagentUsage;
  model: string | undefined;
  finalOutput: string | undefined;
  error: string | undefined;
  progress: SubagentProgress | undefined;
  progressSummary: { toolCount: number; tokens: number; durationMs: number } | undefined;
}

export interface SubagentToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: SubagentDetails;
  isError?: boolean;
}

export interface SubagentDetails {
  mode: "single" | "parallel";
  results: SubagentResult[];
  progress: SubagentProgress[] | undefined;
}

/** Mutable state during streaming — shared between stream.ts and handlers.ts */
export interface StreamState {
  childSessionId?: string;
  toolCount: number;
  turnCount: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalCost: number;
  currentTool: string | undefined;
  currentToolArgs: string | undefined;
  currentToolStartedAt: number | undefined;
  model: string | undefined;
  accumulatedOutput: string[];
  recentOutput: string[];
  toolCalls: SubagentToolCall[];
  finalOutput: string | undefined;
}

