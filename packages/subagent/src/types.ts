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
  tokens: number;
  cost: number;
  durationMs: number;
  error?: string;
}

export interface SubagentResult {
  agent: string;
  task: string;
  exitCode: number;
  usage: SubagentUsage;
  finalOutput?: string;
  error?: string;
  progress?: SubagentProgress;
  progressSummary?: { toolCount: number; tokens: number; durationMs: number };
}

export interface SubagentToolResult {
  content: Array<{ type: "text"; text: string }>;
  details?: SubagentDetails;
  isError?: boolean;
}

export interface SubagentDetails {
  mode: "single" | "parallel";
  results: SubagentResult[];
  progress?: SubagentProgress[];
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
