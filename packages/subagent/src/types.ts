export interface SubagentUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  turns: number;
}

export interface SubagentProgress {
  agent: string;
  status: "running" | "completed" | "failed";
  task: string;
  currentTool?: string;
  currentToolArgs?: string;
  currentToolStartedAt?: number;
  toolCount: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  cost: number;
  durationMs: number;
  error?: string;
  /** Model used by the subagent */
  model?: string;
  /** Accumulated assistant text output during streaming */
  output?: string;
  /** Last N lines of assistant text for live display */
  recentOutput?: string[];
  /** History of tool calls: "toolName: args_preview" */
  toolCalls?: string[];
}

export interface SubagentResult {
  agent: string;
  task: string;
  exitCode: number;
  usage: SubagentUsage;
  model?: string;
  finalOutput?: string;
  error?: string;
  progress?: SubagentProgress;
  progressSummary?: { toolCount: number; tokens: number; durationMs: number };
}

export interface SubagentToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: SubagentDetails;
  isError?: boolean;
}

export interface SubagentDetails {
  mode: "single" | "parallel";
  results: SubagentResult[];
  progress?: SubagentProgress[];
}

/** Mutable state during streaming — shared between stream.ts and handlers.ts */
export interface StreamState {
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
  toolCalls: string[];
  finalOutput: string | undefined;
}

export interface SubagentParamsSchema {
  agent?: string;
  task: string;
  tasks?: Array<{ agent?: string; task: string; count?: number }>;
  model?: string;
  async?: boolean;
  context?: "fresh" | "fork";
  cwd?: string;
}
