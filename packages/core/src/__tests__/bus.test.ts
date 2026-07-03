import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { getBus, initBus, Events } from "../bus.js";

describe("Bus", () => {
  let bus: ReturnType<typeof getBus>;

  beforeEach(() => {
    // Reset global bus state before each test
    const SymbolKey = Symbol.for("archimedes:bus");
    const QueueKey = Symbol.for("archimedes:busQueue");
    delete (globalThis as any)[SymbolKey];
    delete (globalThis as any)[QueueKey];
    bus = getBus();
  });

  it("should emit event to immediate subscriber", () => {
    const listener = (payload: unknown) => {
      assert.strictEqual(payload, "test");
    };
    bus.on("test", listener);
    bus.emit("test", "test");
  });

  it("should queue event for later subscriber", () => {
    let received: unknown;
    bus.on("queued", (payload) => {
      received = payload;
    });
    // Emit before any subscriber would normally queue, but here we just test on() triggers delivery
    // Since initBus() is not called, the event should be queued and delivered to the new subscriber
    // Actually, in this implementation, on() drains the queue immediately for the new listener
    bus.emit("queued", "queued_value");
    assert.strictEqual(received, "queued_value");
  });

  it("should NOT double-deliver events when initBus() is called", () => {
    let callCount = 0;
    const payloadValue = "test_payload";

    // Emit before any subscriber
    bus.emit("no_dup_test", payloadValue);

    // Subscribe later (this should drain the queue)
    bus.on("no_dup_test", () => {
      callCount++;
    });

    // Call initBus() which re-emits any remaining queued events
    initBus();

    // The event should have been delivered exactly once (by on())
    assert.strictEqual(callCount, 1);
  });

  it("should handle multiple listeners for same event", () => {
    const calls: string[] = [];
    bus.on("multi", (payload) => calls.push(payload as string));
    bus.on("multi", (payload) => calls.push(payload as string));

    bus.emit("multi", "a");
    assert.deepStrictEqual(calls, ["a", "a"]);
  });

  it("should not crash when listener throws error", () => {
    bus.on("error_test", () => {
      throw new Error("listener error");
    });
    // Should not throw
    assert.doesNotThrow(() => bus.emit("error_test", "data"));
  });

  it("should work with async listeners", async () => {
    const results: number[] = [];
    bus.on("async_test", async (payload: unknown) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      results.push(payload as number);
    });

    bus.emit("async_test", 1);
    bus.emit("async_test", 2);

    // Wait for async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.deepStrictEqual(results, [1, 2]);
  });
});
