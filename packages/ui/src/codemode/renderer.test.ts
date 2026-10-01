import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  formatCodemodeDuration,
  formatCost,
  formatNestedCall,
  getCodemodeOutput,
  parseWallTimeMs,
  renderCodemodeCall,
  renderCodemodeResult,
  clearActiveCodemodeIntervals,
  setCodemodeOutputStyle,
  PreviewTextComponent,
} from "./renderer.js";

// Mock Text from @earendil-works/pi-tui while preserving real utility
// functions (getCapabilities, imageFallback, …). The mock's render()
// returns the raw lines (no padding), so assertions stay exact.
vi.mock("@earendil-works/pi-tui", async () => {
  const actual =
    await vi.importActual<typeof import("@earendil-works/pi-tui")>(
      "@earendil-works/pi-tui",
    );
  class MockText {
    private _content = "";

    constructor(initial: string = "") {
      this._content = initial;
    }

    setText(content: string): void {
      this._content = content;
    }

    getContent(): string {
      return this._content;
    }

    invalidate(): void {}

    render(): string[] {
      return this._content ? this._content.split("\n") : [""];
    }
  }
  return {
    ...actual,
    Text: MockText,
  };
});

// Mock highlightCode from the agent package (Shiki-backed, not available in
// unit tests) with a stable per-line marker.
vi.mock("@earendil-works/pi-coding-agent", async () => {
  const actual =
    await vi.importActual<typeof import("@earendil-works/pi-coding-agent")>(
      "@earendil-works/pi-coding-agent",
    );
  return {
    ...actual,
    highlightCode: (code: string) =>
      code.split("\n").map((line) => `<hl:${line}>`),
  };
});

type ComponentShim = { render(width: number): string[] };
const lines = (c: unknown) => (c as unknown as ComponentShim).render(80);
const text = (c: unknown) => lines(c).join("\n");

// Test theme wrapping in markers
const theme = {
  fg: (token: string, text?: string) =>
    text === undefined ? `[${token}]` : `[${token}:${text}]`,
  bold: (t: string) => `**${t}**`,
} as unknown as Theme;

// The renderer reads the style from module state; every test starts from
// the default (Minimal).
beforeEach(() => {
  setCodemodeOutputStyle("Minimal");
});

describe("formatCodemodeDuration", () => {
  it("formats milliseconds for under a second", () => {
    expect(formatCodemodeDuration(0)).toBe("0ms");
    expect(formatCodemodeDuration(42)).toBe("42ms");
    expect(formatCodemodeDuration(999)).toBe("999ms");
  });

  it("formats seconds with one decimal at a second and up", () => {
    expect(formatCodemodeDuration(1000)).toBe("1.0s");
    expect(formatCodemodeDuration(1500)).toBe("1.5s");
    expect(formatCodemodeDuration(12345)).toBe("12.3s");
  });

  it("returns an empty string for undefined and clamps negatives", () => {
    expect(formatCodemodeDuration(undefined)).toBe("");
    expect(formatCodemodeDuration(-5)).toBe("0ms");
  });
});

describe("formatCost", () => {
  it("formats dollars with two decimals at a cent and up", () => {
    expect(formatCost(0.5)).toBe("$0.50");
    expect(formatCost(1.234)).toBe("$1.23");
  });

  it("formats fractions of a cent with two significant digits", () => {
    expect(formatCost(0.001234)).toBe("$0.0012");
    expect(formatCost(0.0005)).toBe("$0.00050");
  });
});

