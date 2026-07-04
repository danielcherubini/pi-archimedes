import { describe, it, expect } from "vitest";
import { stripAnsi, isParentBorder, formatKey } from "./text.js";

// ── stripAnsi ───────────────────────────────────────────────────────────────

describe("stripAnsi", () => {
  it("strips CSI sequences", () => {
    expect(stripAnsi("\x1b[31mhello\x1b[0m")).toBe("hello");
  });

  it("strips multiple CSI sequences", () => {
    expect(stripAnsi("\x1b[1;32mred\x1b[0m \x1b[33myellow\x1b[0m")).toBe(
      "red yellow"
    );
  });

  it("strips OSC sequences", () => {
    expect(stripAnsi("before\x1b]0;title\x07after")).toBe("beforeafter");
  });

  it("strips OSC with ST (ESC \\)", () => {
    expect(stripAnsi("before\x1b]0;title\x1b\\after")).toBe("beforeafter");
  });

  it("strips DCS sequences", () => {
    expect(stripAnsi("before\x1bPdata\x07after")).toBe("beforeafter");
  });

  it("strips SOS sequences", () => {
    expect(stripAnsi("before\x1b^data\x07after")).toBe("beforeafter");
  });

  it("strips APC sequences", () => {
    expect(stripAnsi("before\x1b_data\x07after")).toBe("beforeafter");
  });

  it("strips PM sequences", () => {
    expect(stripAnsi("before\x1b\\data\x07after")).toBe("beforeafter");
  });

  it("strips character set escapes (ESC ( / ESC ))", () => {
    // The regex strips ESC( and ESC) but not the following charset designator
    expect(stripAnsi("before\x1b(Bafter")).toBe("beforeBafter");
    expect(stripAnsi("before\x1b)Bafter")).toBe("beforeBafter");
  });

  it("handles nested escapes", () => {
    expect(stripAnsi("\x1b[1m\x1b[31mhello\x1b[0m\x1b[0m")).toBe("hello");
  });

  it("returns empty string for empty input", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("returns input unchanged for no-escape string", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });

  it("trims leading and trailing whitespace", () => {
    expect(stripAnsi("  \x1b[31mhello\x1b[0m  ")).toBe("hello");
  });
});

// ── isParentBorder ──────────────────────────────────────────────────────────

describe("isParentBorder", () => {
  it("returns true for border char", () => {
    expect(isParentBorder("─")).toBe(true);
  });

  it("returns true for border with SGR", () => {
    expect(isParentBorder("\x1b[90m─\x1b[0m")).toBe(true);
  });

  it("returns false for non-border", () => {
    expect(isParentBorder("hello")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isParentBorder("")).toBe(false);
  });
});

// ── formatKey ───────────────────────────────────────────────────────────────

describe("formatKey", () => {
  it("formats ctrl+a", () => {
    expect(formatKey("ctrl+a")).toBe("Ctrl+A");
  });

  it("formats alt+shift+f", () => {
    expect(formatKey("alt+shift+f")).toBe("Alt+Shift+F");
  });

  it("formats cmd as Cmd", () => {
    expect(formatKey("cmd")).toBe("Cmd");
  });

  it("formats meta as Cmd", () => {
    expect(formatKey("meta")).toBe("Cmd");
  });

  it("uppercases single char", () => {
    expect(formatKey("a")).toBe("A");
    expect(formatKey("z")).toBe("Z");
  });

  it("capitalizes multi-word", () => {
    expect(formatKey("escape")).toBe("Escape");
    expect(formatKey("enter")).toBe("Enter");
  });

  it("returns that key for undefined", () => {
    expect(formatKey(undefined)).toBe("that key");
  });
});
