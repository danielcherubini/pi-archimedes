import { Text } from "@earendil-works/pi-tui";
import type { SubagentDetails, SubagentProgress, SubagentResult, SubagentToolResult } from "./types.js";
import { SPINNER_FRAMES, formatTokens, formatDuration, formatCost, truncLine, buildStatsLine } from "./format.js";

type Theme = { fg: (token: string, text: string) => string; bold: (text: string) => string };
type RenderContext = { state: Record<string, unknown>; invalidate: () => void };

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
  const isRunning = progress?.status === "running";
  const status = isRunning ? "running" : (result.exitCode === 0 ? "completed" : "failed");

  // Manage timer for spinner on line 3
  if (isRunning) {
    getSpinnerGlyph(agentName, true, "running", context);
  } else {
    cleanupTimer(agentName, context);
  }

  // Track start time for live duration
  const timeKey = "_subagentStartTime_" + agentName;
  if (isRunning && !context.state[timeKey]) {
    // Estimate start time from current duration
    const currentDuration = summary.durationMs || (progress?.durationMs ?? 0);
    context.state[timeKey] = Date.now() - currentDuration;
  }
  if (!isRunning) {
    delete context.state[timeKey];
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
  const statsLine = buildStatsLine(statsData, theme.fg);

  const statsPart = statsLine ?? "";

  // Activity: spinner + current tool if running, status if finished
  let activityLine: string;
  if (isRunning) {
    const spinner = SPINNER_FRAMES[(context.state["_subagentFrame_" + agentName] as number) ?? 0];
    const spinnerColored = theme.fg("muted", spinner);
    if (progress?.currentTool) {
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
      activityLine = spinnerColored + " " + line;
    } else if (progress?.toolCalls && progress.toolCalls.length > 0) {
      const lastCall = progress.toolCalls[progress.toolCalls.length - 1];
      activityLine = theme.fg("dim", "  ⎿  ") + theme.fg("muted", lastCall);
    } else {
      activityLine = theme.fg("muted", "  ⎿  Working...");
    }
  } else if (result.error) {
    activityLine = theme.fg("error", "✗ " + truncLine(result.error, 80));
  } else if (status === "completed") {
    activityLine = theme.fg("success", "✓ Done");
  } else {
    activityLine = theme.fg("error", "✗ Failed");
  }

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
    const statsLine = buildStatsLine(statsData, theme.fg);
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

  // Track start time for live duration
  const timeKey = "_subagentStartTime_" + agentName;
  if (isRunning && !context.state[timeKey]) {
    context.state[timeKey] = Date.now() - (progress.durationMs ?? 0);
  }
  if (!isRunning) {
    delete context.state[timeKey];
  }
  const liveDuration = isRunning && context.state[timeKey]
    ? Date.now() - (context.state[timeKey] as number)
    : progress.durationMs;

  const statsData = {
    turns: 0,
    toolCount: progress.toolCount,
    tokens: progress.tokens,
    durationMs: liveDuration,
    cost: progress.cost,
  };
  const statsLine = buildStatsLine(statsData, theme.fg);

  // Activity: current tool if running, status if finished
  let activityLine: string;
  if (isRunning) {
    const spinner = SPINNER_FRAMES[(context.state["_subagentFrame_" + agentName] as number) ?? 0];
    const spinnerColored = theme.fg("muted", spinner);
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
      activityLine = spinnerColored + " " + line;
    } else if (progress.toolCalls && progress.toolCalls.length > 0) {
      const lastCall = progress.toolCalls[progress.toolCalls.length - 1];
      activityLine = spinnerColored + " " + theme.fg("muted", lastCall);
    } else {
      activityLine = spinnerColored + " " + theme.fg("muted", "Working...");
    }
  } else if (progress.error) {
    activityLine = theme.fg("error", "✗ " + truncLine(progress.error, 80));
  } else if (status === "completed") {
    activityLine = theme.fg("success", "✓ Done");
  } else {
    activityLine = theme.fg("error", "✗ Failed");
  }

  const modelLabel = progress.model
    ? theme.fg("accent", progress.model)
    : "";
  const statsPart = statsLine ?? "";
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
    const statsLine = buildStatsLine(statsData, theme.fg);
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
