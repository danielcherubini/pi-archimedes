import { Text } from "@earendil-works/pi-tui";
import type { SubagentDetails, SubagentProgress, SubagentResult, SubagentToolCall, SubagentToolResult } from "./types.js";
import { formatDuration, truncLine, buildStatsLine, buildAgentLabel } from "./format.js";
import { renderToolCallLine, STATUS_GLYPH } from "@pi-archimedes/core/tool-render";

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
  toolCalls?: (SubagentToolCall | string)[] | undefined;
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

  // Running: show the current tool with the running glyph ▸ + live duration.
  if (data.currentTool) {
    const argsPreview = data.currentToolArgs
      ? truncLine(data.currentToolArgs, 60)
      : "";
    const durationPart = data.currentToolStartedAt
      ? " | " + formatDuration(Date.now() - data.currentToolStartedAt)
      : "";
    const suffix = (argsPreview ? ": " + argsPreview : "") + durationPart;
    return renderToolCallLine("running", data.currentTool, suffix, theme);
  }

  // Running, no active tool: show the most recently completed tool call with
  // its status glyph (✓ ok / ✗ error) and matching name colour.
  if (data.toolCalls && data.toolCalls.length > 0) {
    const lastCall = data.toolCalls[data.toolCalls.length - 1];
    if (lastCall) {
      if (typeof lastCall === "string") {
        return renderToolCallLine("success", truncLine(lastCall, 60), "", theme);
      }
      const status = lastCall.error ? "error" : "success";
      const suffix = lastCall.argsPreview
        ? ": " + truncLine(lastCall.argsPreview, 60)
        : "";
      return renderToolCallLine(status, lastCall.name, suffix, theme);
    }
  }

  // Running, no tool history: show first line of streamed output (▸, muted).
  if (data.finalOutput) {
    const firstLine = data.finalOutput.split("\n")[0] ?? "";
    return renderToolCallLine("running", truncLine(firstLine, 80), "", theme);
  }

  // Running, no info yet
  if (data.status === "running") {
    return renderToolCallLine("running", "Starting...", "", theme);
  }

  return "";
}

// ── Status glyph ────────────────────────────────────────────────────────────

// Per-agent row prefix (shares the core glyph set: ▸ running, ✓ done, ✗
// failed). Returns the raw character — callers colour it per status.
function statusGlyph(isRunning: boolean, status: string): string {
  if (isRunning) return STATUS_GLYPH.running;
  return status === "completed" ? STATUS_GLYPH.success : STATUS_GLYPH.error;
}

// ── Compact single agent ────────────────────────────────────────────────────

type AgentBlockData = {
  agentName: string;
  task: string | undefined;
  model: string | undefined;
  statsData: Parameters<typeof buildStatsLine>[0];
  activity: ActivityData;
  status: "running" | "completed" | "failed";
};

// Shared 3-line agent block used by both the single and parallel compact
// views so they render identically:
//   [<glyph> ]<agent>: <task>   (glyph prefix only in parallel/multi)
//   <model> · <stats>
//   <activity>
// includeGlyph prefixes the label line with a status-coloured glyph
// (▸ running / ✓ done / ✗ failed) to distinguish stacked agents.
function buildAgentBlock(
  data: AgentBlockData,
  theme: Theme,
  includeGlyph: boolean,
): string {
  const statsLine = buildStatsLine(data.statsData, theme);
  const modelLabel = data.model ? theme.fg("accent", data.model) : "";
  const activityLine = buildActivityLine(data.activity, theme);

  let label = buildAgentLabel(data.agentName, data.task, theme);
  if (includeGlyph) {
    const isRunning = data.status === "running";
    const glyph = statusGlyph(isRunning, data.status);
    const glyphColored =
      data.status === "completed"
        ? theme.fg("success", glyph)
        : data.status === "failed"
          ? theme.fg("error", glyph)
          : theme.fg("muted", glyph);
    label = `${glyphColored} ${label}`;
  }

  return (
    label +
    "\n" +
    [modelLabel, statsLine].filter(Boolean).join(" ") +
    "\n" +
    activityLine
  );
}

