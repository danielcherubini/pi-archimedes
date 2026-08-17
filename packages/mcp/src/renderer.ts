import { Text } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";

import type { Theme } from "@earendil-works/pi-coding-agent";

// Local aliases — the real ToolRenderContext has many more fields
// but we only use these in the renderer. Using a local type avoids
// over-constraining signatures.
type RenderContext = {
  lastComponent?: Component;
  isError?: boolean;
  expanded?: boolean;
  isPartial?: boolean;
  state?: Record<string, unknown>;
};

type ToolResult = {
  content: Array<{ type: string; text?: string }>;
  details?: Record<string, unknown>;
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Format the mcp proxy tool call header line.
 *
 * Maps the args to a human-readable action string like:
 *   "call atlassian_searchJiraIssuesUsingJql"
 *   "search jira"
 *   "describe tool_name"
 *   "status"
 */
export function formatProxyCallTitle(args: {
  tool?: string;
  args?: unknown;
  search?: string;
  describe?: string;
  connect?: string;
  server?: string;
  action?: string;
}): string {
  if (args.tool) {
    const target = args.server ? `${args.tool} @ ${args.server}` : args.tool;
    return `call ${target}`;
  }
  if (args.search) {
    return `search ${args.search}${args.server ? ` @ ${args.server}` : ""}`;
  }
  if (args.describe) return `describe ${args.describe}`;
  if (args.connect) return `connect ${args.connect}`;
  if (args.action) return args.action;
  if (args.server) return `list ${args.server}`;
  return "status";
}

/**
 * Render the mcp proxy tool call row.
 *
 * Line 1: `mcp` (bold cyan) + action (orange)
 * Line 2 (optional): formatted args in muted
 */
export function renderProxyCall(
  args: Record<string, unknown>,
  theme: Theme,
  context: RenderContext,
): Component {
  const text = (context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0)) as Text;

  const action = formatProxyCallTitle(
    args as Parameters<typeof formatProxyCallTitle>[0],
  );
  const argsStr = args.args
    ? "\n" + theme.fg("muted", formatArgs(args.args, 1200))
    : "";

  text.setText(
    theme.fg("toolTitle", theme.bold("mcp")) +
      " " +
      theme.fg("accent", action) +
      argsStr,
  );
  return text;
}

/**
 * Render the mcp proxy tool result row.
 *
 * - isPartial: shows "Running…" in warning colour
 * - isError: shows error content in error colour
 * - normal: shows up to 3 lines (collapsed) or all lines (expanded),
 *   with a truncation hint when collapsed
 * - empty content: shows "(empty result)" in muted
 */
export function renderProxyResult(
  result: ToolResult,
  options: { expanded?: boolean; isPartial?: boolean },
  theme: Theme,
  context: RenderContext,
  maxCollapsedLines: number = 3,
): Component {
  const text = (context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0)) as Text;

  // Running state
  if (options.isPartial) {
    text.setText(theme.fg("warning", "Running…"));
    return text;
  }

  // Error state
  if (context.isError) {
    const errText = result.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n")
      .slice(0, 2000);
    text.setText(theme.fg("error", errText || "Error"));
    return text;
  }

  // Normal output
  const lines = result.content
    .filter((b) => b.type === "text")
    .flatMap((b) => (b.text ?? "").split("\n"));

  if (lines.length === 0) {
    text.setText(theme.fg("muted", "(empty result)"));
    return text;
  }

  const expanded = options.expanded ?? context.expanded ?? false;
  const maxLines = expanded ? lines.length : maxCollapsedLines;
  const shown = lines.slice(0, maxLines);
  const truncated = lines.length > maxLines;

  let out = shown.map((l) => theme.fg("toolOutput", l)).join("\n");
  if (truncated) {
    out +=
      "\n" +
      theme.fg(
        "dim",
        `… ${lines.length - maxLines} more lines (Ctrl+O to expand)`,
      );
  }

  text.setText(out);
  return text;
}

/**
 * Render a direct tool call row (e.g. atlassian_searchJiraIssuesUsingJql).
 *
 * Splits displayName at the first `_` to produce two-tone colouring:
 *   "atlassian" → toolTitle (bold cyan)
 *   "_searchJiraIssuesUsingJql" → accent (orange)
 *
 * If there is no `_`, uses "mcp" as the prefix and prefixes the whole name.
 */
export function renderDirectCall(
  displayName: string,
  args: Record<string, unknown>,
  theme: Theme,
  context: RenderContext,
): Component {
  const text = (context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0)) as Text;

  const under = displayName.indexOf("_");
  const [prefix, rest] =
    under > 0
      ? [displayName.slice(0, under), displayName.slice(under)]
      : ["mcp", "_" + displayName];

  const hasArgs = Object.keys(args).length > 0;
  const argsStr = hasArgs ? "\n" + theme.fg("muted", formatArgs(args, 1200)) : "";

  text.setText(
    theme.fg("toolTitle", theme.bold(prefix)) +
      theme.fg("accent", rest) +
      argsStr,
  );
  return text;
}

/**
 * Render a direct tool result row — delegates to renderProxyResult since the
 * logic is identical.
 */
export function renderDirectResult(
  result: ToolResult,
  options: { expanded?: boolean; isPartial?: boolean },
  theme: Theme,
  context: RenderContext,
  maxCollapsedLines: number = 3,
): Component {
  return renderProxyResult(result, options, theme, context, maxCollapsedLines);
}

// ── Private helpers ──────────────────────────────────────────────────────────

/**
 * Format args as compact JSON, truncated to maxChars.
 * Strings pass through unchanged; other values are JSON.stringify'd.
 * Truncation appends "…".
 */
function formatArgs(args: unknown, maxChars: number): string {
  try {
    const s =
      typeof args === "string" ? args : JSON.stringify(args, null, 2);
    return s.length > maxChars ? s.slice(0, maxChars) + "…" : s;
  } catch {
    return String(args).slice(0, maxChars);
  }
}
