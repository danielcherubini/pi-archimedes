import { highlightCode } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Container,
  getImageDimensions,
  imageFallback,
  Text,
  type Component,
} from "@earendil-works/pi-tui";
import { renderToolHeader, toolRowDuration } from "@pi-archimedes/core/tool-render";

/** Nested-call args preview budget, collapsed (the native renderer uses 80). */
const COLLAPSED_CALL_ARGS_CHARS = 80;
/** Collapsed call-list budget: the last 5 calls, with an expand hint. */
const COLLAPSED_CALL_COUNT = 5;

/** The executor's result header, stripped before the output is displayed. */
const SCRIPT_HEADER = /^Script (completed|failed)\nWall time [\d.]+ seconds\nOutput:\n$/;

export interface CodemodeNestedCall {
  id: string;
  name: string;
  /** Compact JSON of the arguments, truncated for display. */
  args: string;
  status: "running" | "ok" | "error" | "cancelled";
  durationMs?: number;
  /** Error text, truncated for display. */
  error?: string;
  /** Cost in USD of a `models.*` call that reported usage. */
  cost?: number;
}

export interface CodemodeToolDetails {
  calls: CodemodeNestedCall[];
  /** Temp file with the full text output, when the output was truncated. */
  fullOutputPath?: string;
}

export interface CodemodeRendererState {
  startedAt?: number | undefined;
  endedAt?: number | undefined;
  interval?: NodeJS.Timeout | undefined;
}

const activeStates = new Set<CodemodeRendererState>();

/**
 * Clear live-timer intervals of in-flight codemode rows. Called on
 * session_shutdown so a cancelled script does not keep invalidating a
 * component that no longer exists.
 */
export function clearActiveCodemodeIntervals(): void {
  for (const state of activeStates) {
    if (state.interval) {
      clearInterval(state.interval);
      state.interval = undefined;
    }
  }
  activeStates.clear();
}

/**
 * Format a duration in milliseconds: `<X>ms` under a second, `<X.X>s`
 * otherwise (the native codemode renderer's format).
 */
