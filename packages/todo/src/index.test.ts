/**
 * Index-level test: the bus consumer guarantee.
 *
 * The parent todo widget receives subagent todo state ONLY via the
 * TODOS_UPDATE bus event. These tests prove that whatever the producer
 * emits (legacy shapes, garbage) the consumer stored in `subagentTodos`
 * is always canonical — the widget can render real text and can never
 * print the string "undefined".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getBus, Events } from "@pi-archimedes/core/bus";
import { registerTodo } from "./index.js";

describe("todo index — bus consumer normalization", () => {
  const captured: Record<string, unknown> = {};
  const handlers: Record<string, Function> = {};
  const registered: { tool?: any; commands: Record<string, unknown> } = { commands: {} };

  const pi = {
    on(evt: string, fn: Function) {
      handlers[evt] = fn;
    },
    registerTool(tool: any) {
      registered.tool = tool;
    },
    registerCommand(name: string, def: unknown) {
      registered.commands[name] = def;
    },
  } as unknown as ExtensionAPI;

  const ctx = {
    ui: {
      setWidget(id: string, component: unknown) {
        captured[id] = component;
      },
    },
    sessionManager: { getBranch: () => [] },
  } as any;

  // The widget calls theme.fg / theme.strikethrough; same behavior these
  // tests rely on (identity-ish, no ANSI) is enough to inspect the text.
  const theme: any = {
    fg: (_c: unknown, s: unknown) => String(s),
    strikethrough: (s: unknown) => String(s),
  };

  function renderLines(): string[] {
    // Read fresh on every render step — the factory can be replaced, or
    // self-cleared to undefined, between steps.
    const factory = captured["todo-list"] as
      | ((_tui: unknown, t: unknown) => { render(width: number): string[]; invalidate(): void })
      | undefined;
    expect(typeof factory).toBe("function");
    const comp = factory!(null, theme);
    return comp.render(200);
  }

  beforeAll(() => {
    registerTodo(pi as any);
  });

  it("normalizes a legacy subagent payload — renders real text, never 'undefined'", async () => {
    // CRITICAL ordering: session_start must fire BEFORE seeding, because
    // reconstructState → state.loadFromSession(ctx) resets the list from
    // getBranch() (mock returns []), which would wipe the seed.
    const start = handlers.session_start;
    if (typeof start !== "function") throw new Error("session_start handler not registered");
    let anyP: unknown;
    anyP = start(undefined, ctx as any);
    await anyP;

    // Seed main state through the real tool.
    const result = await registered.tool.execute(
      "c1",
      { operation: "write", todoList: [{ content: "Main task", status: "pending" }] },
      undefined,
      undefined,
      ctx as any,
    );
    expect(result.isError).toBeFalsy();

    // Legacy (old-schema) subagent payload: id/title/not-started.
    getBus().emit(Events.TODOS_UPDATE, {
      source: "subagent:fake1",
      todos: [{ id: 1, title: "Old shape task", status: "not-started" }],
    });

    const lines = renderLines();
    const joined = lines.join("\n");
    expect(joined).toContain("Old shape task");
    expect(joined).toContain("Main task");
    expect(joined).not.toContain("undefined");
  });

  it("ignores unrecoverable payloads without crashing (no phantom column)", () => {
    // State from the previous test persists (same registered instance).
    expect(() => {
      getBus().emit(Events.TODOS_UPDATE, { source: "subagent:fake2", todos: "garbage" });
      getBus().emit(Events.TODOS_UPDATE, {
        source: "subagent:fake2",
        todos: [{ status: "pending" }],
      });
    }).not.toThrow();

    const lines = renderLines();
    const joined = lines.join("\n");
    expect(joined).toContain("Main task");
    expect(lines.some((l) => l.includes("subagent (fake2)"))).toBe(false);
  });

  it("TODOS_CLEAR removes the subagent column", () => {
    getBus().emit(Events.TODOS_CLEAR, { source: "subagent:fake1" });

    const lines = renderLines();
    const joined = lines.join("\n");
    expect(lines.some((l) => l.includes("subagent (fake1)"))).toBe(false);
    expect(joined).toContain("Main task");
  });

  it("renders the plain agent name for a unique per-child (suffixed) source", async () => {
    // Fresh setup mirroring test 1: session_start first (resets main), then
    // seed main through the real tool, then a suffixed subagent bus emit.
    const start = handlers.session_start;
    if (typeof start !== "function") throw new Error("session_start handler not registered");
    let anyP: unknown;
    anyP = start(undefined, ctx as any);
    await anyP;

    const result = await registered.tool.execute(
      "c1",
      { operation: "write", todoList: [{ content: "Main task", status: "pending" }] },
      undefined,
      undefined,
      ctx as any,
    );
    expect(result.isError).toBeFalsy();

    // Per-child source now carries a suffix; the header must still render
    // just the agent name, not the uuid.
    getBus().emit(Events.TODOS_UPDATE, {
      source: "subagent:fake1:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      todos: [{ id: 1, title: "Old shape task", status: "not-started" }],
    });

    const lines = renderLines();
    const joined = lines.join("\n");
    expect(lines.some((l) => l.includes("subagent (fake1)"))).toBe(true);
    expect(joined).toContain("Old shape task");
    expect(joined).toContain("Main task");
    expect(joined).not.toContain("undefined");
  });

  afterAll(() => {
    // Unsubscribes the bus listeners registered by registerTodo and
    // clears state (fixture uses a pending item, so no auto-clear timer
    // is pending, but cancel defensively).
    handlers.session_shutdown?.(undefined, ctx as any);
  });
});
