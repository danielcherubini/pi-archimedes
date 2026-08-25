import { describe, it, expect } from "vitest";
import { stripAnsi, clampLines } from "@pi-archimedes/core/text";
import { packFooterLines } from "./layout.js";
import { formatContextBar } from "./format.js";
import { visibleWidth } from "@earendil-works/pi-tui";

// Minimal stand-ins: same visible chars as the real footer, no ANSI
// left joined: dir(7)+sep+branch(38)+sep+worktree(36)+sep+model(20)+sep+thinking(6) = 119
// full single line (left + stats 37): 159
const DIR = "📁 auth";
const BRANCH = "⎇ feat/plan-040-jwt-cookie-security+~3"; // + fake status
const WORKTREE = "⛅ feat/plan-040-jwt-cookie-security";
const MODEL = "🧠 claude-sonnet-4-6";
const THINKING = "◐ high";
const STATS = "↑141 ↓42k R8.7M W220k $4.25 116k/977k";

function buildLines(width: number, pct: number, splitThreshold = 150) {
  const leftSections = [
    DIR,
    BRANCH,
    WORKTREE,
    MODEL,
    THINKING,
  ].filter(Boolean);
  const SEP_W = 3;
  let groups = packFooterLines([...leftSections, STATS], width, SEP_W);
  if (groups.length < 2 && width < splitThreshold && leftSections.length > 0) {
    groups = [leftSections, [STATS]];
  }
  return groups
    .map((g, idx) => {
      let line = g.join(" · ");
      if (idx === groups.length - 1) {
        const remaining = width - visibleWidth(line) - (line ? SEP_W : 0);
        const bar = formatContextBar((t, s) => s, pct, remaining);
        if (bar) line = line ? line + " · " + bar : bar;
      }
      return line;
    })
    .map((l) => "\x1b[0m" + l); // put a dummy escape in to exercise stripAnsi below
}

describe("render glue simulation", () => {
  it("wide terminal (width 200): single line, nothing clipped, bar exactly fills", () => {
    const lines = buildLines(200, 12);
    expect(lines.length).toBe(1);
    // clamp to terminal — must survive (nothing cut)
    const [clamped] = clampLines(lines, 200);
    expect(stripAnsi(clamped!)).toContain("116k/977k");
    expect(visibleWidth(stripAnsi(clamped!))).toBeLessThanOrEqual(200);
    // stats line ends with the bar percentage label
    expect(stripAnsi(lines[0]!)).toContain("12%");
  });

  it("user's terminal: one column short of fitting → two lines, nothing lost", () => {
    const lines = buildLines(158, 12);
    expect(lines.length).toBe(2);
    expect(stripAnsi(lines[0]!)).toContain("auth");
    expect(stripAnsi(lines[0]!)).toContain("feat/plan-"); // worktree on line 1
    expect(stripAnsi(lines[1]!)).toContain("116k/977k");
    expect(stripAnsi(lines[1]!)).toContain("12%");
  });

  it("narrow (width 69): three lines", () => {
    const lines = buildLines(69, 12, 150);
    expect(lines.length).toBe(3);
    const all = lines.map((l) => stripAnsi(l)).join(" | ");
    expect(all).toContain("116k/977k");
    expect(all).toContain("12%");
  });

  it("below splitThreshold but fits in one line → forced two lines", () => {
    const lines = buildLines(165, 12, 200); // 159 + bar ≤ 165 fits one line; 165 < 200 forces split
    expect(lines.length).toBe(2);
  });

  it("very narrow (width 40): bar is dropped, stats still present, no line exceeds 40 cols", () => {
    const lines = buildLines(40, 12);
    const stripped = lines.map((l) => stripAnsi(l));
    // Bar should be dropped — no % sign in any line
    expect(stripped.every((l) => !l.includes("%"))).toBe(true);
    // Stats should still appear somewhere
    const all = stripped.join(" ");
    expect(all).toContain("116k/977k");
    // No line exceeds 40 visible columns
    expect(lines.every((l) => visibleWidth(stripAnsi(l)) <= 40)).toBe(true);
  });
});
