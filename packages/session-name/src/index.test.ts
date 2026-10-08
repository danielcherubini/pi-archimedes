import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFailureReporter,
  generateTitle,
  isStaleCtxError,
  MAX_TITLE_FAILURES,
  normalizeReasoning,
  registerSessionName,
  resolveReasoningOption,
  REASONING_DEFAULT_LABEL,
  REASONING_VALUES,
  getSessionNameSettingsItems,
} from "./index.js";

// loadSessionNameConfig reads the real settings.json. Mock it so the suite is
// hermetic, and drive setting variants through `settings`.
const settings: { model?: string; reasoning?: unknown } = {};
vi.mock("@pi-archimedes/core/settings-io", () => ({
  loadConfig: () => ({ ...settings }),
}));

beforeEach(() => {
  delete settings.model;
  delete settings.reasoning;
});

/** pi's stale-ctx message (print-mode teardown / reload / session replacement). */
const STALE_ERROR =
  "This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload().";

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

/** A pi whose getSessionName() throws the stale-ctx error once `armStale` fires. */
function createStalePi() {
  const pi = createMockPi();
  let armed = false;
  const getSessionName = vi.fn((): string | undefined => {
    if (armed) throw new Error(STALE_ERROR);
    return undefined;
  });
  return { pi: { ...pi, getSessionName }, armStale: () => (armed = true) };
}

interface MockCtxOptions {
  /** Response for the next stream. Reassigned by tests that change behaviour mid-test. */
  response?: () => Promise<any>;
  branch?: any[];
  model?: any;
  hasConfiguredAuth?: boolean;
  hasUI?: boolean;
}

function createMockCtx(options: MockCtxOptions = {}) {
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

  const defaultResponse = async () => ({
    stopReason: "stop",
    content: [{ type: "text", text: "Bug Fix Discussion" }],
  });

  return {
    sessionManager: {
      getBranch: vi.fn(() => options.branch ?? defaultBranch),
      getSessionFile: vi.fn(() => "/tmp/session.json"),
    },
    modelRegistry: {
      getAll: vi.fn(() => [defaultModel]),
      hasConfiguredAuth: vi.fn(() => options.hasConfiguredAuth ?? true),
      // Reassign to change what the next call returns; the mock identity stays
      // stable so call counts keep working.
      streamSimple: vi.fn((_model: any, _context: any, _opts: any) => ({
        result: async () => (options.response ?? defaultResponse)(),
      })),
    },
    model: options.model ?? defaultModel,
    hasUI: options.hasUI ?? false,
    ui: { notify: vi.fn() },
  };
}

/** Third argument (stream options) of the Nth streamSimple call. */
function streamOptions(ctx: ReturnType<typeof createMockCtx>, n = 0): Record<string, unknown> {
  const calls = ctx.modelRegistry.streamSimple.mock.calls as unknown as Array<[any, any, any]>;
  return calls[n]?.[2] ?? {};
}

