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
    const text = reuseText(context);
    try {
      const params = args as { query?: string; queries?: string[] };
      const query = params.queries?.[0] ?? params.query ?? "unknown";
      text.setText(renderToolHeader("web_search", query, theme));
      return text;
    } catch {
      text.setText("web_search error");
      return text;
    }
}

export function renderWebSearchResult(result: unknown, options: { expanded?: boolean; isPartial?: boolean }, theme: Theme, context?: unknown): Text {
  const text = reuseText(context);
  try {
    const details = (result as { details?: any })?.details;
    if (!details) {
      text.setText(renderStatusLabel("error", sanitizeStatus("No details"), theme));
      return text;
    }
    
    if (details.error) {
      text.setText(renderStatusLabel("error", sanitizeStatus(details.error), theme));
      return text;
    }

    const label = `${details.resultCount ?? 0} results (${details.provider ?? "unknown"})`;
    if (options?.expanded) {
      let output = "";
      for (const res of details.results || []) {
        output += `${theme.fg("accent", res.title)}\n${theme.fg("dim", res.url)}\n${theme.fg("muted", res.snippet)}\n\n`;
      }
      text.setText(output.trim());
    } else {
      text.setText(renderStatusLabel("success", sanitizeStatus(label), theme));
    }
    return text;
  } catch (e) {
    text.setText(renderStatusLabel("error", sanitizeStatus(String(e)), theme));
    return text;
  }
}

export function renderFetchContentCall(args: unknown, theme: Theme, context?: unknown): Text {
  const text = reuseText(context);
  try {
    const url = (args as { url?: string })?.url ?? "unknown";
    text.setText(renderToolHeader("fetch_content", url, theme));
    return text;
  } catch {
    text.setText("fetch_content error");
    return text;
  }
}

export function renderFetchContentResult(result: unknown, options: { expanded?: boolean; isPartial?: boolean }, theme: Theme, context?: unknown): Text {
  const text = reuseText(context);
  try {
    const details = (result as { details?: any })?.details;
    if (!details) {
      text.setText(renderStatusLabel("error", sanitizeStatus("No details"), theme));
      return text;
    }
    if (details.error) {
      text.setText(renderStatusLabel("error", sanitizeStatus(details.error), theme));
      return text;
    }
    
    if (options?.expanded) {
      text.setText(`${details.title ?? "Untitled"}\n${details.url}\nExtractor: ${details.extractor ?? "default"}\nWords: ${details.wordCount ?? 0}\n\n${details.snippet ?? ""}`);
    } else {
      const label = `${details.status ?? 200} | ${details.title ?? "Untitled"} (${details.wordCount ?? 0} words)`;
      text.setText(renderStatusLabel("success", sanitizeStatus(label), theme));
    }
    return text;
  } catch (e) {
    text.setText(renderStatusLabel("error", sanitizeStatus(String(e)), theme));
    return text;
  }
}

export function renderGetSearchContentCall(args: unknown, theme: Theme, context?: unknown): Text {
  const text = reuseText(context);
  try {
    const id = (args as { responseId?: string })?.responseId ?? "unknown";
    text.setText(renderToolHeader("get_search_content", id, theme));
    return text;
  } catch {
    text.setText("get_search_content error");
    return text;
  }
}

export function renderGetSearchContentResult(result: unknown, options: { expanded?: boolean; isPartial?: boolean }, theme: Theme, context?: unknown): Text {
  const text = reuseText(context);
  try {
    const details = (result as { details?: any })?.details;
    if (!details) {
      text.setText(renderStatusLabel("error", sanitizeStatus("No details"), theme));
      return text;
    }
    
    if (options?.expanded) {
      text.setText(details.passages?.join("\n\n") ?? "No passages found");
    } else {
      let label = "Content retrieved";
      if (details.matches) {
          label = `Found ${details.matches.length} passages`;
      } else if (details.content) {
          label = `${details.content.length} characters`;
      }
      text.setText(renderStatusLabel("success", sanitizeStatus(label), theme));
    }
    return text;
  } catch (e) {
    text.setText(renderStatusLabel("error", sanitizeStatus(String(e)), theme));
    return text;
  }
}