describe("formatNestedCall", () => {
  it("renders glyph, name, args, duration, and cost", () => {
    const line = formatNestedCall(
      {
        id: "1/1",
        name: "mcp__postgres__run_select",
        args: '{"sql":"SELECT 1"}',
        status: "ok",
        durationMs: 32,
        cost: 0.0012,
      },
      theme,
      false,
    );
    expect(line).toBe(
      "[success:✓] [toolTitle:mcp__postgres__run_select] [muted:{\"sql\":\"SELECT 1\"}] [dim:32ms] [dim:$0.0012]",
    );
  });

  it("truncates long args when collapsed but not when expanded", () => {
    const args = "a".repeat(100);
    const collapsed = formatNestedCall(
      { id: "1", name: "t", args, status: "ok" },
      theme,
      false,
    );
    expect(collapsed).toContain(`[muted:${"a".repeat(77)}...]`);
    const expanded = formatNestedCall(
      { id: "1", name: "t", args, status: "ok" },
      theme,
      true,
    );
    expect(expanded).toContain(`[muted:${args}]`);
  });

  it("omits empty args, duration, and cost", () => {
    const line = formatNestedCall(
      { id: "1", name: "t", args: "", status: "running" },
      theme,
      false,
    );
    expect(line).toBe("[warning:…] [toolTitle:t]");
  });

  it("appends the indented error text only when expanded", () => {
    const call = {
      id: "1",
      name: "t",
      args: "",
      status: "error" as const,
      error: "line1\nline2",
    };
    expect(formatNestedCall(call, theme, false)).toBe("[error:✗] [toolTitle:t]");
    // The whole multi-line error is one styled block, indented per line.
    expect(formatNestedCall(call, theme, true)).toBe(
      "[error:✗] [toolTitle:t]\n    [error:line1\n    line2]",
    );
  });

  it("uses a muted glyph for cancelled calls", () => {
    const line = formatNestedCall(
      { id: "1", name: "t", args: "", status: "cancelled" },
      theme,
      false,
    );
    expect(line).toBe("[muted:⊘] [toolTitle:t]");
  });
});

describe("parseWallTimeMs", () => {
  it("parses the wall time from the result header", () => {
    expect(
      parseWallTimeMs([
        { type: "text", text: "Script completed\nWall time 0.4 seconds\nOutput:\n" },
      ]),
    ).toBe(400);
  });

  it("parses failed-script headers too", () => {
    expect(
      parseWallTimeMs([
        { type: "text", text: "Script failed\nWall time 12.5 seconds\nOutput:\n" },
      ]),
    ).toBe(12500);
  });

  it("returns undefined without a header or for non-text first blocks", () => {
    expect(parseWallTimeMs([{ type: "text", text: "plain output" }])).toBe(
      undefined,
    );
    expect(parseWallTimeMs([{ type: "image" }])).toBe(undefined);
    expect(parseWallTimeMs([])).toBe(undefined);
  });
});

describe("getCodemodeOutput", () => {
  it("drops the script header when present", () => {
    const out = getCodemodeOutput(
      [
        {
          type: "text",
          text: "Script completed\nWall time 0.1 seconds\nOutput:\n",
        },
        { type: "text", text: "line1\nline2" },
      ],
      true,
    );
    expect(out).toBe("line1\nline2");
  });

  it("keeps the first block when it has no header", () => {
    const out = getCodemodeOutput(
      [{ type: "text", text: "just output" }],
      true,
    );
    expect(out).toBe("just output");
  });

  it("joins text blocks and ignores non-text blocks", () => {
    const out = getCodemodeOutput(
      [
        { type: "text", text: "a" },
        { type: "image", data: "x", mimeType: "image/png" },
        { type: "text", text: "b" },
      ],
      true,
    );
    expect(out).toBe("a\nb");
  });
});

