/**
 * Shared tool-row rendering helpers.
 *
 * Archimedes tools (todo, …) render a consistent two-part row:
 *
 *   line 1 (header):  <toolName> (blue bold) + <action> (orange accent)
 *   result line:      <glyph> <label>  — glyph reflects run status:
 *                       ▸ running (muted) · ✓ success (green) · ✗ error (red)
 *                     the label is muted so the glyph carries the colour.
 *
 * These helpers are pure (no TUI component imports) so they stay directly
 * unit-testable and can be reused across packages. Callers wrap the returned
 * string in whatever component they use (typically a pi-tui Text).
 */

import type { ThemeColor } from "@earendil-works/pi-coding-agent";

/** Run status of a settled/in-flight tool row. */
export type ToolStatus = "running" | "success" | "error";

/** Glyph shown before the result label, keyed by status. */
export const STATUS_GLYPH: Record<ToolStatus, string> = {
  running: "▸",
  success: "✓",
  error: "✗",
};

/** Theme color token used to colour each status glyph. */
const STATUS_TOKEN: Record<ToolStatus, ThemeColor> = {
  running: "muted",
  success: "success",
  error: "error",
};

/**
 * The subset of a pi Theme these helpers need. Typed with pi's ThemeColor so
 * pi's real Theme is assignable (parameter contravariance: a fn requiring the
 * wider string token would NOT accept a Theme whose fg only takes ThemeColor).
 */
export type ToolRenderTheme = {
  fg: (token: ThemeColor, text: string) => string;
  bold: (text: string) => string;
};

/**
 * Render the tool header line:
 *   <toolName> (toolTitle, bold) + " " + <action> (accent)
 *
 * When action is empty/undefined only the tool name is rendered.
 */
export function renderToolHeader(
  toolName: string,
  action: string | undefined,
  theme: ToolRenderTheme,
): string {
  const name = theme.fg("toolTitle", theme.bold(toolName));
  if (!action) return name;
  return name + " " + theme.fg("accent", action);
}

/**
 * Render a status result line:
 *   <glyph> (status-coloured) + <label> (muted)
 *
 * e.g. "✓ atlassian_searchJiraIssuesUsingJql" or "▸ 2/4 completed".
 */
export function renderStatusLabel(
  status: ToolStatus,
  label: string,
  theme: ToolRenderTheme,
): string {
  return (
    theme.fg(STATUS_TOKEN[status], STATUS_GLYPH[status] + " ") +
    theme.fg("muted", label)
  );
}

/**
 * Render a tool-call line with a status glyph, a status-coloured name, and an
 * optional dim args/suffix fragment:
 *
 *   <glyph> (status-coloured) + <name> (status-coloured) + <suffix> (dim)
 *
 * e.g. "✓ read: /path/to/file" (green glyph+name, dim ": /path...") or
 *      "▸ grep: pattern" (muted glyph+name while running).
 *
 * The name shares the glyph's colour (unlike renderStatusLabel, which mutes
 * the label) so a completed call reads as a single green/red unit. The suffix
 * is passed pre-formatted (e.g. ": args" or ": args | 2s") and rendered dim.
 */
export function renderToolCallLine(
  status: ToolStatus,
  name: string,
  suffix: string,
  theme: ToolRenderTheme,
): string {
  const token = STATUS_TOKEN[status];
  const head =
    theme.fg(token, STATUS_GLYPH[status] + " ") + theme.fg(token, name);
  return suffix ? head + theme.fg("dim", suffix) : head;
}

/** What a row knows about how long its tool took. */
export interface ToolRowTiming {
  /** Milliseconds the tool recorded on its final result, if it recorded any. */
  durationMs?: number | undefined;
  /** When this row first saw the call running, from the row's own clock. */
  startedAt?: number | undefined;
  /** When the row saw the call settle, from the row's own clock. */
  endedAt?: number | undefined;
}

/** The timing line of a tool row: which word to use, and how long to show. */
export interface ToolRowDuration {
  label: "Elapsed" | "Took";
  ms: number;
}

/**
 * The duration line a tool row shows, following pi's own rows:
 *
 * - A settled result carries `durationMs`, measured by the tool. That number
 *   wins, because it is monotonic, it excludes whatever the row was doing
 *   between the call and the paint, and it is still there when the session is
 *   reloaded and the row's own clock is gone.
 * - While the result is still partial the row counts from its own clock
 *   (`Elapsed`).
 * - A settled result that recorded no duration falls back to the row's clock.
 * - A row that never saw the call start and recorded nothing says nothing.
 *
 * `isError` finalises the row: a failed call is not still running, whatever the
 * partial flag says.
 */
export function toolRowDuration(
  timing: ToolRowTiming,
  options: { isPartial: boolean; isError?: boolean },
): ToolRowDuration | undefined {
  const settled = !options.isPartial || options.isError === true;
  if (settled && typeof timing.durationMs === "number") {
    return { label: "Took", ms: Math.max(0, timing.durationMs) };
  }
  if (timing.startedAt === undefined) return undefined;
  const end = timing.endedAt ?? Date.now();
  return { label: settled ? "Took" : "Elapsed", ms: Math.max(0, end - timing.startedAt) };
}
