import { describe, it, expect, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getBus, Events } from "../bus.js";
import { registerSelfUsage } from "./self-usage.js";

/**
 * Bus discipline (load-bearing): the bus has NO reset seam, `emit` with zero
 * subscribers queues the payload globally, and `on()` replays queued events
 * WITHOUT removing them. So EVERY test subscribes a per-test listener FIRST,
 * then invokes the handler, asserts only on that test's captured array, and
 * unsubscribes via the `on` return value.
 */
function captureCostUpdates(): { events: unknown[]; done: () => void } {
  const events: unknown[] = [];
  const unsub = getBus().on(Events.COST_UPDATE, (p) => events.push(p));
  return { events, done: unsub };
}

/**
 * Register and capture the turn_end handler, using the repo's mock-ExtensionAPI
 * idiom (verbatim from bridge/index.test.ts — a plain object fails `tsc` with
 * TS2740; the `as unknown as ExtensionAPI` cast and the `mock.calls` re-typing
 * are BOTH required).
 */
function registerAndGetTurnEndHandler(): (e: unknown, ctx: unknown) => void {
  const onSpy = vi.fn();
  registerSelfUsage({ on: onSpy } as unknown as ExtensionAPI);
  const calls = onSpy.mock.calls as Array<[string, (e: unknown, ctx: unknown) => void]>;
  const handler = calls.find(([event]) => event === "turn_end")![1];
  expect(handler).toBeTruthy();
  return handler;
}

function assistantMessage(overrides: { usage?: unknown }): { role: "assistant"; usage?: unknown } {
  return { role: "assistant", ...overrides };
}

// ── 1. per-turn emit ─────────────────────────────────────────────────────

describe("per-turn emit", () => {
  it("emits a COST_UPDATE with the turn's usage (delta, exact shape — no reasoning/totalTokens)", () => {
    const handler = registerAndGetTurnEndHandler();
    const { events, done } = captureCostUpdates();
    try {
      handler({
        type: "turn_end",
        turnIndex: 0,
        message: assistantMessage({
          usage: {
            input: 100,
            output: 50,
            cacheRead: 10,
            cacheWrite: 5,
            totalTokens: 165,
            cost: { input: 0.001, output: 0.002, cacheRead: 0.0001, cacheWrite: 0.0002, total: 0.0033 },
          },
        }),
      }, { mode: "tui" });
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        source: "main",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        cost: 0.0033,
      });
    } finally {
      done();
    }
  });
});

// ── 2. no usage → no emit ────────────────────────────────────────────────

describe("no usage", () => {
  it("an assistant message without usage emits nothing", () => {
    const handler = registerAndGetTurnEndHandler();
    const { events, done } = captureCostUpdates();
    try {
      handler({
        type: "turn_end",
        turnIndex: 0,
        message: assistantMessage({}),
      }, { mode: "tui" });
      expect(events).toHaveLength(0);
    } finally {
      done();
    }
  });
});

// ── 3. two turns → two events (delta semantics) ──────────────────────────

describe("delta semantics", () => {
  it("two turns emit two events with per-turn values (NOT accumulated)", () => {
    const handler = registerAndGetTurnEndHandler();
    const { events, done } = captureCostUpdates();
    try {
      handler({
        type: "turn_end",
        turnIndex: 0,
        message: assistantMessage({
          usage: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 100, cost: { input: 0.001, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 } },
        }),
      }, { mode: "tui" });
      handler({
        type: "turn_end",
        turnIndex: 1,
        message: assistantMessage({
          usage: { input: 200, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 200, cost: { input: 0.002, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.002 } },
        }),
      }, { mode: "tui" });
      expect(events).toHaveLength(2);
      expect((events[0] as { inputTokens: number }).inputTokens).toBe(100);
      expect((events[1] as { inputTokens: number }).inputTokens).toBe(200); // NOT 300
    } finally {
      done();
    }
  });
});

// ── 4. unaffected by bridge mode ────────────────────────────────────────

describe("bridge independence", () => {
  it("emits without the bridge channel being configured (bus is in-process; only the bridge forwarder is gated)", () => {
    // NO configure() of the bridge channel anywhere in this file — the channel
    // stays inactive by default. The emitter must still fire the bus event
    // (design decision 3: registered unconditionally, not gated on bridge mode).
    const handler = registerAndGetTurnEndHandler();
    const { events, done } = captureCostUpdates();
    try {
      handler({
        type: "turn_end",
        turnIndex: 0,
        message: assistantMessage({
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        }),
      }, { mode: "tui" });
      expect(events).toHaveLength(1);
      expect((events[0] as { source: string }).source).toBe("main");
    } finally {
      done();
    }
  });
});
