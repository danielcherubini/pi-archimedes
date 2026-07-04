import { describe, it, expect } from "vitest";
import { graphemeWidth, tokenize, visibleWidth } from "./width.js";

// ── graphemeWidth ───────────────────────────────────────────────────────────

describe("graphemeWidth", () => {
  it("ASCII letter = 1", () => {
    expect(graphemeWidth("a")).toBe(1);
    expect(graphemeWidth("Z")).toBe(1);
  });

  it("CJK character = 2", () => {
    expect(graphemeWidth("中")).toBe(2);
    expect(graphemeWidth("日")).toBe(2);
    expect(graphemeWidth("韩")).toBe(2);
  });

  it("emoji = 2", () => {
    expect(graphemeWidth("✅")).toBe(2);
    expect(graphemeWidth("🔥")).toBe(2);
    expect(graphemeWidth("😀")).toBe(2);
  });

  it("zero-width combining marks = 0", () => {
    // Combining acute accent (U+0301) — zero width on its own
    expect(graphemeWidth("\u0301")).toBe(0);
    // Combining tilde (U+0303)
    expect(graphemeWidth("\u0303")).toBe(0);
  });

  it("tab = 2", () => {
    expect(graphemeWidth("\t")).toBe(2);
  });
});

// ── tokenize ────────────────────────────────────────────────────────────────

describe("tokenize", () => {
  it("plain text produces single tokens", () => {
    const tokens = tokenize("ab");
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toEqual({ ansi: "", text: "a", width: 1 });
    expect(tokens[1]).toEqual({ ansi: "", text: "b", width: 1 });
  });

  it("SGR sequence produces ansi+text pairs", () => {
    // \x1b[31m is red fg, followed by "a"
    const tokens = tokenize("\x1b[31ma");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual({ ansi: "\x1b[31m", text: "a", width: 1 });
  });

  it("bare ESC without m terminator handled gracefully", () => {
    // ESC (0x1b) with no 'm' after it — should not hang
    const tokens = tokenize("\x1ba");
    // The bare ESC produces a zero-width token, then "a" is a normal token
    expect(tokens.length).toBeGreaterThanOrEqual(2);
    // Last token should be the "a"
    expect(tokens[tokens.length - 1]!.text).toBe("a");
  });

  it("mixed ANSI + text", () => {
    const tokens = tokenize("\x1b[31mred\x1b[0mplain");
    // "red" under \x1b[31m, then "plain" after reset
    const redToken = tokens.find((t) => t.text === "r");
    expect(redToken?.ansi).toBe("\x1b[31m");

    const plainToken = tokens.find((t) => t.text === "p");
    expect(plainToken?.ansi).toBe("\x1b[0m");
  });
});

// ── visibleWidth ────────────────────────────────────────────────────────────

describe("visibleWidth", () => {
  it("plain ASCII length matches", () => {
    expect(visibleWidth("hello")).toBe(5);
    expect(visibleWidth("abc")).toBe(3);
  });

  it("wide chars counted correctly", () => {
    expect(visibleWidth("中")).toBe(2);
    expect(visibleWidth("中日")).toBe(4);
    expect(visibleWidth("a中b")).toBe(4); // 1 + 2 + 1
  });

  it("ANSI escapes don't add width", () => {
    expect(visibleWidth("\x1b[31mhello\x1b[0m")).toBe(5);
    expect(visibleWidth("\x1b[1m\x1b[31mhi\x1b[0m")).toBe(2);
  });

  it("empty string = 0", () => {
    expect(visibleWidth("")).toBe(0);
  });
});
