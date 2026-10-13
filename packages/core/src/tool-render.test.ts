import { describe, it, expect } from "vitest";
import {
  renderToolHeader,
  renderStatusLabel,
  renderToolCallLine,
  STATUS_GLYPH,
  toolRowDuration,
  type ToolRenderTheme,
} from "./tool-render.js";

// Fake theme: wraps text in visible markers so assertions can verify tokens.
const theme: ToolRenderTheme = {
  fg: (token: string, text: string) => `[${token}:${text}]`,
  bold: (text: string) => `**${text}**`,
};

describe("renderToolHeader", () => {
  it("renders blue bold tool name + orange action", () => {
    expect(renderToolHeader("mcp", "atlassian", theme)).toBe(
      "[toolTitle:**mcp**] [accent:atlassian]",
    );
  });

  it("renders the name only when action is empty", () => {
    expect(renderToolHeader("todo", "", theme)).toBe("[toolTitle:**todo**]");
    expect(renderToolHeader("todo", undefined, theme)).toBe(
      "[toolTitle:**todo**]",
    );
  });
});

describe("renderStatusLabel", () => {
  it("running: muted glyph + muted label", () => {
    expect(renderStatusLabel("running", "2/4 completed", theme)).toBe(
      "[muted:▸ ][muted:2/4 completed]",
    );
  });

  it("success: green glyph + muted label", () => {
    expect(renderStatusLabel("success", "done", theme)).toBe(
      "[success:✓ ][muted:done]",
    );
  });

  it("error: red glyph + muted label", () => {
    expect(renderStatusLabel("error", "boom", theme)).toBe(
      "[error:✗ ][muted:boom]",
    );
  });

  it("exposes the glyph map", () => {
    expect(STATUS_GLYPH).toEqual({ running: "▸", success: "✓", error: "✗" });
  });
});

describe("renderToolCallLine", () => {
  it("success: green glyph + green name + dim suffix", () => {
    expect(renderToolCallLine("success", "read", ": /path", theme)).toBe(
      "[success:✓ ][success:read][dim:: /path]",
    );
  });

  it("error: red glyph + red name + dim suffix", () => {
    expect(renderToolCallLine("error", "read", ": /missing", theme)).toBe(
      "[error:✗ ][error:read][dim:: /missing]",
    );
  });

  it("running: muted glyph + muted name", () => {
    expect(renderToolCallLine("running", "grep", ": pattern | 2s", theme)).toBe(
      "[muted:▸ ][muted:grep][dim:: pattern | 2s]",
    );
  });

  it("omits the dim fragment when suffix is empty", () => {
    expect(renderToolCallLine("success", "bash", "", theme)).toBe(
      "[success:✓ ][success:bash]",
    );
  });
});

describe("toolRowDuration", () => {
  it("takes a settled row's duration from the result, so it survives a session reload", () => {
    // A row re-rendered from a stored session has no renderer state at all —
    // only the duration the result recorded.
    expect(toolRowDuration({ durationMs: 4200 }, { isPartial: false })).toEqual({
      label: "Took",
      ms: 4200,
    });
  });

  it("prefers the recorded duration over the row's own clock, so wall-clock steps are excluded", () => {
    // The row started 90s of real time ago; the tool itself reported 1.5s.
    const startedAt = Date.now() - 90_000;
    expect(toolRowDuration({ durationMs: 1500, startedAt }, { isPartial: false })).toEqual({
      label: "Took",
      ms: 1500,
    });
  });

  it("counts from the row's own clock while the result is still partial", () => {
    const startedAt = Date.now() - 2500;
    const out = toolRowDuration({ startedAt }, { isPartial: true });
    expect(out?.label).toBe("Elapsed");
    expect(out?.ms).toBeGreaterThanOrEqual(2400);
    expect(out?.ms).toBeLessThan(5000);
  });

  it("falls back to the row's clock for a settled result that recorded no duration", () => {
    expect(
      toolRowDuration({ startedAt: Date.now() - 1000, endedAt: Date.now() }, { isPartial: false }),
    ).toMatchObject({ label: "Took" });
  });

  it("says nothing about a row that never started and recorded nothing", () => {
    expect(toolRowDuration({}, { isPartial: false })).toBeUndefined();
    expect(toolRowDuration({}, { isPartial: true })).toBeUndefined();
  });

  it("finalises an errored row from its clock even while the result is partial", () => {
    const out = toolRowDuration(
      { startedAt: Date.now() - 800, endedAt: Date.now() },
      { isPartial: true, isError: true },
    );
    expect(out?.label).toBe("Took");
  });
});
