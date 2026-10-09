import { loadConfig } from "@pi-archimedes/core/settings-io";
import { describe, expect, it, vi } from "vitest";
import { thinkingBudgetForLevel } from "@earendil-works/pi-ai/api/simple-options";
import { generateTitle, registerSessionName, resolveTitleReasoning } from "./index.js";

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

vi.mock("@pi-archimedes/core/settings-io", () => ({
  loadConfig: vi.fn((_namespace, defaults) => defaults),
}));

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

  it.each(["low", null])("uses configured reasoning %s", async (reasoning) => {
    vi.mocked(loadConfig).mockReturnValueOnce({ reasoning });
    const ctx = createMockCtx({});
    await generateTitle(createMockPi() as any, ctx as any, vi.fn(), vi.fn());

    const options = (ctx.modelRegistry.streamSimple as any).mock.calls[0][2];
    if (reasoning === null) expect(options).not.toHaveProperty("reasoning");
    else expect(options.reasoning).toBe(reasoning);
  });

  // Issue #86: settings.json is hand-edited strict JSON, so the value can be
  // anything. A non-level must never reach the provider — see the pin at the
  // end of this block for what that costs.
  describe("reasoning validation", () => {
    it("passes every real thinking level through untouched", async () => {
      for (const reasoning of ["minimal", "low", "medium", "high", "xhigh", "max"]) {
        vi.mocked(loadConfig).mockReturnValueOnce({ reasoning });
        const ctx = createMockCtx({});
        await generateTitle(createMockPi() as any, ctx as any, vi.fn(), vi.fn());

        const options = (ctx.modelRegistry.streamSimple as any).mock.calls[0][2];
        expect(options.reasoning).toBe(reasoning);
      }
    });

    it.each(["Minimal", "  high  ", "MAX"])("tolerates casing and padding: %s", async (raw) => {
      vi.mocked(loadConfig).mockReturnValueOnce({ reasoning: raw });
      const ctx = createMockCtx({});
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await generateTitle(createMockPi() as any, ctx as any, vi.fn(), vi.fn());
        expect((ctx.modelRegistry.streamSimple as any).mock.calls[0][2].reasoning).toBe(
          raw.trim().toLowerCase(),
        );
        expect(log).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
    });

    it.each([["ultra"], ["off"], [""], [42], [true], [{}], [[]]])(
      "never forwards a non-level: %s",
      async (raw) => {
        vi.mocked(loadConfig).mockReturnValueOnce({ reasoning: raw });
        const ctx = createMockCtx({});
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
          await generateTitle(createMockPi() as any, ctx as any, vi.fn(), vi.fn());

          const sent = (ctx.modelRegistry.streamSimple as any).mock.calls[0][2].reasoning;
          // Invalid config behaves like absent config: the documented default.
          expect(sent).toBe("minimal");
          expect(log).toHaveBeenCalledWith(
            "[archimedes] session-name: ignoring unrecognized reasoning",
            JSON.stringify(raw),
          );
        } finally {
          log.mockRestore();
        }
      },
    );

    it("sends no reasoning key when the value is null, and says nothing", async () => {
      vi.mocked(loadConfig).mockReturnValueOnce({ reasoning: null });
      const ctx = createMockCtx({});
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await generateTitle(createMockPi() as any, ctx as any, vi.fn(), vi.fn());
        expect((ctx.modelRegistry.streamSimple as any).mock.calls[0][2]).not.toHaveProperty("reasoning");
        expect(log).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
    });

    it("keeps the default when the setting is absent entirely", async () => {
      const ctx = createMockCtx({});
      await generateTitle(createMockPi() as any, ctx as any, vi.fn(), vi.fn());
      expect((ctx.modelRegistry.streamSimple as any).mock.calls[0][2].reasoning).toBe("minimal");
    });

    // Pin the invariant against the arithmetic that makes this dangerous. Of
    // every adapter, only `anthropic-messages` and `bedrock-converse-stream`
    // never call `clampThinkingLevel` (grepped: zero occurrences), so a
    // forwarded non-level reaches their level tables verbatim:
    //   - adaptive-thinking models: mapThinkingLevelToEffort has no `off` case
    //     and its `default:` returns "high" — a typo silently buys maximum
    //     effort on a one-line title. This is the real damage: nothing fails.
    //   - budget-based models: thinkingBudgetForLevel's table has four keys, so
    //     a non-level yields undefined, which propagates into max_tokens as NaN
    //     (serialized `null`) and the provider rejects it. Silly, but loud.
    // We can't fix pi's tables, so guarantee we never hand it a non-level:
    // whatever we send must be a level the budget table recognises.
    it("resolved reasoning is always a level the Anthropic budget table knows", () => {
      // The hazard, read from pi-ai itself: these levels have a budget, junk doesn't.
      const levels = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
      for (const level of levels) {
        expect(thinkingBudgetForLevel(level)).toBeTypeOf("number");
      }
      const junk: unknown[] = ["ultra", "MINIMAL", "off", "", "Max ", 42, true, {}, []];
      for (const value of junk) {
        expect(thinkingBudgetForLevel(value as never)).toBeUndefined();
      }

      // Whatever the setting holds, the value we forward is always safe to send.
      for (const raw of [...levels, ...junk, null, undefined]) {
        const resolved = resolveTitleReasoning(raw);
        if (resolved === null) continue; // omitted → the adapter skips thinking entirely
        expect(levels).toContain(resolved);
        expect(thinkingBudgetForLevel(resolved)).toBeTypeOf("number");
      }
    });
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

  it.each([
    ["This extension ctx is stale after session replacement or reload.", 0],
    ["Unexpected lookup failure", 1],
  ] as const)("handles lookup errors: %s", async (message, failures) => {
    const pi = createMockPi();
    pi.getSessionName.mockImplementation(() => { throw new Error(message); });
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await generateTitle(pi as any, createMockCtx({}) as any, onSuccess, onFailure);
      expect(onFailure).toHaveBeenCalledTimes(failures);
      expect(log).toHaveBeenCalledTimes(failures);
      expect(onSuccess).not.toHaveBeenCalled();
      expect(pi.setSessionName).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
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

describe("registerSessionName", () => {
  it.each(["UI", "no UI", "named", "stale", "stale UI", "broken UI"])("reports exhaustion safely: %s", async (scenario) => {
    const pi = createMockPi();
    registerSessionName(pi as any);
    const agentEnd = pi.on.mock.calls.find(([event]) => event === "agent_end")![1];
    const error = { stopReason: "error", content: [], errorMessage: "400 boom" };
    const notify = vi.fn();
    const ctx = { ...createMockCtx({ streamSimpleResult: error }), hasUI: scenario !== "no UI", ui: { notify } };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await agentEnd({}, ctx);
      await agentEnd({}, ctx);
      let finish!: (response: any) => void;
      const pending = new Promise((resolve) => { finish = resolve; });
      ctx.modelRegistry.streamSimple.mockReturnValueOnce({ result: vi.fn(() => pending) });
      await agentEnd({}, ctx);
      // Change the session/UI while the third request is still pending.
      if (scenario === "named") pi.setSessionName("Manual name");
      if (scenario === "stale") pi.getSessionName.mockImplementation(() => { throw new Error("stale context"); });
      if (scenario === "stale UI") Object.defineProperty(ctx, "hasUI", { get: () => { throw new Error("stale UI"); } });
      if (scenario === "broken UI") notify.mockImplementation(() => { throw new Error("UI failed"); });
      finish(error);
      await pending;
      await agentEnd({}, ctx);
      expect(ctx.modelRegistry.streamSimple).toHaveBeenCalledTimes(3);
      expect(log).toHaveBeenCalledTimes(3);
      expect(log).toHaveBeenCalledWith("[archimedes] session-name failed:", "400 boom");
      expect(notify).toHaveBeenCalledTimes(scenario === "UI" || scenario === "broken UI" ? 1 : 0);
      if (scenario === "UI") expect(notify).toHaveBeenCalledWith(expect.stringContaining("/name"), "warning");
    } finally {
      log.mockRestore();
    }
  });
});