describe("renderCodemodeCall", () => {
  it("renders the bold codemode header when code is absent", () => {
    const out = renderCodemodeCall({}, theme, {});
    expect(text(out)).toBe("[toolTitle:**codemode**]");
  });

  it("renders an invalid-arg marker for a non-string code", () => {
    const out = renderCodemodeCall({ code: 42 }, theme, {});
    expect(text(out)).toBe("[toolTitle:**codemode**] [error:[invalid arg]]");
  });

  it("falls back to context.args.code when absent from args (expanded)", () => {
    const out = renderCodemodeCall(
      {},
      theme,
      { args: { code: "console.log(1)" }, expanded: true },
    );
    expect(text(out)).toContain("<hl:console.log(1)>");
  });

  it("renders the full highlighted script when expanded", () => {
    const out = renderCodemodeCall(
      { code: "line1\nline2" },
      theme,
      { expanded: true },
    );
    expect(text(out)).toBe("[toolTitle:**codemode**]\n<hl:line1>\n<hl:line2>");
  });

  it("shows the header alone when collapsed in Minimal style", () => {
    const code = Array.from({ length: 15 }, (_, i) => `l${i}`).join("\n");
    const out = renderCodemodeCall({ code }, theme, {});
    expect(text(out)).toBe("[toolTitle:**codemode**]");
  });

  it("shows the header alone when collapsed in Minimal style, even for short scripts", () => {
    const out = renderCodemodeCall({ code: "a\nb" }, theme, {});
    expect(text(out)).toBe("[toolTitle:**codemode**]");
  });

  it("previews the script to 10 visual lines with a hint when collapsed in Compact style", () => {
    setCodemodeOutputStyle("Compact");
    const code = Array.from({ length: 15 }, (_, i) => `l${i}`).join("\n");
    const out = renderCodemodeCall({ code }, theme, {});
    const outLines = lines(out);
    // header + 10 preview lines + 1 hint line
    expect(outLines).toHaveLength(12);
    expect(outLines[0]).toBe("[toolTitle:**codemode**]");
    expect(outLines[1]!.trim()).toBe("<hl:l0>");
    expect(outLines[10]!.trim()).toBe("<hl:l9>");
    expect(outLines[11]!.trim()).toBe("[muted:... (5 more lines, ctrl+o to expand)]");
  });

  it("shows the full short script when collapsed in Compact style (no hint)", () => {
    setCodemodeOutputStyle("Compact");
    const out = renderCodemodeCall({ code: "a\nb" }, theme, {});
    expect(lines(out).map((line) => line.trim())).toEqual(["[toolTitle:**codemode**]", "<hl:a>", "<hl:b>"]);
  });

  it("expansion wins over the style (expanded shows the full script)", () => {
    setCodemodeOutputStyle("Compact");
    const code = Array.from({ length: 15 }, (_, i) => `l${i}`).join("\n");
    const out = renderCodemodeCall({ code }, theme, { expanded: true });
    const outLines = lines(out);
    expect(outLines).toHaveLength(16);
    expect(outLines[15]).toBe("<hl:l14>");
  });

  it("normalizes tabs and carriage returns in the script (expanded)", () => {
    const out = renderCodemodeCall(
      { code: "a\tb\r\nc" },
      theme,
      { expanded: true },
    );
    expect(text(out)).toContain("<hl:a   b>");
  });
});

describe("renderCodemodeResult - Collapsed view (Minimal)", () => {
  it("renders the success glyph and the wall time from the header", () => {
    const out = renderCodemodeResult(
      {
        content: [
          {
            type: "text",
            text: "Script completed\nWall time 0.4 seconds\nOutput:\n",
          },
          { type: "text", text: "done" },
        ],
      },
      { expanded: false },
      theme,
      {},
    );
    expect(text(out)).toBe("[success:✓] [muted:400ms]");
  });

  it("shows the nested calls without a summary line when calls were made", () => {
    const out = renderCodemodeResult(
      {
        content: [
          {
            type: "text",
            text: "Script completed\nWall time 1.2 seconds\nOutput:\n",
          },
        ],
        details: {
          calls: [
            { id: "1/1", name: "a", args: "x", status: "ok", durationMs: 30 },
            { id: "1/2", name: "b", args: "y", status: "ok", durationMs: 40 },
          ],
        },
      },
      { expanded: false },
      theme,
      {},
    );
    expect(text(out)).toBe(
      [
        "[success:✓] [toolTitle:a] [muted:x] [dim:30ms]",
        "[success:✓] [toolTitle:b] [muted:y] [dim:40ms]",
      ].join("\n"),
    );
  });

  it("previews the last 5 calls with a hint when more were made", () => {
    const calls = Array.from({ length: 8 }, (_, i) => ({
      id: `1/${i + 1}`,
      name: `t${i}`,
      args: "",
      status: "ok" as const,
    }));
    const out = renderCodemodeResult(
      {
        content: [
          {
            type: "text",
            text: "Script completed\nWall time 1.0 seconds\nOutput:\n",
          },
        ],
        details: { calls },
      },
      { expanded: false },
      theme,
      {},
    );
    const outLines = lines(out);
    // hint + last 5 calls (no summary line)
    expect(outLines).toHaveLength(6);
    expect(outLines[0]).toBe("[muted:... (3 earlier calls, ctrl+o to expand)]");
    expect(outLines[1]).toBe("[success:✓] [toolTitle:t3]");
    expect(outLines[5]).toBe("[success:✓] [toolTitle:t7]");
  });

  it("never shows an output preview in Minimal style, even with long output", () => {
    const out = renderCodemodeResult(
      {
        content: [
          {
            type: "text",
            text: "Script completed\nWall time 1.0 seconds\nOutput:\n",
          },
          { type: "text", text: Array.from({ length: 20 }, (_, i) => `o${i}`).join("\n") },
        ],
        details: { calls: [] },
      },
      { expanded: false },
      theme,
      {},
    );
    expect(text(out)).toBe("[success:✓] [muted:1.0s]");
  });

  it("shows in-flight calls with the running glyph while isPartial", () => {
    const out = renderCodemodeResult(
      {
        details: {
          calls: [{ id: "1/1", name: "slow_tool", args: "", status: "running" }],
        },
      },
      { expanded: false, isPartial: true },
      theme,
      { state: { startedAt: Date.now() - 1500 } },
    );
    expect(text(out)).toBe("[warning:…] [toolTitle:slow_tool]");
  });

  it("renders the error glyph when the context marks the result an error", () => {
    const out = renderCodemodeResult(
      {
        content: [
          {
            type: "text",
            text: "Script failed\nWall time 0.2 seconds\nOutput:\n",
          },
        ],
      },
      { expanded: false },
      theme,
      { isError: true },
    );
    expect(text(out)).toBe("[error:✗] [muted:200ms]");
  });

  it("falls back to the timer when the header is missing", () => {
    const out = renderCodemodeResult(
      { content: [{ type: "text", text: "partial" }] },
      { expanded: false },
      theme,
      { state: { startedAt: 1000, endedAt: 2500 } },
    );
    expect(text(out)).toBe("[success:✓] [muted:1.5s]");
  });

  it("renders the running glyph and live duration while isPartial", () => {
    const out = renderCodemodeResult(
      {},
      { expanded: false, isPartial: true },
      theme,
      { state: { startedAt: Date.now() - 1500 } },
    );
    expect(text(out)).toBe("[warning:▸] [muted:1.5s]");
  });
});

