import { describe, it, expect } from "vitest";
import {
  renderToolHeader,
  renderStatusLabel,
  renderToolCallLine,
  STATUS_GLYPH,
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