describe("generateTitle", () => {
  it("generates title, trims quotes and whitespace, and calls pi.setSessionName", async () => {
    const pi = createMockPi();
    const ctx = createMockCtx({
      response: async () => ({
        stopReason: "stop",
        content: [{ type: "text", text: '  "Fixing the Login Bug" \n' }],
      }),
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
        cacheRetention: "none",
        sessionId: expect.any(String),
      }),
    );
    // Issue #80 root cause 1: reasoning used to be hardcoded to "minimal", which
    // some providers reject with HTTP 400. By default no level is requested.
    expect("reasoning" in streamOptions(ctx)).toBe(false);
    expect(pi.setSessionName).toHaveBeenCalledWith("Fixing the Login Bug");
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("passes a configured reasoning level through when the model accepts it", async () => {
    settings.reasoning = "low";
    const pi = createMockPi();
    const ctx = createMockCtx();

    await generateTitle(pi as any, ctx as any, vi.fn(), vi.fn());

    expect(streamOptions(ctx).reasoning).toBe("low");
  });

  it("drops a configured level the model marks unsupported (thinkingLevelMap: null)", async () => {
    settings.reasoning = "minimal";
    const pi = createMockPi();
    const ctx = createMockCtx({
      model: {
        provider: "opencode-go",
        id: "mimo-v2.6-flash",
        reasoning: true,
        thinkingLevelMap: { minimal: null, low: "low" },
      },
    });

    await generateTitle(pi as any, ctx as any, vi.fn(), vi.fn());

    expect("reasoning" in streamOptions(ctx)).toBe(false);
    expect(pi.setSessionName).toHaveBeenCalledWith("Bug Fix Discussion");
  });

  it("triggers onFailure when streamSimple returns stopReason === 'error'", async () => {
    const pi = createMockPi();
    const ctx = createMockCtx({
      response: async () => ({ stopReason: "error", content: [] }),
    });
    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    await generateTitle(pi as any, ctx as any, onSuccess, onFailure);

    expect(ctx.modelRegistry.streamSimple).toHaveBeenCalledTimes(1);
    expect(pi.setSessionName).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(typeof onFailure.mock.calls[0]?.[0]).toBe("string");
  });

  it("reports the provider error message on a failed response", async () => {
    const pi = createMockPi();
    const ctx = createMockCtx({
      response: async () => ({
        stopReason: "error",
        errorMessage: "400 Invalid request parameters",
        content: [],
      }),
    });
    const onFailure = vi.fn();

    await generateTitle(pi as any, ctx as any, vi.fn(), onFailure);

    expect(onFailure).toHaveBeenCalledWith("400 Invalid request parameters");
  });

  it("falls back to a generic reason when the error response carries no message", async () => {
    const pi = createMockPi();
    const ctx = createMockCtx({ response: async () => ({ stopReason: "error", content: [] }) });
    const onFailure = vi.fn();

    await generateTitle(pi as any, ctx as any, vi.fn(), onFailure);

    expect(onFailure).toHaveBeenCalledWith(expect.stringContaining("no message"));
  });

  it("truncates an absurdly long provider error before reporting it", async () => {
    const pi = createMockPi();
    const ctx = createMockCtx({
      response: async () => ({ stopReason: "error", errorMessage: "x".repeat(500), content: [] }),
    });
    const onFailure = vi.fn();

    await generateTitle(pi as any, ctx as any, vi.fn(), onFailure);

    const reason = onFailure.mock.calls[0]?.[0] as string;
    expect(reason.length).toBeLessThanOrEqual(201);
    expect(reason).toMatch(/…$/);
  });

  it("reports a model error when the stream throws", async () => {
    const pi = createMockPi();
    const ctx = createMockCtx({ response: async () => { throw new Error("socket hang up"); } });
    const onFailure = vi.fn();

    await generateTitle(pi as any, ctx as any, vi.fn(), onFailure);

    expect(onFailure).toHaveBeenCalledWith("socket hang up");
  });

  it("does not call onFailure when streamSimple returns stopReason === 'aborted'", async () => {
    const pi = createMockPi();
    const ctx = createMockCtx({
      response: async () => ({
        stopReason: "aborted",
        content: [{ type: "text", text: "Partial Title" }],
      }),
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
    const ctx = createMockCtx({ hasConfiguredAuth: false });
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
    const pi = createMockPi("Already Named");
    const ctx = createMockCtx();
    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    await generateTitle(pi as any, ctx as any, onSuccess, onFailure);

    expect(ctx.modelRegistry.streamSimple).toHaveBeenCalledTimes(1);
    expect(pi.setSessionName).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("treats a stale ctx as a no-op: no failure reported, nothing named", async () => {
    // Issue #80 root cause 3: `pi -p` tears the ctx down while the title
    // request is still in flight.
    const { pi, armStale } = createStalePi();
    const ctx = createMockCtx({ hasUI: true });
    const original = ctx.modelRegistry.streamSimple;
    ctx.modelRegistry.streamSimple = vi.fn((m: any, c: any, o: any) => {
      armStale();
      return original(m, c, o);
    }) as any;
    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    await generateTitle(pi as any, ctx as any, onSuccess, onFailure);

    expect(pi.setSessionName).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("reports a thrown stale error from the stream itself as a no-op too", async () => {
    const ctx = createMockCtx({ hasUI: true });
    const pi = createMockPi();
    const onFailure = vi.fn();

    // A stale ctx also throws from ctx.sessionManager.getBranch() before the
    // request is even built.
    const staleCtx = {
      ...ctx,
      sessionManager: {
        ...ctx.sessionManager,
        getBranch: vi.fn(() => {
          throw new Error(STALE_ERROR);
        }),
      },
    };

    await generateTitle(pi as any, staleCtx as any, vi.fn(), onFailure);

    expect(onFailure).not.toHaveBeenCalled();
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });
});

describe("resolveReasoningOption", () => {
  it("requests no reasoning level by default", () => {
    expect(resolveReasoningOption(undefined, { reasoning: true })).toBeUndefined();
  });

  it('treats "off" the same as unset — pi encodes thinking-off as an absent level', () => {
    expect(resolveReasoningOption("off", { reasoning: true })).toBeUndefined();
  });

  it("passes a configured level through when the model does not object", () => {
    expect(resolveReasoningOption("minimal", { reasoning: true })).toBe("minimal");
    expect(resolveReasoningOption("medium", {})).toBe("medium");
  });

  it("drops a level the model marks unsupported (thinkingLevelMap → null)", () => {
    const model = { reasoning: true, thinkingLevelMap: { minimal: null, low: "low" } };
    expect(resolveReasoningOption("minimal", model)).toBeUndefined();
    expect(resolveReasoningOption("low", model)).toBe("low");
  });

  it("passes pi levels, not provider values — adapters do their own mapping", () => {
    expect(resolveReasoningOption("low", { thinkingLevelMap: { low: "minimal" } })).toBe("low");
  });
});

describe("normalizeReasoning", () => {
  it("accepts known levels case-insensitively and trims", () => {
    expect(normalizeReasoning("Minimal")).toBe("minimal");
    expect(normalizeReasoning("  XHIGH ")).toBe("xhigh");
    expect(normalizeReasoning("off")).toBe("off");
  });

  it("rejects junk from a hand-edited settings.json", () => {
    expect(normalizeReasoning("ultra")).toBeUndefined();
    expect(normalizeReasoning("")).toBeUndefined();
    expect(normalizeReasoning(7)).toBeUndefined();
    expect(normalizeReasoning(null)).toBeUndefined();
    expect(normalizeReasoning(undefined)).toBeUndefined();
  });
});

describe("isStaleCtxError", () => {
  it("matches pi's stale-ctx error and nothing else", () => {
    expect(isStaleCtxError(new Error(STALE_ERROR))).toBe(true);
    expect(isStaleCtxError(new Error("fetch failed"))).toBe(false);
    expect(isStaleCtxError("boom")).toBe(false);
    expect(isStaleCtxError(undefined)).toBe(false);
  });
});

describe("createFailureReporter", () => {
  it("notifies on the first failure with the reason, then stays quiet", () => {
    const reporter = createFailureReporter();
    const notify = vi.fn();

    reporter.record("boom", notify);
    reporter.record("boom", notify);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect(reporter.exhausted()).toBe(false);
  });

  it("notifies once more when the retry budget runs out, and not again", () => {
    const reporter = createFailureReporter();
    const notify = vi.fn();

    for (let i = 0; i < MAX_TITLE_FAILURES + 2; i++) reporter.record("boom", notify);

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[1]?.[0]).toContain(String(MAX_TITLE_FAILURES));
    expect(reporter.exhausted()).toBe(true);
  });

  it("reset clears the budget and the notification latches", () => {
    const reporter = createFailureReporter();
    const notify = vi.fn();

    for (let i = 0; i < MAX_TITLE_FAILURES; i++) reporter.record("boom", notify);
    expect(reporter.exhausted()).toBe(true);

    reporter.reset();
    expect(reporter.exhausted()).toBe(false);

    reporter.record("boom again", notify);
    expect(notify).toHaveBeenCalledTimes(3);
  });
});

describe("getSessionNameSettingsItems", () => {
  it("shows the default reasoning label and offers every level in the panel", () => {
    const items = getSessionNameSettingsItems({});
    const reasoning = items.find((i) => i.id === "sessionNameReasoning");

    expect(reasoning?.currentValue).toBe(REASONING_DEFAULT_LABEL);
    expect(reasoning?.values).toEqual([...REASONING_VALUES]);
  });

  it("shows a configured level as the current value", () => {
    const items = getSessionNameSettingsItems({ reasoning: "medium" });
    expect(items.find((i) => i.id === "sessionNameReasoning")?.currentValue).toBe("medium");
  });
});

describe("registerSessionName", () => {
  interface Harness {
    pi: { on: ReturnType<typeof vi.fn>; getSessionName: ReturnType<typeof vi.fn>; setSessionName: ReturnType<typeof vi.fn> };
    sessionStart: (event: any, ctx: any) => Promise<void>;
    agentEnd: (event: any, ctx: any) => Promise<void>;
  }

  function createHarness(): Harness {
    const handlers = new Map<string, (event: any, ctx: any) => Promise<void>>();
    const pi = {
      on: vi.fn((type: string, handler: (event: any, ctx: any) => Promise<void>) => {
        handlers.set(type, handler);
      }),
      getSessionName: vi.fn(() => undefined),
      setSessionName: vi.fn(),
    };
    registerSessionName(pi as any);
    return {
      pi,
      sessionStart: (event, ctx) => handlers.get("session_start")!(event, ctx),
      agentEnd: (event, ctx) => handlers.get("agent_end")!(event, ctx),
    };
  }

  /** Let the fire-and-forget background task run to completion. */
  async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  /** A ctx whose every title request fails with `errorMessage`. */
  function failingCtx(options: { hasUI?: boolean; errorMessage?: string } = {}) {
    return createMockCtx({
      hasUI: options.hasUI ?? true,
      response: async () => ({
        stopReason: "error",
        errorMessage: options.errorMessage ?? "boom",
        content: [],
      }),
    });
  }

  it("registers handlers at the top level of register(), not nested", () => {
    const { pi } = createHarness();
    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("agent_end", expect.any(Function));
  });

  it("warns once with the provider reason when naming fails", async () => {
    const { sessionStart, agentEnd } = createHarness();
    const ctx = failingCtx({ errorMessage: "400 Invalid request parameters" });

    await sessionStart({}, ctx);
    await agentEnd({}, ctx);
    await vi.waitFor(() => expect(ctx.ui.notify).toHaveBeenCalledTimes(1));

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("400 Invalid request parameters"),
      "warning",
    );
  });

  it("stops trying once the budget is exhausted, having said so exactly once", async () => {
    const { sessionStart, agentEnd } = createHarness();
    const ctx = failingCtx();

    await sessionStart({}, ctx);
    // agent_end is once per turn in practice, so attempts are serialised: flush
    // between them rather than firing all attempts at once.
    for (let i = 0; i < MAX_TITLE_FAILURES + 2; i++) {
      await agentEnd({}, ctx);
      await flush();
    }

    expect(ctx.modelRegistry.streamSimple).toHaveBeenCalledTimes(MAX_TITLE_FAILURES);
    // first-failure notice + gave-up notice, and nothing after
    expect(ctx.ui.notify).toHaveBeenCalledTimes(2);
    expect(ctx.ui.notify.mock.calls[1]?.[0]).toMatch(/gave up after 3 failures/);
  });

  it("does not notify when there is no UI (print / JSON mode)", async () => {
    const { sessionStart, agentEnd } = createHarness();
    const ctx = failingCtx({ hasUI: false });

    await sessionStart({}, ctx);
    await agentEnd({}, ctx);

    // The background task still runs — it just has nobody to tell.
    await vi.waitFor(() => expect(ctx.modelRegistry.streamSimple).toHaveBeenCalledTimes(1));
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("counts a stale ctx against neither the retry budget nor the notifications", async () => {
    const { sessionStart, agentEnd } = createHarness();
    const ctx = createMockCtx({
      hasUI: true,
      response: async () => {
        throw new Error(STALE_ERROR);
      },
    });

    await sessionStart({}, ctx);
    for (let i = 0; i < MAX_TITLE_FAILURES; i++) {
      await agentEnd({}, ctx);
      await flush();
    }

    expect(ctx.modelRegistry.streamSimple).toHaveBeenCalledTimes(MAX_TITLE_FAILURES);
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("names again in a new session after the budget was spent", async () => {
    const harness = createHarness();
    const { sessionStart, agentEnd } = harness;
    const ctx = failingCtx();

    await sessionStart({}, ctx);
    for (let i = 0; i < MAX_TITLE_FAILURES; i++) {
      await agentEnd({}, ctx);
      await flush();
    }
    expect(ctx.modelRegistry.streamSimple).toHaveBeenCalledTimes(MAX_TITLE_FAILURES);

    ctx.modelRegistry.streamSimple.mockImplementation(() => ({
      result: async () => ({ stopReason: "stop", content: [{ type: "text", text: "A New Title" }] }),
    }));

    await sessionStart({}, ctx);
    await agentEnd({}, ctx);

    // session_start reset the retry budget, so a fourth attempt is allowed.
    await vi.waitFor(() =>
      expect(ctx.modelRegistry.streamSimple).toHaveBeenCalledTimes(MAX_TITLE_FAILURES + 1),
    );
    expect(harness.pi.setSessionName).toHaveBeenCalledWith("A New Title");
  });

  it("skips naming when the session already has a name", async () => {
    const pi = { ...createMockPi("hand-named"), on: vi.fn() };
    const handlers = new Map<string, (e: any, c: any) => Promise<void>>();
    pi.on = vi.fn((type: string, h: any) => handlers.set(type, h)) as any;
    registerSessionName(pi as any);

    const ctx = createMockCtx({ hasUI: true });
    await handlers.get("session_start")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);

    expect(ctx.modelRegistry.streamSimple).not.toHaveBeenCalled();
    expect(pi.setSessionName).not.toHaveBeenCalled();
  });

  it("skips ephemeral sessions with no session file", async () => {
    const { sessionStart, agentEnd } = createHarness();
    const ctx = createMockCtx({ hasUI: true });
    ctx.sessionManager.getSessionFile = vi.fn(() => undefined) as any;

    await sessionStart({}, ctx);
    await agentEnd({}, ctx);

    expect(ctx.modelRegistry.streamSimple).not.toHaveBeenCalled();
  });
});
