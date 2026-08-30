import { describe, it, expect } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  formatTokenCount,
  formatContextBar,
  formatGitStatusIndicators,
  formatThinkingIndicator,
} from "./format.js";
import { thinkingLevelColors } from "./icons.js";
import type { ColorFn } from "./icons.js";

// ── Mock ColorFn ────────────────────────────────────────────────────────────
// Passthrough — we test structure, not actual coloring.
const mockColor: ColorFn = (_token, text) => text;

// ── formatTokenCount ────────────────────────────────────────────────────────

describe("formatTokenCount", () => {
  it("returns '0' for zero", () => {
    expect(formatTokenCount(0)).toBe("0");
  });

  it("returns raw number below 1K", () => {
    expect(formatTokenCount(500)).toBe("500");
  });

  it("returns '1.0k' for exactly 1024", () => {
    expect(formatTokenCount(1024)).toBe("1.0k");
  });

  it("returns '10k' for 10240", () => {
    expect(formatTokenCount(10240)).toBe("10k");
  });

  it("returns '1.0M' for exactly 1M", () => {
    expect(formatTokenCount(1048576)).toBe("1.0M");
  });

  it("returns '10M' for 10M", () => {
    expect(formatTokenCount(10485760)).toBe("10M");
  });
});

// ── formatContextBar ────────────────────────────────────────────────────────

describe("formatContextBar", () => {
  it("returns empty string when availableSpace <= 2", () => {
    expect(formatContextBar(mockColor, 50, 0)).toBe("");
    expect(formatContextBar(mockColor, 50, 1)).toBe("");
    expect(formatContextBar(mockColor, 50, 2)).toBe("");
  });

  it("0% produces bar of empty segments (not empty string)", () => {
    const result = formatContextBar(mockColor, 0, 10);
    expect(result).not.toBe("");
    // Should contain the context window icon and "0%"
    expect(result).toContain("0%");
    // Should contain bar segments (━) — all empty, no filled portion
    expect(result).toContain("━━━");
    // Must NOT contain higher percentage labels (50%, 100%, etc.)
    expect(result).not.toContain("50%");
    expect(result).not.toContain("100%");
  });

  it("50% produces half-filled bar", () => {
    const result = formatContextBar(mockColor, 50, 10);
    expect(result).not.toBe("");
    expect(result).toContain("50%");
  });

  it("100% produces full bar", () => {
    const result = formatContextBar(mockColor, 100, 10);
    expect(result).not.toBe("");
    expect(result).toContain("100%");
  });

  it("returns bar with icon and percentage", () => {
    const result = formatContextBar(mockColor, 75, 10);
    expect(result).toContain("75%");
  });

  it("occupies exactly totalSpace visible columns", () => {
    expect(visibleWidth(formatContextBar(mockColor, 50, 24))).toBe(24);
    expect(visibleWidth(formatContextBar(mockColor, 100, 30))).toBe(30);
    expect(visibleWidth(formatContextBar(mockColor, 0, 16))).toBe(16);
  });

  it("returns empty when the fixed overhead alone would not fit", () => {
    // icon + gaps (4) + label leave no room for a bar segment
    expect(formatContextBar(mockColor, 50, 7)).toBe("");
    expect(formatContextBar(mockColor, 100, 8)).toBe("");
  });
});

// ── formatGitStatusIndicators ───────────────────────────────────────────────

describe("formatGitStatusIndicators", () => {
  const emptyStatus = {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    ahead: 0,
    behind: 0,
  };

  it("zero counts returns empty string", () => {
    expect(formatGitStatusIndicators(emptyStatus, mockColor)).toBe("");
  });

  it("staged > 0 shows indicator", () => {
    const result = formatGitStatusIndicators(
      { ...emptyStatus, staged: 3 },
      mockColor,
    );
    expect(result).toContain("●3");
  });

  it("multiple counts shows all indicators", () => {
    const result = formatGitStatusIndicators(
      { ...emptyStatus, staged: 2, unstaged: 5, untracked: 1 },
      mockColor,
    );
    expect(result).toContain("●2");
    expect(result).toContain("~5");
    expect(result).toContain("U1");
  });

  it("ahead and behind show indicators", () => {
    const result = formatGitStatusIndicators(
      { ...emptyStatus, ahead: 3, behind: 1 },
      mockColor,
    );
    expect(result).toContain("↑3");
    expect(result).toContain("↓1");
  });
});

// ── formatThinkingIndicator ─────────────────────────────────────────────────

describe("formatThinkingIndicator", () => {
  it("off returns empty string", () => {
    expect(formatThinkingIndicator("off", mockColor)).toBe("");
  });

  it("other levels return indicator with level name", () => {
    expect(formatThinkingIndicator("minimal", mockColor)).toBe("◐ minimal");
    expect(formatThinkingIndicator("low", mockColor)).toBe("◐ low");
    expect(formatThinkingIndicator("medium", mockColor)).toBe("◐ medium");
    expect(formatThinkingIndicator("high", mockColor)).toBe("◐ high");
    expect(formatThinkingIndicator("xhigh", mockColor)).toBe("◐ xhigh");
    expect(formatThinkingIndicator("max", mockColor)).toBe("◐ max");
  });

  it("max uses the thinkingMax theme token", () => {
    expect(thinkingLevelColors["max"]).toBe("thinkingMax");
  });
});
