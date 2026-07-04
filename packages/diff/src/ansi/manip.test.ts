import { describe, it, expect } from "vitest";
import { strip, tabs, fit, ansiState, isLowContrastShikiFg, normalizeShikiContrast, lnum, shortPath, summarize } from "./manip.js";
import * as C from "./codes.js";

// ── strip ───────────────────────────────────────────────────────────────────

describe("strip", () => {
  it("removes SGR sequences", () => {
    expect(strip("\x1b[31mred\x1b[0m")).toBe("red");
    expect(strip("\x1b[1m\x1b[31mhi\x1b[0m")).toBe("hi");
  });

  it("empty string stays empty", () => {
    expect(strip("")).toBe("");
  });
});

// ── tabs ────────────────────────────────────────────────────────────────────

describe("tabs", () => {
  it("replaces \\t with 2 spaces", () => {
    expect(tabs("a\tb")).toBe("a  b");
    expect(tabs("\t")).toBe("  ");
    expect(tabs("no\ttabs\there")).toBe("no  tabs  here");
  });
});

// ── fit ─────────────────────────────────────────────────────────────────────

describe("fit", () => {
  it("truncates to width (ASCII)", () => {
    const result = fit("hello world", 8);
    expect(result).toContain("hello");
    // Should end with truncation indicator
    expect(result).toContain("›");
  });

  it("truncates to width (wide chars — never splits grapheme)", () => {
    // "中日" is 4 columns. fit to 3 should drop "日" (2 cols) since it
    // would overflow, keeping only "中" (2 cols)
    const result = fit("中日", 3);
    expect(result).toContain("中");
    // "日" should not appear since it's 2 cols and would overflow budget of 2 (3-1)
    expect(result).not.toContain("日");
  });

  it("pads short strings", () => {
    const result = fit("hi", 5);
    expect(result).toBe("hi   ");
  });

  it("width 0 returns empty", () => {
    expect(fit("hello", 0)).toBe("");
  });

  it("wide grapheme wider than budget is dropped", () => {
    // Budget of 1 — wide char "中" (2 cols) can't fit, should be dropped
    const result = fit("中", 1);
    expect(result).not.toContain("中");
  });
});

// ── ansiState ───────────────────────────────────────────────────────────────

describe("ansiState", () => {
  it("extracts last fg code (truecolor)", () => {
    const state = ansiState("\x1b[38;2;255;0;0mhello");
    expect(state).toContain("\x1b[38;2;255;0;0m");
  });

  it("extracts last bg code (truecolor)", () => {
    const state = ansiState("\x1b[48;2;0;255;0mhello");
    expect(state).toContain("\x1b[48;2;0;255;0m");
  });

  it("returns bg + fg (background first!)", () => {
    const state = ansiState("\x1b[38;2;255;0;0m\x1b[48;2;0;0;255mtext");
    // bg should come before fg in the return value
    const bgIdx = state.indexOf("\x1b[48;2;0;0;255m");
    const fgIdx = state.indexOf("\x1b[38;2;255;0;0m");
    expect(bgIdx).toBeLessThan(fgIdx);
  });

  it("\\x1b[0m resets both", () => {
    const state = ansiState("\x1b[38;2;255;0;0m\x1b[0m");
    expect(state).toBe("");
  });

  it("truecolor fg/bg", () => {
    const state = ansiState("\x1b[38;2;255;0;0m\x1b[48;2;0;0;255mtext");
    expect(state).toContain("\x1b[38;2;255;0;0m");
    expect(state).toContain("\x1b[48;2;0;0;255m");
  });

  it("\\x1b[39m resets only fg", () => {
    const state = ansiState("\x1b[38;2;255;0;0m\x1b[48;2;0;0;255m\x1b[39mtext");
    expect(state).toContain("\x1b[48;2;0;0;255m");
    expect(state).not.toContain("\x1b[38;2;255;0;0m");
  });

  it("plain ANSI codes (31, 42) are not tracked — Shiki uses truecolor", () => {
    // ansiState only tracks 38;..., 48;..., 39, 0 — plain codes like 31/42 pass through
    const state = ansiState("\x1b[31m\x1b[42mhello");
    expect(state).toBe("");
  });
});

// ── isLowContrastShikiFg ────────────────────────────────────────────────────

describe("isLowContrastShikiFg", () => {
  it('"30" = true (dark black)', () => {
    expect(isLowContrastShikiFg("30")).toBe(true);
  });

  it('"90" = true (dark gray)', () => {
    expect(isLowContrastShikiFg("90")).toBe(true);
  });

  it('"38;5;0" = true (256 palette black)', () => {
    expect(isLowContrastShikiFg("38;5;0")).toBe(true);
  });

  it('"38;5;8" = true (256 palette dark gray)', () => {
    expect(isLowContrastShikiFg("38;5;8")).toBe(true);
  });

  it('"38;2;0;0;0" = true (truecolor black)', () => {
    expect(isLowContrastShikiFg("38;2;0;0;0")).toBe(true);
  });

  it('"38;2;255;255;255" = false (truecolor white)', () => {
    expect(isLowContrastShikiFg("38;2;255;255;255")).toBe(false);
  });

  it('"0" = false (reset, not a fg code)', () => {
    expect(isLowContrastShikiFg("0")).toBe(false);
  });

  it('"38;5;5" = false (256 palette not-dark)', () => {
    expect(isLowContrastShikiFg("38;5;5")).toBe(false);
  });

  it('"48;2;0;0;0" = false (background not foreground)', () => {
    expect(isLowContrastShikiFg("48;2;0;0;0")).toBe(false);
  });
});

// ── normalizeShikiContrast ──────────────────────────────────────────────────

describe("normalizeShikiContrast", () => {
  it("replaces low-contrast codes", () => {
    // \x1b[30m is dark black — should be replaced
    const result = normalizeShikiContrast("\x1b[30mtext\x1b[0m");
    expect(result).toContain(C.FG_SAFE_MUTED);
    expect(result).not.toContain("\x1b[30m");
  });

  it("leaves high-contrast alone", () => {
    // \x1b[37m is white — should pass through
    const result = normalizeShikiContrast("\x1b[37mtext\x1b[0m");
    expect(result).toContain("\x1b[37m");
  });
});

// ── lnum ────────────────────────────────────────────────────────────────────

describe("lnum", () => {
  it("formats number right-padded", () => {
    const result = lnum(42, 5);
    expect(result).toContain("42");
    // Should have spaces before the number
    const stripped = result.replace(C.RST, "").replace(C.FG_LNUM, "");
    expect(stripped).toBe("   42");
  });

  it("null produces spaces", () => {
    const result = lnum(null, 5);
    expect(result).toBe("     ");
  });
});

// ── shortPath ───────────────────────────────────────────────────────────────

describe("shortPath", () => {
  it("relative to cwd returns relative", () => {
    const result = shortPath("/home/user/project", "/home/user", "/home/user/project/src/file.ts");
    expect(result).toBe("src/file.ts");
  });

  it("outside cwd with home returns ~", () => {
    const result = shortPath("/home/user/project", "/home/user", "/home/user/other/file.ts");
    expect(result).toBe("~/other/file.ts");
  });

  it("empty returns empty", () => {
    expect(shortPath("/cwd", "/home", "")).toBe("");
  });
});

// ── summarize ───────────────────────────────────────────────────────────────

describe("summarize", () => {
  it("+N -M format", () => {
    const result = summarize(3, 2);
    expect(result).toContain("+3");
    expect(result).toContain("-2");
  });

  it("zero changes returns 'no changes'", () => {
    const result = summarize(0, 0);
    expect(result).toContain("no changes");
  });
});
