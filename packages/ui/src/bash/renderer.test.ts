import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripAnsi } from "@pi-archimedes/core/text";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  formatDuration,
  formatBashCommand,
  renderBashCall,
  renderBashResult,
  clearActiveBashIntervals,
  TruncatedTextComponent,
} from "./renderer.js";

// Mock Text from @earendil-works/pi-tui while preserving real utility functions
vi.mock("@earendil-works/pi-tui", async () => {
  const actual = await vi.importActual<typeof import("@earendil-works/pi-tui")>("@earendil-works/pi-tui");
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
  }
  return {
    ...actual,
    Text: MockText,
  };
});

import { Text as MockText } from "@earendil-works/pi-tui";

type MockTextShim = { getContent(): string };
const content = (c: unknown) => (c as unknown as MockTextShim).getContent();

// Test theme wrapping in markers
const theme = {
  fg: (token: string, text?: string) =>
    text === undefined ? `[${token}]` : `[${token}:${text}]`,
  bold: (text: string) => `**${text}**`,
} as unknown as Theme;

describe("formatDuration", () => {
  it("formats under 10 seconds as <X.X>s", () => {
    expect(formatDuration(0)).toBe("0.0s");
    expect(formatDuration(400)).toBe("0.4s");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(9900)).toBe("9.9s");
  });

  it("formats between 10s and 60s as <X>s", () => {
    expect(formatDuration(10000)).toBe("10s");
    expect(formatDuration(15000)).toBe("15s");
    expect(formatDuration(45800)).toBe("45s");
    expect(formatDuration(59999)).toBe("59s");
  });

  it("formats minutes and seconds as <M>m <S>s", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
    expect(formatDuration(65000)).toBe("1m 5s");
    expect(formatDuration(125000)).toBe("2m 5s");
  });

  it("formats hours if duration exceeds 60 minutes", () => {
    expect(formatDuration(3665000)).toBe("1h 1m 5s");
  });
});

describe("formatBashCommand", () => {
  it("returns undefined for undefined or non-string input", () => {
    expect(formatBashCommand(undefined)).toBeUndefined();
    expect(formatBashCommand(null as any)).toBeUndefined();
    expect(formatBashCommand(123 as any)).toBeUndefined();
  });

  it("returns undefined for empty or whitespace-only commands", () => {
    expect(formatBashCommand("")).toBeUndefined();
    expect(formatBashCommand("   ")).toBeUndefined();
    expect(formatBashCommand("\t\n")).toBeUndefined();
  });

  it("returns trimmed single-line command", () => {
    expect(formatBashCommand("  echo hi  ")).toBe("echo hi");
  });

  it("normalizes newlines to spaces", () => {
    expect(formatBashCommand("echo 'first'\r\necho 'second'\necho 'third'")).toBe(
      "echo 'first' echo 'second' echo 'third'",
    );
  });

  it("preserves full command when maxLength is omitted", () => {
    const longCmd = "a".repeat(120);
    expect(formatBashCommand(longCmd)).toBe(longCmd);
  });

  it("truncates via truncateToWidth when maxLength is provided", () => {
    const longCmd = "a".repeat(80);
    const result = formatBashCommand(longCmd, 70)!;
    expect(stripAnsi(result)).toBe("a".repeat(69) + "…");
    expect(visibleWidth(result)).toBe(70);
  });
});

describe("TruncatedTextComponent", () => {
  it("renders single-line text and pads to width", () => {
    const comp = new TruncatedTextComponent("hello");
    const lines = comp.render(10);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("hello     ");
  });

  it("truncates text wider than width with … via truncateToWidth", () => {
    const comp = new TruncatedTextComponent("a".repeat(50));
    const lines = comp.render(10);
    expect(lines).toHaveLength(1);
    expect(stripAnsi(lines[0]!)).toBe("a".repeat(9) + "…");
    expect(visibleWidth(lines[0]!)).toBe(10);
  });

  it("styles truncation ellipsis with theme accent when theme is set", () => {
    const comp = new TruncatedTextComponent("a".repeat(50), theme);
    const lines = comp.render(10);
    expect(lines[0]!.includes("[accent:…]")).toBe(true);
  });

  it("normalizes newlines to spaces during render", () => {
    const comp = new TruncatedTextComponent("hello\nworld");
    const lines = comp.render(20);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.startsWith("hello world")).toBe(true);
  });

  it("returns single empty padded line when text is empty", () => {
    const comp = new TruncatedTextComponent("");
    expect(comp.render(5)).toEqual([""]);
  });
});

