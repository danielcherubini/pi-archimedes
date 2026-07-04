import { Text } from "@earendil-works/pi-tui";
import type { SubagentDetails, SubagentProgress, SubagentResult } from "./types.js";
import { formatTokens, formatDuration, truncLine, buildStatsLine, buildAgentLabel } from "./format.js";

type Theme = { fg: (token: string, text: string) => string; bold: (text: string) => string };

// ── Expanded completed result ───────────────────────────────────────────────

export function buildExpandedText(
  result: SubagentResult,
  progress: SubagentProgress | undefined,
  theme: Theme,
): string {
  const lines: string[] = [];

  lines.push(buildAgentLabel(result.agent, result.task, theme));
  lines.push("");

  // Stats line (same as compact view)
  const modelName = progress?.model ?? result.model;
  const modelLabel = modelName ? theme.fg("accent", modelName) : "";
  const statsLine = buildStatsLine({
    turns: result.usage.turns,
    toolCount: result.progressSummary?.toolCount,
    tokens: result.progressSummary?.tokens,
    durationMs: result.progressSummary?.durationMs,
    cost: result.usage.cost,
  }, theme);
  const expandHint = theme.fg("muted", "(ctrl+o)");
  const statsParts = [modelLabel, statsLine, expandHint].filter(Boolean);
  if (statsParts.length > 0) {
    lines.push(statsParts.join(" "));
  }

  // Task
  if (result.task) {
    lines.push("");
    lines.push(theme.fg("dim", "Task: " + result.task));
  }

  // Tool calls history
  const toolCalls = progress?.toolCalls;
  if (toolCalls && toolCalls.length > 0) {
    lines.push("");
    for (const call of toolCalls) {
      lines.push(theme.fg("dim", "↳ " + call));
    }
  }

  // Output - show live streaming output or final output
  const outputText = progress?.output ?? result.finalOutput;
  if (outputText) {
    lines.push("");
    lines.push(outputText);
  }

  // Error
  if (result.error) {
    lines.push("");
    lines.push(theme.fg("error", "✗ " + result.error));
  } else if (result.exitCode === 0) {
    lines.push("");
    lines.push(theme.fg("success", "✓ Done"));
  } else {
    lines.push("");
    lines.push(theme.fg("error", "✗ Failed"));
  }

  return lines.join("\n");
}

export function renderExpanded(
  text: Text,
  result: SubagentResult,
  progress: SubagentProgress | undefined,
  theme: Theme,
): Text {
  text.setText(buildExpandedText(result, progress, theme));
  return text;
}

// ── Expanded streaming progress ─────────────────────────────────────────────

export function renderProgressExpanded(
  text: Text,
  progress: SubagentProgress,
  theme: Theme,
): Text {
  const lines: string[] = [];

  lines.push(buildAgentLabel(progress.agent, progress.task, theme));
  lines.push("");

  // Stats line (same as compact view)
  const modelLabel = progress.model ? theme.fg("accent", progress.model) : "";
  const statsLine = buildStatsLine({
    turns: undefined,
    toolCount: progress.toolCount,
    tokens: progress.tokens,
    durationMs: progress.durationMs,
    cost: progress.cost,
  }, theme);
  const expandHint = theme.fg("muted", "(ctrl+o)");
  const statsParts = [modelLabel, statsLine, expandHint].filter(Boolean);
  if (statsParts.length > 0) {
    lines.push(statsParts.join(" "));
  }

  // Task
  if (progress.task) {
    lines.push("");
    lines.push(theme.fg("dim", "Task: " + progress.task));
  }

  // Tool calls history
  if (progress.toolCalls && progress.toolCalls.length > 0) {
    lines.push("");
    for (const call of progress.toolCalls) {
      lines.push(theme.fg("dim", "↳ " + call));
    }
  }

  // Activity (current tool with spinner)
  if (progress.currentTool) {
    lines.push("");
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
    lines.push(line);
  }

  // Status at bottom
  if (progress.status === "completed") {
    lines.push("");
    lines.push(theme.fg("success", "✓ Done"));
  } else if (progress.status === "failed") {
    lines.push("");
    if (progress.error) {
      lines.push(theme.fg("error", "✗ " + progress.error));
    } else {
      lines.push(theme.fg("error", "✗ Failed"));
    }
  }

  text.setText(lines.join("\n"));
  return text;
}

// ── Expanded parallel streaming progress ────────────────────────────────────

export function buildProgressExpandedText(
  progress: SubagentProgress,
  theme: Theme,
): string {
  const lines: string[] = [];

  lines.push(buildAgentLabel(progress.agent, progress.task, theme));
  lines.push("");

  // Stats line (same as compact view)
  const modelLabel = progress.model ? theme.fg("accent", progress.model) : "";
  const statsLine = buildStatsLine({
    turns: undefined,
    toolCount: progress.toolCount,
    tokens: progress.tokens,
    durationMs: progress.durationMs,
    cost: progress.cost,
  }, theme);
  const expandHint = theme.fg("muted", "(ctrl+o)");
  const statsParts = [modelLabel, statsLine, expandHint].filter(Boolean);
  if (statsParts.length > 0) {
    lines.push(statsParts.join(" "));
  }

  // Task
  if (progress.task) {
    lines.push("");
    lines.push(theme.fg("dim", "Task: " + progress.task));
  }

  // Tool calls history
  if (progress.toolCalls && progress.toolCalls.length > 0) {
    lines.push("");
    for (const call of progress.toolCalls) {
      lines.push(theme.fg("dim", "↳ " + call));
    }
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
    lines.push("");
    lines.push(line);
  }

  // Status at bottom
  if (progress.status === "completed") {
    lines.push("");
    lines.push(theme.fg("success", "✓ Done"));
  } else if (progress.status === "failed") {
    lines.push("");
    if (progress.error) {
      lines.push(theme.fg("error", "✗ " + progress.error));
    } else {
      lines.push(theme.fg("error", "✗ Failed"));
    }
  }

  return lines.join("\n");
}
