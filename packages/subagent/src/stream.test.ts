import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import { getBus, Events } from "@pi-archimedes/core/bus";
import { streamEvents, type StreamCallbacks } from "./stream.js";

type FakeChild = ChildProcess & { stdout: PassThrough; stderr: PassThrough };

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  Object.assign(child, {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => true,
  });
  return child;
}

async function finishWith(
  events: Array<Record<string, unknown>>,
  callbacks: StreamCallbacks = {},
) {
  const child = fakeChild();
  const result = streamEvents(child, callbacks);
  for (const event of events) {
    child.stdout.write(`${JSON.stringify(event)}\n`);
  }
  child.emit("close", 0);
  return result;
}


describe("streamEvents session identity", () => {
  it("returns the logical child Pi session ID", async () => {
    const result = await finishWith([{
      type: "session",
      id: "00000000-0000-7000-8000-000000000003",
    }]);

    expect(result.childSessionId).toBe("00000000-0000-7000-8000-000000000003");
  });

  it("omits the child session ID when no valid session event arrives", async () => {
    const result = await finishWith([
      { type: "session" },
      { type: "session", id: 42 },
    ]);

    expect(result.childSessionId).toBeUndefined();
  });
});

describe("streamEvents todo mirroring", () => {
  const start = {
    type: "tool_execution_start",
    toolCallId: "t1",
    toolName: "manage_todo_list",
    args: {
      operation: "write",
      todoList: [{ id: 1, title: "Fix auth", status: "not-started" }],
    },
  } as unknown as Record<string, unknown>;

  it("mirrors the child-accepted state from result.details.todos", async () => {
    const updates: Array<{ source: string; todos: unknown[] }> = [];
    const clears: Array<{ source: string }> = [];
    const off = getBus().on(Events.TODOS_UPDATE, (p: unknown) =>
      updates.push(p as (typeof updates)[number]),
    );
    const offClear = getBus().on(Events.TODOS_CLEAR, (p: unknown) =>
      clears.push(p as { source: string }),
    );

    await finishWith(
      [
        start,
        {
          type: "tool_execution_end",
          toolCallId: "t1",
          toolName: "manage_todo_list",
          isError: false,
          result: {
            content: [{ type: "text", text: "ok" }],
            details: {
              operation: "write",
              todos: [{ content: "Fix auth", status: "pending" }],
            },
          },
        },
      ],
      { agent: "t-acc" },
    );
    off();
    offClear();

    expect(updates).toHaveLength(1);
    expect(updates[0]!.source).toBe("subagent:t-acc");
    expect(updates[0]!.todos).toEqual([
      { content: "Fix auth", status: "pending" },
    ]);
    // Bus re-drains queued events (emitted while unsubscribed) to the next
    // subscriber, so stale "subagent:general" clears from earlier tests may
    // be present — assert on the per-agent source instead of the raw count.
    expect(clears.filter((c) => c.source === "subagent:t-acc")).toHaveLength(1);
  });

  it("mirrors nothing when the tool returned a validation rejection (result.isError)", async () => {
    const updates: Array<{ source: string; todos: unknown[] }> = [];
    const off = getBus().on(Events.TODOS_UPDATE, (p: unknown) =>
      updates.push(p as (typeof updates)[number]),
    );

    await finishWith(
      [
        start,
        {
          type: "tool_execution_end",
          toolCallId: "t1",
          toolName: "manage_todo_list",
          isError: false,
          result: {
            content: [{ type: "text", text: "Validation failed" }],
            details: {
              operation: "write",
              todos: [{ content: "Old item", status: "completed" }],
              error: "Item 1: missing or invalid 'content'",
            },
            isError: true,
          },
        },
      ],
      { agent: "t-rej" },
    );
    off();

    expect(updates).toHaveLength(0);
  });

  it("mirrors nothing when the harness reported an error (event.isError)", async () => {
    const updates: Array<{ source: string; todos: unknown[] }> = [];
    const off = getBus().on(Events.TODOS_UPDATE, (p: unknown) =>
      updates.push(p as (typeof updates)[number]),
    );

    await finishWith(
      [
        start,
        {
          type: "tool_execution_end",
          toolCallId: "t1",
          toolName: "manage_todo_list",
          isError: true,
          result: {
            content: [{ type: "text", text: "Aborted" }],
            details: {},
          },
        },
      ],
      { agent: "t-rej2" },
    );
    off();

    expect(updates).toHaveLength(0);
  });

  it("falls back to normalized raw args when the accepted result has no details", async () => {
    const updates: Array<{ source: string; todos: unknown[] }> = [];
    const off = getBus().on(Events.TODOS_UPDATE, (p: unknown) =>
      updates.push(p as (typeof updates)[number]),
    );

    await finishWith(
      [
        start,
        {
          type: "tool_execution_end",
          toolCallId: "t1",
          toolName: "manage_todo_list",
          isError: false,
          result: { content: [{ type: "text", text: "ok" }] },
        },
      ],
      { agent: "t-nodetails" },
    );
    off();

    expect(updates).toHaveLength(1);
    expect(updates[0]!.source).toBe("subagent:t-nodetails");
    expect(updates[0]!.todos).toEqual([
      { content: "Fix auth", status: "pending" },
    ]);
  });

  it("stows raw args under the alias key todo_list (result has no details)", async () => {
    const updates: Array<{ source: string; todos: unknown[] }> = [];
    const off = getBus().on(Events.TODOS_UPDATE, (p: unknown) =>
      updates.push(p as (typeof updates)[number]),
    );

    await finishWith(
      [
        {
          type: "tool_execution_start",
          toolCallId: "t-alias",
          toolName: "manage_todo_list",
          args: {
            operation: "write",
            todo_list: [{ id: 1, title: "Fix auth", status: "not-started" }],
          },
        },
        {
          type: "tool_execution_end",
          toolCallId: "t-alias",
          toolName: "manage_todo_list",
          isError: false,
          result: { content: [{ type: "text", text: "ok" }] },
        },
      ],
      { agent: "t-alias" },
    );
    off();

    expect(updates).toHaveLength(1);
    expect(updates[0]!.source).toBe("subagent:t-alias");
    expect(updates[0]!.todos).toEqual([
      { content: "Fix auth", status: "pending" },
    ]);
  });

  it("does not crash or emit when the end event has no matching start", async () => {
    const updates: Array<{ source: string; todos: unknown[] }> = [];
    const off = getBus().on(Events.TODOS_UPDATE, (p: unknown) =>
      updates.push(p as (typeof updates)[number]),
    );

    const result = await finishWith(
      [
        {
          type: "tool_execution_end",
          toolCallId: "orphan",
          toolName: "manage_todo_list",
          isError: false,
          result: { content: [{ type: "text", text: "ok" }] },
        },
      ],
      { agent: "t-orphan" },
    );
    off();

    expect(result.exitCode).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("does not emit for non-todo tools with todoList-shaped args", async () => {
    const updates: Array<{ source: string; todos: unknown[] }> = [];
    const off = getBus().on(Events.TODOS_UPDATE, (p: unknown) =>
      updates.push(p as (typeof updates)[number]),
    );

    await finishWith(
      [
        {
          type: "tool_execution_start",
          toolCallId: "b1",
          toolName: "bash",
          args: {
            operation: "write",
            todoList: [{ content: "Fix auth", status: "pending" }],
          },
        },
        {
          type: "tool_execution_end",
          toolCallId: "b1",
          toolName: "bash",
          isError: false,
          result: {
            content: [{ type: "text", text: "ok" }],
            details: {
              operation: "write",
              todos: [{ content: "Fix auth", status: "pending" }],
            },
          },
        },
      ],
      { agent: "t-bash" },
    );
    off();

    expect(updates).toHaveLength(0);
  });

  it("uses a unique per-child source when the child provides a session id", async () => {
    const updates: Array<{ source: string; todos: unknown[] }> = [];
    const clears: Array<{ source: string }> = [];
    const off = getBus().on(Events.TODOS_UPDATE, (p: unknown) =>
      updates.push(p as (typeof updates)[number]),
    );
    const offClear = getBus().on(Events.TODOS_CLEAR, (p: unknown) =>
      clears.push(p as { source: string }),
    );

    const agent = "t-unique";
    const idA = "11111111-1111-7111-8111-111111111111";
    const idB = "22222222-2222-7222-8222-222222222222";

    const accepted = {
      type: "tool_execution_end",
      toolCallId: "t1",
      toolName: "manage_todo_list",
      isError: false,
      result: {
        content: [{ type: "text", text: "ok" }],
        details: {
          operation: "write",
          todos: [{ content: "Fix auth", status: "pending" }],
        },
      },
    } as unknown as Record<string, unknown>;

    // Two concurrent children, same agent, distinct session ids.
    await finishWith(
      [{ type: "session", id: idA }, start, accepted],
      { agent },
    );
    await finishWith(
      [{ type: "session", id: idB }, start, accepted],
      { agent },
    );
    off();
    offClear();

    const sources = updates.map((u) => u.source);
    // Each child gets its own suffixed source equal to subagent:<agent>:<uuid>.
    expect(sources).toContain(`subagent:${agent}:${idA}`);
    expect(sources).toContain(`subagent:${agent}:${idB}`);
    // The two concurrent children must NOT share a single source.
    expect(sources.filter((s) => s.startsWith(`subagent:${agent}:`))).toEqual([
      `subagent:${agent}:${idA}`,
      `subagent:${agent}:${idB}`,
    ]);
    // The clear on close carries the same suffixed source for each child.
    expect(clears.filter((c) => c.source === `subagent:${agent}:${idA}`)).toHaveLength(1);
    expect(clears.filter((c) => c.source === `subagent:${agent}:${idB}`)).toHaveLength(1);
  });
});


// ── Run outcomes (CONTEXT.md: *Run outcome*; ADR 0028) ──────────────────────
//
// pi 1.2.0 made print mode exit 1 when the final response hit the output token
// limit, and text-mode truncation is reported that way — so an exit code alone
// can no longer tell a useful-but-cut-off answer from a crash. The child's own
// `stopReason` and 1.1.0's `agent_settled.aborted` are what carry the
// distinction; `agent_end` fires for a cancelled run too and says nothing about
// either. Cost has to survive all three outcomes.

const USAGE = {
  input: 100,
  output: 40,
  cacheRead: 7,
  cacheWrite: 2,
  totalTokens: 149,
  cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
};

function assistantMessage(stopReason: string): Record<string, unknown> {
  return {
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "partial answer" }],
      model: "anthropic/claude-opus-4.5",
      stopReason,
      usage: USAGE,
    },
  };
}

