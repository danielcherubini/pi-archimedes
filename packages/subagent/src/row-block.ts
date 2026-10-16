/**
 * Width-aware rows for the subagent tool's transcript rows.
 *
 * pi draws a tool row at the width it is rendering at: bash truncates inside
 * `VisualLinePreview`/`truncateToVisualLines`, which are handed `render(width)`'s
 * width. That module is not importable (pi's export map is `.` and `./rpc-entry`),
 * so the rows here get the same behaviour from pi-tui's own helpers — the
 * sanctioned route, per ADR 0029 ("width maths goes through pi-tui helpers").
 *
 * Two kinds of content, because the subagent draws two kinds of thing:
 *
 *   * a **row** — one logical line: the agent label, the stats line, the activity
 *     line, the outcome line. It is cut at the render width, so it fills the
 *     frame and truncates there, exactly like the bash row. Leaving it uncapped
 *     inside a `Text` is not the fix: `Text.render(width)` *wraps*, so a long task
 *     would become a multi-row block instead of one full-width row.
 *   * a **block** — multi-line content that is meant to be read in full (the
 *     expanded view's output, its task text, its tool-call history). It wraps,
 *     as it always has (ADR 0020: expanded output is deliberately untruncated).
 *
 * The width therefore arrives per-render and nothing is cached across renders
 * except keyed by (content, width).
 */

