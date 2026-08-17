import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerClient } from "./server-client.js";
import type { ServerManager } from "./server-manager.js";
import { LifecycleManager } from "./lifecycle.js";
import type { ServerDef } from "./types.js";

/** Interval the lifecycle manager ticks at in production. */
const TICK_MS = 30_000;

interface FakeClient {
  name: string;
  status: "disconnected" | "connecting" | "connected" | "error" | "needs-auth";
  connect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function makeClient(
  name: string,
  status: FakeClient["status"] = "disconnected",
): FakeClient {
  return {
    name,
    status,
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function stdioDef(extra?: Partial<ServerDef>): ServerDef {
  return { type: "stdio", command: "true", ...extra } as ServerDef;
}

function makeLifecycle(
  clients: FakeClient[],
  defs: Record<string, ServerDef>,
  globalIdleMin: number,
  isIdleImpl: (name: string, timeoutMs: number) => boolean,
) {
  const isIdle = vi.fn(isIdleImpl);
  const manager = {
    getClients: () => clients as unknown as ServerClient[],
    isIdle,
  } as unknown as ServerManager;
  const lifecycle = new LifecycleManager(manager, () => defs, () => globalIdleMin);
  return { lifecycle, isIdle };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LifecycleManager", () => {
  it("reconnects a disconnected keep-alive server on tick", () => {
    const client = makeClient("ka");
    const { lifecycle } = makeLifecycle(
      [client],
      { ka: stdioDef({ lifecycle: "keep-alive" }) },
      10,
      () => false,
    );

    lifecycle.start();
    vi.advanceTimersByTime(TICK_MS);

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.close).not.toHaveBeenCalled();
    lifecycle.stop();
  });

  it("reconnects a disconnected lazy-keep-alive server on tick", () => {
    const client = makeClient("lka");
    const { lifecycle } = makeLifecycle(
      [client],
      { lka: stdioDef({ lifecycle: "lazy-keep-alive" }) },
      10,
      () => false,
    );

    lifecycle.start();
    vi.advanceTimersByTime(TICK_MS);

    expect(client.connect).toHaveBeenCalledTimes(1);
    lifecycle.stop();
  });

  it("does not reconnect or close a disconnected non-keep-alive server", () => {
    const client = makeClient("lazy");
    const { lifecycle } = makeLifecycle(
      [client],
      { lazy: stdioDef({ lifecycle: "lazy" }) },
      10,
      () => false,
    );

    lifecycle.start();
    vi.advanceTimersByTime(TICK_MS * 2);

    expect(client.connect).not.toHaveBeenCalled();
    expect(client.close).not.toHaveBeenCalled();
    lifecycle.stop();
  });

  it("reconnects a keep-alive server in error status on tick", () => {
    const client = makeClient("err", "error");
    const { lifecycle } = makeLifecycle(
      [client],
      { err: stdioDef({ lifecycle: "keep-alive" }) },
      10,
      () => false,
    );

    lifecycle.start();
    vi.advanceTimersByTime(TICK_MS);

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.close).not.toHaveBeenCalled();
    lifecycle.stop();
  });

  it("does not touch a needs-auth keep-alive server", () => {
    const client = makeClient("auth", "needs-auth");
    const { lifecycle } = makeLifecycle(
      [client],
      { auth: stdioDef({ lifecycle: "keep-alive" }) },
      10,
      () => false,
    );

    lifecycle.start();
    vi.advanceTimersByTime(TICK_MS);

    expect(client.connect).not.toHaveBeenCalled();
    expect(client.close).not.toHaveBeenCalled();
    lifecycle.stop();
  });

  it("closes a lazy server past its per-server idle timeout", () => {
    const client = makeClient("lazy");
    const { lifecycle, isIdle } = makeLifecycle(
      [client],
      { lazy: stdioDef({ lifecycle: "lazy", idleTimeout: 5 }) },
      10,
      () => true,
    );

    lifecycle.start();
    vi.advanceTimersByTime(TICK_MS);

    expect(isIdle).toHaveBeenCalledWith("lazy", 5 * 60_000);
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(client.connect).not.toHaveBeenCalled();
    lifecycle.stop();
  });

  it("leaves a lazy server alone when it is not idle yet", () => {
    const client = makeClient("lazy");
    const { lifecycle } = makeLifecycle(
      [client],
      { lazy: stdioDef({ lifecycle: "lazy", idleTimeout: 5 }) },
      10,
      () => false,
    );

    lifecycle.start();
    vi.advanceTimersByTime(TICK_MS * 2);

    expect(client.close).not.toHaveBeenCalled();
    expect(client.connect).not.toHaveBeenCalled();
    lifecycle.stop();
  });

  it("falls back to the global idle timeout when no per-server timeout is set", () => {
    const client = makeClient("lazy");
    const { lifecycle, isIdle } = makeLifecycle(
      [client],
      { lazy: stdioDef({ lifecycle: "lazy" }) },
      10,
      () => true,
    );

    lifecycle.start();
    vi.advanceTimersByTime(TICK_MS);

    expect(isIdle).toHaveBeenCalledWith("lazy", 10 * 60_000);
    expect(client.close).toHaveBeenCalledTimes(1);
    lifecycle.stop();
  });

  it("idleTimeout 0 disables idle shutdown even when idle", () => {
    const client = makeClient("lazy");
    const { lifecycle, isIdle } = makeLifecycle(
      [client],
      { lazy: stdioDef({ lifecycle: "lazy", idleTimeout: 0 }) },
      10,
      () => true,
    );

    lifecycle.start();
    vi.advanceTimersByTime(TICK_MS);

    expect(isIdle).not.toHaveBeenCalled();
    expect(client.close).not.toHaveBeenCalled();
    lifecycle.stop();
  });

  it("skips servers whose definition was removed", () => {
    const client = makeClient("gone");
    const { lifecycle } = makeLifecycle([client], {}, 10, () => true);

    lifecycle.start();
    vi.advanceTimersByTime(TICK_MS);

    expect(client.connect).not.toHaveBeenCalled();
    expect(client.close).not.toHaveBeenCalled();
    lifecycle.stop();
  });

  it("stop() clears the timer so no further ticks run", () => {
    const client = makeClient("ka");
    const { lifecycle } = makeLifecycle(
      [client],
      { ka: stdioDef({ lifecycle: "keep-alive" }) },
      10,
      () => false,
    );

    lifecycle.start();
    vi.advanceTimersByTime(TICK_MS);
    expect(client.connect).toHaveBeenCalledTimes(1);

    lifecycle.stop();
    vi.advanceTimersByTime(TICK_MS * 4);
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it("start() is idempotent — calling it twice does not double the ticks", () => {
    const client = makeClient("ka");
    const { lifecycle } = makeLifecycle(
      [client],
      { ka: stdioDef({ lifecycle: "keep-alive" }) },
      10,
      () => false,
    );

    lifecycle.start();
    lifecycle.start();
    vi.advanceTimersByTime(TICK_MS);

    expect(client.connect).toHaveBeenCalledTimes(1);
    lifecycle.stop();
  });

  it("unrefs the interval so it does not keep the process alive", () => {
    vi.useRealTimers();
    const unref = vi.fn();
    const spy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation(() => ({ unref }) as unknown as NodeJS.Timeout);

    const lifecycle = new LifecycleManager(
      { getClients: () => [], isIdle: () => false } as unknown as ServerManager,
      () => ({}),
      () => 10,
    );
    lifecycle.start();
    expect(unref).toHaveBeenCalledTimes(1);
    lifecycle.stop();
    spy.mockRestore();
  });
});
