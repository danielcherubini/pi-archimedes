import { Text } from "@earendil-works/pi-tui";
import { clampLine } from "@pi-archimedes/core/text";
import type { SubagentDetails, SubagentProgress, SubagentResult, SubagentToolResult } from "./types.js";

// ── Spinner frames ──────────────────────────────────────────────────────────
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// ── Formatting helpers ──────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return Math.round(n / 1_000) + "k";
  return String(n);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return seconds + "s";
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return minutes + "m" + (remaining > 0 ? remaining + "s" : "");
}

function formatCost(cost: number): string {
  if (cost === 0) return "";
  if (cost < 0.01) return "$" + cost.toFixed(4);
  return "$" + cost.toFixed(2);
}

/** Truncate text to visible width, preserving ANSI. */
function truncLine(text: string, width: number): string {
  return clampLine(text, width);
}

// ── Stats line builder ──────────────────────────────────────────────────────

function buildStatsLine(
  progress: {
    turns?: number;
    toolCount?: number;
    tokens?: number;
    durationMs?: number;
    cost?: number;
  },
  theme: { fg: (token: string, text: string) => string },
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

function buildActivityLine(
  progress: {
    currentTool?: string;
    currentToolArgs?: string;
    currentToolStartedAt?: number;
    finalOutput?: string;
    status?: "running" | "completed" | "failed";
    error?: string;
  },
  theme: { fg: (token: string, text: string) => string },
): string {
  const prefix = theme.fg("dim", "  ⎿  ");

  // Error state
  if (progress.error) {
    return prefix + theme.fg("error", truncLine(progress.error, 80));
  }

  // Running with active tool
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

  // Done — show first line of output
  if (progress.finalOutput) {
    const firstLine = progress.finalOutput.split("\n")[0] ?? "";
    return prefix + truncLine(firstLine, 80);
  }

  return "";
}

// ── Main render function ────────────────────────────────────────────────────

export function renderSubagentResult(
  result: SubagentToolResult,
  options: { expanded: boolean },
  theme: { fg: (token: string, text: string) => string; bold: (text: string) => string },
  context: {
    expanded: boolean;
    isError: boolean;
    lastComponent: Text | undefined;
    state: Record<string, unknown>;
    invalidate: () => void;
  },
): Text {
  const text = context.lastComponent ?? new Text("", 0, 0);
  const details: SubagentDetails | undefined = result.details;
  const expanded = context.expanded ?? options.expanded;

  if (!details) {
    text.setText(theme.fg("dim", "  no results"));
    return text;
  }

  // ── Streaming progress (results empty but progress has data) ──────────
  if (details.results.length === 0 && details.progress && details.progress.length > 0) {
    if (details.progress.length === 1) {
      return renderProgressUpdate(text, details.progress[0], expanded, theme, context);
    }
    return renderProgressUpdatesParallel(text, details, expanded, theme, context);
  }

  if (details.results.length === 0) {
    text.setText(theme.fg("dim", "  no results"));
    return text;
  }

  // ── Single agent ────────────────────────────────────────────────────────
  if (details.mode === "single" || details.results.length === 1) {
    return renderSingleAgent(text, details.results[0], details.progress?.[0], expanded, theme, context);
  }

  // ── Parallel agents ─────────────────────────────────────────────────────
  return renderParallelAgents(text, details, expanded, theme, context);
}

function renderSingleAgent(
  text: Text,
  result: SubagentResult,
  progress: SubagentDetails["progress"] extends (infer U)[] | undefined ? U | undefined : undefined,
  expanded: boolean,
  theme: { fg: (token: string, text: string) => string; bold: (text: string) => string },
  context: {
    state: Record<string, unknown>;
    invalidate: () => void;
  },
): Text {
  const agentName = result.agent ?? "subagent";
  const summary = result.progressSummary ?? { toolCount: 0, tokens: 0, durationMs: 0 };
  const status = progress?.status ?? (result.exitCode === 0 ? "completed" : "failed");
  const isRunning = status === "running";

  if (expanded) {
    return renderExpanded(text, result, progress, theme);
  }

  // ── Compact view ────────────────────────────────────────────────────────

  // Status glyph
  let glyph: string;
  if (isRunning) {
    // Time-based spinner frame counter
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
    glyph = SPINNER_FRAMES[context.state[frameKey] as number];
  } else if (status === "completed") {
    glyph = "✓";
    // Clear animation timer
    const timerKey = "_subagentTimer_" + agentName;
    const frameKey = "_subagentFrame_" + agentName;
    if (context.state[timerKey]) {
      clearInterval(context.state[timerKey] as ReturnType<typeof setInterval>);
      delete context.state[timerKey];
    }
    delete context.state[frameKey];
  } else {
    glyph = "✗";
    const timerKey = "_subagentTimer_" + agentName;
    const frameKey = "_subagentFrame_" + agentName;
    if (context.state[timerKey]) {
      clearInterval(context.state[timerKey] as ReturnType<typeof setInterval>);
      delete context.state[timerKey];
    }
    delete context.state[frameKey];
  }

  // Stats
  const statsData = {
    turns: result.usage.turns ?? 0,
    toolCount: summary.toolCount,
    tokens: summary.tokens,
    durationMs: summary.durationMs,
    cost: result.usage.cost ?? 0,
  };
  const statsLine = buildStatsLine(statsData, theme);

  // Activity
  const activityData = {
    currentTool: progress?.currentTool,
    currentToolArgs: progress?.currentToolArgs,
    currentToolStartedAt: progress?.currentToolStartedAt,
    finalOutput: result.finalOutput,
    status,
    error: result.error,
  };
  const activityLine = buildActivityLine(activityData, theme);

  // Assemble
  const statsPart = statsLine ? "  " + statsLine : "";
  const glyphColored = status === "completed"
    ? theme.fg("success", glyph)
    : status === "failed"
      ? theme.fg("error", glyph)
      : theme.fg("muted", glyph);

  let output = `${glyphColored} ${agentName}${statsPart}`;
  if (activityLine) {
    output += "\n" + activityLine;
  }

  text.setText(output);
  return text;
}

function renderParallelAgents(
  text: Text,
  details: SubagentDetails,
  expanded: boolean,
  theme: { fg: (token: string, text: string) => string; bold: (text: string) => string },
  context: {
    state: Record<string, unknown>;
    invalidate: () => void;
  },
): Text {
  if (expanded) {
    // Render each agent expanded — build text directly
    const lines = details.results.map((result, i) => {
      return buildExpandedText(result, details.progress?.[i], theme);
    });
    text.setText(lines.join("\n\n"));
    return text;
  }

  // Compact parallel view
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

function buildExpandedText(
  result: SubagentResult,
  progress: SubagentDetails["progress"] extends (infer U)[] | undefined ? U | undefined : undefined,
  theme: { fg: (token: string, text: string) => string; bold: (text: string) => string },
): string {
  const lines: string[] = [];

  // Header
  lines.push(theme.fg("toolTitle", theme.bold(result.agent ?? "subagent")));

  // Task
  if (result.task) {
    lines.push(theme.fg("dim", "  Task: " + result.task));
  }

  // Stats
  const summary = result.progressSummary;
  if (summary) {
    const stats: string[] = [];
    if (summary.toolCount > 0) stats.push(summary.toolCount + " tools");
    if (summary.tokens > 0) stats.push(formatTokens(summary.tokens) + " tokens");
    if (summary.durationMs > 0) stats.push(formatDuration(summary.durationMs));
    if (stats.length > 0) {
      lines.push(theme.fg("dim", "  " + stats.join(" · ")));
    }
  }

  // Output
  if (result.finalOutput) {
    lines.push("");
    lines.push(result.finalOutput);
  }

  // Error
  if (result.error) {
    lines.push("");
    lines.push(theme.fg("error", "  Error: " + result.error));
  }

  return lines.join("\n");
}

function renderExpanded(
  text: Text,
  result: SubagentResult,
  progress: SubagentDetails["progress"] extends (infer U)[] | undefined ? U | undefined : undefined,
  theme: { fg: (token: string, text: string) => string; bold: (text: string) => string },
): Text {
  text.setText(buildExpandedText(result, progress, theme));
  return text;
}

// ── Streaming progress renderers ───────────────────────────────────────────

function renderProgressUpdate(
  text: Text,
  progress: SubagentProgress,
  expanded: boolean,
  theme: { fg: (token: string, text: string) => string; bold: (text: string) => string },
  context: {
    state: Record<string, unknown>;
    invalidate: () => void;
  },
): Text {
  const agentName = progress.agent ?? "subagent";
  const status = progress.status;
  const isRunning = status === "running";

  if (expanded) {
    return renderProgressExpanded(text, progress, theme);
  }

  // ── Compact view ────────────────────────────────────────────────────────

  // Status glyph
  let glyph: string;
  if (isRunning) {
    // Time-based spinner frame counter
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
    glyph = SPINNER_FRAMES[context.state[frameKey] as number];
  } else if (status === "completed") {
    glyph = "✓";
  } else {
    glyph = "✗";
  }

  // Stats
  const statsData = {
    turns: 0,
    toolCount: progress.toolCount,
    tokens: progress.tokens,
    durationMs: progress.durationMs,
    cost: progress.cost,
  };
  const statsLine = buildStatsLine(statsData, theme);

  // Activity
  const activityData = {
    currentTool: progress.currentTool,
    currentToolArgs: progress.currentToolArgs,
    currentToolStartedAt: progress.currentToolStartedAt,
    finalOutput: undefined,
    status,
    error: progress.error,
  };
  const activityLine = buildActivityLine(activityData, theme);

  // Assemble
  const statsPart = statsLine ? "  " + statsLine : "";
  const glyphColored = status === "completed"
    ? theme.fg("success", glyph)
    : status === "failed"
      ? theme.fg("error", glyph)
      : theme.fg("muted", glyph);

  let output = `${glyphColored} ${agentName}${statsPart}`;
  if (activityLine) {
    output += "\n" + activityLine;
  }

  text.setText(output);
  return text;
}

function renderProgressExpanded(
  text: Text,
  progress: SubagentProgress,
  theme: { fg: (token: string, text: string) => string; bold: (text: string) => string },
): Text {
  const lines: string[] = [];

  // Header
  lines.push(theme.fg("toolTitle", theme.bold(progress.agent ?? "subagent")));

  // Task
  if (progress.task) {
    lines.push(theme.fg("dim", "  Task: " + progress.task));
  }

  // Stats
  const stats: string[] = [];
  if (progress.toolCount > 0) stats.push(progress.toolCount + " tools");
  if (progress.tokens > 0) stats.push(formatTokens(progress.tokens) + " tokens");
  if (progress.durationMs > 0) stats.push(formatDuration(progress.durationMs));
  if (stats.length > 0) {
    lines.push(theme.fg("dim", "  " + stats.join(" · ")));
  }

  // Activity
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
    lines.push("" + line);
  }

  // Error
  if (progress.error) {
    lines.push("");
    lines.push(theme.fg("error", "  Error: " + progress.error));
  }

  text.setText(lines.join("\n"));
  return text;
}

function renderProgressUpdatesParallel(
  text: Text,
  details: SubagentDetails,
  expanded: boolean,
  theme: { fg: (token: string, text: string) => string; bold: (text: string) => string },
  context: {
    state: Record<string, unknown>;
    invalidate: () => void;
  },
): Text {
  if (expanded) {
    const lines = (details.progress ?? []).map((progress) => {
      return buildProgressExpandedText(progress, theme);
    });
    text.setText(lines.join("\n\n"));
    return text;
  }

  // Compact parallel progress view
  const lines = (details.progress ?? []).map((progress, i) => {
    const agentName = progress.agent ?? "agent-" + i;
    const status = progress.status;

    let glyph: string;
    if (status === "running") {
      // Time-based spinner frame counter
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
      glyph = SPINNER_FRAMES[context.state[frameKey] as number];
    } else if (status === "completed") {
      glyph = "✓";
    } else {
      glyph = "✗";
    }

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

function buildProgressExpandedText(
  progress: SubagentProgress,
  theme: { fg: (token: string, text: string) => string; bold: (text: string) => string },
): string {
  const lines: string[] = [];

  // Header
  lines.push(theme.fg("toolTitle", theme.bold(progress.agent ?? "subagent")));

  // Task
  if (progress.task) {
    lines.push(theme.fg("dim", "  Task: " + progress.task));
  }

  // Stats
  const stats: string[] = [];
  if (progress.toolCount > 0) stats.push(progress.toolCount + " tools");
  if (progress.tokens > 0) stats.push(formatTokens(progress.tokens) + " tokens");
  if (progress.durationMs > 0) stats.push(formatDuration(progress.durationMs));
  if (stats.length > 0) {
    lines.push(theme.fg("dim", "  " + stats.join(" · ")));
  }

  // Activity
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
    lines.push("" + line);
  }

  // Error
  if (progress.error) {
    lines.push("");
    lines.push(theme.fg("error", "  Error: " + progress.error));
  }

  return lines.join("\n");
}
