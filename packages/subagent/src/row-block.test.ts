/**
 * Unit tests for the row primitives the subagent rows are drawn with.
 *
 * The two properties worth pinning down, both learned by measuring pi-tui:
 *
 *   * `truncateToWidth` puts the ellipsis **after** a colour reset
 *     (`…\x1b[0m…` → `\x1b[0m...\x1b[0m`), so a truncated span loses the colour
 *     of the span it belongs to. That is why the rows do not use it for the
 *     ellipsis — see the "why not truncateToWidth" test, which pins the measured
 *     bytes so the claim cannot quietly rot.
 *   * `sliceByColumn` cuts on display cells (wide glyphs and emoji included) and
 *     leaves the ANSI state open at the cut, so a plain `"..."` appended after
 *     it inherits the style that was active where the line was cut.
 */

import { describe, it, expect } from "vitest";
import { Box, Text, stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { RowBlock, block, row, truncateRow, RESET } from "./row-block.js";

const dim = (t: string) => `\x1b[2m${t}${RESET}`;
const bold = (t: string) => `\x1b[1m${t}${RESET}`;

const drawn = (line: string) => visibleWidth(stripTerminalSequences(line).replace(/\s+$/, ""));

const LONG =
  "Handle the review cycle for PR #107 in /home/daniel/Coding/Javascript/pi-archimedes and report every finding with a file:line reference so the maintainer can act on each one without re-reading the diff herself ";

describe("truncateRow", () => {
  it("leaves a row that fits untouched, byte for byte", () => {
    const line = bold("general") + dim(": short task");
    expect(truncateRow(line, 80)).toBe(line);
  });

  it("cuts on display cells and fills the frame exactly", () => {
    for (const width of [200, 120, 80, 60, 40, 20]) {
      const truncated = truncateRow(dim(LONG), width);
      expect(drawn(truncated), `width ${width}`).toBe(width);
      expect(stripTerminalSequences(truncated).endsWith("..."), `width ${width}`).toBe(true);
    }
  });

  it("keeps the ellipsis inside the styled span (byte-exact)", () => {
    // 10 columns, 3 of them the ellipsis: 7 visible characters of the dim text,
    // then the dots — still inside the open `\x1b[2m`, then closed for us.
    expect(truncateRow(dim("abcdefghijklmnop"), 10)).toBe(`\x1b[2mabcdefg...${RESET}`);
  });

  it("why not truncateToWidth: its ellipsis lands after the colour reset", () => {
    // Measured against pi-tui 1.2.0. The dots are outside the dim span, which is
    // the exact defect the old character-based `truncLine` existed to avoid.
    expect(truncateToWidth(dim("abcdefghijklmnop"), 10)).toBe(
      "\x1b[2mabcdefg\x1b[0m...\x1b[0m",
    );
    // Ours keeps the colour: nothing resets between the span's own colour and
    // the dots.
    const ours = truncateRow(dim("abcdefghijklmnop"), 10);
    const beforeDots = ours.slice(0, ours.indexOf("..."));
    expect(ours.slice(0, -RESET.length).endsWith("...")).toBe(true);
    expect(beforeDots.startsWith("\x1b[2m")).toBe(true);
    expect(beforeDots.includes(RESET)).toBe(false);
  });

  it("closes the style it left open, so padding is not painted", () => {
    expect(truncateRow(dim(LONG), 30).endsWith(RESET)).toBe(true);
  });

  it("cuts at the first newline instead of bleeding into the next row", () => {
    // The rule the old truncLine enforced: a newline is a hard boundary.
    expect(stripTerminalSequences(truncateRow("line one\nline two\nline three", 40))).toBe("line one...");
    expect(stripTerminalSequences(truncateRow("a\n\n\nb", 40))).toBe("a...");
    expect(stripTerminalSequences(truncateRow("\nhello", 40))).toBe("...");
    // Including when the first line is short enough to fit the frame.
    expect(stripTerminalSequences(truncateRow(dim("short\nrest"), 40))).toBe("short...");
  });

  it("never splits a wide glyph, at any width", () => {
    const cjk = "検証サイクルをPR107で実行して結果を報告".repeat(3);
    for (const width of [40, 30, 21, 11, 5]) {
      const truncated = truncateRow(cjk, width);
      const cells = visibleWidth(truncated);
      expect(cells, `cjk width ${width}`).toBeLessThanOrEqual(width);
      // One cell of slack is the most a dropped double-width glyph can cost.
      expect(cells, `cjk width ${width}`).toBeGreaterThanOrEqual(Math.min(width, 3) - 1);
    }
    expect(stripTerminalSequences(truncateRow(cjk, 40)).endsWith("...")).toBe(true);
  });

  it("never splits an emoji cluster, at any width", () => {
    const emoji = ("🚀 ship 🔥 the ✅ change 🧪 with 📦 care 🎯 now 🏁 ship 🧭 ").repeat(3);
    for (const width of [40, 27, 13, 7]) {
      expect(visibleWidth(truncateRow(emoji, width)), `emoji width ${width}`).toBeLessThanOrEqual(width);
    }
  });

  it("never emits a full SGR reset (\\x1b[0m) that would kill a container Box background", () => {
    // Both when cut on width and when cut on a newline
    const cutOnWidth = truncateRow(dim(LONG), 40);
    expect(cutOnWidth.includes("\x1b[0m")).toBe(false);
    expect(cutOnWidth.includes("\x1b[m")).toBe(false);

    const cutOnNewline = truncateRow("general: Check status\nsecond line", 80);
    expect(cutOnNewline.includes("\x1b[0m")).toBe(false);
    expect(cutOnNewline.includes("\x1b[m")).toBe(false);

    // Embedded \x1b[0m is safely converted to style reset
    const embedded = truncateRow("\x1b[31merror\x1b[0m: details", 80);
    expect(embedded.includes("\x1b[0m")).toBe(false);
    expect(embedded.includes("\x1b[m")).toBe(false);
  });

  it("preserves an enclosing Box background across the entire row including padding", () => {
    const bgFn = (t: string) => `\x1b[48;2;33;34;44m${t}\x1b[49m`;
    const box = new Box(1, 1, bgFn);
    const rows = new RowBlock();
    rows.setSegments([
      row("general: Check the status of PR #23 on danielcherubini/archimedes:\nsomething else"),
    ]);
    box.addChild(rows);
    const lines = box.render(100);
    // Line 1 is the content row
    const contentLine = lines[1]!;
    expect(contentLine).toBeDefined();
    // Background escape was applied at the start and closed at the end
    expect(contentLine.startsWith("\x1b[48;2;33;34;44m")).toBe(true);
    expect(contentLine.endsWith("\x1b[49m")).toBe(true);
    // No full reset in the middle that would kill the background before the padding
    expect(contentLine.includes("\x1b[0m")).toBe(false);
    expect(contentLine.includes("\x1b[m")).toBe(false);
  });

  it("survives widths with no room for an ellipsis", () => {
    expect(truncateRow(LONG, 3)).toBe("...");
    expect(truncateRow(LONG, 2)).toBe("..");
    expect(truncateRow(LONG, 1)).toBe(".");
    expect(truncateRow(LONG, 0)).toBe("");
    expect(truncateRow(LONG, -5)).toBe("");
  });
});

describe("RowBlock", () => {
  const padTo = (line: string, width: number) =>
    line + " ".repeat(Math.max(0, width - visibleWidth(line)));

  const gamma = () => "gamma: " + LONG;

  it("renders every logical line of setText as one row, padded to the frame", () => {
    const rows = new RowBlock();
    rows.setText(["alpha", "beta", gamma()].join("\n"));
    const lines = rows.render(40);
    expect(lines.length).toBe(3);
    for (const line of lines) expect(visibleWidth(line)).toBe(40);
  });

  it("matches pi-tui's Text exactly while nothing needs truncating", () => {
    // The rows used to be a plain Text; for short content the replacement must be
    // byte-identical, or the fix silently restyles every row.
    const text = ["alpha", "beta", "gamma"].join("\n");
    const plain = new Text(text, 0, 0).render(80);
    const rows = new RowBlock();
    rows.setText(text);
    expect(rows.render(80)).toEqual(plain);
  });

  it("truncates a long row to one line instead of wrapping it", () => {
    const rows = new RowBlock();
    rows.setText(bold("general") + dim(": " + LONG));
    for (const width of [200, 120, 80, 60, 40]) {
      const lines = rows.render(width);
      expect(lines.length, `width ${width}`).toBe(1);
      expect(drawn(lines[0]!), `width ${width}`).toBeGreaterThanOrEqual(width - 1);
      expect(stripTerminalSequences(lines[0]!.replace(/\s+$/, "")).endsWith("..."), `width ${width}`).toBe(true);
    }
  });

  it("keeps wrapped blocks wrapped, so multi-line content is not lost", () => {
    const rows = new RowBlock();
    rows.setSegments([row(bold("general") + dim(": " + LONG)), block(LONG)]);
    const lines = rows.render(40);
    // One row + a wrapped block: the block costs more than one line, the row not.
    expect(lines.length).toBeGreaterThan(2);
    expect(stripTerminalSequences(lines[0]!).trimEnd().endsWith("...")).toBe(true);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
  });

  it("re-renders for a new width instead of serving a stale frame", () => {
    const rows = new RowBlock();
    rows.setText(bold("general") + dim(": " + LONG));
    const narrow = rows.render(40);
    const wide = rows.render(120);
    expect(narrow).not.toEqual(wide);
    for (const [width, lines] of [
      [40, narrow],
      [120, wide],
    ] as const) {
      expect(lines.length).toBe(1);
      expect(drawn(lines[0]!)).toBeGreaterThanOrEqual(width - 1);
    }
    // …and the same width again is stable (the cache is keyed by content + width).
    expect(rows.render(120)).toEqual(wide);
    // …and new content invalidates it, rather than serving the cached frame.
    rows.setText(bold("general") + dim(": now in a hurry"));
    const changed = rows.render(120);
    expect(changed).not.toEqual(wide);
    expect(stripTerminalSequences(changed[0]!).trimEnd()).toBe("general: now in a hurry");
  });

  it("renders nothing for blank content, like Text", () => {
    const rows = new RowBlock();
    rows.setText("");
    expect(rows.render(80)).toEqual([]);
    rows.setSegments([]);
    expect(rows.render(80)).toEqual([]);
    const blank = new RowBlock();
    blank.setText("   ");
    expect(blank.render(80)).toEqual(new Text("   ", 0, 0).render(80));
  });

  it("normalizes tabs to three spaces, like Text", () => {
    const rows = new RowBlock();
    rows.setText("a\tb");
    expect(rows.render(80)).toEqual(new Text("a\tb", 0, 0).render(80));
  });

  it("pads every produced row to the frame", () => {
    const rows = new RowBlock();
    rows.setSegments([row("short"), block(LONG), row(dim(LONG))]);
    const lines = rows.render(60);
    for (const line of lines) expect(padTo(line, 60)).toBe(line);
  });

  it("sanitizes embedded \\x1b[0m in block segments to RESET when rendered and padded", () => {
    const rows = new RowBlock();
    rows.setSegments([block("\x1b[31merror message\x1b[0m: line one\nsecond line with \x1b[32msuccess\x1b[m details")]);
    const lines = rows.render(80);
    expect(lines.length).toBe(2);
    for (const line of lines) {
      expect(line.includes("\x1b[0m")).toBe(false);
      expect(line.includes("\x1b[m")).toBe(false);
      expect(visibleWidth(line)).toBe(80);
    }
    expect(lines[0]!).toContain(`\x1b[31merror message${RESET}: line one`);
    expect(lines[1]!).toContain(`second line with \x1b[32msuccess${RESET} details`);
  });
});