export function renderCompactSingle(
  text: Text,
  result: SubagentResult,
  progress: SubagentProgress | undefined,
  theme: Theme,
  context: RenderContext,
): Text {
  // agentName sourced from result; defaults to "subagent"
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

  const output = buildAgentBlock(
    {
      agentName,
      task: result.task,
      model: progress?.model ?? result.model,
      statsData: {
        turns: result.usage.turns ?? 0,
        toolCount: summary.toolCount,
        tokens: summary.tokens,
        durationMs: liveDuration,
        cost: result.usage.cost ?? 0,
      },
      activity: {
        currentTool: progress?.currentTool,
        currentToolArgs: progress?.currentToolArgs,
        currentToolStartedAt: progress?.currentToolStartedAt,
        finalOutput: result.finalOutput,
        status: isRunning ? "running" : status,
        error: result.error,
        toolCalls: progress?.toolCalls,
      },
      status: isRunning ? "running" : status,
    },
    theme,
    false,
  );

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
    const agentName = result.agent ?? "subagent";
    const summary = result.progressSummary ?? { toolCount: 0, tokens: 0, durationMs: 0 };
    const isRunning = progress?.status === "running";
    // Prefer result.exitCode as the source of truth for completion status
    // (matches expanded view). Only fall back to progress.status when the
    // subagent is still actively running. This prevents stale or misaligned
    // progress from showing the wrong status for a finished subagent.
    const status: "running" | "completed" | "failed" = isRunning
      ? "running"
      : result.exitCode === 0 ? "completed" : "failed";

    return buildAgentBlock(
      {
        agentName,
        task: result.task,
        model: progress?.model ?? result.model,
        statsData: {
          turns: result.usage.turns ?? 0,
          toolCount: summary.toolCount,
          tokens: summary.tokens,
          durationMs: summary.durationMs,
          cost: result.usage.cost ?? 0,
        },
        activity: {
          currentTool: progress?.currentTool,
          currentToolArgs: progress?.currentToolArgs,
          currentToolStartedAt: progress?.currentToolStartedAt,
          finalOutput: result.finalOutput,
          status,
          error: result.error,
          toolCalls: progress?.toolCalls,
        },
        status,
      },
      theme,
      true,
    );
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
  // agentName sourced from progress; defaults to "subagent"
  const agentName = progress.agent ?? "subagent";
  const status = progress.status;
  const isRunning = status === "running";

  // Track start time for live duration
  const timeKey = "_subagentStartTime_" + agentName;
  if (isRunning && context.state[timeKey] === undefined) {
    context.state[timeKey] = Date.now() - (progress.durationMs ?? 0);
  }
  const liveDuration = isRunning && context.state[timeKey] !== undefined
    ? Date.now() - (context.state[timeKey] as number)
    : progress.durationMs;

  const output = buildAgentBlock(
    {
      agentName,
      task: progress.task,
      model: progress.model,
      statsData: {
        turns: 0,
        toolCount: progress.toolCount,
        tokens: progress.tokens,
        durationMs: liveDuration,
        cost: progress.cost,
      },
      activity: {
        currentTool: progress.currentTool,
        currentToolArgs: progress.currentToolArgs,
        currentToolStartedAt: progress.currentToolStartedAt,
        finalOutput: undefined,
        status,
        error: progress.error,
        toolCalls: progress.toolCalls,
      },
      status,
    },
    theme,
    false,
  );

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
  const lines = (details.progress ?? []).map((progress) => {
    const agentName = progress.agent ?? "subagent";
    const status = progress.status;

    return buildAgentBlock(
      {
        agentName,
        task: progress.task,
        model: progress.model,
        statsData: {
          turns: 0,
          toolCount: progress.toolCount,
          tokens: progress.tokens,
          durationMs: progress.durationMs,
          cost: progress.cost,
        },
        activity: {
          currentTool: progress.currentTool,
          currentToolArgs: progress.currentToolArgs,
          currentToolStartedAt: progress.currentToolStartedAt,
          finalOutput: undefined,
          status,
          error: progress.error,
          toolCalls: progress.toolCalls,
        },
        status,
      },
      theme,
      true,
    );
  });

  text.setText(lines.join("\n"));
  return text;
}
