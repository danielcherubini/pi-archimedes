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

