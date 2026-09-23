import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { renderToolHeader, renderStatusLabel } from "@pi-archimedes/core/tool-render";

export function reuseText(context?: unknown): Text {
  return (context && typeof context === "object" && "lastComponent" in context && (context as { lastComponent?: unknown }).lastComponent instanceof Text
    ? (context as { lastComponent: Text }).lastComponent
    : new Text("", 0, 0));
}

export function sanitizeStatus(text: string): string {
  return text.replace(/[\n\t\r\x00-\x1F\x7F]/g, ' ').trim();
}

export function renderWebSearchCall(args: unknown, theme: Theme, context?: unknown): Text {
  try {
    const query = (args as { query?: string })?.query ?? "unknown";
    return new Text(renderToolHeader("web_search", query, theme), 0, 0);
  } catch {
    return new Text("web_search error", 0, 0);
  }
}

export function renderWebSearchResult(result: unknown, options: { expanded?: boolean; isPartial?: boolean }, theme: Theme, context?: unknown): Text {
  try {
    const label = sanitizeStatus("5 results (brave)");
    return new Text(renderStatusLabel("success", label, theme), 0, 0);
  } catch {
    return new Text("result error", 0, 0);
  }
}

export function renderFetchContentCall(args: unknown, theme: Theme, context?: unknown): Text {
  try {
    const url = (args as { url?: string })?.url ?? "unknown";
    return new Text(renderToolHeader("fetch_content", url, theme), 0, 0);
  } catch {
    return new Text("fetch_content error", 0, 0);
  }
}

export function renderFetchContentResult(result: unknown, options: { expanded?: boolean; isPartial?: boolean }, theme: Theme, context?: unknown): Text {
  try {
    return new Text(renderStatusLabel("success", "200 OK", theme), 0, 0);
  } catch {
    return new Text("result error", 0, 0);
  }
}

export function renderGetSearchContentCall(args: unknown, theme: Theme, context?: unknown): Text {
  try {
    return new Text(renderToolHeader("get_search_content", "query", theme), 0, 0);
  } catch {
    return new Text("get_search_content error", 0, 0);
  }
}

export function renderGetSearchContentResult(result: unknown, options: { expanded?: boolean; isPartial?: boolean }, theme: Theme, context?: unknown): Text {
  try {
    return new Text(renderStatusLabel("success", "Found passages", theme), 0, 0);
  } catch {
    return new Text("result error", 0, 0);
  }
}
