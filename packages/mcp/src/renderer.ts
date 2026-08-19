import { Text } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";

import type { Theme } from "@earendil-works/pi-coding-agent";

import {
  formatSummaryLine,
  pickKeyArg,
  type KeyArg,
  type SummaryState,
} from "./call-summary.js";

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
 * Render the mcp proxy tool call row (compact, ≤2 lines).
 *
 * Line 1: `mcp` (bold toolTitle) + action word (accent)
 * Line 2 (running only, when the nested args object has a key arg):
 *        → key: value, muted, no hint
 *
 * While the result is pending, the summary line renders here; once the result
 * is delivered (isPartial flips to false) the call row drops it and the result
 * row renders it in its settled colour. When args are still streaming
 * (argsComplete === false) only the header shows, to avoid flicker on partial
 * args. Never throws.
 */
export function renderProxyCall(
  args: Record<string, unknown>,
  theme: Theme,
  context: RenderContext,
): Component {
  const text = reuseText(context);
  try {
    const action = formatProxyCallTitle(
      args as Parameters<typeof formatProxyCallTitle>[0],
    );
    const header =
      theme.fg("toolTitle", theme.bold("mcp")) +
      " " +
      theme.fg("accent", action);
    const summary = proxyCallSummary(args, theme, context);
    text.setText(summary ? header + "\n" + summary : header);
  } catch {
    // Renderers must never throw — pi drops a throwing renderer back to
    // stock rendering. Degrade to a plain, unstyled header.
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
 * - isPartial (streaming partial, defensive): running-state summary line only
 * - collapsed (default): the key-arg summary line in its settled colour
 *   (success/error) + "(ctrl+o)" hint — no result content. Result text is
 *   hidden until expanded (ctrl+o).
 * - expanded: the nested args (args.args only) as dim JSON, a blank line,
 *   then the full result text — error-coloured when isError.
 *
 * An empty result here is intentional: pi hands the row back to the call row's
 * header, so the row stays visible. Never throws.
 */
export function renderProxyResult(
  result: ToolResult,
  options: RenderOptions,
  theme: Theme,
  context: RenderContext,
): Component {
  const args = isPlainObject(context.args) ? context.args : null;
  const nested = args ? nestedArgs(context.args) : null;
  return renderSettledOrExpanded(result, options, theme, context, {
    keyArg: nested ? pickKeyArg(nested) : null,
    // Gateway: only the nested args (string or object) — matches the old
    // call renderer, which surfaced args.args and nothing else.
    expandedArgs: args ? args["args"] : undefined,
    mode: "proxy",
  });
}

/**
 * Render a direct tool call row (e.g. postgres_describe_table) —
 * compact, ≤2 lines.
 *
 * Line 1: `mcp` (bold toolTitle) + full tool name (accent)
 * Line 2 (running only, when a key arg exists): → key: value, muted, no hint
 *
 * No JSON args block in the call row — args surface in the expanded result.
 * See renderProxyCall for the settled/flipping rules. Never throws.
 */
export function renderDirectCall(
  displayName: string,
  args: Record<string, unknown>,
  theme: Theme,
  context: RenderContext,
): Component {
  const text = reuseText(context);
  try {
    const header =
      theme.fg("toolTitle", theme.bold("mcp")) +
      " " +
      theme.fg("accent", displayName);
    let summary = "";
    if (!isSettled(context) && context.argsComplete !== false) {
      summary = formatSummaryLine(pickKeyArg(args), "running", theme);
    }
    text.setText(summary ? header + "\n" + summary : header);
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
 * Render a direct tool result row — see renderProxyResult for the contract.
 * The key arg and the expanded args block come from the full call args.
 */
export function renderDirectResult(
  result: ToolResult,
  options: RenderOptions,
  theme: Theme,
  context: RenderContext,
): Component {
  const args = isPlainObject(context.args) ? context.args : null;
  return renderSettledOrExpanded(result, options, theme, context, {
    keyArg: args ? pickKeyArg(args) : null,
    expandedArgs: args,
    mode: "direct",
  });
}

// ── Shared renderer core ─────────────────────────────────────────────────────

/**
 * pi re-invokes BOTH renderers on every update of the row (tool-execution.js
 * updateDisplay): the call renderer first, then the result renderer once a
 * result exists. For our non-streaming tools the component only flips
 * isPartial to false inside the same updateResult() call that stores the
 * final result (verified against pi 0.84.2), so `isPartial === false` is a
 * reliable "settled" signal for renderCall — and undefined (older pi) counts
 * as not settled yet.
 */
function isSettled(context: RenderContext): boolean {
  return context.isPartial === false;
}

function proxyCallSummary(
  args: Record<string, unknown>,
  theme: Theme,
  context: RenderContext,
): string {
  if (isSettled(context)) return "";
  if (context.argsComplete === false) return "";
  const nested = nestedArgs(args);
  return nested === null ? "" : formatSummaryLine(pickKeyArg(nested), "running", theme);
}

/** Core for both result renderers — see renderProxyResult for the contract. */
function renderSettledOrExpanded(
  result: ToolResult,
  options: RenderOptions,
  theme: Theme,
  context: RenderContext,
  input: {
    keyArg: KeyArg | null;
    expandedArgs: unknown;
    mode: "direct" | "proxy";
  },
): Component {
  const text = reuseText(context);
  try {
    // Streaming partial (defensive — our tools are non-streaming): keep the
    // running-state summary line, no content, no hint.
    if (options.isPartial) {
      text.setText(formatSummaryLine(input.keyArg, "running", theme));
      return text;
    }

    const expanded = options.expanded ?? context.expanded ?? false;

    if (!expanded) {
      const state: SummaryState = context.isError ? "error" : "success";
      // "" (no key arg) is fine — the empty component renders nothing and
      // the call row's header keeps the row visible.
      text.setText(formatSummaryLine(input.keyArg, state, theme));
      return text;
    }

    const parts: string[] = [];
    const argsBlock = formatExpandedArgs(input, theme);
    if (argsBlock) parts.push(argsBlock);
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
  } catch {
    try {
      text.setText("");
    } catch {
      // keep whatever the component last rendered
    }
  }
  return text;
}

function formatExpandedArgs(
  input: { expandedArgs: unknown; mode: "direct" | "proxy" },
  theme: Theme,
): string {
  const args = input.expandedArgs;
  if (args === undefined || args === null) return "";
  if (input.mode === "direct") {
    // Full call args, only when a non-empty object.
    if (!isPlainObject(args) || Object.keys(args).length === 0) return "";
  } else {
    // Gateway: the nested args value (string or object/array), truthy-only.
    if (typeof args !== "string" && typeof args !== "object") return "";
  }
  const block = formatArgs(args, 1200);
  return block ? theme.fg("dim", block) : "";
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

/** Nested gateway args (args.args) when it is a plain object, else null. */
function nestedArgs(args: unknown): Record<string, unknown> | null {
  if (!isPlainObject(args)) return null;
  const nested = (args as Record<string, unknown>).args;
  return isPlainObject(nested) ? (nested as Record<string, unknown>) : null;
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
