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

  it("prefers finalOutput as the body when both are set, and still marks the failure", () => {
    const r = makeResult({ finalOutput: "out", error: "boom" });
    expect(formatParallelResults([r])).toBe("✗ test-agent 5 tools · 0k tok · 3s\nout");
  });

  it("keeps internal newlines in a multi-line body and trims only the tail", () => {
    const r1 = makeResult({
      agent: "researcher",
      finalOutput: "line one\nline two\n",
    });
    const r2 = makeResult({
      agent: "reviewer",
      finalOutput: "second",
    });
    expect(formatParallelResults([r1, r2])).toBe(
      "✓ researcher 5 tools · 0k tok · 3s\nline one\nline two\n\n✓ reviewer 5 tools · 0k tok · 3s\nsecond",
    );
  });

  it("keeps duplicate agent names distinguishable by position and body", () => {
    const a = makeResult({ agent: "researcher", finalOutput: "first" });
    const b = makeResult({ agent: "researcher", finalOutput: "second" });
    expect(formatParallelResults([a, b])).toBe(
      "✓ researcher 5 tools · 0k tok · 3s\nfirst\n\n✓ researcher 5 tools · 0k tok · 3s\nsecond",
    );
  });
});

describe("formatParallelResults: run outcomes", () => {
  it("says truncated on the header row of a cut-off result", () => {
    const out = formatParallelResults([
      makeResult({ outcome: "truncated", finalOutput: "partial answer" }),
    ]);
    expect(out.split("\n")[0]).toMatch(/truncated/i);
    expect(out).toContain("partial answer");
  });

  it("marks a run that failed at exit 0 with ✗, because the exit code is not the signal", () => {
    // `--mode json` — what the child actually runs — never maps `stopReason`
    // onto the exit code (that mapping is print mode's text branch), so a child
    // whose last response errored exits **0**. `streamEvents` reports that as
    // `error` with no `outcome`; a header that read only `exitCode` handed the
    // calling model a ✓ for a run that produced nothing, while `index.ts` set
    // `isError` on the very same result.
    const out = formatParallelResults([
      makeResult({ exitCode: 0, error: "401 unauthorized" }),
    ]);
    expect(out.split("\n")[0]?.startsWith("✗")).toBe(true);
    expect(out).toContain("401 unauthorized");
  });

  it("marks a run the parent cancelled through the bridge (exit 0, error set)", () => {
    // The bridge contract: a local cancel settles as a FAILED result carrying
    // error "cancelled" and exitCode 0 — same shape, same wrong ✓ without the
    // error check.
    const out = formatParallelResults([
      makeResult({ exitCode: 0, error: "cancelled" }),
    ]);
    expect(out.split("\n")[0]?.startsWith("✗")).toBe(true);
  });

  it("never shows a success marker for a result the tool reports as an error", () => {
    // The single assertion that ties the two halves together: `index.ts` decides
    // `isError` from `error`, so the header has to agree with it.
    const out = formatParallelResults([
      makeResult({ exitCode: 0, error: "boom" }),
      makeResult({ agent: "ok", exitCode: 0, finalOutput: "fine" }),
    ]);
    const rows = out.split("\n").filter((l) => l.startsWith("✓") || l.startsWith("✗"));
    expect(rows[0]).toContain("✗");
    expect(rows[1]).toContain("✓");
  });

  it("says aborted on the header row of a cancelled result", () => {
    const out = formatParallelResults([makeResult({ outcome: "aborted" })]);
    expect(out.split("\n")[0]).toMatch(/aborted/i);
  });

  it("leaves a completed header byte-identical to the pre-outcome contract", () => {
    const r = makeResult({
      outcome: "completed",
      agent: "reviewer",
      progressSummary: { toolCount: 4, tokens: 2000, durationMs: 12000 },
      finalOutput: "Looks good.",
    });
    expect(formatParallelResults([r])).toBe("✓ reviewer 4 tools · 2k tok · 12s\nLooks good.");
  });
});
