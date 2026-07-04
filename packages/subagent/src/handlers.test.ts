import { describe, it, expect } from "vitest";
import { extractArgsPreview } from "./handlers.js";

// ── extractArgsPreview ──────────────────────────────────────────────────────

describe("extractArgsPreview", () => {
  it("returns string args truncated", () => {
    const long = "a".repeat(200);
    expect(extractArgsPreview(long)).toBe("a".repeat(120));
  });

  it("replaces newlines in string args", () => {
    expect(extractArgsPreview("hello\nworld")).toBe("hello world");
  });

  it("replaces newlines in single-key object value", () => {
    const args = { command: "cat file.txt\ngrep -A5 \"test\"" };
    const result = extractArgsPreview(args);
    expect(result).not.toContain("\n");
    expect(result).toBe("cat file.txt grep -A5 \"test\"");
  });

  it("replaces newlines in multi-key longest string value", () => {
    const args = { short: "x", long: "hello\nworld\nfoo" };
    expect(extractArgsPreview(args)).toBe("hello world foo");
  });

  it("handles number and boolean values", () => {
    expect(extractArgsPreview({ count: 42 })).toBe("42");
    expect(extractArgsPreview({ enabled: true })).toBe("true");
  });
});
