import { describe, it, expect } from "vitest";
import { wordDiffAnalysis, injectBg, plainWordDiff } from "./word-diff.js";
import * as Ansi from "./ansi/index.js";
import type { DiffBg } from "./ansi/index.js";

// ── wordDiffAnalysis ────────────────────────────────────────────────────────

describe("wordDiffAnalysis", () => {
  it("identical strings → similarity 1, empty ranges", () => {
    const result = wordDiffAnalysis("hello world", "hello world");
    expect(result.similarity).toBe(1);
    expect(result.oldRanges).toEqual([]);
    expect(result.newRanges).toEqual([]);
  });

  it("completely different → similarity 0, full ranges", () => {
    const result = wordDiffAnalysis("abc", "xyz");
    expect(result.similarity).toBe(0);
    expect(result.oldRanges).toEqual([[0, 3]]);
    expect(result.newRanges).toEqual([[0, 3]]);
  });

  it("partial overlap → correct similarity and ranges", () => {
    const result = wordDiffAnalysis("hello world", "hello earth");
    expect(result.similarity).toBeGreaterThan(0);
    expect(result.similarity).toBeLessThan(1);
    // "world" changed to "earth" — both 5 chars, same position in new string
    expect(result.oldRanges.length).toBeGreaterThan(0);
    expect(result.newRanges.length).toBeGreaterThan(0);
  });

  it("one empty string", () => {
    const result = wordDiffAnalysis("hello", "");
    expect(result.similarity).toBe(0);
    expect(result.oldRanges).toEqual([[0, 5]]);
    expect(result.newRanges).toEqual([]);
  });

  it("both empty → similarity 1", () => {
    const result = wordDiffAnalysis("", "");
    expect(result.similarity).toBe(1);
    expect(result.oldRanges).toEqual([]);
    expect(result.newRanges).toEqual([]);
  });
});

// ── injectBg ────────────────────────────────────────────────────────────────

describe("injectBg", () => {
  const baseBg = "\x1b[48;2;10;20;30m";
  const hlBg = "\x1b[48;2;200;50;50m";

  it("no ranges returns baseBg + ansiLine + Ansi.RST (trailing reset!)", () => {
    const result = injectBg("hello", [], baseBg, hlBg);
    expect(result).toBe(baseBg + "hello" + Ansi.RST);
  });

  it("single range with concrete example", () => {
    // "hello" with highlight on [2,4] → "he" + highlight "ll" + "o"
    const result = injectBg("hello", [[2, 4]], baseBg, hlBg);
    expect(result).toBe(
      baseBg + "he" + hlBg + "ll" + baseBg + "o" + Ansi.RST
    );
  });

  it("overlapping ranges merged", () => {
    // [[1, 4], [3, 6]] should merge to [[1, 6]]
    const result = injectBg("abcdef", [[1, 4], [3, 6]], baseBg, hlBg);
    // "a" is base, "bcdef" is highlighted
    expect(result).toBe(
      baseBg + "a" + hlBg + "bcdef" + Ansi.RST
    );
  });

  it("\\x1b[0m triggers bg re-injection", () => {
    // When a reset appears mid-string, bg should be re-injected after it
    const ansiLine = "he\x1b[0mllo";
    const result = injectBg(ansiLine, [[2, 4]], baseBg, hlBg);
    // After \x1b[0m, the bg should be re-injected
    expect(result).toContain(baseBg);
    // The reset should still be present
    expect(result).toContain("\x1b[0m");
  });
});

// ── plainWordDiff ───────────────────────────────────────────────────────────

describe("plainWordDiff", () => {
  const dbg: DiffBg = Ansi.DEFAULT_DIFF_BG;

  it("removed text gets del bg", () => {
    const result = plainWordDiff("hello world", "hello", dbg);
    expect(result.old).toContain(dbg.bgDelW);
    expect(result.old).toContain("world");
    expect(result.new).toBe("hello");
  });

  it("added text gets add bg", () => {
    const result = plainWordDiff("hello", "hello world", dbg);
    expect(result.new).toContain(dbg.bgAddW);
    expect(result.new).toContain("world");
    // diffWords treats the space as unchanged, so old includes trailing space
    expect(result.old).toBe("hello ");
  });

  it("unchanged passed through", () => {
    const result = plainWordDiff("hello", "hello", dbg);
    expect(result.old).toBe("hello");
    expect(result.new).toBe("hello");
  });
});
