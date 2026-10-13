/**
 * Dispatch-time behaviour of the `subagent` tool: the two halves of tool-name
 * validation as the calling model sees them.
 *
 *   * A `tools:` list the config read rejected (an entry pi cannot read as a
 *     name) refuses the dispatch — the child must never be spawned with a list
 *     whose meaning is up to the host's parser.
 *   * A name that is well formed but not in `pi.getAllTools()` right now is a
 *     **warning** and the dispatch runs anyway. A plugin being toggled off, or an
 *     MCP server being disconnected, must not make `tools: web_search` unusable.
 *
 * `./agents.js` and `./execute.js` are mocked so the assertions are about the
 * gate, not about the filesystem or a real child process.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const discoverAgents = vi.hoisted(() => vi.fn());
const executeSubagent = vi.hoisted(() => vi.fn());
const executeParallel = vi.hoisted(() => vi.fn());

vi.mock("./agents.js", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  discoverAgents,
}));
vi.mock("./execute.js", () => ({
  executeSubagent,
  executeParallel,
}));

const { registerSubagent } = await import("./index.js");

interface FakeTool {
  name: string;
  execute: (
    id: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
}

function register(): FakeTool[] {
  const tools: FakeTool[] = [];
  const pi = {
    registerTool: (def: FakeTool) => tools.push(def),
    on: () => {},
    getAllTools: () => [{ name: "read" }, { name: "bash" }],
  };
  // `as never` at the seam only: the fake API carries the three members the
  // registration path actually touches.
  registerSubagent(pi as never);
  return tools;
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    cwd: "/tmp",
    model: undefined,
    modelRegistry: { getAll: () => [], getAvailable: () => [] },
    hasUI: true,
    ui: { notify: vi.fn() },
    ...overrides,
  };
}

const okResult = {
  agent: "reviewer",
  task: "review it",
  exitCode: 0,
  usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.01, turns: 1 },
  model: "anthropic/claude-opus-4.5",
  finalOutput: "all good",
  error: undefined,
  progress: undefined,
  progressSummary: { toolCount: 1, tokens: 15, durationMs: 10 },
};

function agentConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: "reviewer",
    description: "d",
    systemPrompt: "p",
    source: "user",
    filePath: "/tmp/agents/reviewer.md",
    ...overrides,
  };
}

function subagent(tools: FakeTool[]): FakeTool {
  const tool = tools.find((t) => t.name === "subagent");
  if (!tool) throw new Error("subagent tool was not registered");
  return tool;
}

beforeEach(() => {
  discoverAgents.mockReset();
  executeSubagent.mockReset();
  executeParallel.mockReset();
  executeSubagent.mockResolvedValue(okResult);
  executeParallel.mockResolvedValue([okResult]);
});

describe("dispatch: membership of tools: entries", () => {
  it("a well-formed name pi does not have right now warns, naming the entry", async () => {
    discoverAgents.mockReturnValue([agentConfig({ tools: ["read", "web_search"] })]);
    const ctx = makeCtx();
    const result = await subagent(register()).execute(
      "call-1",
      { agent: "reviewer", task: "review it" },
      undefined,
      undefined,
      ctx,
    );

    const warnings = ctx.ui.notify.mock.calls.filter(([, kind]) => kind === "warning");
    expect(warnings.length).toBe(1);
    expect(String(warnings[0]![0])).toContain("web_search");
    expect(result.isError).toBeFalsy();
  });

  it("and the dispatch still runs, returning the child's real result", async () => {
    discoverAgents.mockReturnValue([agentConfig({ tools: ["read", "web_search"] })]);
    const ctx = makeCtx();
    const result = await subagent(register()).execute(
      "call-1",
      { agent: "reviewer", task: "review it" },
      undefined,
      undefined,
      ctx,
    );

    // The success path, not just the message: the child ran and its output is
    // what the model gets back.
    expect(executeSubagent).toHaveBeenCalledTimes(1);
    expect(result.content[0]!.text).toBe("all good");
    expect(result.isError).toBeFalsy();
  });

  it("names every unavailable entry in one warning", async () => {
    discoverAgents.mockReturnValue([agentConfig({ tools: ["read", "web_search", "fetch_content"] })]);
    const ctx = makeCtx();
    await subagent(register()).execute("c", { agent: "reviewer", task: "t" }, undefined, undefined, ctx);
    const message = String(ctx.ui.notify.mock.calls.find(([, kind]) => kind === "warning")?.[0] ?? "");
    expect(message).toContain("web_search");
    expect(message).toContain("fetch_content");
  });

  it("says nothing when every entry is a tool pi has", async () => {
    discoverAgents.mockReturnValue([agentConfig({ tools: ["read", "bash"] })]);
    const ctx = makeCtx();
    await subagent(register()).execute("c", { agent: "reviewer", task: "t" }, undefined, undefined, ctx);
    expect(ctx.ui.notify).not.toHaveBeenCalled();
    expect(executeSubagent).toHaveBeenCalledTimes(1);
  });

  it("says nothing when the agent has no allowlist (nothing to check)", async () => {
    discoverAgents.mockReturnValue([agentConfig()]);
    const ctx = makeCtx();
    await subagent(register()).execute("c", { agent: "reviewer", task: "t" }, undefined, undefined, ctx);
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("a * entry is a pattern, so it is judged against the tools pi has, not by name", async () => {
    const tools: Array<{ name: string }> = [{ name: "read" }, { name: "bash" }, { name: "mcp__radius__query" }];
    discoverAgents.mockReturnValue([agentConfig({ tools: ["read", "mcp__radius__*"] })]);
    const ctx = makeCtx();
    const registered: FakeTool[] = [];
    registerSubagent({
      registerTool: (def: FakeTool) => registered.push(def),
      on: () => {},
      getAllTools: () => tools,
    } as never);
    await subagent(registered).execute("c", { agent: "reviewer", task: "t" }, undefined, undefined, ctx);
    expect(ctx.ui.notify).not.toHaveBeenCalled();
    expect(executeSubagent).toHaveBeenCalledTimes(1);
  });

  it("a pattern that nothing currently satisfies is named in the warning", async () => {
    discoverAgents.mockReturnValue([agentConfig({ tools: ["read", "mcp__*"] })]);
    const ctx = makeCtx();
    await subagent(register()).execute("c", { agent: "reviewer", task: "t" }, undefined, undefined, ctx);
    const warning = ctx.ui.notify.mock.calls.find(([, kind]) => kind === "warning");
    expect(warning).toBeTruthy();
    expect(String(warning![0])).toContain("mcp__*");
    // Still a warning: the run happens.
    expect(executeSubagent).toHaveBeenCalledTimes(1);
  });

  it("warns per task in parallel mode and still dispatches the batch", async () => {
    discoverAgents.mockReturnValue([agentConfig({ tools: ["read", "web_search"] })]);
    const ctx = makeCtx();
    const result = await subagent(register()).execute(
      "c",
      { tasks: [{ agent: "reviewer", task: "a" }, { agent: "reviewer", task: "b" }] },
      undefined,
      undefined,
      ctx,
    );
    expect(executeParallel).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeFalsy();
    const warnings = ctx.ui.notify.mock.calls.filter(([, kind]) => kind === "warning");
    expect(warnings.length).toBeGreaterThan(0);
    expect(String(warnings[0]![0])).toContain("web_search");
  });

  it("stays quiet when there is no UI to notify, and still runs", async () => {
    discoverAgents.mockReturnValue([agentConfig({ tools: ["web_search"] })]);
    const ctx = makeCtx({ hasUI: false });
    await subagent(register()).execute("c", { agent: "reviewer", task: "t" }, undefined, undefined, ctx);
    expect(ctx.ui.notify).not.toHaveBeenCalled();
    expect(executeSubagent).toHaveBeenCalledTimes(1);
  });
});

describe("dispatch: a tools list the config read rejected", () => {
  it("refuses to spawn, naming the entry and the file", async () => {
    discoverAgents.mockReturnValue([
      agentConfig({
        tools: undefined,
        toolsError: 'Agent "reviewer" has a tools entry starting with "+" (in /tmp/agents/reviewer.md): "+web_search".',
      }),
    ]);
    const ctx = makeCtx();
    const result = await subagent(register()).execute(
      "c",
      { agent: "reviewer", task: "t" },
      undefined,
      undefined,
      ctx,
    );
    expect(executeSubagent).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("+web_search");
    expect(result.content[0]!.text).toContain("/tmp/agents/reviewer.md");
  });

  it("refuses the whole parallel batch rather than running the poisoned task", async () => {
    discoverAgents.mockReturnValue([
      agentConfig({ toolsError: 'Agent "reviewer" lists the tool "read" more than once (in /tmp/agents/reviewer.md).' }),
    ]);
    const ctx = makeCtx();
    const result = await subagent(register()).execute(
      "c",
      { tasks: [{ agent: "reviewer", task: "a" }] },
      undefined,
      undefined,
      ctx,
    );
    expect(executeParallel).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("read");
  });
});

describe("dispatch: the result the model reads carries the run outcome", () => {
  it("marks a truncated answer, and does not report it as an error", async () => {
    discoverAgents.mockReturnValue([]);
    executeSubagent.mockResolvedValue({
      ...okResult,
      outcome: "truncated",
      exitCode: 1,
      finalOutput: "here is most of it",
      error: undefined,
    });
    const ctx = makeCtx();
    const result = await subagent(register()).execute("c", { task: "t" }, undefined, undefined, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain("here is most of it");
    expect(result.content[0]!.text).toMatch(/truncated/i);
  });

  it("marks a cancelled run", async () => {
    discoverAgents.mockReturnValue([]);
    executeSubagent.mockResolvedValue({
      ...okResult,
      outcome: "aborted",
      exitCode: 143,
      finalOutput: undefined,
    });
    const result = await subagent(register()).execute("c", { task: "t" }, undefined, undefined, makeCtx());
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toMatch(/aborted/i);
  });

  it("keeps reporting a failed run as an error, with no outcome claim", async () => {
    discoverAgents.mockReturnValue([]);
    executeSubagent.mockResolvedValue({
      ...okResult,
      outcome: undefined,
      exitCode: 1,
      finalOutput: undefined,
      error: "boom",
    });
    const result = await subagent(register()).execute("c", { task: "t" }, undefined, undefined, makeCtx());
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("boom");
  });

  it("reports a failed run that exited 0 as an error too", async () => {
    // The exit code cannot be the trigger: `--mode json` — what the child runs —
    // never maps `stopReason` onto it (that mapping is print mode's text branch),
    // so a child whose last response errored exits 0. Keying `isError` off the
    // code reported a provider failure to the model as a success.
    discoverAgents.mockReturnValue([]);
    executeSubagent.mockResolvedValue({
      ...okResult,
      outcome: undefined,
      exitCode: 0,
      finalOutput: undefined,
      error: '401 unauthorized',
    });
    const result = await subagent(register()).execute("c", { task: "t" }, undefined, undefined, makeCtx());
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("401");
  });

  it("says nothing extra for a completed run", async () => {
    discoverAgents.mockReturnValue([]);
    const result = await subagent(register()).execute("c", { task: "t" }, undefined, undefined, makeCtx());
    expect(result.content[0]!.text).toBe("all good");
    expect(result.isError).toBeFalsy();
  });
});

describe("dispatch: cost is reported natively, not on the bus", () => {
  it("the tool result carries usage in pi's shape, so /session folds it in", async () => {
    discoverAgents.mockReturnValue([]);
    const result = (await subagent(register()).execute(
      "c",
      { task: "t" },
      undefined,
      undefined,
      makeCtx(),
    )) as unknown as {
      usage?: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        totalTokens: number;
        cost: { total: number };
      };
    };
    expect(result.usage?.input).toBe(10);
    expect(result.usage?.output).toBe(5);
    expect(result.usage?.totalTokens).toBe(15);
    expect(result.usage?.cost.total).toBeCloseTo(0.01);
  });

  it("a parallel batch carries the summed usage of its runs", async () => {
    discoverAgents.mockReturnValue([]);
    executeParallel.mockResolvedValue([okResult, okResult]);
    const result = (await subagent(register()).execute(
      "c",
      { tasks: [{ task: "a" }, { task: "b" }] },
      undefined,
      undefined,
      makeCtx(),
    )) as unknown as { usage?: { input: number; cost: { total: number } } };
    expect(result.usage?.input).toBe(20);
    expect(result.usage?.cost.total).toBeCloseTo(0.02);
  });

  it("does not republish the usage of a run the desktop performed (bridge mode)", async () => {
    // A bridge-dispatched child is a session of the desktop's own and books its
    // usage there. pi folds a tool result's `usage` into THIS session's totals,
    // so copying it across would bill the parent for a run it did not perform —
    // the same double-count that deleted the COST_UPDATE route. `executeSubagent`
    // marks the result; the tool has to honour the mark.
    discoverAgents.mockReturnValue([]);
    executeSubagent.mockResolvedValue({ ...okResult, usageAccountedElsewhere: true });
    const result = (await subagent(register()).execute(
      "c",
      { task: "t" },
      undefined,
      undefined,
      makeCtx(),
    )) as unknown as { usage?: unknown; content: Array<{ text: string }> };
    expect(result.usage).toBeUndefined();
    // Only the cost report is withheld — the run's output is untouched.
    expect(result.content[0]!.text).toBe("all good");
  });

  it("reports the fork path's usage even when a sibling run was done elsewhere", async () => {
    discoverAgents.mockReturnValue([]);
    executeParallel.mockResolvedValue([
      okResult,
      { ...okResult, usageAccountedElsewhere: true },
    ]);
    const result = (await subagent(register()).execute(
      "c",
      { tasks: [{ task: "a" }, { task: "b" }] },
      undefined,
      undefined,
      makeCtx(),
    )) as unknown as { usage?: { input: number; cost: { total: number } } };
    expect(result.usage?.input).toBe(10);
    expect(result.usage?.cost.total).toBeCloseTo(0.01);
  });

  it("publishes nothing on COST_UPDATE while a run reports its cost", async () => {
    const { getBus, Events } = await import("@pi-archimedes/core/bus");
    const seen: unknown[] = [];
    const unsub = getBus().on(Events.COST_UPDATE, (payload) => seen.push(payload));
    try {
      discoverAgents.mockReturnValue([]);
      await subagent(register()).execute("c", { task: "t" }, undefined, undefined, makeCtx());
    } finally {
      unsub();
    }
    expect(seen).toEqual([]);
  });

  it("publishes nothing on COST_UPDATE for a parallel batch either", async () => {
    const { getBus, Events } = await import("@pi-archimedes/core/bus");
    executeParallel.mockResolvedValue([okResult, okResult]);
    const seen: unknown[] = [];
    const unsub = getBus().on(Events.COST_UPDATE, (payload) => seen.push(payload));
    try {
      discoverAgents.mockReturnValue([]);
      await subagent(register()).execute(
        "c",
        { tasks: [{ task: "a" }, { task: "b" }] },
        undefined,
        undefined,
        makeCtx(),
      );
    } finally {
      unsub();
    }
    expect(seen).toEqual([]);
  });
});
