import { describe, it, expect } from "vitest";
import { buildExpandedText } from "./expanded.js";
import type { SubagentResult } from "./types.js";

// The expanded row is what the user reads after `ctrl+o`; the compact row is
// what they see while it runs. Both have to carry the *Run outcome* vocabulary
// (CONTEXT.md) rather than collapsing it into done/failed.

const theme = { fg: (token: string, text: string) => `[${token}]${text}`, bold: (t: string) => t };

function makeResult(overrides: Partial<SubagentResult> = {}): SubagentResult {
  return {
    agent: "reviewer",
    task: "review the diff",
    exitCode: 0,
    usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.01, turns: 1 },
    model: "anthropic/claude-opus-4.5",
    finalOutput: "the answer",
    error: undefined,
    progress: undefined,
    progressSummary: { toolCount: 2, tokens: 15, durationMs: 1000 },
    ...overrides,
  };
}

describe("expanded view: run outcomes", () => {
  it("still says Done for a completed run", () => {
    expect(buildExpandedText(makeResult({ outcome: "completed" }), undefined, theme)).toContain("✓ Done");
  });

  it("says Truncated — and not Failed — for a cut-off answer", () => {
    const text = buildExpandedText(
      makeResult({ outcome: "truncated", exitCode: 1, finalOutput: "partial" }),
      undefined,
      theme,
    );
    expect(text).toMatch(/truncated/i);
    expect(text).not.toMatch(/Failed/);
  });

  it("says Aborted for a cancelled run", () => {
    const text = buildExpandedText(
      makeResult({ outcome: "aborted", exitCode: 143, error: undefined }),
      undefined,
      theme,
    );
    expect(text).toMatch(/aborted/i);
    expect(text).not.toMatch(/Failed/);
  });

  it("keeps reporting a real error as an error", () => {
    const failed = makeResult({ exitCode: 1, error: "401 unauthorized" });
    delete failed.outcome; // a failed run claims no outcome
    const text = buildExpandedText(failed, undefined, theme);
    expect(text).toContain("401 unauthorized");
  });
});
