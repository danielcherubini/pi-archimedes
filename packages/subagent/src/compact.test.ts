import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { buildActivityLine, renderCompactSingle, renderCompactParallel } from "./compact.js";
import type { SubagentResult, SubagentProgress, SubagentDetails, SubagentToolCall } from "./types.js";

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@earendil-works/pi-tui", () => {
  class MockTextInner {
    private _content = "";

    setText(content: string): void {
      this._content = content;
    }

    getContent(): string {
      return this._content;
    }
  }
  return {
    Text: MockTextInner,
  };
});

// Re-import MockText for use in tests (same class as the mock)
import { Text as MockText } from "@earendil-works/pi-tui";

// Type-safe helper: ActivityData with all optional fields for test convenience
// ActivityData is defined in compact.ts — reconstruct the shape here
type ActivityData = {
  currentTool: string | undefined;
  currentToolArgs: string | undefined;
  currentToolStartedAt: number | undefined;
  finalOutput: string | undefined;
  status: "running" | "completed" | "failed" | undefined;
  error: string | undefined;
  toolCalls?: (SubagentToolCall | string)[] | undefined;
};

function activityData(p: Partial<ActivityData>): ActivityData {
  return {
    currentTool: undefined,
    currentToolArgs: undefined,
    currentToolStartedAt: undefined,
    finalOutput: undefined,
    status: undefined,
    error: undefined,
    toolCalls: undefined,
    ...p,
  };
}

// Mock theme that tracks calls for verification
function makeMockTheme() {
  const calls: Array<{ fn: string; args: unknown[] }> = [];

  const theme = {
    fg: (token: string, text: string) => {
      calls.push({ fn: "fg", args: [token, text] });
      return `[${token}]${text}[/${token}]`;
    },
    bold: (text: string) => {
      calls.push({ fn: "bold", args: [text] });
      return `**${text}**`;
    },
  };

  return { theme, calls };
}

// ── buildActivityLine ──────────────────────────────────────────────────────

describe("buildActivityLine", () => {
  it("shows error prefix with truncated error when error is present", () => {
    const { theme } = makeMockTheme();
    const result = buildActivityLine(
      activityData({ error: "Something went wrong", status: "running" }),
      theme,
    );
    expect(result).toContain("✗ Something went wrong");
  });

  it("shows '✓ Done' when status is completed", () => {
    const { theme } = makeMockTheme();
    const result = buildActivityLine(
      activityData({ status: "completed" }),
      theme,
    );
    expect(result).toContain("✓ Done");
  });

  it("shows '✗ Failed' when status is failed", () => {
    const { theme } = makeMockTheme();
    const result = buildActivityLine(
      activityData({ status: "failed" }),
      theme,
    );
    expect(result).toContain("✗ Failed");
  });

  it("shows tool name + args when running with current tool", () => {
    const { theme } = makeMockTheme();
    const result = buildActivityLine(
      activityData({
        status: "running",
        currentTool: "read",
        currentToolArgs: '{"path": "foo.ts"}',
      }),
      theme,
    );
    expect(result).toContain("read");
    expect(result).toContain("foo.ts");
  });

  it("shows last tool call when running with no current tool but toolCalls present", () => {
    const { theme } = makeMockTheme();
    const result = buildActivityLine(
      activityData({
        status: "running",
        toolCalls: [
          { name: "bash", argsPreview: "ls -la", error: false },
        ],
      }),
      theme,
    );
    expect(result).toContain("bash");
  });

  it("shows '↳ Starting...' when running with no info", () => {
    const { theme } = makeMockTheme();
    const result = buildActivityLine(
      activityData({ status: "running" }),
      theme,
    );
    expect(result).toContain("↳ Starting...");
  });

  it("shows first line of final output when available", () => {
    const { theme } = makeMockTheme();
    const result = buildActivityLine(
      activityData({
        status: "running",
        finalOutput: "first line of output\nsecond line\nthird line",
      }),
      theme,
    );
    expect(result).toContain("first line of output");
    expect(result).not.toContain("second line");
  });

  it("returns empty string when status is undefined and no data", () => {
    const { theme } = makeMockTheme();
    const result = buildActivityLine(activityData({}), theme);
    expect(result).toBe("");
  });

  it("error takes priority over completed status", () => {
    const { theme } = makeMockTheme();
    const result = buildActivityLine(
      activityData({ error: "oops", status: "completed" }),
      theme,
    );
    expect(result).toContain("✗ oops");
    expect(result).not.toContain("✓ Done");
  });

  it("completed status takes priority over currentTool", () => {
    const { theme } = makeMockTheme();
    const result = buildActivityLine(
      activityData({ status: "completed", currentTool: "read" }),
      theme,
    );
    expect(result).toContain("✓ Done");
    expect(result).not.toContain("read");
  });

  it("shows string toolCall in toolCalls array", () => {
    const { theme } = makeMockTheme();
    const result = buildActivityLine(
      activityData({
        status: "running",
        toolCalls: ["some-string-call"],
      }),
      theme,
    );
    expect(result).toContain("some-string-call");
  });

  it("colors last tool call name with error color when error flag set", () => {
    const { theme, calls } = makeMockTheme();
    buildActivityLine(
      activityData({
        status: "running",
        toolCalls: [{ name: "bash", argsPreview: "rm -rf /", error: true }],
      }),
      theme,
    );
    // The tool name "bash" should be colored with "error" token
    const fgCalls = calls.filter(c => c.fn === "fg");
    const errorCall = fgCalls.find(c => c.args[0] === "error" && c.args[1] === "bash");
    expect(errorCall).toBeDefined();
  });

  it("colors last tool call name with success color when no error", () => {
    const { theme, calls } = makeMockTheme();
    buildActivityLine(
      activityData({
        status: "running",
        toolCalls: [{ name: "read", argsPreview: "file.ts", error: false }],
      }),
      theme,
    );
    const fgCalls = calls.filter(c => c.fn === "fg");
    const successCall = fgCalls.find(c => c.args[0] === "success" && c.args[1] === "read");
    expect(successCall).toBeDefined();
  });
});

