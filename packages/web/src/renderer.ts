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
    const params = args as { query?: string; queries?: string[] };
    const query = params.queries?.[0] ?? params.query ?? "unknown";
    return new Text(renderToolHeader("web_search", query, theme), 0, 0);
  } catch {
    return new Text("web_search error", 0, 0);
  }
}

export function renderWebSearchResult(result: unknown, options: { expanded?: boolean; isPartial?: boolean }, theme: Theme, context?: unknown): Text {
  try {
    const details = (result as { details?: any })?.details;
    if (!details) return new Text(renderStatusLabel("error", "No details", theme), 0, 0);
    
    if (details.error) return new Text(renderStatusLabel("error", details.error, theme), 0, 0);

    const label = `${details.resultCount ?? 0} results (${details.provider ?? "unknown"})`;
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
    const details = (result as { details?: any })?.details;
    if (!details) return new Text(renderStatusLabel("error", "No details", theme), 0, 0);
    if (details.error) return new Text(renderStatusLabel("error", details.error, theme), 0, 0);
    
    const label = `${details.status ?? 200} | ${details.title ?? "Untitled"} (${details.wordCount ?? 0} words)`;
    return new Text(renderStatusLabel("success", label, theme), 0, 0);
  } catch {
    return new Text("result error", 0, 0);
  }
}

export function renderGetSearchContentCall(args: unknown, theme: Theme, context?: unknown): Text {
  try {
    const id = (args as { responseId?: string })?.responseId ?? "unknown";
    return new Text(renderToolHeader("get_search_content", id, theme), 0, 0);
  } catch {
    return new Text("get_search_content error", 0, 0);
  }
}

export function renderGetSearchContentResult(result: unknown, options: { expanded?: boolean; isPartial?: boolean }, theme: Theme, context?: unknown): Text {
  try {
    const details = (result as { details?: any })?.details;
    if (!details) return new Text(renderStatusLabel("error", "No details", theme), 0, 0);
    
    let label = "Content retrieved";
    if (details.matches) {
        label = `Found ${details.matches.length} passages`;
    } else if (details.content) {
        label = `${details.content.length} characters`;
    }
    
    return new Text(renderStatusLabel("success", label, theme), 0, 0);
  } catch {
    return new Text("result error", 0, 0);
  }
}
