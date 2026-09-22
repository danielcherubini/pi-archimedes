import { describe, it, expect, afterEach } from "vitest";
import {
  request,
  configure,
  __resetForTests,
  BridgeCancelledError,
  BridgeTransportError,
} from "./channel.js";

// The cancel contract between core and the subagent package is TYPED:
// dispatchViaBridge matches `instanceof BridgeCancelledError` (not the
// message string). These tests pin that contract at the source.

afterEach(() => {
  __resetForTests();
});

describe("request() cancel contract", () => {
  it("cancel() settles the promise deterministically with a BridgeCancelledError", async () => {
    // Unreachable socket path: the connect fails asynchronously; the
    // synchronous cancel() wins the race and settles first.
    configure({ active: true, socketPath: "/tmp/bridge-does-not-exist-xyz" });
    const handle = request("test_method", { a: 1 });
    handle.cancel();
    await expect(handle.promise).rejects.toBeInstanceOf(BridgeCancelledError);
    await expect(handle.promise).rejects.toHaveProperty("name", "BridgeCancelledError");
  });

  it("a BridgeCancelledError is NOT a BridgeTransportError (never a fork-fallback trigger)", async () => {
    configure({ active: true, socketPath: "/tmp/bridge-does-not-exist-xyz" });
    const handle = request("test_method", { a: 1 });
    handle.cancel();
    const err = await handle.promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BridgeCancelledError);
    expect(err).not.toBeInstanceOf(BridgeTransportError);
  });

  it("cancel() is idempotent (a second settle is a no-op, same error)", async () => {
    configure({ active: true, socketPath: "/tmp/bridge-does-not-exist-xyz" });
    const handle = request("test_method", { a: 1 });
    handle.cancel();
    handle.cancel();
    const err = await handle.promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BridgeCancelledError);
  });

  it("an unreachable channel (no cancel) still rejects with a BridgeTransportError", async () => {
    configure({ active: true, socketPath: undefined });
    const handle = request("test_method", { a: 1 });
    await expect(handle.promise).rejects.toBeInstanceOf(BridgeTransportError);
  });
});
