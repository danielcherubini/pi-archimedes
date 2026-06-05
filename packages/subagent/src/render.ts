import { Text } from "@earendil-works/pi-tui";
import type { SubagentDetails, SubagentProgress, SubagentToolResult } from "./types.js";
import {
  renderCompactSingle,
  renderCompactParallel,
  renderCompactProgress,
  renderCompactParallelProgress,
} from "./compact.js";
import {
  renderExpanded,
  renderProgressExpanded,
  buildProgressExpandedText,
  buildExpandedText,
} from "./expanded.js";

type Theme = { fg: (token: string, text: string) => string; bold: (text: string) => string };
type RenderContext = {
  expanded: boolean;
  isError: boolean;
  lastComponent: Text | undefined;
  state: Record<string, unknown>;
  invalidate: () => void;
};

export function renderSubagentResult(
  text: Text,
  result: SubagentToolResult,
  options: { expanded: boolean },
  theme: Theme,
  context: RenderContext,
): Text {
  const details: SubagentDetails | undefined = result.details;
  const expanded = context.expanded ?? options.expanded;

  if (!details) {
    text.setText(theme.fg("dim", "  no results"));
    return text;
  }

  // ── Streaming progress (results empty but progress has data) ──────────
  if (details.results.length === 0 && details.progress && details.progress.length > 0) {
    if (details.progress.length === 1) {
      return renderProgressUpdate(text, details.progress[0]!, expanded, theme, context);
    }
    return renderProgressUpdatesParallel(text, details, expanded, theme, context);
  }

  if (details.results.length === 0) {
    text.setText(theme.fg("dim", "  no results"));
    return text;
  }

  // ── Single agent ────────────────────────────────────────────────────────
  if (details.mode === "single" || details.results.length === 1) {
    return renderSingleAgent(text, details.results[0]!, details.progress?.[0], expanded, theme, context);
  }

  // ── Parallel agents ─────────────────────────────────────────────────────
  return renderParallelAgents(text, details, expanded, theme, context);
}

function renderSingleAgent(
  text: Text,
  result: SubagentDetails["results"][number],
  progress: SubagentDetails["progress"] extends (infer U)[] | undefined ? U | undefined : undefined,
  expanded: boolean,
  theme: Theme,
  context: RenderContext,
): Text {
  if (expanded) {
    return renderExpanded(text, result, progress, theme);
  }
  return renderCompactSingle(text, result, progress, theme, context);
}

function renderParallelAgents(
  text: Text,
  details: SubagentDetails,
  expanded: boolean,
  theme: Theme,
  context: RenderContext,
): Text {
  if (expanded) {
    const progressArr: SubagentProgress[] = details.progress ?? [];
    const lines = details.results.map((result, i) => {
      return buildExpandedText(result, progressArr[i], theme);
    });
    text.setText(lines.join("\n\n"));
    return text;
  }
  return renderCompactParallel(text, details, theme, context);
}

function renderProgressUpdate(
  text: Text,
  progress: SubagentProgress,
  expanded: boolean,
  theme: Theme,
  context: RenderContext,
): Text {
  if (expanded) {
    return renderProgressExpanded(text, progress, theme);
  }
  return renderCompactProgress(text, progress, theme, context);
}

function renderProgressUpdatesParallel(
  text: Text,
  details: SubagentDetails,
  expanded: boolean,
  theme: Theme,
  context: RenderContext,
): Text {
  if (expanded) {
    const progressArr: SubagentProgress[] = details.progress ?? [];
    const lines = progressArr.map((progress) => {
      return buildProgressExpandedText(progress, theme);
    });
    text.setText(lines.join("\n\n"));
    return text;
  }
  return renderCompactParallelProgress(text, details, theme, context);
}