describe("renderCodemodeResult - Collapsed view (Compact)", () => {
  beforeEach(() => {
    setCodemodeOutputStyle("Compact");
  });

  it("previews the last 8 calls with a hint when more were made", () => {
    const calls = Array.from({ length: 12 }, (_, i) => ({
      id: `1/${i + 1}`,
      name: `t${i}`,
      args: "",
      status: "ok" as const,
    }));
    const out = renderCodemodeResult(
      {
        content: [
          {
            type: "text",
            text: "Script completed\nWall time 1.0 seconds\nOutput:\n",
          },
        ],
        details: { calls },
      },
      { expanded: false },
      theme,
      {},
    );
    const outLines = lines(out);
    // hint + last 8 calls
    expect(outLines).toHaveLength(9);
    expect(outLines[0]).toBe("[muted:... (4 earlier calls, ctrl+o to expand)]");
    expect(outLines[1]).toBe("[success:✓] [toolTitle:t4]");
    expect(outLines[8]).toBe("[success:✓] [toolTitle:t11]");
  });

  it("previews the output to 5 visual lines with a hint and the full-output path", () => {
    const out = renderCodemodeResult(
      {
        content: [
          {
            type: "text",
            text: "Script completed\nWall time 1.0 seconds\nOutput:\n",
          },
          { type: "text", text: Array.from({ length: 20 }, (_, i) => `o${i}`).join("\n") },
        ],
        details: {
          calls: [],
          fullOutputPath: "/tmp/pi-codemode-out-123.txt",
        },
      },
      { expanded: false },
      theme,
      {},
    );
    const outLines = lines(out);
    // 5 output preview lines + 1 hint line + the path line
    expect(outLines).toHaveLength(7);
    expect(outLines[0]!.trim()).toBe("[toolOutput:o0]");
    expect(outLines[4]!.trim()).toBe("[toolOutput:o4]");
    expect(outLines[5]!.trim()).toBe("[muted:... (15 more lines, ctrl+o to expand)]");
    expect(outLines[6]!.trim()).toBe("[muted:Full output: /tmp/pi-codemode-out-123.txt]");
  });

  it("caps a single long line at 5 visual lines (wrapped-line budget)", () => {
    const longLine = "x".repeat(500);
    const out = renderCodemodeResult(
      {
        content: [
          {
            type: "text",
            text: "Script completed\nWall time 1.0 seconds\nOutput:\n",
          },
          { type: "text", text: longLine },
        ],
      },
      { expanded: false },
      theme,
      {},
    );
    const outLines = lines(out);
    // 500 chars at width 80 wrap to 7 visual lines: 5 kept + hint
    expect(outLines).toHaveLength(6);
    // The final line carries the hint.
    expect(outLines[5]).toContain("[muted:... (2 more lines");
    expect(outLines[5]).toContain("ctrl+o to expand)");
  });

  it("shows the full short output without a hint", () => {
    const out = renderCodemodeResult(
      {
        content: [
          {
            type: "text",
            text: "Script completed\nWall time 1.0 seconds\nOutput:\n",
          },
          { type: "text", text: "a\nb" },
        ],
      },
      { expanded: false },
      theme,
      {},
    );
    const outLines = lines(out);
    expect(outLines).toHaveLength(2);
    expect(outLines[0]!.trim()).toBe("[toolOutput:a]");
    expect(outLines[1]!.trim()).toBe("[toolOutput:b]");
  });

  it("shows nothing but in-flight calls while isPartial (no output preview yet)", () => {
    const out = renderCodemodeResult(
      {
        details: {
          calls: [{ id: "1/1", name: "slow_tool", args: "", status: "running" }],
        },
        content: [
          { type: "text", text: "Script completed\nWall time 1.0 seconds\nOutput:\n" },
          { type: "text", text: "early output" },
        ],
      },
      { expanded: false, isPartial: true },
      theme,
      {},
    );
    expect(text(out)).toBe("[warning:…] [toolTitle:slow_tool]");
  });

  it("shows no status line when calls were made (the calls carry the outcome)", () => {
    const out = renderCodemodeResult(
      {
        content: [
          {
            type: "text",
            text: "Script completed\nWall time 1.0 seconds\nOutput:\n",
          },
        ],
        details: {
          calls: [{ id: "1/1", name: "a", args: "", status: "ok" }],
        },
      },
      { expanded: false },
      theme,
      {},
    );
    expect(text(out)).not.toContain("Done");
    expect(text(out)).toBe("[success:✓] [toolTitle:a]");
  });
});

