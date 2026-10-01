import { highlightCode } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Container,
  getCapabilities,
  getImageDimensions,
  imageFallback,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@earendil-works/pi-tui";
import { renderToolHeader } from "@pi-archimedes/core/tool-render";
import type { OutputStyle } from "../config.js";

/**
 * Live output style, refreshed from the config on every session_start
 * (same pattern as tools/patch.ts: the renderers read it per call, so a
 * Full→Compact→Minimal change sticks across /reload without re-registering
 * the tool). `Minimal` is the default collapsed presentation; `Compact`
 * falls back to the native-style collapsed view (script preview + call
 * list + output preview); `Full` auto-expands (via the toolStyle patch),
 * so its collapsed branch is only reached on a manual collapse and shows
 * the Compact presentation.
 */
let liveStyle: OutputStyle = "Minimal";

export function setCodemodeOutputStyle(style: OutputStyle): void {
  liveStyle = style;
}

/** Nested-call args preview budget, collapsed (the native renderer uses 80). */
const COLLAPSED_CALL_ARGS_CHARS = 80;
/** Collapsed call-list budget: Minimal shows the last 5, Compact the last 8. */
const COLLAPSED_CALL_COUNT_MINIMAL = 5;
const COLLAPSED_CALL_COUNT_COMPACT = 8;

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
  showImages: boolean,
): string {
  const textBlocks = content.filter(
    (b) => b.type === "text" && typeof b.text === "string",
  );
  const [first, ...rest] = textBlocks;
  const hasHeader = first !== undefined && SCRIPT_HEADER.test(first.text!);
  const text = (hasHeader ? rest : textBlocks).map((b) => b.text!).join("\n");
  const imageBlocks = content.filter((b) => b.type === "image");
  const caps = getCapabilities();
  if (imageBlocks.length > 0 && (!caps.images || !showImages)) {
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
 * Component that renders text limited to a number of VISUAL lines (wrapped
 * lines, not logical ones — script output is often one long JSON line):
 * the first `maxVisualLines - 1` wrapped lines, then a final line truncated
 * to make room for a `... (N more, hint)` suffix. Re-renders per width, so
 * the preview stays honest when the terminal resizes.
 */
export class PreviewTextComponent implements Component {
  private text: string;

  constructor(
    text: string = "",
    private maxVisualLines: number = 5,
    private hint: (hidden: number) => string = () => "",
  ) {
    this.text = text;
  }

  setText(text: string): void {
    this.text = text;
  }

  getContent(): string {
    return this.text;
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (!this.text) return [" ".repeat(Math.max(0, width))];
    const lines = wrapTextWithAnsi(this.text, width);
    if (lines.length <= this.maxVisualLines) {
      return lines.map((line) => line + " ".repeat(Math.max(0, width - visibleWidth(line))));
    }
    const hidden = lines.length - this.maxVisualLines;
    const hint = truncateToWidth(this.hint(hidden), width, "…", false);
    return [
      ...lines.slice(0, this.maxVisualLines).map((line) => line + " ".repeat(Math.max(0, width - visibleWidth(line)))),
      hint,
    ];
  }
}

/**
 * Track the script's wall clock for the collapsed row: start on the first
 * render after execution began, end when the result settles (or errors).
 * Mirrors the bash renderer's timer lifecycle.
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
  if (isPartial && !state.interval) {
    if (ctx?.invalidate) {
      state.interval = setInterval(() => {
        ctx.invalidate?.();
      }, 1000);
      activeStates.add(state);
    }
  }
  if (!isPartial || ctx?.isError) {
    state.endedAt ??= Date.now();
    if (state.interval) {
      clearInterval(state.interval);
      state.interval = undefined;
    }
    activeStates.delete(state);
  }
}

/**
 * The script's wall time in ms, parsed from the result header when present
 * (more accurate than the renderer's timer, which spans TUI updates).
 */
export function parseWallTimeMs(
  content: Array<{ type: string; text?: string }>,
): number | undefined {
  const first = content[0];
  if (first?.type !== "text" || typeof first.text !== "string") return undefined;
  const match = first.text.match(
    /^Script (completed|failed)\nWall time ([\d.]+) seconds/,
  );
  if (!match) return undefined;
  const seconds = Number.parseFloat(match[2]!);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

/**
 * Render the codemode tool call: the bold `codemode` header. Collapsed,
 * `Minimal` shows the header alone (the script is the expandable detail);
 * `Compact` previews the syntax-highlighted script to 10 visual lines with
 * an expand hint (the native renderer's layout).
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

  updateTiming(ctx, false);

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

  // The `// @options:` line is part of the script, so options show as-is.
  const highlighted = highlightCode(
    code.replace(/\t/g, "   ").replace(/\r/g, "").trimEnd(),
    "javascript",
  ).join("\n");

  const expanded = (context as { expanded?: boolean }).expanded;
  if (expanded) {
    container.addChild(new Text(highlighted, 0, 0));
    return container;
  }
  if (liveStyle === "Minimal") return container;

  // Compact: preview the script to 10 visual lines, with an expand hint.
  container.addChild(
    new PreviewTextComponent(
      highlighted,
      10,
      (hidden) => theme.fg("muted", `... (${hidden} more lines, ctrl+o to expand)`),
    ),
  );
  return container;
}

/**
 * Render the codemode tool result.
 *
 * Collapsed, `Minimal`: the nested tool calls (last 5, args truncated) —
 * the script's activity at a glance, no summary line. A script that made
 * no calls falls back to one `<glyph> <duration>` line so its outcome is
 * still visible. Collapsed, `Compact` (the native renderer's layout): the
 * last 8 calls, a 5-visual-line output preview, and the full-output path
 * when truncated. Expanded: every nested call (with per-call status,
 * duration, and model cost), the script output without the executor's
 * header, the full-output path when truncated, and the timing + status.
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
    state?: CodemodeRendererState;
    showImages?: boolean;
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

  const state: CodemodeRendererState = ctx?.state ?? {};
  const now = Date.now();
  const wallTime = parseWallTimeMs(content);
  const timerMs =
    state.startedAt !== undefined
      ? Math.max(0, (state.endedAt ?? now) - state.startedAt)
      : undefined;
  const durationMs = wallTime ?? timerMs;

  const container = new Container();

  // Collapsed view, by style.
  if (!options.expanded) {
    const budget = liveStyle === "Minimal" ? COLLAPSED_CALL_COUNT_MINIMAL : COLLAPSED_CALL_COUNT_COMPACT;
    if (calls.length > 0) {
      const shown = calls.slice(-budget);
      const lines = shown.map((call) => formatNestedCall(call, theme, false));
      if (shown.length < calls.length) {
        lines.unshift(
          theme.fg(
            "muted",
            `... (${calls.length - shown.length} earlier calls, ctrl+o to expand)`,
          ),
        );
      }
      container.addChild(new Text(lines.join("\n"), 0, 0));
    } else if (liveStyle === "Minimal") {
      // No calls: a single status line so the script's outcome is visible.
      const glyph = options.isPartial
        ? theme.fg("warning", "▸")
        : isError
          ? theme.fg("error", "✗")
          : theme.fg("success", "✓");
      const duration = formatCodemodeDuration(durationMs);
      container.addChild(new Text(`${glyph} ${theme.fg("muted", duration)}`, 0, 0));
    }

    // Compact: a short output preview (Minimal keeps the row minimal).
    if (liveStyle !== "Minimal" && !options.isPartial) {
      const output = getCodemodeOutput(content, ctx?.showImages ?? true).trim();
      if (output.length > 0) {
        const color = isError ? "error" : "toolOutput";
        const styled = output
          .split("\n")
          .map((line) => theme.fg(color, line))
          .join("\n");
        container.addChild(
          new PreviewTextComponent(
            styled,
            5,
            (hidden) => theme.fg("muted", `... (${hidden} more lines, ctrl+o to expand)`),
          ),
        );
        if (res?.details?.fullOutputPath) {
          container.addChild(
            new Text(theme.fg("muted", `Full output: ${res.details.fullOutputPath}`), 0, 0),
          );
        }
      }
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
    const output = getCodemodeOutput(content, ctx?.showImages ?? true).trim();
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
    const label = options.isPartial ? "Elapsed" : "Took";
    parts.push(
      theme.fg("muted", `${label} ${formatCodemodeDuration(durationMs)}`),
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
