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
} from "./renderer.js";

// Mock Text from @earendil-works/pi-tui while preserving real utility
// functions (imageFallback, getImageDimensions, …).
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
    const out = getCodemodeOutput([
      {
        type: "text",
        text: "Script completed\nWall time 0.1 seconds\nOutput:\n",
      },
      { type: "text", text: "line1\nline2" },
    ]);
    expect(out).toBe("line1\nline2");
  });

  it("keeps the first block when it has no header", () => {
    const out = getCodemodeOutput([{ type: "text", text: "just output" }]);
    expect(out).toBe("just output");
  });

  it("joins text blocks and appends a fallback indicator for image blocks", () => {
    // The renderer is text-only, so image blocks ALWAYS get the fallback
    // indicator (mime type + dimensions when known), regardless of the
    // terminal's inline-image support.
    const out = getCodemodeOutput([
      { type: "text", text: "a" },
      { type: "image", data: "x", mimeType: "image/png" },
      { type: "text", text: "b" },
    ]);
    expect(out).toContain("a\nb");
    expect(out).toContain("image/png");
  });

  it("returns only the indicators when there is no text output", () => {
    const out = getCodemodeOutput([
      { type: "image", data: "x", mimeType: "image/jpeg" },
    ]);
    expect(out).toContain("image/jpeg");
    expect(out).not.toContain("undefined");
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

  it("shows the header alone when collapsed", () => {
    const code = Array.from({ length: 15 }, (_, i) => `l${i}`).join("\n");
    const out = renderCodemodeCall({ code }, theme, {});
    expect(text(out)).toBe("[toolTitle:**codemode**]");
  });

  it("shows the header alone when collapsed, even for short scripts", () => {
    const out = renderCodemodeCall({ code: "a\nb" }, theme, {});
    expect(text(out)).toBe("[toolTitle:**codemode**]");
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

  it("appends the failure marker when the script failed after successful calls", () => {
    // A failed script whose nested calls succeeded must not look like a
    // success in the collapsed view: the failure marker is appended after
    // the call list.
    const out = renderCodemodeResult(
      {
        content: [
          {
            type: "text",
            text: "Script failed\nWall time 0.2 seconds\nOutput:\n",
          },
        ],
        details: {
          calls: [
            { id: "1/1", name: "a", args: "", status: "ok", durationMs: 30 },
            { id: "1/2", name: "b", args: "", status: "ok", durationMs: 40 },
          ],
        },
      },
      { expanded: false },
      theme,
      { isError: true },
    );
    const outLines = lines(out);
    expect(outLines[outLines.length - 1]).toBe("[error:✗ Script failed]");
  });

  it("does not append the failure marker while the script is still running", () => {
    const out = renderCodemodeResult(
      {
        details: {
          calls: [{ id: "1/1", name: "a", args: "", status: "ok", durationMs: 30 }],
        },
      },
      { expanded: false, isPartial: true },
      theme,
      { isError: true },
    );
    expect(text(out)).not.toContain("Script failed");
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

  it("does not finalize the timer at call-render time (the call is in flight)", () => {
    const invalidate = vi.fn();
    const context = {
      executionStarted: true,
      invalidate,
      state: {} as any,
    };

    // The call renderer runs while the script is running: it must NOT record
    // endedAt (a fixed end time would freeze the elapsed timer).
    renderCodemodeCall({ code: "await slow()" }, theme, context);
    expect(context.state.endedAt).toBeUndefined();
    expect(context.state.interval).toBeDefined();

    // Partial results keep the timer advancing.
    renderCodemodeResult({}, { isPartial: true }, theme, context);
    vi.advanceTimersByTime(2000);
    expect(invalidate).toHaveBeenCalledTimes(2);

    // The final result settles the timer.
    renderCodemodeResult(
      { content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }] },
      { isPartial: false },
      theme,
      context,
    );
    expect(context.state.interval).toBeUndefined();
    expect(context.state.endedAt).toBeDefined();
  });

  it("does not recreate the timer interval for a settled call re-render", () => {
    const context = {
      executionStarted: true,
      invalidate: vi.fn(),
      state: {} as any,
    };

    renderCodemodeResult(
      { content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }] },
      { isPartial: false },
      theme,
      context,
    );
    expect(context.state.interval).toBeUndefined();

    // Re-rendering the call after the result settled must not spawn a
    // permanent interval (endedAt is already set).
    renderCodemodeCall({ code: "x" }, theme, context);
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