describe("PreviewTextComponent", () => {
  it("renders the full text when it fits the budget", () => {
    const comp = new PreviewTextComponent("a\nb", 5, () => "H");
    expect(comp.render(80).map((line) => line.trim())).toEqual(["a", "b"]);
  });

  it("caps the text at the budget with a hint line", () => {
    const comp = new PreviewTextComponent(
      Array.from({ length: 10 }, (_, i) => `l${i}`).join("\n"),
      5,
      (hidden) => `H(${hidden})`,
    );
    const out = comp.render(80);
    expect(out).toHaveLength(6);
    expect(out[0]!.trim()).toBe("l0");
    expect(out[4]!.trim()).toBe("l4");
    // 5 kept lines, 5 hidden (l5..l9)
    expect(out[5]!.trim()).toBe("H(5)");
  });

  it("truncates the hint line to the terminal width", () => {
    const comp = new PreviewTextComponent("x".repeat(500), 3, () => "HINT");
    const out = comp.render(20);
    expect(out).toHaveLength(4);
    expect(out[3]!.trim()).toBe("HINT");
    expect(out[3]!.length).toBeLessThanOrEqual(20);
  });

  it("renders a padded blank line for empty text", () => {
    const comp = new PreviewTextComponent("", 5, () => "H");
    expect(comp.render(10)).toEqual([" ".repeat(10)]);
  });
});

describe("renderCodemodeResult - Live timer lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts the interval and invalidates the context while isPartial", () => {
    const invalidate = vi.fn();
    const context = {
      executionStarted: true,
      invalidate,
      state: {} as any,
    };

    renderCodemodeResult({}, { isPartial: true }, theme, context);
    expect(context.state.interval).toBeDefined();

    vi.advanceTimersByTime(1000);
    expect(invalidate).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("clears the interval and sets endedAt when the script settles", () => {
    const invalidate = vi.fn();
    const context = {
      executionStarted: true,
      invalidate,
      state: {} as any,
    };

    renderCodemodeResult({}, { isPartial: true }, theme, context);
    expect(context.state.interval).toBeDefined();

    renderCodemodeResult(
      { content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }] },
      { isPartial: false },
      theme,
      context,
    );
    expect(context.state.interval).toBeUndefined();
    expect(context.state.endedAt).toBeDefined();
  });

  it("clears active codemode intervals when clearActiveCodemodeIntervals is called", () => {
    const context = {
      executionStarted: true,
      invalidate: vi.fn(),
      state: {} as any,
    };

    renderCodemodeResult({}, { isPartial: true }, theme, context);
    expect(context.state.interval).toBeDefined();

    clearActiveCodemodeIntervals();
    expect(context.state.interval).toBeUndefined();
    vi.advanceTimersByTime(1000);
    expect(context.invalidate).not.toHaveBeenCalled();
  });
});

