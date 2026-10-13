import type { Usage } from "@earendil-works/pi-ai";

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

/**
 * The terminal state of a finished run — the suite's fixed vocabulary for it
 * (`CONTEXT.md`: *Run outcome*).
 *
 * `completed` finished within limits; `truncated` finished but hit the output
 * token limit, so the answer is partial; `aborted` was cancelled. None of them
 * is a *failed* run — a pre/during-run error carries `error` and **no** outcome.
 */
export type RunOutcome = "completed" | "truncated" | "aborted";

export interface SubagentProgress {
  agent: string;
  /**
   * The coarse view axis (still running / finished / broke). The three-valued
   * *Run outcome* lives in `outcome`, which is what the renderers show when a
   * run has finished — a truncated run is not `failed`, and an aborted one is
   * not `completed`, whatever the row's status has to say for layout.
   */
  status: "running" | "completed" | "failed";
  /** Set once the run reaches a terminal state; absent for a failed run. */
  outcome?: RunOutcome;
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
  /**
   * How the run ended, when it ended. Absent when the run **failed** (an error
   * before or during the run), which is the case `error` and `isError` describe.
   */
  outcome?: RunOutcome;
  usage: SubagentUsage;
  /**
   * The run happened somewhere that already books its usage, so **this** session
   * must not also report it on the tool result.
   *
   * Set for a bridge-dispatched run: the desktop runs it as a session of its own
   * on its worker runtime, and that session's total is the number its Client
   * shows. `usage` still carries the metrics for display in `details`, but
   * `toNativeUsage`/`sumNativeUsage` leave it out, because pi folds a tool
   * result's `usage` into *this* session's totals — publishing it here would add
   * the same money to the parent's view of a run the parent did not perform
   * (ADR 0028: cost is counted once, which is why the `COST_UPDATE` bus route was
   * deleted rather than left alone).
   *
   * Absent on the fork path, where the child is a bare `pi --mode json` process
   * that reports nothing to anyone: the tool result is the only cost report.
   */
  usageAccountedElsewhere?: boolean;
  model: string | undefined;
  finalOutput: string | undefined;
  error: string | undefined;
  progress: SubagentProgress | undefined;
  progressSummary: { toolCount: number; tokens: number; durationMs: number } | undefined;
}

export interface SubagentToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: SubagentDetails;
  /**
   * The runs' summed usage, in pi's own shape (see `usage.ts`).
   *
   * This is the cost report: pi persists it onto the toolResult message and
   * folds it into `/session`, which is why the `COST_UPDATE` bus route to the
   * footer was deleted instead of merely abandoned — the footer reads the same
   * entries and would have counted the money twice.
   */
  usage?: Usage;
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
  /** `stopReason` of the last assistant message seen (`length` ⇒ truncated). */
  lastStopReason?: string;
  /** `agent_settled.aborted` — pi 1.1.0's own account of a cancelled run. */
  settledAborted?: boolean;
  currentTool: string | undefined;
  currentToolArgs: string | undefined;
  currentToolStartedAt: number | undefined;
  model: string | undefined;
  accumulatedOutput: string[];
  recentOutput: string[];
  toolCalls: SubagentToolCall[];
  finalOutput: string | undefined;
}

