import { Text } from "@earendil-works/pi-tui";
import type { SubagentDetails, SubagentProgress, SubagentResult } from "./types.js";
import { formatTokens, formatDuration, truncLine } from "./format.js";

type Theme = { fg: (token: string, text: string) => string; bold: (text: string) => string };

// ── Expanded completed result ───────────────────────────────────────────────

export function buildExpandedText(
  result: SubagentResult,
  progress: SubagentProgress | undefined,
  theme: Theme,
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

  // Output - show live streaming output or final output
  const outputText = progress?.output ?? result.finalOutput;
  if (outputText) {
    lines.push("");
    lines.push(outputText);
  }

  // Error
  if (result.error) {
    lines.push("");
    lines.push(theme.fg("error", "  Error: " + result.error));
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

  // Tool calls history
  if (progress.toolCalls && progress.toolCalls.length > 0) {
    lines.push("");
    for (const call of progress.toolCalls) {
      lines.push(theme.fg("dim", "  - " + call));
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

  // Error
  if (progress.error) {
    lines.push("");
    lines.push(theme.fg("error", "  Error: " + progress.error));
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

  // Tool calls history
  if (progress.toolCalls && progress.toolCalls.length > 0) {
    lines.push("");
    for (const call of progress.toolCalls) {
      lines.push(theme.fg("dim", "  - " + call));
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

  // Error
  if (progress.error) {
    lines.push("");
    lines.push(theme.fg("error", "  Error: " + progress.error));
  }

  return lines.join("\n");
}
