import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { getLinearCursorIndexFromEditor } from "./cursor.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

interface MockEditor {
  lines: string[];
  cursorLine: number;
  cursorCol: number;
}

function makeEditor(lines: string[], cursorLine: number, cursorCol: number): MockEditor {
  return { lines, cursorLine, cursorCol };
}

function editorFromMock(m: MockEditor) {
  return {
    getLines: () => m.lines,
    getCursor: () => ({ line: m.cursorLine, col: m.cursorCol }),
  };
}

// ── getLinearCursorIndexFromEditor ──────────────────────────────────────────

describe("getLinearCursorIndexFromEditor", () => {
  it("single line, cursor at start → 0", () => {
    const editor = editorFromMock(makeEditor(["hello"], 0, 0));
    expect(getLinearCursorIndexFromEditor(editor)).toBe(0);
  });

  it("single line, cursor at end → line length", () => {
    const editor = editorFromMock(makeEditor(["hello"], 0, 5));
    expect(getLinearCursorIndexFromEditor(editor)).toBe(5);
  });

  it("multi-line, cursor on second line → first line length + 1 + col", () => {
    const editor = editorFromMock(makeEditor(["hello", "world"], 1, 3));
    // "hello" (5 chars) + "\n" (1 char) + 3 cols into "world" = 9
    expect(getLinearCursorIndexFromEditor(editor)).toBe(9);
  });

  it("empty editor → 0", () => {
    const editor = editorFromMock(makeEditor([], 0, 0));
    expect(getLinearCursorIndexFromEditor(editor)).toBe(0);
  });

  it("cursor beyond bounds clamped correctly", () => {
    const editor = editorFromMock(makeEditor(["hi"], 10, 100));
    // Clamped to last line (line 0) and end of line (col 2)
    expect(getLinearCursorIndexFromEditor(editor)).toBe(2);
  });

  it("property: linear index always >= 0", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ maxLength: 50 }), { maxLength: 20 }),
        fc.nat({ max: 100 }),
        fc.nat({ max: 100 }),
        (lines, cursorLine, cursorCol) => {
          const editor = editorFromMock(makeEditor(lines, cursorLine, cursorCol));
          const result = getLinearCursorIndexFromEditor(editor);
          if (result < 0) {
            throw new Error(`Linear index is negative: ${result}`);
          }
        },
      ),
      { verbose: false },
    );
  });

  it("property: linear index <= total character count", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ maxLength: 50 }), { maxLength: 20 }),
        fc.nat({ max: 100 }),
        fc.nat({ max: 100 }),
        (lines, cursorLine, cursorCol) => {
          const editor = editorFromMock(makeEditor(lines, cursorLine, cursorCol));
          const result = getLinearCursorIndexFromEditor(editor);
          const totalChars = lines.reduce((sum, line, i) => sum + line.length + (i < lines.length - 1 ? 1 : 0), 0);
          if (result > totalChars) {
            throw new Error(`Linear index ${result} exceeds total chars ${totalChars}`);
          }
        },
      ),
      { verbose: false },
    );
  });
});
