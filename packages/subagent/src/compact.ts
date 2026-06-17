import { Text } from "@earendil-works/pi-tui";
import type { SubagentDetails, SubagentProgress, SubagentResult, SubagentToolResult } from "./types.js";
import { formatTokens, formatDuration, formatCost, truncLine, buildStatsLine } from "./format.js";

type Theme = { fg: (token: string, text: string) => string; bold: (text: string) => string };
type RenderContext = { state: Record<string, unknown>; invalidate: () => void };

// ── Activity line builder ───────────────────────────────────────────────────

interface ActivityData {
  currentTool: string | undefined;
  currentToolArgs: string | undefined;
  currentToolStartedAt: number | undefined;
  finalOutput: string | undefined;
  status: "running" | "completed" | "failed" | undefined;
  error: string | undefined;
  toolCalls?: string[] | undefined;
}

export function buildActivityLine(
  data: ActivityData,
  theme: Theme,
): string {
  if (data.error) {
    return theme.fg("error", "✗ " + truncLine(data.error, 80));
  }

  // Finished subagents always show their final status — never a stale
  // tool call from history. This keeps compact view consistent with
  // expanded view ("✓ Done" / "✗ Failed" at the bottom).
  if (data.status === "completed") {
    return theme.fg("success", "✓ Done");
  }
  if (data.status === "failed") {
    return theme.fg("error", "✗ Failed");
  }

  // Running: show the current tool with live duration
  if (data.currentTool) {
    const arrow = theme.fg("muted", "↳ ");
    const argsPreview = data.currentToolArgs
      ? truncLine(data.currentToolArgs ?? "", 60)
      : "";
    const durationPart = data.currentToolStartedAt
      ? " | " + formatDuration(Date.now() - data.currentToolStartedAt)
      : "";
    let line = theme.fg("syntaxFunction", data.currentTool);
    if (argsPreview) {
      line += theme.fg("dim", ": " + argsPreview);
    }
    if (durationPart) {
      line += theme.fg("dim", durationPart);
    }
    return arrow + line;
  }

  // Running, no active tool: show the most recently completed tool call
  if (data.toolCalls && data.toolCalls.length > 0) {
    const lastCall = data.toolCalls[data.toolCalls.length - 1];
    if (lastCall) return theme.fg("muted", "↳ " + lastCall);
  }

  // Running, no tool history: show first line of streamed output if any
  if (data.finalOutput) {
    const firstLine = data.finalOutput.split("\n")[0] ?? "";
    return theme.fg("muted", "↳ " + truncLine(firstLine, 80));
  }

  // Running, no info yet
  if (data.status === "running") {
    return theme.fg("muted", "↳ Starting...");
  }

  return "";
}

// ── Status glyph ────────────────────────────────────────────────────────────

function statusGlyph(isRunning: boolean, status: string): string {
  if (isRunning) return "↳";
  return status === "completed" ? "✓" : "✗";
}

// ── Compact single agent ────────────────────────────────────────────────────

export function renderCompactSingle(
  text: Text,
  result: SubagentResult,
  progress: SubagentProgress | undefined,
  theme: Theme,
  context: RenderContext,
): Text {
  const agentName = result.agent ?? "subagent";
  const summary = result.progressSummary ?? { toolCount: 0, tokens: 0, durationMs: 0 };
  const isRunning = progress?.status === "running";
  const status = isRunning ? "running" : (result.exitCode === 0 ? "completed" : "failed");

  // Track start time for live duration
  const timeKey = "_subagentStartTime_" + agentName;
  if (isRunning && context.state[timeKey] === undefined) {
    // Estimate start time from current duration
    const currentDuration = summary.durationMs || (progress?.durationMs ?? 0);
    context.state[timeKey] = Date.now() - currentDuration;
  }
  const liveDuration = isRunning && context.state[timeKey]
    ? Date.now() - (context.state[timeKey] as number)
    : summary.durationMs;

  const statsData = {
    turns: result.usage.turns ?? 0,
    toolCount: summary.toolCount,
    tokens: summary.tokens,
    durationMs: liveDuration,
    cost: result.usage.cost ?? 0,
  };
  const statsLine = buildStatsLine(statsData, theme);

  const statsPart = statsLine;

  // Activity: arrow + current tool if running, status if finished
  const activityLine = buildActivityLine({
    currentTool: progress?.currentTool,
    currentToolArgs: progress?.currentToolArgs,
    currentToolStartedAt: progress?.currentToolStartedAt,
    finalOutput: result.finalOutput,
    status: isRunning ? "running" : status,
    error: result.error,
    toolCalls: progress?.toolCalls,
  }, theme);

  const modelName = progress?.model ?? result.model;
  const modelLabel = modelName
    ? theme.fg("accent", modelName)
    : "";
  const expandHint = theme.fg("muted", "(ctrl+o)");
  let output = [modelLabel, statsPart, expandHint].filter(Boolean).join(" ");
  output += "\n" + activityLine;

  text.setText(output);
  return text;
}

// ── Compact parallel agents ─────────────────────────────────────────────────