describe("renderBashCall", () => {
  it("renders bold bash header when command is absent", () => {
    const text = renderBashCall({}, theme, {});
    expect(content(text)).toBe("[toolTitle:**bash**]");
  });

  it("renders bold bash header with orange accent command when command is provided in args", () => {
    const text = renderBashCall({ command: "echo hi" }, theme, {});
    expect(content(text)).toBe("[toolTitle:**bash**] [accent:echo hi]");
  });

  it("falls back to context.args.command when absent from args", () => {
    const text = renderBashCall({}, theme, { args: { command: "git status" } });
    expect(content(text)).toBe("[toolTitle:**bash**] [accent:git status]");
  });

  it("normalizes newlines to spaces in command in header", () => {
    const text = renderBashCall({ command: "echo 1\r\necho 2\necho 3" }, theme, {});
    expect(content(text)).toBe("[toolTitle:**bash**] [accent:echo 1 echo 2 echo 3]");
  });

  it("preserves full command text in component and truncates dynamically at render width", () => {
    const longCmd = "a".repeat(120);
    const comp = renderBashCall({ command: longCmd }, theme, {});
    expect(content(comp)).toBe(`[toolTitle:**bash**] [accent:${longCmd}]`);
    // Render at width 50: dynamically truncated
    const lines50 = comp.render(50);
    expect(lines50[0]!.includes("…")).toBe(true);
  });

  it("sets startedAt when executionStarted is true and startedAt is undefined", () => {
    const context = { executionStarted: true, state: {} as any };
    renderBashCall({ command: "echo hi" }, theme, context);
    expect(typeof context.state.startedAt).toBe("number");
  });

  it("reuses context.lastComponent if present and an instance of TruncatedTextComponent", () => {
    const last = new TruncatedTextComponent("stale");
    const out = renderBashCall({ command: "echo hi" }, theme, { lastComponent: last });
    expect(out).toBe(last);
    expect(content(out)).toBe("[toolTitle:**bash**] [accent:echo hi]");
  });

  it("stores timeout and command in context state when provided", () => {
    const context = { state: {} as any };
    renderBashCall({ command: "echo hi", timeout: 30 }, theme, context);
    expect(context.state.timeout).toBe(30);
    expect(context.state.command).toBe("echo hi");
  });

  it("does not store timeout when not a finite number", () => {
    const context = { state: {} as any };
    renderBashCall({ command: "echo hi", timeout: Number.NaN }, theme, context);
    expect(context.state.timeout).toBeUndefined();
  });
});

describe("renderBashResult - Collapsed view", () => {
  it("renders running status glyph (warning ▸) and live duration when isPartial is true", () => {
    const context = {
      state: { startedAt: Date.now() - 1500 },
    };
    const out = renderBashResult({}, { isPartial: true, expanded: false }, theme, context);
    expect(content(out)).toBe("[warning:▸] [muted:1.5s]");
  });

  it("renders success status glyph (success ✓) and duration when exit 0", () => {
    const context = {
      state: { startedAt: 1000, endedAt: 2500 },
    };
    const out = renderBashResult(
      { content: [{ type: "text", text: "On branch main" }] },
      { expanded: false },
      theme,
      context,
    );
    expect(content(out)).toBe("[success:✓] [muted:1.5s]");
  });

  it("renders error status glyph (error ✗) and duration when context.isError or result.isError", () => {
    const context = {
      isError: true,
      state: { startedAt: 1000, endedAt: 2500 },
    };
    const out = renderBashResult(
      { content: [{ type: "text", text: "command not found" }] },
      { expanded: false },
      theme,
      context,
    );
    expect(content(out)).toBe("[error:✗] [muted:1.5s]");
  });

  it("appends timeout when timeout is provided in args", () => {
    const context = {
      args: { timeout: 1800 },
      state: { startedAt: 1000, endedAt: 26000 },
    };
    const out = renderBashResult({}, { expanded: false }, theme, context);
    expect(content(out)).toBe("[success:✓] [muted:25s][dim: (timeout: 1800s)]");
  });

  it("appends timeout when timeout is stored in state", () => {
    const context = {
      state: { timeout: 30, startedAt: 1000, endedAt: 2500 },
    };
    const out = renderBashResult({}, { expanded: false }, theme, context);
    expect(content(out)).toBe("[success:✓] [muted:1.5s][dim: (timeout: 30s)]");
  });

  it("does not append timeout when timeout is not a finite number", () => {
    const context = {
      args: { timeout: Number.NaN },
      state: { startedAt: 1000, endedAt: 2000 },
    };
    const out = renderBashResult({}, { expanded: false }, theme, context);
    expect(content(out)).toBe("[success:✓] [muted:1.0s]");
  });

  it("formats running collapsed row with timeout and exact spacing", () => {
    const context = {
      args: { timeout: 1800 },
      state: { startedAt: Date.now() - 25000 },
    };
    const out = renderBashResult({}, { isPartial: true, expanded: false }, theme, context);
    expect(content(out)).toBe("[warning:▸] [muted:25s][dim: (timeout: 1800s)]");
  });
});

