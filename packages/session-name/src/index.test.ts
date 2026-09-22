import { describe, expect, it, vi } from "vitest";
import { generateTitle } from "./index.js";

function createMockPi(sessionName: string | undefined = undefined) {
  let currentName = sessionName;
  return {
    getSessionName: vi.fn(() => currentName),
    setSessionName: vi.fn((name: string) => {
      currentName = name;
    }),
    on: vi.fn(),
  };
}

function createMockCtx(options: {
  streamSimpleResult?: any;
  branch?: any[];
  model?: any;
  hasConfiguredAuth?: boolean;
}) {
  const defaultBranch = [
    {
      type: "message",
      entry: undefined,
      message: {
        role: "user",
        content: [{ type: "text", text: "How do I fix this bug?" }],
      },
    },
    {
      type: "message",
      entry: undefined,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Here is how you fix the bug." }],
      },
    },
  ];

  const defaultModel = { provider: "anthropic", id: "claude-3-5-sonnet" };

  return {
    sessionManager: {
      getBranch: vi.fn(() => options.branch ?? defaultBranch),
      getSessionFile: vi.fn(() => "/tmp/session.json"),
    },
    modelRegistry: {
      getAll: vi.fn(() => [defaultModel]),
      hasConfiguredAuth: vi.fn(() => options.hasConfiguredAuth ?? true),
      streamSimple: vi.fn(() => ({
        result: vi.fn().mockResolvedValue(
          options.streamSimpleResult ?? {
            stopReason: "stop",
            content: [{ type: "text", text: "Bug Fix Discussion" }],
          },
        ),
      })),
    },
    model: options.model ?? defaultModel,
  };
}

describe("generateTitle", () => {
  it("generates title, trims quotes and whitespace, and calls pi.setSessionName", async () => {
    const pi = createMockPi();
    const ctx = createMockCtx({
      streamSimpleResult: {
        stopReason: "stop",
        content: [{ type: "text", text: '  "Fixing the Login Bug" \n' }],
      },
    });
    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    await generateTitle(pi as any, ctx as any, onSuccess, onFailure);

    expect(ctx.modelRegistry.streamSimple).toHaveBeenCalledTimes(1);
    expect(ctx.modelRegistry.streamSimple).toHaveBeenCalledWith(
      ctx.model,
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            role: "user",
            content: [
              expect.objectContaining({
                type: "text",
                text: expect.stringContaining("How do I fix this bug?"),
              }),
            ],
          }),
        ],
      }),
      expect.objectContaining({
        reasoning: "minimal",
        cacheRetention: "none",
        sessionId: expect.any(String),
      }),
    );
    expect(pi.setSessionName).toHaveBeenCalledWith("Fixing the Login Bug");
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("triggers onFailure when streamSimple returns stopReason === 'error'", async () => {
    const pi = createMockPi();
    const ctx = createMockCtx({
      streamSimpleResult: {
        stopReason: "error",
        content: [],
      },
    });
    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    await generateTitle(pi as any, ctx as any, onSuccess, onFailure);

    expect(ctx.modelRegistry.streamSimple).toHaveBeenCalledTimes(1);
    expect(pi.setSessionName).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("does not call onFailure when streamSimple returns stopReason === 'aborted'", async () => {
    const pi = createMockPi();
    const ctx = createMockCtx({
      streamSimpleResult: {
        stopReason: "aborted",
        content: [{ type: "text", text: "Partial Title" }],
      },
    });
    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    await generateTitle(pi as any, ctx as any, onSuccess, onFailure);

    expect(ctx.modelRegistry.streamSimple).toHaveBeenCalledTimes(1);
    expect(pi.setSessionName).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("skips title generation without incrementing failCount if model lacks configured auth", async () => {
    const pi = createMockPi();
    const ctx = createMockCtx({
      hasConfiguredAuth: false,
    });
    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    await generateTitle(pi as any, ctx as any, onSuccess, onFailure);

    expect(ctx.modelRegistry.hasConfiguredAuth).toHaveBeenCalledWith(ctx.model);
    expect(ctx.modelRegistry.streamSimple).not.toHaveBeenCalled();
    expect(pi.setSessionName).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("aborts without setting session name if race condition occurs (session name already set)", async () => {
    let getSessionNameCallCount = 0;
    const pi = {
      getSessionName: vi.fn(() => {
        getSessionNameCallCount++;
        // First check in generateTitle before setting name returns existing name
        // (Wait, step 8 checks if (pi.getSessionName()) return;)
        return "Already Named";
      }),
      setSessionName: vi.fn(),
      on: vi.fn(),
    };
    const ctx = createMockCtx({
      streamSimpleResult: {
        stopReason: "stop",
        content: [{ type: "text", text: "New Title" }],
      },
    });
    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    await generateTitle(pi as any, ctx as any, onSuccess, onFailure);

    expect(ctx.modelRegistry.streamSimple).toHaveBeenCalledTimes(1);
    expect(pi.setSessionName).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });
});
