import { describe, it, expect } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { packFooterLines, SEP_W } from "./layout.js";

/** Local copy of measureChunks (not exported from layout.ts — test-only helper). */
function measureChunks(chunks: string[], sepWidth = SEP_W): number {
  let w = 0;
  for (let i = 0; i < chunks.length; i++) {
    w += (i > 0 ? sepWidth : 0) + visibleWidth(chunks[i]!);
  }
  return w;
}

// Plain-Chinese chunks keep the math readable; packFooterLines only
// needs to *measure* them, not render them.
const DIR = "a"; // dir section
const BRANCH = "b".repeat(40); // branch section
const WORKTREE = "w".repeat(40); // worktree section
const MODEL = "model"; // model section
const THINKING = "high"; // thinking level
const STATS = "s".repeat(20); // stats section

describe("measureChunks", () => {
  it("measures a single chunk", () => {
    expect(measureChunks(["abcde"])).toBe(5);
  });

  it("measures joined chunks with the separator", () => {
    expect(measureChunks(["ab", "cde"])) // 2 + 3 + 3
      .toBe(8);
    expect(measureChunks(["ab", "cde", "fg"])) // 2 + (3+3) + (2+3)
      .toBe(13);
  });

  it("measures empty chunks as zero", () => {
    expect(measureChunks([])).toBe(0);
  });
});

describe("packFooterLines", () => {
  it("returns an empty array for empty chunks", () => {
    expect(packFooterLines([], 100, 3)).toEqual([]);
  });

  it("keeps everything on one line when it fits", () => {
    const chunks = [DIR, BRANCH, WORKTREE, MODEL, THINKING, STATS];
    const groups = packFooterLines(chunks, measureChunks(chunks) + 10, SEP_W);
    expect(groups).toEqual([chunks]);
  });

  it("exactly-fits means one line (boundary is inclusive)", () => {
    const chunks = [DIR, BRANCH];
    const width = measureChunks(chunks); // 1 + SEP_W + 40
    expect(packFooterLines(chunks, width, SEP_W)).toEqual([chunks]);
  });

  it("wraps the tail to a second line when it no longer fits", () => {
    const chunks = [DIR, BRANCH, WORKTREE, MODEL, THINKING, STATS];
    const oneLineW = measureChunks(chunks);

    // One less column than needed → STATS drops to its own line
    const groups = packFooterLines(chunks, oneLineW - 1, SEP_W);
    expect(groups).toEqual([[DIR, BRANCH, WORKTREE, MODEL, THINKING], [STATS]]);
  });

  it("wraps left sections when they alone overflow (three lines)", () => {
    // ""(1) + sep + 40"" fits, +worktree doesn't.
    // worktree+model+thinking (55) fits, +stats (78) doesn't.
    const chunks = [DIR, BRANCH, WORKTREE, MODEL, THINKING, STATS];
    const groups = packFooterLines(chunks, 70, SEP_W);
    expect(groups).toEqual([
      [DIR, BRANCH],
      [WORKTREE, MODEL, THINKING],
      [STATS],
    ]);
  });

  it("gives an over-wide chunk its own line", () => {
    const huge = "x".repeat(120); // wider than the terminal
    const groups = packFooterLines([DIR, huge, STATS], 60, SEP_W);
    expect(groups).toEqual([[DIR], [huge], [STATS]]);
  });

  it("splits per chunk on a near-zero width", () => {
    const groups = packFooterLines([DIR, MODEL], 0, SEP_W);
    expect(groups).toEqual([[DIR], [MODEL]]);
  });

  it("respects a custom separator width", () => {
    // separator of 0: dir(1) and branch(40) fit in 41
    expect(packFooterLines(["a", "b".repeat(40)], 41, 0)).toHaveLength(1);
    // no slack for separator SEP_W → wraps
    expect(packFooterLines(["a", "b".repeat(40)], 41, SEP_W)).toHaveLength(2);
  });

  it("measures ANSI-escaped chunks by their visible width only", () => {
    const plain = "branch"; // 6 visible cols
    const ansi = "\x1b[32mbranch\x1b[0m"; // same 6 visible cols, with color escape
    // Both should produce the same grouping structure:
    // "branch" (6) + sep (3) + "stats" (5) = 14 ≤ 20 → one group of two
    const plainGroups = packFooterLines([plain, "stats"], 20, 3);
    const ansiGroups = packFooterLines([ansi, "stats"], 20, 3);
    // Same number of lines and same number of chunks per line
    expect(plainGroups.map((g) => g.length)).toEqual(ansiGroups.map((g) => g.length));
    expect(plainGroups.length).toBe(1);
  });
});