// ── renderCompactSingle ────────────────────────────────────────────────────

describe("renderCompactSingle", () => {
  function makeResult(overrides: Partial<SubagentResult> = {}): SubagentResult {
    return {
      agent: "test-agent",
      task: "do something",
      exitCode: 0,
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.01, turns: 3 },
      model: "gpt-4",
      finalOutput: undefined,
      error: undefined,
      progress: undefined,
      progressSummary: { toolCount: 5, tokens: 150, durationMs: 3000 },
      ...overrides,
    };
  }

  it("calls setText with expected output structure for completed agent", () => {
    const { theme } = makeMockTheme();
    const text = new MockText();
    const result = makeResult({ exitCode: 0 });
    const context = { state: {}, invalidate: vi.fn() };

    renderCompactSingle(text, result, undefined, theme, context);

    const output = (text as unknown as { getContent(): string }).getContent();
    expect(output).toContain("test-agent");
    expect(output).toContain("do something");
    expect(output).toContain("✓ Done");
  });

  it("calls setText with expected output structure for running agent", () => {
    const { theme } = makeMockTheme();
    const text = new MockText();
    const result = makeResult({ exitCode: 1 });
    const progress: SubagentProgress = {
      agent: "test-agent",
      status: "running",
      task: "do something",
      currentTool: "read",
      currentToolArgs: undefined,
      currentToolStartedAt: undefined,
      toolCount: 2,
      inputTokens: 50,
      outputTokens: 30,
      tokens: 80,
      cost: 0.005,
      durationMs: 1000,
      error: undefined,
      model: "gpt-4",
      output: undefined,
      recentOutput: undefined,
      toolCalls: undefined,
    };
    const context = { state: {}, invalidate: vi.fn() };

    renderCompactSingle(text, result, progress, theme, context);

    const output = (text as unknown as { getContent(): string }).getContent();
    expect(output).toContain("test-agent");
    expect(output).toContain("read");
  });

  it("returns the text instance", () => {
    const { theme } = makeMockTheme();
    const text = new MockText();
    const result = makeResult();
    const context = { state: {}, invalidate: vi.fn() };

    const returned = renderCompactSingle(text, result, undefined, theme, context);
    expect(returned).toBe(text);
  });
});

// ── renderCompactParallel ──────────────────────────────────────────────────