import { Text, sliceByColumn, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

/** The marker appended to a row that was cut. Plain text, so it inherits colour. */
export const ROW_ELLIPSIS = "...";

/**
 * SGR reset for styled rows: resets foreground color and font styles (bold,
 * dim, italic, underline), but never resets the background color (SGR 49).
 *
 * Inside pi's tool execution component, rows are rendered inside a Box that
 * applies a panel background (e.g. toolSuccessBg / toolPendingBg) across the
 * entire row: `theme.bg(token, paddedLine)`. A full SGR reset (`\x1b[0m` or
 * `\x1b[m`) cancels the Box-painted background mid-line, causing all subsequent
 * padding spaces and trailing content to fall through to the terminal's default
 * background (appearing as an unsightly mid-grey or mismatched bar after
 * truncated text or early newlines).
 */
export const RESET = "\x1b[22;23;24;39m";

/**
 * Replace any full SGR resets (\x1b[0m or \x1b[m) with a style-and-foreground reset
 * so the line never kills an enclosing container's background color mid-line.
 */
export function sanitizeRowResets(line: string): string {
  return line.replace(/\x1b\[0?m/g, RESET);
}

/** How `Text` renders a tab; kept identical so short rows stay byte-identical. */
const TAB_WIDTH = 3;

/** `row`: one line, truncated to the frame. `block`: wrapped, never cut. */
export type RowKind = "row" | "block";

export interface RowSegment {
  readonly kind: RowKind;
  readonly text: string;
}

/** One logical line that must stay one line at any width. */
export function row(text: string): RowSegment {
  return { kind: "row", text };
}

/**
 * What the row builders draw into: the two ways content reaches a `RowBlock`.
 * Kept as a projection of `RowBlock` so a builder cannot ask for anything a row
 * does not do (no `tui`, no width, no renderer — see ADR 0027).
 */
export type RowSink = Pick<RowBlock, "setText" | "setSegments">;

/** Multi-line content that keeps pi-tui's wrapping. */
export function block(text: string): RowSegment {
  return { kind: "block", text };
}

/** Treat every logical line of `text` as a row (the compact view is all rows). */
export function rowsFromText(text: string): RowSegment[] {
  return text.split("\n").map(row);
}

/**
 * Cut one styled row to `width` display cells.
 *
 * The ellipsis stays inside the styled span — the property the old character-based
 * `truncLine` existed to keep, and the reason `truncateToWidth` is not used for
 * the cut: it emits `…\x1b[0m…`, i.e. the dots land *after* a colour reset, so a
 * truncated span loses its colour (`row-block.test.ts` pins those bytes).
 * `sliceByColumn` cuts on display cells instead — wide glyphs and emoji included —
 * and leaves the ANSI state open where it cuts, so a plain `"..."` appended after
 * it inherits whatever colour the row was drawing at that point. The trailing
 * reset then closes what was left open, so the row's padding is not painted.
 *
 * A newline is a hard boundary: the row stops at the first one rather than
 * bleeding into the next row, and says so with the ellipsis.
 */
export function truncateRow(line: string, width: number): string {
  if (width <= 0) return "";
  const nlIdx = line.indexOf("\n");
  const firstLine = nlIdx === -1 ? line : line.slice(0, nlIdx);
  if (nlIdx === -1 && visibleWidth(firstLine) <= width) {
    return sanitizeRowResets(firstLine);
  }

  const budget = width - ROW_ELLIPSIS.length;
  // No room for both content and dots: show as many dots as the frame holds, so
  // the row still reads as "cut" rather than as "the whole task".
  if (budget <= 0) return sliceByColumn(ROW_ELLIPSIS, 0, width, true);
  const sliced = sliceByColumn(firstLine, 0, budget, true);
  return sanitizeRowResets(sliced + ROW_ELLIPSIS) + RESET;
}

/** Pad a rendered line out to the frame, the way `Text` does. */
function padToWidth(line: string, width: number): string {
  const used = visibleWidth(line);
  return used >= width ? line : line + " ".repeat(width - used);
}

/**
 * The rows of one subagent result, truncated at the width pi renders them at.
 *
 * A `Text` subclass, because everything that already knows how to hold a row —
 * pi's own tool shell, and this package's `setText`-shaped renderers — expects
 * one. `setText` treats every logical line as a row; `setSegments` is for the
 * views that mix rows with wrapped blocks (expanded).
 */
export class RowBlock extends Text {
  private segments: RowSegment[];
  private content: string;
  private cacheKey: string | undefined;
  private cacheWidth: number | undefined;
  private cacheLines: string[] | undefined;

  constructor(text = "") {
    // Edge-to-edge: pi's tool shell supplies the row's inset (a Box with its own
    // padding), exactly as it did for the `Text` this replaces.
    super(text, 0, 0);
    this.segments = rowsFromText(text);
    this.content = text;
  }

  /** Every logical line of `text` is a row. */
  override setText(text: string): void {
    super.setText(text);
    this.content = text;
    this.segments = rowsFromText(text);
    this.cacheKey = undefined;
    this.cacheWidth = undefined;
    this.cacheLines = undefined;
  }

  /** Mixed content: rows truncated to the frame, blocks wrapped. */
  setSegments(segments: RowSegment[]): void {
    const text = segments.map((segment) => segment.text).join("\n");
    super.setText(text);
    this.content = text;
    this.segments = segments;
    this.cacheKey = undefined;
    this.cacheWidth = undefined;
    this.cacheLines = undefined;
  }

  override invalidate(): void {
    super.invalidate();
    this.cacheKey = undefined;
    this.cacheWidth = undefined;
    this.cacheLines = undefined;
  }

  override render(width: number): string[] {
    // Cached across frames exactly the way `Text` caches: by content and width,
    // because the duration in a running row changes the content between frames.
    if (
      this.cacheLines !== undefined &&
      this.cacheKey === this.content &&
      this.cacheWidth === width
    ) {
      return this.cacheLines;
    }
    const lines = this.layout(Math.max(1, width));
    this.cacheKey = this.content;
    this.cacheWidth = width;
    this.cacheLines = lines;
    return lines;
  }

  private layout(width: number): string[] {
    // Nothing but blanks to draw: render no lines at all, matching `Text`.
    if (this.segments.length === 0 || this.segments.every((s) => s.text.trim() === "")) {
      return [];
    }
    const lines: string[] = [];
    for (const segment of this.segments) {
      const text = segment.text.replace(/\t/g, " ".repeat(TAB_WIDTH));
      if (segment.kind === "block") {
        for (const wrapped of wrapTextWithAnsi(text, width)) {
          lines.push(padToWidth(sanitizeRowResets(wrapped), width));
        }
      } else {
        lines.push(padToWidth(truncateRow(text, width), width));
      }
    }
    return lines;
  }
}
