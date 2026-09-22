import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { formatDuration, renderBashCall, renderBashResult, clearActiveBashIntervals } from "./renderer.js";

// Mock Text from @earendil-works/pi-tui
vi.mock("@earendil-works/pi-tui", () => {
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

describe("renderBashCall", () => {
  it("renders bold bash header", () => {
    const text = renderBashCall({ command: "echo hi" }, theme, {});
    expect(content(text)).toBe("[toolTitle:**bash**]");
  });

  it("sets startedAt when executionStarted is true and startedAt is undefined", () => {
    const context = { executionStarted: true, state: {} as any };
    renderBashCall({ command: "echo hi" }, theme, context);
    expect(typeof context.state.startedAt).toBe("number");
  });

  it("reuses context.lastComponent if present", () => {
    const last = new MockText("stale");
    const out = renderBashCall({ command: "echo hi" }, theme, { lastComponent: last });
    expect(out).toBe(last);
    expect(content(out)).toBe("[toolTitle:**bash**]");
  });
});

describe("renderBashResult - Collapsed view", () => {
  it("renders running status glyph (warning ▸) when isPartial is true", () => {
    const context = {
      args: { command: "npm test" },
      state: { startedAt: Date.now() - 1500 },
    };
    const out = renderBashResult({}, { isPartial: true, expanded: false }, theme, context);
    expect(content(out)).toContain("[warning:▸]");
    expect(content(out)).toContain("[muted:npm test]");
    expect(content(out)).toContain("[dim:(1.5s)]");
  });

  it("renders success status glyph (success ✓) when exit 0", () => {
    const context = {
      args: { command: "git status" },
      state: { startedAt: 1000, endedAt: 2500 },
    };
    const out = renderBashResult(
      { content: [{ type: "text", text: "On branch main" }] },
      { expanded: false },
      theme,
      context,
    );
    expect(content(out)).toContain("[success:✓]");
    expect(content(out)).toContain("[muted:git status]");
    expect(content(out)).toContain("[dim:(1.5s)]");
  });

  it("renders error status glyph (error ✗) when context.isError or result.isError", () => {
    const context = {
      isError: true,
      args: { command: "bad-command" },
      state: { startedAt: 1000, endedAt: 2500 },
    };
    const out = renderBashResult(
      { content: [{ type: "text", text: "command not found" }] },
      { expanded: false },
      theme,
      context,
    );
    expect(content(out)).toContain("[error:✗]");
    expect(content(out)).toContain("[muted:bad-command]");
    expect(content(out)).toContain("[dim:(1.5s)]");
  });

  it("normalizes newlines to spaces in command preview", () => {
    const context = {
      args: { command: "echo 'first'\r\necho 'second'\necho 'third'" },
      state: { startedAt: 1000, endedAt: 2000 },
    };
    const out = renderBashResult({}, { expanded: false }, theme, context);
    expect(content(out)).toContain("[muted:echo 'first' echo 'second' echo 'third']");
  });

  it("truncates command preview to 70 chars with …", () => {
    const longCmd = "a".repeat(80);
    const context = {
      args: { command: longCmd },
      state: { startedAt: 1000, endedAt: 2000 },
    };
    const out = renderBashResult({}, { expanded: false }, theme, context);
    const expectedTruncated = "a".repeat(70) + "…";
    expect(content(out)).toContain(`[muted:${expectedTruncated}]`);
  });

  it("formats collapsed row with exact spacing (no leading space)", () => {
    const context = {
      args: { command: "ls" },
      state: { startedAt: 1000, endedAt: 2000 },
    };
    const out = renderBashResult({}, { expanded: false }, theme, context);
    expect(content(out)).toBe("[success:✓] [muted:ls] [dim:(1.0s)]");
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