describe("renderCodemodeResult - Expanded view", () => {
  it("renders nested calls, output, timing, and ✓ Done on success", () => {
    const out = renderCodemodeResult(
      {
        content: [
          {
            type: "text",
            text: "Script completed\nWall time 0.3 seconds\nOutput:\n",
          },
          { type: "text", text: "line1\nline2" },
        ],
        details: {
          calls: [
            {
              id: "1/1",
              name: "mcp__postgres__run_select",
              args: '{"sql":"SELECT 1"}',
              status: "ok",
              durationMs: 32,
            },
          ],
        },
      },
      { expanded: true },
      theme,
      {},
    );
    const outText = text(out);

    expect(outText).toContain(
      "[success:✓] [toolTitle:mcp__postgres__run_select] [muted:{\"sql\":\"SELECT 1\"}] [dim:32ms]",
    );
    expect(outText).toContain("[toolOutput:line1]");
    expect(outText).toContain("[toolOutput:line2]");
    expect(outText).toContain("[muted:Took 300ms]");
    expect(outText).toContain("[success:✓ Done]");
  });

  it("is not affected by the style (Compact expanded shows the full output)", () => {
    setCodemodeOutputStyle("Compact");
    const out = renderCodemodeResult(
      {
        content: [
          {
            type: "text",
            text: "Script completed\nWall time 0.3 seconds\nOutput:\n",
          },
          { type: "text", text: Array.from({ length: 30 }, (_, i) => `o${i}`).join("\n") },
        ],
      },
      { expanded: true },
      theme,
      {},
    );
    const outLines = lines(out);
    // 30 output lines + blank + Took + blank + Done (parts joined with \n\n)
    expect(outLines).toHaveLength(34);
    expect(outLines[29]).toBe("[toolOutput:o29]");
    expect(outLines[31]).toBe("[muted:Took 300ms]");
    expect(outLines[33]).toBe("[success:✓ Done]");
  });

  it("renders output lines with error styling and ✗ Script failed on failure", () => {
    const out = renderCodemodeResult(
      {
        content: [
          {
            type: "text",
            text: "Script failed\nWall time 0.1 seconds\nOutput:\n",
          },
          {
            type: "text",
            text: "Script error:\nReferenceError: x is not defined",
          },
        ],
      },
      { expanded: true },
      theme,
      { isError: true },
    );
    const outText = text(out);

    expect(outText).toContain("[error:Script error:]");
    expect(outText).toContain("[error:ReferenceError: x is not defined]");
    expect(outText).toContain("[muted:Took 100ms]");
    expect(outText).toContain("[error:✗ Script failed]");
  });

  it("renders the model-call total when more than one call has a cost", () => {
    const out = renderCodemodeResult(
      {
        content: [
          {
            type: "text",
            text: "Script completed\nWall time 2.0 seconds\nOutput:\n",
          },
        ],
        details: {
          calls: [
            { id: "1/1", name: "a", args: "", status: "ok", cost: 0.001 },
            { id: "1/2", name: "b", args: "", status: "ok", cost: 0.002 },
          ],
        },
      },
      { expanded: true },
      theme,
      {},
    );
    expect(text(out)).toContain("[muted:Model calls: $0.0030]");
  });

  it("renders the full-output path when the output was truncated", () => {
    const out = renderCodemodeResult(
      {
        content: [
          {
            type: "text",
            text: "Script completed\nWall time 1.0 seconds\nOutput:\n",
          },
          { type: "text", text: "partial" },
        ],
        details: {
          calls: [],
          fullOutputPath: "/tmp/pi-codemode-out-123.txt",
        },
      },
      { expanded: true },
      theme,
      {},
    );
    expect(text(out)).toContain(
      "[muted:Full output: /tmp/pi-codemode-out-123.txt]",
    );
  });

  it("renders Elapsed without the final status while isPartial", () => {
    const out = renderCodemodeResult(
      { content: [{ type: "text", text: "working..." }] },
      { expanded: true, isPartial: true },
      theme,
      { state: { startedAt: Date.now() - 3200 } },
    );
    const outText = text(out);
    expect(outText).toContain("[muted:Elapsed 3.2s]");
    expect(outText).not.toContain("✓ Done");
    expect(outText).not.toContain("✗ Script failed");
  });
});