export function renderCompactParallel(
  text: Text,
  details: SubagentDetails,
  theme: Theme,
  context: RenderContext,
): Text {
  const lines = details.results.map((result, i) => {
    const progress = details.progress?.[i];
    const agentName = result.agent ?? "agent-" + i;
    const summary = result.progressSummary ?? { toolCount: 0, tokens: 0, durationMs: 0 };
    const isRunning = progress?.status === "running";
    // Prefer result.exitCode as the source of truth for completion status
    // (matches expanded view). Only fall back to progress.status when the
    // subagent is still actively running. This prevents stale or misaligned
    // progress from showing the wrong status for a finished subagent.
    const status: "running" | "completed" | "failed" = isRunning
      ? "running"
      : result.exitCode === 0 ? "completed" : "failed";

    const glyph = statusGlyph(isRunning, status);
    const glyphColored = status === "completed"
      ? theme.fg("success", glyph)
      : status === "failed"
        ? theme.fg("error", glyph)
        : theme.fg("muted", glyph);

    const statsData = {
      turns: result.usage.turns ?? 0,
      toolCount: summary.toolCount,
      tokens: summary.tokens,
      durationMs: summary.durationMs,
      cost: result.usage.cost ?? 0,
    };
    const statsLine = buildStatsLine(statsData, theme);
    const statsPart = statsLine ? "  " + statsLine : "";

    const activityData = {
      currentTool: progress?.currentTool,
      currentToolArgs: progress?.currentToolArgs,
      currentToolStartedAt: progress?.currentToolStartedAt,
      finalOutput: result.finalOutput,
      status,
      error: result.error,
      toolCalls: progress?.toolCalls,
    };
    const activityLine = buildActivityLine(activityData, theme);

    let line = `${glyphColored} ${agentName}${statsPart}`;
    if (activityLine) {
      line += "\n" + activityLine;
    }
    return line;
  });

  text.setText(lines.join("\n"));
  return text;
}

// ── Compact streaming progress ──────────────────────────────────────────────

export function renderCompactProgress(
  text: Text,
  progress: SubagentProgress,
  theme: Theme,
  context: RenderContext,
): Text {
  const agentName = progress.agent ?? "subagent";
  const status = progress.status;
  const isRunning = status === "running";

  const glyph = statusGlyph(isRunning, status);
  const glyphColored = status === "completed"
    ? theme.fg("success", glyph)
    : status === "failed"
      ? theme.fg("error", glyph)
      : theme.fg("muted", glyph);

  // Track start time for live duration
  const timeKey = "_subagentStartTime_" + agentName;
  if (isRunning && context.state[timeKey] === undefined) {
    context.state[timeKey] = Date.now() - (progress.durationMs ?? 0);
  }
  const liveDuration = isRunning && context.state[timeKey] !== undefined
    ? Date.now() - (context.state[timeKey] as number)
    : progress.durationMs;

  const statsData = {
    turns: 0,
    toolCount: progress.toolCount,
    tokens: progress.tokens,
    durationMs: liveDuration,
    cost: progress.cost,
  };
  const statsLine = buildStatsLine(statsData, theme);

  // Activity: arrow + current tool if running, status if finished
  const activityLine = buildActivityLine({
    currentTool: progress.currentTool,
    currentToolArgs: progress.currentToolArgs,
    currentToolStartedAt: progress.currentToolStartedAt,
    finalOutput: undefined,
    status,
    error: progress.error,
    toolCalls: progress.toolCalls,
  }, theme);

  const modelLabel = progress.model
    ? theme.fg("accent", progress.model)
    : "";
  const statsPart = statsLine;
  const expandHint = theme.fg("muted", "(ctrl+o)");
  let output = [modelLabel, statsPart, expandHint].filter(Boolean).join(" ");
  output += "\n" + activityLine;

  text.setText(output);
  return text;
}

// ── Compact parallel streaming progress ─────────────────────────────────────

export function renderCompactParallelProgress(
  text: Text,
  details: SubagentDetails,
  theme: Theme,
  context: RenderContext,
): Text {
  const lines = (details.progress ?? []).map((progress, i) => {
    const agentName = progress.agent ?? "agent-" + i;
    const status = progress.status;
    const isRunning = status === "running";

    const glyph = statusGlyph(isRunning, status);
    const glyphColored = status === "completed"
      ? theme.fg("success", glyph)
      : status === "failed"
        ? theme.fg("error", glyph)
        : theme.fg("muted", glyph);

    const statsData = {
      turns: 0,
      toolCount: progress.toolCount,
      tokens: progress.tokens,
      durationMs: progress.durationMs,
      cost: progress.cost,
    };
    const statsLine = buildStatsLine(statsData, theme);
    const statsPart = statsLine ? "  " + statsLine : "";

    const activityData = {
      currentTool: progress.currentTool,
      currentToolArgs: progress.currentToolArgs,
      currentToolStartedAt: progress.currentToolStartedAt,
      finalOutput: undefined,
      status,
      error: progress.error,
      toolCalls: progress.toolCalls,
    };
    const activityLine = buildActivityLine(activityData, theme);

    let line = `${glyphColored} ${agentName}${statsPart}`;
    if (activityLine) {
      line += "\n" + activityLine;
    }
    return line;
  });

  text.setText(lines.join("\n"));
  return text;
}
