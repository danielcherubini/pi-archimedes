import { describe, it, expect } from "vitest";
import { truncLine } from "./format.js";

// ── truncLine ───────────────────────────────────────────────────────────────

describe("truncLine", () => {
  it("returns text unchanged when within limit", () => {
    expect(truncLine("hello", 10)).toBe("hello");
  });

  it("truncates with '...' when exceeding limit", () => {
    expect(truncLine("hello world", 8)).toBe("hello...");
  });

  it("stops at newline boundary instead of bleeding into next line", () => {
    expect(truncLine("line one\nline two\nline three", 15)).toBe("line one...");
  });

  it("truncates first line if it itself exceeds limit", () => {
    expect(truncLine("this is a very long first line\nsecond", 12)).toBe("this is a...");
  });

  it("handles multiple consecutive newlines", () => {
    expect(truncLine("a\n\n\nb", 10)).toBe("a...");
  });

  it("handles text starting with newline", () => {
    expect(truncLine("\nhello", 10)).toBe("...");
  });
});