export function formatCodemodeDuration(ms: number | undefined): string {
  if (ms === undefined) return "";
  if (ms < 0) ms = 0;
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Cents for larger amounts, two significant digits for the fractions of a
 * cent classifier calls cost (the native renderer's format).
 */
export function formatCost(cost: number): string {
  return `$${cost >= 0.01 ? cost.toFixed(2) : cost.toPrecision(2)}`;
}

/**
 * Status glyph for a nested tool call.
 */
function statusIcon(
  status: CodemodeNestedCall["status"],
  theme: Theme,
): string {
  switch (status) {
    case "running":
      return theme.fg("warning", "…");
    case "ok":
      return theme.fg("success", "✓");
    case "error":
      return theme.fg("error", "✗");
    case "cancelled":
      return theme.fg("muted", "⊘");
  }
}

/**
 * One nested tool call row:
 * `<glyph> <name> <args> <duration> <cost>` — args truncated to
 * COLLAPSED_CALL_ARGS_CHARS when not expanded; an expanded failed call
 * appends its error text indented below.
 */
export function formatNestedCall(
  call: CodemodeNestedCall,
  theme: Theme,
  expanded: boolean,
): string {
  const args =
    !expanded && call.args.length > COLLAPSED_CALL_ARGS_CHARS
      ? `${call.args.slice(0, COLLAPSED_CALL_ARGS_CHARS - 3)}...`
      : call.args;
  let line = `${statusIcon(call.status, theme)} ${theme.fg("toolTitle", call.name)}`;
  if (args) line += ` ${theme.fg("muted", args)}`;
  const duration = formatCodemodeDuration(call.durationMs);
  if (duration) line += ` ${theme.fg("dim", duration)}`;
  if (call.cost) line += ` ${theme.fg("dim", formatCost(call.cost))}`;
  if (expanded && call.error) {
    line += `\n    ${theme.fg("error", call.error.split("\n").join("\n    "))}`;
  }
  return line;
}

/**
 * The script output as display text: text blocks joined, the executor's
 * "Script completed/failed" header dropped, and a fallback indicator line
 * for image blocks that cannot be shown inline.
 */
export function getCodemodeOutput(
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
): string {
  const textBlocks = content.filter(
    (b) => b.type === "text" && typeof b.text === "string",
  );
  const [first, ...rest] = textBlocks;
  const hasHeader = first !== undefined && SCRIPT_HEADER.test(first.text!);
  const text = (hasHeader ? rest : textBlocks).map((b) => b.text!).join("\n");
  // The renderer is text-only: image blocks are never rendered as images,
  // so they ALWAYS get a fallback indicator (mime + dimensions when known),
  // regardless of the terminal's inline-image support.
  const imageBlocks = content.filter((b) => b.type === "image");
  if (imageBlocks.length > 0) {
    const indicators = imageBlocks
      .map((img) => {
        const mimeType = img.mimeType ?? "image/unknown";
        const dims =
          img.data && img.mimeType
            ? (getImageDimensions(img.data, img.mimeType) ?? undefined)
            : undefined;
        return imageFallback(mimeType, dims);
      })
      .join("\n");
    return text ? `${text}\n${indicators}` : indicators;
  }
  return text;
}

/**
 * Keep the row's own clock for the live `Elapsed` count: start on the first
 * render after execution began, stop the repaint when the result settles (or
 * errors). The interval lives on the row's own state — pi's rows do the same —
 * and there is no module-level registry of live rows to sweep on shutdown.
 *
 * `isPartial` means "still in flight": the CALL renderer passes `true`
 * (a call is in flight until its result settles) — passing `false` there
 * would record `endedAt` at call-render time and freeze the count for the rest
 * of the script. The interval is (re)created only while the result has not
 * settled yet (`endedAt === undefined`), so a re-render of a settled call never
 * spawns a permanent interval.
 */
function updateTiming(
  ctx: {
    executionStarted?: boolean;
    isError?: boolean;
    state?: CodemodeRendererState;
    invalidate?: () => void;
  } | undefined,
  isPartial: boolean,
): void {
  const state: CodemodeRendererState = ctx?.state ?? {};
  if (ctx && !ctx.state) ctx.state = state;

  if ((ctx?.executionStarted || isPartial) && state.startedAt === undefined) {
    state.startedAt = Date.now();
  }

  const settled = !isPartial || ctx?.isError === true;
  if (isPartial && !state.interval && state.endedAt === undefined && ctx?.invalidate) {
    state.interval = setInterval(() => {
      ctx.invalidate?.();
    }, 1000);
  }
  if (settled) {
    state.endedAt ??= Date.now();
    if (state.interval) {
      clearInterval(state.interval);
      state.interval = undefined;
    }
  }
}

/**
 * Render the codemode tool call: the bold `codemode` header. Collapsed, the
 * header stands alone — the script (syntax-highlighted) shows when expanded.
 */
export function renderCodemodeCall(
  args: unknown,
  theme: Theme,
  context: unknown,
): Component {
  const ctx = context as {
    executionStarted?: boolean;
    state?: CodemodeRendererState;
    args?: { code?: string };
  } | undefined;

  // The call is in flight until its result settles — pass `true` so the
  // timer is not finalized at call-render time (see updateTiming).
  updateTiming(ctx, true);

  // Native semantics: a missing or empty `code` renders the header alone;
  // a present-but-non-string `code` renders the invalid-arg marker.
  const rawCode =
    (args as { code?: unknown } | undefined)?.code ?? ctx?.args?.code;
  let code: string | null;
  if (typeof rawCode === "string") {
    code = rawCode;
  } else if (rawCode === undefined || rawCode === null) {
    code = "";
  } else {
    code = null;
  }

  const container = new Container();
  const title = renderToolHeader("codemode", undefined, theme);

  if (code === null) {
    container.addChild(new Text(`${title} ${theme.fg("error", "[invalid arg]")}`, 0, 0));
    return container;
  }

  container.addChild(new Text(title, 0, 0));

  // Empty script: header alone (the native renderer's behavior).
  if (code.length === 0) return container;

  // Collapsed: header alone — the script is the expandable detail.
  if (!(context as { expanded?: boolean }).expanded) return container;

  // The `// @options:` line is part of the script, so options show as-is.
  const highlighted = highlightCode(
    code.replace(/\t/g, "   ").replace(/\r/g, "").trimEnd(),
    "javascript",
  ).join("\n");
  container.addChild(new Text(highlighted, 0, 0));
  return container;
}

/**
 * Render the codemode tool result.
 *
 * Collapsed: the nested tool calls (last 5, args truncated) — the script's
 * activity at a glance, no summary line. A script that made no calls falls
 * back to one `<glyph> <duration>` line so its outcome is still visible.
 * Expanded: every nested call (with per-call status, duration, and model
 * cost), the script output without the executor's header, the full-output
 * path when truncated, and the timing + status.
 */
export function renderCodemodeResult(
  result: unknown,
  options: { expanded?: boolean; isPartial?: boolean },
  theme: Theme,
  context: unknown,
): Component {
  const ctx = context as {
    executionStarted?: boolean;
    isError?: boolean;
    durationMs?: number | undefined;
    state?: CodemodeRendererState;
    invalidate?: () => void;
  } | undefined;

  updateTiming(ctx, Boolean(options.isPartial));

  const res = result as {
    content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    details?: CodemodeToolDetails;
  } | undefined;
  const content = Array.isArray(res?.content) ? res.content : [];
  const calls = res?.details?.calls ?? [];
  const isError = Boolean(ctx?.isError);

  // The duration the script recorded wins over the row's own clock, so a
  // reloaded session still says how long the script took.
  const timing = toolRowDuration(
    {
      durationMs: ctx?.durationMs,
      startedAt: ctx?.state?.startedAt,
      endedAt: ctx?.state?.endedAt,
    },
    { isPartial: Boolean(options.isPartial), isError },
  );
  const durationMs = timing?.ms;

  const container = new Container();

  // Collapsed view.
  if (!options.expanded) {
    if (calls.length > 0) {
      const shown = calls.slice(-COLLAPSED_CALL_COUNT);
      const callLines = shown.map((call) => formatNestedCall(call, theme, false));
      if (shown.length < calls.length) {
        callLines.unshift(
          theme.fg(
            "muted",
            `... (${calls.length - shown.length} earlier calls, ctrl+o to expand)`,
          ),
        );
      }
      // A failure must never be hidden behind success glyphs: when the
      // script failed after successful calls, append the failure marker.
      if (!options.isPartial && isError) {
        callLines.push(theme.fg("error", "✗ Script failed"));
      }
      container.addChild(new Text(callLines.join("\n"), 0, 0));
    } else {
      // No calls: a single status line so the script's outcome is visible.
      const glyph = options.isPartial
        ? theme.fg("warning", "▸")
        : isError
          ? theme.fg("error", "✗")
          : theme.fg("success", "✓");
      const duration = formatCodemodeDuration(durationMs);
      container.addChild(new Text(`${glyph} ${theme.fg("muted", duration)}`, 0, 0));
    }
    return container;
  }

  // Expanded view.
  const parts: string[] = [];

  if (calls.length > 0) {
    const lines = calls.map((call) => formatNestedCall(call, theme, true));
    const priced = calls.filter((call) => call.cost);
    if (priced.length > 1) {
      const total = priced.reduce((sum, call) => sum + (call.cost ?? 0), 0);
      lines.push(theme.fg("muted", `Model calls: ${formatCost(total)}`));
    }
    parts.push(lines.join("\n"));
  }

  if (!options.isPartial) {
    const output = getCodemodeOutput(content).trim();
    if (output.length > 0) {
      const color = isError ? "error" : "toolOutput";
      parts.push(
        output.split("\n").map((line) => theme.fg(color, line)).join("\n"),
      );
    }
    if (res?.details?.fullOutputPath) {
      parts.push(theme.fg("muted", `Full output: ${res.details.fullOutputPath}`));
    }
  }

  if (durationMs !== undefined) {
    parts.push(
      theme.fg("muted", `${timing!.label} ${formatCodemodeDuration(durationMs)}`),
    );
  }

  if (!options.isPartial) {
    parts.push(
      isError
        ? theme.fg("error", "✗ Script failed")
        : theme.fg("success", "✓ Done"),
    );
  }

  if (parts.length > 0) {
    container.addChild(new Text(parts.join("\n\n"), 0, 0));
  }
  return container;
}
