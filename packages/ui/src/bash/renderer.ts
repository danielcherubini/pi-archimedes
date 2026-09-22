import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { renderToolHeader } from "@pi-archimedes/core/tool-render";

export interface BashRendererState {
  startedAt?: number | undefined;
  endedAt?: number | undefined;
  interval?: NodeJS.Timeout | undefined;
}

const activeIntervals = new Set<NodeJS.Timeout>();

export function clearActiveBashIntervals(): void {
  for (const interval of activeIntervals) {
    clearInterval(interval);
  }
  activeIntervals.clear();
}

/**
 * Format duration in milliseconds as:
 * - <X.X>s for under 10 seconds (e.g. "1.5s")
 * - <X>s for 10s to 60s (e.g. "15s")
 * - <M>m <S>s for 60s and above (e.g. "1m 5s")
 * - <H>h <M>m <S>s if exceeding 60 minutes
 */
export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const seconds = ms / 1000;
  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`;
  }
  const totalSeconds = Math.floor(seconds);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  const remainderSeconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return `${totalMinutes}m ${remainderSeconds}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const remainderMinutes = totalMinutes % 60;
  return `${hours}h ${remainderMinutes}m ${remainderSeconds}s`;
}

function getTextComponent(context: unknown): Text {
  const ctx = context as { lastComponent?: unknown } | undefined;
  if (ctx?.lastComponent instanceof Text) {
    return ctx.lastComponent;
  }
  return new Text("", 0, 0);
}

/**
 * Render the bash tool call line with bold header.
 */
export function renderBashCall(_args: unknown, theme: Theme, context: unknown): Text {
  const ctx = context as {
    executionStarted?: boolean;
    state?: BashRendererState;
  } | undefined;

  if (ctx) {
    if (!ctx.state) {
      ctx.state = {};
    }
    if (ctx.executionStarted && ctx.state.startedAt === undefined) {
      ctx.state.startedAt = Date.now();
      ctx.state.endedAt = undefined;
    }
  }

  const text = getTextComponent(context);
  text.setText(renderToolHeader("bash", undefined, theme));
  return text;
}

/**
 * Render the bash tool result line (collapsed or expanded view).
 */
export function renderBashResult(
  result: unknown,
  options: { expanded?: boolean; isPartial?: boolean },
  theme: Theme,
  context: unknown,
): Text {
  const ctx = context as {
    executionStarted?: boolean;
    isError?: boolean;
    state?: BashRendererState;
    args?: { command?: string; timeout?: number };
    invalidate?: () => void;
  } | undefined;

  const state: BashRendererState = ctx?.state ?? {};
  if (ctx && !ctx.state) {
    ctx.state = state;
  }

  if (ctx?.executionStarted && state.startedAt === undefined) {
    state.startedAt = Date.now();
  }

  if (options.isPartial && !state.interval) {
    if (ctx?.invalidate) {
      state.interval = setInterval(() => {
        ctx.invalidate?.();
      }, 1000);
      activeIntervals.add(state.interval);
    }
  }

  if (!options.isPartial || ctx?.isError) {
    state.endedAt ??= Date.now();
    if (state.interval) {
      clearInterval(state.interval);
      activeIntervals.delete(state.interval);
      state.interval = undefined;
    }
  }

  const res = result as {
    content?: Array<{ type: string; text?: string }>;
    details?: {
      truncation?: {
        truncated?: boolean;
        outputLines?: number;
        totalLines?: number;
      };
      fullOutputPath?: string;
      exitCode?: number;
    };
    isError?: boolean;
    exitCode?: number;
  } | undefined;

  const isError = Boolean(ctx?.isError || res?.isError || result instanceof Error);
  const now = Date.now();
  const startTime = state.startedAt ?? (state.endedAt ?? now);
  const endTime = state.endedAt ?? now;
  const elapsed = Math.max(0, endTime - startTime);

  const textComponent = getTextComponent(context);

  if (!options.expanded) {
    // Collapsed view:
    // ` <status> <command in muted grey in one line truncated> (<time running>)`
    const statusGlyph = options.isPartial
      ? theme.fg("warning", "▸")
      : isError
        ? theme.fg("error", "✗")
        : theme.fg("success", "✓");

    const rawCmd = typeof ctx?.args?.command === "string" ? ctx.args.command : "";
    const oneLineCmd = rawCmd.replace(/[\r\n]+/g, " ");
    const truncatedCmd = oneLineCmd.length > 70 ? oneLineCmd.slice(0, 70) + "…" : oneLineCmd;
    const styledCmd = theme.fg("muted", truncatedCmd);
    const styledDuration = theme.fg("dim", `(${formatDuration(elapsed)})`);

    textComponent.setText(`${statusGlyph} ${styledCmd} ${styledDuration}`);
    return textComponent;
  }

  // Expanded view:
  const parts: string[] = [];
  const rawCmd = typeof ctx?.args?.command === "string" ? ctx.args.command : "";
  parts.push(theme.fg("dim", "$ ") + theme.fg("toolOutput", rawCmd));

  const textBlocks = Array.isArray(res?.content)
    ? res.content.filter((b) => b && b.type === "text" && typeof b.text === "string")
    : [];

  const rawOutput = textBlocks.map((b) => b.text!).join("\n");
  if (rawOutput.length > 0) {
    const lines = rawOutput.split("\n");
    for (const line of lines) {
      parts.push(theme.fg(isError ? "error" : "toolOutput", line));
    }
  }

  if (res?.details?.truncation?.truncated) {
    const truncation = res.details.truncation;
    parts.push(
      theme.fg(
        "warning",
        `[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines. Full output: ${res.details.fullOutputPath}]`,
      ),
    );
  }

  const durationLabel = options.isPartial ? "Elapsed" : "Took";
  parts.push(theme.fg("muted", `${durationLabel} ${formatDuration(elapsed)}`));

  if (!options.isPartial) {
    if (isError) {
      const exitMatch = rawOutput.match(/(?:Command exited with code|exit code:?)\s*(\d+)/i);
      const code = exitMatch
        ? exitMatch[1]
        : typeof res?.details?.exitCode === "number"
          ? String(res.details.exitCode)
          : typeof res?.exitCode === "number"
            ? String(res.exitCode)
            : "1";
      parts.push(theme.fg("error", `✗ Command exited with code ${code}`));
    } else {
      parts.push(theme.fg("success", "✓ Done"));
    }
  }

  textComponent.setText(parts.join("\n"));
  return textComponent;
}
