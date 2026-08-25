import { describe, it, expect } from "vitest";
import { measureChunks, packFooterLines } from "./layout.js";

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
    const groups = packFooterLines(chunks, measureChunks(chunks) + 10, 3);
    expect(groups).toEqual([chunks]);
  });

  it("exactly-fits means one line (boundary is inclusive)", () => {
    const chunks = [DIR, BRANCH];
    const width = measureChunks(chunks); // 1 + 3 + 40
    expect(packFooterLines(chunks, width, 3)).toEqual([chunks]);
  });

  it("wraps the tail to a second line when it no longer fits", () => {
    const chunks = [DIR, BRANCH, WORKTREE, MODEL, THINKING, STATS];
    const oneLineW = measureChunks(chunks);

    // One less column than needed → STATS drops to its own line
    const groups = packFooterLines(chunks, oneLineW - 1, 3);
    expect(groups).toEqual([[DIR, BRANCH, WORKTREE, MODEL, THINKING], [STATS]]);
  });

  it("wraps left sections when they alone overflow (three lines)", () => {
    // ""(1) + sep + 40"" fits, +worktree doesn't.
    // worktree+model+thinking (55) fits, +stats (78) doesn't.
    const chunks = [DIR, BRANCH, WORKTREE, MODEL, THINKING, STATS];
    const groups = packFooterLines(chunks, 70, 3);
    expect(groups).toEqual([
      [DIR, BRANCH],
      [WORKTREE, MODEL, THINKING],
      [STATS],
    ]);
  });

  it("gives an over-wide chunk its own line", () => {
    const huge = "x".repeat(120); // wider than the terminal
    const groups = packFooterLines([DIR, huge, STATS], 60, 3);
    expect(groups).toEqual([[DIR], [huge], [STATS]]);
  });

  it("splits per chunk on a near-zero width", () => {
    const groups = packFooterLines([DIR, MODEL], 0, 3);
    expect(groups).toEqual([[DIR], [MODEL]]);
  });

  it("respects a custom separator width", () => {
    // separator of 0: dir(1) and branch(40) fit in 41
    expect(packFooterLines(["a", "b".repeat(40)], 41, 0)).toHaveLength(1);
    // no slack for separator 3 → wraps
    expect(packFooterLines(["a", "b".repeat(40)], 41, 3)).toHaveLength(2);
  });
});
