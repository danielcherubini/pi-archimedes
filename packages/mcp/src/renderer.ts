import { Text } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";

import type { Theme } from "@earendil-works/pi-coding-agent";

import { renderToolHeader, renderStatusLabel } from "@pi-archimedes/core/tool-render";

// Local aliases — the real ToolRenderContext has many more fields but we
// only use these in the renderer. Using a local type avoids over-constraining
// signatures and keeps the renderer tolerant of older pi versions (missing
// fields simply read as undefined). Exported so the registration wiring can
// cast pi's untyped context to the same loose shape.
export type RenderContext = {
  lastComponent?: Component;
  isError?: boolean;
  expanded?: boolean;
  isPartial?: boolean;
  argsComplete?: boolean;
  executionStarted?: boolean;
  args?: unknown;
  state?: Record<string, unknown>;
};

type ToolResult = {
  content: Array<{ type: string; text?: string }>;
  details?: Record<string, unknown>;
};

type RenderOptions = { expanded?: boolean; isPartial?: boolean };

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract server name from a tool name (first segment before "_").
 * e.g. "atlassian_searchJiraIssuesUsingJql" → "atlassian"
 * Falls back to the full name if no underscore.
 */
export function extractServerName(toolName: string): string {
  const idx = toolName.indexOf("_");
  return idx === -1 ? toolName : toolName.slice(0, idx);
}

/**
 * Get the server label for the mcp proxy call header.
 * Uses args.server if provided, otherwise extracts from args.tool.
 * Falls back to a generic action word for non-tool calls.
 */
export function formatProxyCallServer(args: {
  tool?: string;
  search?: string;
  describe?: string;
  connect?: string;
  server?: string;
  action?: string;
}): string {
  if (args.tool) return extractServerName(args.tool);
  if (args.server) return args.server;
  if (args.search) return `search`;
  if (args.describe) return `describe`;
  if (args.connect) return `connect`;
  if (args.action) return args.action;
  return "status";
}

/**
 * Render the mcp proxy tool call row.
 *
 * Line 1: `mcp` (bold toolTitle) + server name (accent)
 *
 * Never throws.
 */
export function renderProxyCall(
  args: Record<string, unknown>,
  theme: Theme,
  context: RenderContext,
): Component {
  const text = reuseText(context);
  try {
    const server = formatProxyCallServer(
      args as Parameters<typeof formatProxyCallServer>[0],
    );
    text.setText(renderToolHeader("mcp", server, theme));
  } catch {
    try {
      text.setText("mcp");
    } catch {
      // keep whatever the component last rendered
    }
  }
  return text;
}

/**
 * Render the mcp proxy tool result row.
 *
 * - isPartial (streaming partial, defensive): ▸ tool name muted
 * - collapsed (default): ▸/✓/✗ + full tool name (muted/success/error)
 * - expanded: nested args as dim JSON + full result text
 *
 * Never throws.
 */
export function renderProxyResult(
  result: ToolResult,
  options: RenderOptions,
  theme: Theme,
  context: RenderContext,
): Component {
  const args = isPlainObject(context.args) ? context.args : null;
  const toolName = (args?.["tool"] as string | undefined) ?? "mcp";
  const expandedArgs = args ? args["args"] : undefined;
  return renderStatusLine(result, options, theme, context, toolName, expandedArgs);
}

/**
 * Render a direct tool call row (e.g. atlassian_searchJiraIssuesUsingJql).
 *
 * Line 1: `mcp` (bold toolTitle) + server name (accent)
 *
 * Never throws.
 */
export function renderDirectCall(
  displayName: string,
  args: Record<string, unknown>,
  theme: Theme,
  context: RenderContext,
): Component {
  const text = reuseText(context);
  try {
    const server = extractServerName(displayName);
    text.setText(renderToolHeader("mcp", server, theme));
  } catch {
    try {
      text.setText(`mcp ${displayName}`);
    } catch {
      // keep whatever the component last rendered
    }
  }
  return text;
}

/**
 * Render a direct tool result row.
 * ▸/✓/✗ + full display name (muted/success/error)
 */
export function renderDirectResult(
  displayName: string,
  result: ToolResult,
  options: RenderOptions,
  theme: Theme,
  context: RenderContext,
): Component {
  const args = isPlainObject(context.args) ? context.args : null;
  return renderStatusLine(result, options, theme, context, displayName, args);
}

// ── Shared renderer core ─────────────────────────────────────────────────────

/**
 * Render the result row as:
 *   ▸ toolName   (muted, while partial/running)
 *   ✓ toolName   (success, green)
 *   ✗ toolName   (error, red)
 * When expanded: dim JSON args block + full result text.
 */
function renderStatusLine(
  result: ToolResult,
  options: RenderOptions,
  theme: Theme,
  context: RenderContext,
  toolName: string,
  expandedArgs: unknown,
): Component {
  const text = reuseText(context);
  try {
    const expanded = options.expanded ?? context.expanded ?? false;

    if (expanded) {
      const parts: string[] = [];
      if (expandedArgs !== undefined && expandedArgs !== null) {
        const block = formatArgs(expandedArgs, 1200);
        if (block) parts.push(theme.fg("dim", block));
      }
      const lines = result.content
        .filter((b) => b.type === "text")
        .flatMap((b) => (b.text ?? "").split("\n"));
      const token = context.isError ? "error" : "toolOutput";
      parts.push(
        lines.length === 0
          ? theme.fg("muted", "(empty result)")
          : lines.map((l) => theme.fg(token, l)).join("\n"),
      );
      text.setText(parts.join("\n\n"));
      return text;
    }

    if (options.isPartial) {
      text.setText(renderStatusLabel("running", toolName, theme));
      return text;
    }

    text.setText(
      renderStatusLabel(context.isError ? "error" : "success", toolName, theme),
    );
  } catch {
    try {
      text.setText("");
    } catch {
      // keep whatever the component last rendered
    }
  }
  return text;
}

// ── Private helpers ──────────────────────────────────────────────────────────

function reuseText(context: RenderContext): Text {
  return (context.lastComponent instanceof Text
    ? context.lastComponent
    : new Text("", 0, 0)) as Text;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

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