describe("renderBashResult - Live timer lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts interval and invalidates context when isPartial is true", () => {
    const invalidate = vi.fn();
    const context = {
      executionStarted: true,
      invalidate,
      state: {} as any,
    };

    renderBashResult({}, { isPartial: true }, theme, context);
    expect(context.state.interval).toBeDefined();

    vi.advanceTimersByTime(1000);
    expect(invalidate).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("clears interval and sets endedAt when execution completes", () => {
    const invalidate = vi.fn();
    const context = {
      executionStarted: true,
      invalidate,
      state: {} as any,
    };

    renderBashResult({}, { isPartial: true }, theme, context);
    expect(context.state.interval).toBeDefined();

    renderBashResult({}, { isPartial: false }, theme, context);
    expect(context.state.interval).toBeUndefined();
    expect(context.state.endedAt).toBeDefined();
  });

  it("clears active bash intervals when clearActiveBashIntervals is called", () => {
    const context = {
      executionStarted: true,
      invalidate: vi.fn(),
      state: {} as any,
    };

    renderBashResult({}, { isPartial: true }, theme, context);
    expect(context.state.interval).toBeDefined();

    clearActiveBashIntervals();
    expect(context.state.interval).toBeUndefined();
    // Verify if the interval still triggers
    vi.advanceTimersByTime(1000);
    expect(context.invalidate).not.toHaveBeenCalled();
  });
});

describe("renderBashResult - Expanded view", () => {
  it("renders full command with $ prefix, output lines, duration, and ✓ Done on success", () => {
    const context = {
      args: { command: "git log -n 1 --oneline" },
      state: { startedAt: 1000, endedAt: 2200 },
    };
    const result = {
      content: [
        { type: "text", text: "abc1234 feat: first commit\nsecond line" },
      ],
    };

    const out = renderBashResult(result, { expanded: true }, theme, context);
    const text = content(out);

    expect(text).toContain("[dim:$ ][toolOutput:git log -n 1 --oneline]");
    expect(text).toContain("[toolOutput:abc1234 feat: first commit]");
    expect(text).toContain("[toolOutput:second line]");
    expect(text).toContain("[muted:Took 1.2s]");
    expect(text).toContain("[success:✓ Done]");
  });

  it("renders output lines with error styling and exit code on failure", () => {
    const context = {
      isError: true,
      args: { command: "cat nonexistent.txt" },
      state: { startedAt: 1000, endedAt: 2500 },
    };
    const result = {
      content: [
        {
          type: "text",
          text: "cat: nonexistent.txt: No such file or directory\nCommand exited with code 1",
        },
      ],
    };

    const out = renderBashResult(result, { expanded: true }, theme, context);
    const text = content(out);

    expect(text).toContain("[dim:$ ][toolOutput:cat nonexistent.txt]");
    expect(text).toContain("[error:cat: nonexistent.txt: No such file or directory]");
    expect(text).toContain("[muted:Took 1.5s]");
    expect(text).toContain("[error:✗ Command exited with code 1]");
  });

  it("renders truncation notice if output was truncated", () => {
    const context = {
      args: { command: "find ." },
      state: { startedAt: 1000, endedAt: 2000 },
    };
    const result = {
      content: [{ type: "text", text: "file1\nfile2" }],
      details: {
        truncation: {
          truncated: true,
          outputLines: 2000,
          totalLines: 5000,
        },
        fullOutputPath: "/tmp/pi-bash-123.log",
      },
    };

    const out = renderBashResult(result, { expanded: true }, theme, context);
    const text = content(out);

    expect(text).toContain(
      "[warning:[Truncated: showing 2000 of 5000 lines. Full output: /tmp/pi-bash-123.log]]",
    );
  });

  it("renders Elapsed <duration> without final status while isPartial is true", () => {
    const context = {
      args: { command: "sleep 10" },
      state: { startedAt: Date.now() - 3200 },
    };
    const result = {
      content: [{ type: "text", text: "working..." }],
    };

    const out = renderBashResult(result, { expanded: true, isPartial: true }, theme, context);
    const text = content(out);

    expect(text).toContain("[muted:Elapsed 3.2s]");
    expect(text).not.toContain("✓ Done");
    expect(text).not.toContain("✗ Command exited");
  });
});
