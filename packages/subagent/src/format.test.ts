import { describe, it, expect } from "vitest";
import { truncLine, formatParallelResults } from "./format.js";
import type { SubagentResult } from "./types.js";

function makeResult(overrides: Partial<SubagentResult> = {}): SubagentResult {
  return {
    agent: "test-agent",
    task: "do something",
    exitCode: 0,
    usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.01, turns: 3 },
    model: "gpt-4",
    finalOutput: undefined,
    error: undefined,
    progress: undefined,
    progressSummary: { toolCount: 5, tokens: 150, durationMs: 3000 },
    ...overrides,
  };
}

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

describe("formatParallelResults", () => {
  it("renders header + body per task with exactly one blank line between sections", () => {
    const r1 = makeResult({
      agent: "researcher",
      progressSummary: { toolCount: 31, tokens: 12345, durationMs: 153000 },
      finalOutput: "Found the bug.\n", // trailing newline: pins trimEnd
    });
    const r2 = makeResult({
      agent: "reviewer",
      progressSummary: { toolCount: 4, tokens: 2000, durationMs: 12000 },
      finalOutput: "Looks good.",
    });
    expect(formatParallelResults([r1, r2])).toBe(
      "✓ researcher 31 tools · 12k tok · 153s\nFound the bug.\n\n✓ reviewer 4 tools · 2k tok · 12s\nLooks good.",
    );
  });

  it("rounds tokens and duration with Math.round", () => {
    const r = makeResult({
      progressSummary: { toolCount: 1, tokens: 12500, durationMs: 154000 },
      finalOutput: "x",
    });
    expect(formatParallelResults([r])).toBe("✓ test-agent 1 tools · 13k tok · 154s\nx");
  });

  it("renders header only when progressSummary is absent (synthetic case)", () => {
    const r = makeResult({ progressSummary: undefined });
    expect(formatParallelResults([r])).toBe("✓ test-agent\ncompleted");
  });

  it("uses the ✗ glyph for non-zero exit codes", () => {
    const r = makeResult({ exitCode: 1, finalOutput: "done" });
    expect(formatParallelResults([r])).toBe("✗ test-agent 5 tools · 0k tok · 3s\ndone");
  });

  it("falls back to 'completed' when there is no finalOutput and no error", () => {
    const r = makeResult();
    expect(formatParallelResults([r])).toBe("✓ test-agent 5 tools · 0k tok · 3s\ncompleted");
  });

  it("uses the error text as the body when there is no finalOutput", () => {
    const r = makeResult({ exitCode: 1, error: "spawn failed" });
    expect(formatParallelResults([r])).toBe("✗ test-agent 5 tools · 0k tok · 3s\nspawn failed");
  });

  it("prefers finalOutput over error when both are set", () => {
    const r = makeResult({ finalOutput: "out", error: "boom" });
    expect(formatParallelResults([r])).toBe("✓ test-agent 5 tools · 0k tok · 3s\nout");
  });

  it("keeps duplicate agent names distinguishable by position and body", () => {
    const a = makeResult({ agent: "researcher", finalOutput: "first" });
    const b = makeResult({ agent: "researcher", finalOutput: "second" });
    expect(formatParallelResults([a, b])).toBe(
      "✓ researcher 5 tools · 0k tok · 3s\nfirst\n\n✓ researcher 5 tools · 0k tok · 3s\nsecond",
    );
  });
});