async function finishChild(
  events: Array<Record<string, unknown>>,
  close: [code: number | null, signal?: NodeJS.Signals | null],
  stderr = "",
) {
  const child = fakeChild();
  const result = streamEvents(child, { agent: "reviewer", task: "t" });
  if (stderr) child.stderr.write(stderr);
  for (const event of events) {
    child.stdout.write(`${JSON.stringify(event)}\n`);
  }
  child.emit("close", close[0], close[1] ?? null);
  return result;
}

describe("streamEvents run outcomes", () => {
  it("a clean finish is `completed`", async () => {
    const result = await finishChild(
      [
        assistantMessage("stop"),
        { type: "agent_end", messages: [] },
        { type: "agent_settled", aborted: false },
      ],
      [0],
    );
    expect(result.outcome).toBe("completed");
    expect(result.error).toBeUndefined();
  });

  it("exit 1 with stopReason `length` is `truncated`, not a failure, and keeps the cost", async () => {
    const result = await finishChild(
      [
        assistantMessage("length"),
        { type: "agent_end", messages: [] },
        { type: "agent_settled", aborted: false },
      ],
      [1],
      "Response was truncated: the model reached its output token limit.\n",
    );
    expect(result.outcome).toBe("truncated");
    expect(result.error).toBeUndefined();
    expect(result.usage.cost).toBeCloseTo(0.003);
    expect(result.usage.input).toBe(100);
    expect(result.usage.output).toBe(40);
  });

  it("`--mode json` exits 0 for the same truncation, and it is still `truncated`", async () => {
    // Verified on 1.2.0: the exit-1 mapping lives in print mode's *text* branch,
    // so a json child reports truncation only through stopReason.
    const result = await finishChild(
      [assistantMessage("length"), { type: "agent_settled", aborted: false }],
      [0],
    );
    expect(result.outcome).toBe("truncated");
    expect(result.error).toBeUndefined();
  });

  it("`agent_settled.aborted: true` is `aborted`, whatever the exit code says", async () => {
    // The child's print mode exits 143 when it is SIGTERM'd on the way out.
    const result = await finishChild(
      [assistantMessage("stop"), { type: "agent_settled", aborted: true }],
      [143],
    );
    expect(result.outcome).toBe("aborted");
    expect(result.error).toBeUndefined();
    expect(result.usage.cost).toBeCloseTo(0.003);
  });

  it("a child killed by the abort signal before it settled is `aborted`", async () => {
    const result = await finishChild([assistantMessage("stop")], [null, "SIGTERM"]);
    expect(result.outcome).toBe("aborted");
    expect(result.error).toBeUndefined();
  });

  it("a real SIGTERM'd child exits 143 with no signal and no settle event, and is still `aborted`", async () => {
    // The shape a live 1.2.0 child actually produces when the parent's abort
    // handler SIGTERMs it: print mode catches the signal and `process.exit(143)`,
    // so there is no `signal`, and the process dies before it can emit
    // `agent_settled`. Whatever it had printed to stderr (here, an unrelated
    // provider warning) must not be promoted to an error.
    const result = await finishChild([assistantMessage("stop")], [143], "LiteLLM discovery: warning");
    expect(result.outcome).toBe("aborted");
    expect(result.error).toBeUndefined();
  });

  it("an assistant message aborted at the provider is `aborted` even with no settle event", async () => {
    const result = await finishChild([assistantMessage("aborted")], [0]);
    expect(result.outcome).toBe("aborted");
  });

  it("a pre/during-run error stays a failure: no outcome, error from stderr", async () => {
    const result = await finishChild(
      [assistantMessage("error"), { type: "agent_settled", aborted: false }],
      [1],
      "401 unauthorized",
    );
    expect(result.outcome).toBeUndefined();
    expect(result.error).toContain("401");
  });

  it("a nonzero exit with no run behind it stays a failure", async () => {
    const result = await finishChild([], [2], "unknown flag --nope");
    expect(result.outcome).toBeUndefined();
    expect(result.error).toContain("unknown flag");
  });

  it("a failed run always says why, even on a clean exit with empty stderr", async () => {
    // The shape a json child produces when the provider errors mid-run: the last
    // assistant message ends `stopReason: "error"`, the exit code stays 0 (the
    // code mapping is print mode's text branch) and stderr is empty. Without a
    // synthesised explanation this is indistinguishable from a successful run.
    const result = await finishChild(
      [assistantMessage("error"), { type: "agent_settled", aborted: false }],
      [0],
    );
    expect(result.outcome).toBeUndefined();
    expect(result.error).toMatch(/stopReason|failed/i);
  });

  it("a crash on an unexpected signal is a failure, not a cancellation", async () => {
    const result = await finishChild([assistantMessage("stop")], [null, "SIGSEGV"]);
    expect(result.outcome).toBeUndefined();
    expect(result.error).toBeTruthy();
  });

  it("the final progress carries the outcome, so the live view can show it", async () => {
    const seen: Array<string | undefined> = [];
    const result = await finishChild(
      [assistantMessage("length"), { type: "agent_settled", aborted: false }],
      [0],
    ).then((r) => {
      seen.push(r.progress?.outcome);
      return r;
    });
    expect(seen).toEqual(["truncated"]);
    expect(result.progress?.status).toBe("completed");
  });
});
