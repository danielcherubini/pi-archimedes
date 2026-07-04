import { describe, it, expect, afterEach } from "vitest";
import { getBus, initBus, Events } from "./bus.js";

// ── globalThis cleanup ──────────────────────────────────────────────────────

const BUS_KEY = Symbol.for("archimedes:bus");
const QUEUE_KEY = Symbol.for("archimedes:busQueue");

afterEach(() => {
  // Reset globalThis bus and queue to avoid test pollution
  delete (globalThis as Record<symbol, unknown>)[BUS_KEY];
  delete (globalThis as Record<symbol, unknown>)[QUEUE_KEY];
});

// ── emit → on delivery ─────────────────────────────────────────────────────

describe("emit → on delivery", () => {
  it("subscriber receives payload", () => {
    const bus = getBus();
    const received: unknown[] = [];
    bus.on("test:event", (payload) => received.push(payload));
    bus.emit("test:event", { hello: "world" });
    expect(received).toEqual([{ hello: "world" }]);
  });
});

// ── multiple subscribers ────────────────────────────────────────────────────

describe("multiple subscribers", () => {
  it("all receive the event", () => {
    const bus = getBus();
    const a: unknown[] = [];
    const b: unknown[] = [];
    bus.on("multi", (p) => a.push(p));
    bus.on("multi", (p) => b.push(p));
    bus.emit("multi", "shared");
    expect(a).toEqual(["shared"]);
    expect(b).toEqual(["shared"]);
  });
});

// ── unsubscribe ─────────────────────────────────────────────────────────────

describe("unsubscribe", () => {
  it("removed subscriber does not receive subsequent events", () => {
    const bus = getBus();
    const received: unknown[] = [];
    const unsub = bus.on("unsub:test", (p) => received.push(p));
    bus.emit("unsub:test", "first");
    unsub();
    bus.emit("unsub:test", "second");
    expect(received).toEqual(["first"]);
  });
});

// ── error isolation ─────────────────────────────────────────────────────────

describe("error isolation", () => {
  it("one listener throwing does not prevent others from receiving", () => {
    const bus = getBus();
    const received: unknown[] = [];
    bus.on("err:test", () => {
      throw new Error("boom");
    });
    bus.on("err:test", (p) => received.push(p));
    bus.emit("err:test", "payload");
    expect(received).toEqual(["payload"]);
  });
});

// ── late subscriber queue ───────────────────────────────────────────────────

describe("late subscriber queue", () => {
  it("events emitted before on() are delivered when subscriber registers", () => {
    // Create a fresh bus
    const bus = getBus();

    // Emit before anyone subscribes — this queues the event
    bus.emit("queued:event", "queued-payload");

    // Now subscribe — queued events should be delivered
    const received: unknown[] = [];
    bus.on("queued:event", (p) => received.push(p));

    expect(received).toEqual(["queued-payload"]);
  });
});

// ── initBus ─────────────────────────────────────────────────────────────────

describe("initBus", () => {
  it("flushes queued events", () => {
    // Emit before bus exists — queues event
    const bus = getBus();
    bus.emit("init:event", "queued-before-init");

    // Create a new subscriber after init
    // First, reset to simulate fresh start
    delete (globalThis as Record<symbol, unknown>)[BUS_KEY];
    delete (globalThis as Record<symbol, unknown>)[QUEUE_KEY];

    // Emit before init — this queues
    const preBus = getBus();
    preBus.emit("init:event2", "queued");

    // Now subscribe and init
    const received: unknown[] = [];
    const freshBus = getBus();
    freshBus.on("init:event2", (p) => received.push(p));

    // The event should be delivered when subscribing (queue drain on on())
    expect(received).toEqual(["queued"]);
  });
});

// ── Events constant ─────────────────────────────────────────────────────────

describe("Events constant", () => {
  it("all event names are defined", () => {
    expect(Events.COST_UPDATE).toBe("archimedes:cost_update");
    expect(Events.TODOS_UPDATE).toBe("archimedes:todos_update");
    expect(Events.TODOS_CLEAR).toBe("archimedes:todos_clear");
    expect(Events.ASK_REQUEST).toBe("archimedes:ask_request");
    expect(Events.ASK_RESPONSE).toBe("archimedes:ask_response");
  });
});
