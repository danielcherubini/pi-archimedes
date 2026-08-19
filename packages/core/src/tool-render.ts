/**
 * Shared tool-row rendering helpers.
 *
 * Archimedes tools (mcp, todo, …) render a consistent two-part row:
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