describe("renderCompactParallel", () => {
  function makeDetails(overrides: Partial<SubagentDetails> = {}): SubagentDetails {
    return {
      mode: "parallel",
      results: [
        {
          agent: "agent-a",
          task: "task a",
          exitCode: 0,
          usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
          model: undefined,
          finalOutput: undefined,
          error: undefined,
          progress: undefined,
          progressSummary: { toolCount: 0, tokens: 0, durationMs: 0 },
        },
        {
          agent: "agent-b",
          task: "task b",
          exitCode: 1,
          usage: { input: 200, output: 100, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
          model: undefined,
          finalOutput: undefined,
          error: "failed",
          progress: undefined,
          progressSummary: { toolCount: 0, tokens: 0, durationMs: 0 },
        },
      ],
      progress: undefined,
      ...overrides,
    };
  }

  it("calls setText with one line per result", () => {
    const { theme } = makeMockTheme();
    const text = new MockText();
    const details = makeDetails();
    const context = { state: {}, invalidate: vi.fn() };

    renderCompactParallel(text, details, theme, context);

    const output = (text as unknown as { getContent(): string }).getContent();
    expect(output).toContain("agent-a");
    expect(output).toContain("agent-b");
    // Two results joined by newline
    const lines = output.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it("returns the text instance", () => {
    const { theme } = makeMockTheme();
    const text = new MockText();
    const details = makeDetails();
    const context = { state: {}, invalidate: vi.fn() };

    const returned = renderCompactParallel(text, details, theme, context);
    expect(returned).toBe(text);
  });
});

// ── Property tests (fast-check) ────────────────────────────────────────────

describe("buildActivityLine property tests", () => {
  it("truncated error never exceeds truncLine limit of 80 chars", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }),
        (error) => {
          const { theme } = makeMockTheme();
          const result = buildActivityLine(
            activityData({ error, status: "running" }),
            theme,
          );
          // Strip the "✗ " prefix and ANSI tags to get the actual truncated text
          const withoutPrefix = result.replace(/^\[error\]✗ /, "");
          // The visible text (without closing ANSI tag) should be <= 80
          const visibleText = withoutPrefix.replace(/\[\/error\]$/, "");
          expect(visibleText.length).toBeLessThanOrEqual(80);
        },
      ),
    );
  });

  it("truncated argsPreview never exceeds truncLine limit of 60 chars", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.includes(": ") && !s.includes("\n")),
        fc.string({ minLength: 1, maxLength: 500 }).filter((s) => !s.includes(": ") && !s.includes("\n")),
        (currentTool, currentToolArgs) => {
          const { theme } = makeMockTheme();
          const result = buildActivityLine(
            activityData({ status: "running", currentTool, currentToolArgs }),
            theme,
          );
          // Extract the args portion after ": "
          const argsMatch = result.match(/: (.+?)(?:\s\|.*|\[\/dim\].*)?$/);
          expect(argsMatch).not.toBeNull();
          if (argsMatch && argsMatch[1]) {
            const argsText = argsMatch[1].replace(/\[\/dim\]$/, "").replace(/\[dim\]/, "");
            expect(argsText.length).toBeLessThanOrEqual(60);
          }
        },
      ),
    );
  });

  it("truncated finalOutput first line never exceeds truncLine limit of 80 chars", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }),
        (finalOutput) => {
          const { theme } = makeMockTheme();
          const result = buildActivityLine(
            activityData({ status: "running", finalOutput }),
            theme,
          );
          // Strip ANSI tags to get visible text
          const visible = result.replace(/\[muted\]/g, "").replace(/\[\/muted\]/g, "");
          // The visible text after "↳ " should be <= 80
          const afterArrow = visible.replace(/^↳ /, "");
          expect(afterArrow.length).toBeLessThanOrEqual(80);
        },
      ),
    );
  });

  it("truncated string toolCall never exceeds truncLine limit of 60 chars", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }),
        (toolCallStr) => {
          const { theme } = makeMockTheme();
          const result = buildActivityLine(
            activityData({ status: "running", toolCalls: [toolCallStr] }),
            theme,
          );
          const visible = result.replace(/\[dim\]/g, "").replace(/\[\/dim\]/g, "");
          const afterArrow = visible.replace(/^↳ /, "");
          expect(afterArrow.length).toBeLessThanOrEqual(60);
        },
      ),
    );
  });
});
