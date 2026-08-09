import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// ── Mock @earendil-works/pi-tui ────────────────────────────────────────────

vi.mock("@earendil-works/pi-tui", () => ({
  wrapTextWithAnsi: vi.fn(),
  truncateToWidth: vi.fn(),
}));

// Lazy import after mock is set up
const { wrapTextWithAnsi, truncateToWidth } = await import("@earendil-works/pi-tui");

const { appendWrappedTextLines } = await import("./wrap.js");

describe("appendWrappedTextLines", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: wrapTextWithAnsi returns input as single line (no wrapping needed)
    vi.mocked(wrapTextWithAnsi).mockImplementation((text: string) => [text]);

    // Default: truncateToWidth returns input unchanged (no truncation needed)
    vi.mocked(truncateToWidth).mockImplementation((text: string) => text);
  });

  it("single line within width → no wrapping", () => {
    const rendered: string[] = [];
    appendWrappedTextLines(rendered, "hello", 80);
    expect(rendered).toEqual(["hello"]);
    expect(wrapTextWithAnsi).toHaveBeenCalledWith("hello", 80);
  });

  it("long line → wrapped to specified width", () => {
    vi.mocked(wrapTextWithAnsi).mockReturnValueOnce(["part1", "part2", "part3"]);
    const rendered: string[] = [];
    appendWrappedTextLines(rendered, "a very long line of text that needs wrapping", 10);
    expect(rendered).toEqual(["part1", "part2", "part3"]);
    expect(wrapTextWithAnsi).toHaveBeenCalledWith("a very long line of text that needs wrapping", 10);
  });

  it("multiline input → each line wrapped independently", () => {
    vi.mocked(wrapTextWithAnsi).mockImplementation((text: string) => {
      if (text === "line1") return ["line1"];
      if (text === "line2") return ["line2"];
      return [text];
    });
    const rendered: string[] = [];
    appendWrappedTextLines(rendered, "line1\nline2", 80);
    expect(rendered).toEqual(["line1", "line2"]);
    expect(wrapTextWithAnsi).toHaveBeenCalledTimes(2);
    expect(wrapTextWithAnsi).toHaveBeenNthCalledWith(1, "line1", 80);
    expect(wrapTextWithAnsi).toHaveBeenNthCalledWith(2, "line2", 80);
  });

  it("indent reduces effective wrap width", () => {
    const rendered: string[] = [];
    appendWrappedTextLines(rendered, "hello", 80, { indent: 4 });
    expect(wrapTextWithAnsi).toHaveBeenCalledWith("hello", 76);
    expect(truncateToWidth).toHaveBeenCalledWith("    hello", 80);
  });

  it("formatLine applied to each wrapped line", () => {
    vi.mocked(wrapTextWithAnsi).mockReturnValueOnce(["part1", "part2"]);
    const formatLine = vi.fn((line: string) => `>>${line}<<`);
    const rendered: string[] = [];
    appendWrappedTextLines(rendered, "some text", 80, { formatLine });
    expect(formatLine).toHaveBeenCalledWith("part1");
    expect(formatLine).toHaveBeenCalledWith("part2");
    expect(truncateToWidth).toHaveBeenCalledWith(">>part1<<", 80);
    expect(truncateToWidth).toHaveBeenCalledWith(">>part2<<", 80);
  });

  it("empty text → single empty line added", () => {
    const rendered: string[] = [];
    appendWrappedTextLines(rendered, "", 80);
    expect(rendered).toEqual([""]);
  });

  it("property: output lines never exceed safeWidth chars", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 200 }),
        fc.integer({ min: 1, max: 80 }),
        fc.integer({ min: 0, max: 20 }),
        (text, width, indent) => {
          const safeWidth = Math.max(1, Math.floor(width));
          const actualIndent = Math.max(0, Math.floor(indent));
          const wrapWidth = Math.max(1, safeWidth - actualIndent);

          // Mock: wrap returns single line (worst case for truncation)
          vi.mocked(wrapTextWithAnsi).mockReturnValueOnce([text]);
          // Mock: truncateToWidth truncates to safeWidth
          vi.mocked(truncateToWidth).mockImplementation((s: string) => s.slice(0, safeWidth));

          const rendered: string[] = [];
          appendWrappedTextLines(rendered, text, safeWidth, { indent: actualIndent });

          for (const line of rendered) {
            if (line.length > safeWidth) {
              throw new Error(`Line length ${line.length} exceeds safeWidth ${safeWidth}`);
            }
          }
        },
      ),
      { verbose: false },
    );
  });
});
