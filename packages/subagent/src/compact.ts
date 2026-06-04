import { Text } from "@earendil-works/pi-tui";
import type { SubagentDetails, SubagentProgress, SubagentResult, SubagentToolResult } from "./types.js";
import { SPINNER_FRAMES, formatTokens, formatDuration, formatCost, truncLine } from "./format.js";

type Theme = { fg: (token: string, text: string) => string; bold: (text: string) => string };
type RenderContext = { state: Record<string, unknown>; invalidate: () => void };

// ── Stats line builder ──────────────────────────────────────────────────────

export function buildStatsLine(
  progress: {
    turns?: number;
    toolCount?: number;
    tokens?: number;
    durationMs?: number;
    cost?: number;
  },
  theme: Theme,
): string {
  const parts: string[] = [];
  const turns = progress.turns ?? 0;
  const tools = progress.toolCount ?? 0;
  const tokens = progress.tokens ?? 0;
  const duration = progress.durationMs ?? 0;
  const cost = progress.cost ?? 0;

  if (turns > 0) parts.push("⟳ " + turns);
  if (tools > 0) parts.push(tools + " tool" + (tools !== 1 ? "s" : ""));
  if (tokens > 0) parts.push(formatTokens(tokens) + " tok");
  if (duration > 0) parts.push(formatDuration(duration));
  if (cost > 0) parts.push(formatCost(cost));

  return parts.map(p => theme.fg("dim", "· " + p)).join(" ");
}

// ── Activity line builder ───────────────────────────────────────────────────

export function buildActivityLine(
  progress: {
    currentTool?: string;
    currentToolArgs?: string;
    currentToolStartedAt?: number;
    finalOutput?: string;
    status?: "running" | "completed" | "failed";
    error?: string;
  },
  theme: Theme,
): string {
  const prefix = theme.fg("dim", "  ⎿  ");

  if (progress.error) {
    return prefix + theme.fg("error", truncLine(progress.error, 80));
  }

  if (progress.currentTool) {
    const argsPreview = progress.currentToolArgs
      ? truncLine(progress.currentToolArgs, 60)
      : "";
    const durationPart = progress.currentToolStartedAt
      ? " | " + formatDuration(Date.now() - progress.currentToolStartedAt)
      : "";
    let line = theme.fg("syntaxFunction", progress.currentTool);
    if (argsPreview) {
      line += theme.fg("dim", ": " + argsPreview);
    }
    if (durationPart) {
      line += theme.fg("dim", durationPart);
    }
    return prefix + line;
  }

  if (progress.finalOutput) {
    const firstLine = progress.finalOutput.split("\n")[0] ?? "";
    return prefix + truncLine(firstLine, 80);
  }

  return "";
}

// ── Spinner helper ──────────────────────────────────────────────────────────

function getSpinnerGlyph(agentName: string, isRunning: boolean, status: string, context: RenderContext): string {
  if (isRunning) {
    const timerKey = "_subagentTimer_" + agentName;
    const frameKey = "_subagentFrame_" + agentName;
    if (!context.state[timerKey]) {
      context.state[frameKey] = 0;
      const timer = setInterval(() => {
        context.state[frameKey] = ((context.state[frameKey] as number) + 1) % SPINNER_FRAMES.length;
        context.invalidate();
      }, 80);
      context.state[timerKey] = timer;
    }
    return SPINNER_FRAMES[context.state[frameKey] as number];
  }
  return status === "completed" ? "✓" : "✗";
}

function cleanupTimer(agentName: string, context: RenderContext) {
  const timerKey = "_subagentTimer_" + agentName;
  const frameKey = "_subagentFrame_" + agentName;
  if (context.state[timerKey]) {
    clearInterval(context.state[timerKey] as ReturnType<typeof setInterval>);
    delete context.state[timerKey];
  }
  delete context.state[frameKey];
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
  const status = progress?.status ?? (result.exitCode === 0 ? "completed" : "failed");
  const isRunning = status === "running";

  let glyph = getSpinnerGlyph(agentName, isRunning, status, context);

  if (!isRunning) {
    cleanupTimer(agentName, context);
  }

  const statsData = {
    turns: result.usage.turns ?? 0,
    toolCount: summary.toolCount,
    tokens: summary.tokens,
    durationMs: summary.durationMs,
    cost: result.usage.cost ?? 0,
  };
  const statsLine = buildStatsLine(statsData, theme);

  const statsPart = statsLine ? "  " + statsLine : "";
  const glyphColored = status === "completed"
    ? theme.fg("success", glyph)
    : status === "failed"
      ? theme.fg("error", glyph)
      : theme.fg("muted", glyph);

  // Activity: current tool if running, "Done"/error if finished
  let activityLine: string;
  if (isRunning && progress?.currentTool) {
    const argsPreview = progress.currentToolArgs
      ? truncLine(progress.currentToolArgs, 60)
      : "";
    const durationPart = progress.currentToolStartedAt
      ? " | " + formatDuration(Date.now() - progress.currentToolStartedAt)
      : "";
    let line = theme.fg("syntaxFunction", progress.currentTool);
    if (argsPreview) {
      line += theme.fg("dim", ": " + argsPreview);
    }
    if (durationPart) {
      line += theme.fg("dim", durationPart);
    }
    activityLine = theme.fg("dim", "  ⎿  ") + line;
  } else if (result.error) {
    activityLine = theme.fg("dim", "  ⎿  ") + theme.fg("error", truncLine(result.error, 80));
  } else if (status === "completed") {
    activityLine = theme.fg("success", "  ⎿  Done");
  } else {
    activityLine = theme.fg("error", "  ⎿  Failed");
  }

  const expandHint = theme.fg("muted", "(ctrl+o)");
  let output = `${glyphColored} ${statsPart}${expandHint ? "  " + expandHint : ""}`;
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
    const status = progress?.status ?? (result.exitCode === 0 ? "completed" : "failed");

    let glyph = status === "completed" ? "✓" : status === "failed" ? "✗" : "⠋";
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

  let glyph = getSpinnerGlyph(agentName, isRunning, status, context);
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

  // Activity: current tool if running, status if finished
  let activityLine: string;
  if (isRunning && progress.currentTool) {
    const argsPreview = progress.currentToolArgs
      ? truncLine(progress.currentToolArgs, 60)
      : "";
    const durationPart = progress.currentToolStartedAt
      ? " | " + formatDuration(Date.now() - progress.currentToolStartedAt)
      : "";
    let line = theme.fg("syntaxFunction", progress.currentTool);
    if (argsPreview) {
      line += theme.fg("dim", ": " + argsPreview);
    }
    if (durationPart) {
      line += theme.fg("dim", durationPart);
    }
    activityLine = theme.fg("dim", "  ⎿  ") + line;
  } else if (progress.error) {
    activityLine = theme.fg("dim", "  ⎿  ") + theme.fg("error", truncLine(progress.error, 80));
  } else if (status === "completed") {
    activityLine = theme.fg("success", "  ⎿  Done");
  } else {
    activityLine = theme.fg("error", "  ⎿  Failed");
  }

  const statsPart = statsLine ? "  " + statsLine : "";
  const expandHint = theme.fg("muted", "(ctrl+o)");
  let output = `${glyphColored} ${statsPart}  ${expandHint}`;
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

    let glyph = getSpinnerGlyph(agentName, isRunning, status, context);
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
