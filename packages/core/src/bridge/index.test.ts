import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { getBus, Events } from "../bus.js";
import {
  getBridge,
  ask,
  confirm,
  password,
  registerBridge,
  dispatch,
  BridgeInactiveError,
} from "./index.js";
import { configure, sendEvent, request, BridgeTransportError, __resetForTests as resetChannel } from "./channel.js";
import {
  state,
  start,
  onAgentStart,
  onAgentSettled,
  onSessionStart,
  __resetForTests as resetEvents,
} from "./events.js";

// ── env helpers ─────────────────────────────────────────────────────────

const ENV_KEYS = [
  "PI_ARCHIMEDES_BRIDGE",
  "PI_ARCHIMEDES_BRIDGE_SOCKET",
  "PI_ARCHIMEDES_BRIDGE_SESSION",
  "PI_ARCHIMEDES_BRIDGE_SERVER_PID",
  "PI_SUBAGENT_SOCKET",
] as const;

const savedEnv: Record<string, string | undefined> = {};

function clearBridgeEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

function setBridgeEnv(overrides: Record<string, string> = {}): void {
  clearBridgeEnv();
  process.env.PI_ARCHIMEDES_BRIDGE = "1";
  process.env.PI_ARCHIMEDES_BRIDGE_SOCKET = "/tmp/nonexistent-bridge.sock";
  process.env.PI_ARCHIMEDES_BRIDGE_SESSION = "desktop-session-1";
  process.env.PI_ARCHIMEDES_BRIDGE_SERVER_PID = "12345";
  for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
}

function makeFakeCtx(mode: "tui" | "rpc" | "json" | "print"): { mode: string } {
  return { mode };
}

/** Register the bridge and fire its session_start handler with the given ctx. */
function registerAndFireSessionStart(ctx: { mode: string }): void {
  const onSpy = vi.fn();
  registerBridge({ on: onSpy } as unknown as ExtensionAPI);
  const calls = onSpy.mock.calls as Array<[string, (e: unknown, ctx: unknown) => void]>;
  const startCall = calls.find((c) => c[0] === "session_start");
  expect(startCall).toBeTruthy();
  startCall![1](null, ctx);
}

function tempSocketPath(): string {
  return path.join(os.tmpdir(), `bridge-test-${randomUUID()}.sock`);
}

/** A minimal valid AskQuestion (matches AskRequestPayload["questions"][n]). */
function makeQuestion(overrides: Partial<{ id: string; question: string }> = {}): {
  id: string;
  question: string;
  options: Array<{ label: string }>;
} {
  return {
    id: overrides.id ?? "q1",
    question: overrides.question ?? "Which option?",
    options: [{ label: "A" }, { label: "B" }],
  };
}

function startServer(
  sockPath: string,
  onFrame: (frame: Record<string, unknown>) => void,
): Promise<net.Server> {
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          onFrame(JSON.parse(trimmed) as Record<string, unknown>);
        } catch {
          /* malformed — ignore */
        }
      }
    });
    socket.on("error", () => { /* connection dropped */ });
  });
  return new Promise((resolve) => server.listen(sockPath, () => resolve(server)));
}

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  clearBridgeEnv();
  resetChannel();
  resetEvents();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  clearBridgeEnv();
  resetChannel();
  resetEvents();
});

// ── 1. Env matrix (getBridge().active at session_start) ─────────────────

describe("env matrix (getBridge().active at session_start)", () => {
  it("(a) no env → active === false", () => {
    clearBridgeEnv();
    registerAndFireSessionStart(makeFakeCtx("rpc"));
    expect(getBridge().active).toBe(false);
  });

  it("(b) all env + tui mode → active === false (TUI wins)", () => {
    setBridgeEnv();
    registerAndFireSessionStart(makeFakeCtx("tui"));
    expect(getBridge().active).toBe(false);
  });

  it("(c) all env + rpc mode + no PI_SUBAGENT_SOCKET → active === true", () => {
    setBridgeEnv();
    registerAndFireSessionStart(makeFakeCtx("rpc"));
    expect(getBridge().active).toBe(true);
  });

  it("(d) all env + rpc mode + PI_SUBAGENT_SOCKET set → active === false (root-only)", () => {
    setBridgeEnv({ PI_SUBAGENT_SOCKET: "/tmp/subagent.sock" });
    registerAndFireSessionStart(makeFakeCtx("rpc"));
    expect(getBridge().active).toBe(false);
  });

  it("missing one env var (SERVER_PID) → active === false", () => {
    setBridgeEnv();
    delete process.env.PI_ARCHIMEDES_BRIDGE_SERVER_PID;
    registerAndFireSessionStart(makeFakeCtx("rpc"));
    expect(getBridge().active).toBe(false);
  });
});

// ── 2. Inactive API ──────────────────────────────────────────────────────

describe("inactive API", () => {
  it("ask throws BridgeInactiveError", () => {
    clearBridgeEnv();
    expect(() => ask({ questions: [makeQuestion()] }, "tool-1")).toThrow(BridgeInactiveError);
    expect(() => ask({ questions: [makeQuestion()] }, "tool-1")).toThrow("bridge is not active");
  });

  it("confirm resolves false", async () => {
    clearBridgeEnv();
    await expect(confirm({ command: "rm -rf /", reason: "test" })).resolves.toBe(false);
  });

  it("password resolves empty string", async () => {
    clearBridgeEnv();
    await expect(password({ command: "sudo apt install", reason: "test" })).resolves.toBe("");
  });

  it("dispatch throws BridgeInactiveError", () => {
    clearBridgeEnv();
    expect(() => dispatch({ agentName: "a", task: "t", systemPrompt: null, model: null, thinking: null, tools: null }, "tool-1")).toThrow(BridgeInactiveError);
  });
});

// ── 3. State machine ─────────────────────────────────────────────────────

describe("state machine", () => {
  it("onAgentSettled → idle; onAgentStart → working", () => {
    start();
    onAgentSettled();
    expect(state()).toBe("idle");
    onAgentStart();
    expect(state()).toBe("working");
  });

  it("ASK_REQUEST → blocked; stays blocked through onAgentSettled; ASK_RESPONSE → idle (settled)", () => {
    start();
    onAgentSettled(); // settled = true
    getBus().emit(Events.ASK_REQUEST, { source: "main", requestId: "r1", questions: [makeQuestion()] });
    expect(state()).toBe("blocked");
    onAgentSettled(); // still blocked (refcount > 0)
    expect(state()).toBe("blocked");
    getBus().emit(Events.ASK_RESPONSE, { requestId: "r1", cancelled: false, results: [] });
    expect(state()).toBe("idle"); // settled
  });

  it("ASK_RESPONSE → working (not settled)", () => {
    start();
    onAgentStart(); // settled = false
    getBus().emit(Events.ASK_REQUEST, { source: "main", requestId: "r2", questions: [makeQuestion()] });
    expect(state()).toBe("blocked");
    getBus().emit(Events.ASK_RESPONSE, { requestId: "r2", cancelled: false, results: [] });
    expect(state()).toBe("working"); // not settled
  });

  it("an unpaired ASK_RESPONSE does not drive the refcount negative (floor at 0)", () => {
    start();
    onAgentSettled(); // settled = true
    expect(state()).toBe("idle");

    // A spurious/duplicated ASK_RESPONSE with no matching ASK_REQUEST must not
    // push the refcount below zero (the floor keeps the machine honest).
    getBus().emit(Events.ASK_RESPONSE, { requestId: "orphan", cancelled: false, results: [] });
    expect(state()).toBe("idle"); // floor at 0 (not -1)

    // A legitimate ask is still blocked (the floor prevented the negative count).
    getBus().emit(Events.ASK_REQUEST, { source: "main", requestId: "r3", questions: [makeQuestion()] });
    expect(state()).toBe("blocked");

    // ...and it still unblocks cleanly.
    getBus().emit(Events.ASK_RESPONSE, { requestId: "r3", cancelled: false, results: [] });
    expect(state()).toBe("idle"); // settled
  });
});

// ── 4. ASK_CANCEL flow ───────────────────────────────────────────────────

describe("ASK_CANCEL flow", () => {
  it("a cancelled subagent ask emits a cancelled ASK_RESPONSE and refcount returns to 0", async () => {
    const sockPath = tempSocketPath();
    const server = await startServer(sockPath, () => {
      /* accept but never respond */
    });

    start();
    configure({ active: true, socketPath: sockPath });

    const responses: unknown[] = [];
    const unsub = getBus().on(Events.ASK_RESPONSE, (p) => responses.push(p));

    getBus().emit(Events.ASK_REQUEST, {
      source: "subagent:x",
      requestId: "sub-req-1",
      questions: [makeQuestion()],
    });
    expect(state()).toBe("blocked");

    // Give the forwarded request a moment to connect to the (silent) server.
    await new Promise((r) => setTimeout(r, 50));

    getBus().emit(Events.ASK_CANCEL, { requestId: "sub-req-1", source: "subagent:x" });

    // The cancel closes the socket → the request rejects → a cancelled ASK_RESPONSE is emitted.
    await vi.waitFor(() => {
      expect(responses.length).toBeGreaterThanOrEqual(1);
    }, 3000);

    const resp = responses[0] as { requestId: string; cancelled: boolean; results: unknown[] };
    expect(resp.requestId).toBe("sub-req-1");
    expect(resp.cancelled).toBe(true);
    expect(resp.results).toEqual([{ id: "q1", selectedOptions: [] }]);
    expect(state()).toBe("working"); // refcount back to 0, not settled

    unsub();
    server.close();
    try { fs.unlinkSync(sockPath); } catch { /* already gone */ }
  });

  it("ASK_CANCEL with no pending entry is a no-op (no crash, refcount untouched)", () => {
    start();
    getBus().emit(Events.ASK_CANCEL, { requestId: "does-not-exist", source: "subagent:x" });
    expect(state()).toBe("working"); // refcount still 0
  });
});

// ── 5. request round-trip + cancel ───────────────────────────────────────

describe("request round-trip + cancel", () => {
  it("resolves with the response result", async () => {
    const sockPath = tempSocketPath();
    const server = await startServer(sockPath, (frame) => {
      /* the server's onFrame is used below via a dedicated handler */
    });
    // Replace with a server that echoes a response for a matching id.
    server.close();
    const echoServer = net.createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf-8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed) as { type?: string; id?: string };
            if (msg.type === "request" && msg.id) {
              socket.write(JSON.stringify({ v: 1, type: "response", id: msg.id, result: "roundtrip-ok" }) + "\n");
            }
          } catch { /* malformed — ignore */
          }
        }
      });
      socket.on("error", () => { /* connection dropped */ });
    });
    await new Promise<void>((resolve) => echoServer.listen(sockPath, resolve));

    configure({ active: true, socketPath: sockPath });
    const { promise } = request("ask", { questions: [makeQuestion()] });
    await expect(promise).resolves.toBe("roundtrip-ok");

    echoServer.close();
    try { fs.unlinkSync(sockPath); } catch { /* already gone */ }
  });

  it("cancel() before the response rejects with a cancel error", async () => {
    const sockPath = tempSocketPath();
    const server = await startServer(sockPath, () => {
      /* accept but never respond */
    });

    configure({ active: true, socketPath: sockPath });
    const { promise, cancel } = request("ask", { questions: [makeQuestion()] });
    await new Promise((r) => setTimeout(r, 50)); // let the socket connect
    cancel();
    await expect(promise).rejects.toThrow();
    // Idempotent: a second cancel is a no-op.
    cancel();

    server.close();
    try { fs.unlinkSync(sockPath); } catch { /* already gone */ }
  });

  it("an unreachable channel fails fast (rejects on connect error)", async () => {
    configure({ active: true, socketPath: "/tmp/definitely-does-not-exist-bridge.sock" });
    const { promise } = request("ask", { questions: [makeQuestion()] });
    await expect(promise).rejects.toThrow();
  });

  it("ask() with an AbortSignal cancels the request on abort", async () => {
    const sockPath = tempSocketPath();
    const server = await startServer(sockPath, () => {
      /* accept but never respond */
    });

    configure({ active: true, socketPath: sockPath });
    const controller = new AbortController();
    const p = ask({ questions: [makeQuestion()] }, "tool-1", controller.signal);
    await new Promise((r) => setTimeout(r, 50)); // let the socket connect
    controller.abort();
    await expect(p).rejects.toThrow();

    server.close();
    try { fs.unlinkSync(sockPath); } catch { /* already gone */ }
  });

  it("ask() with a PRE-ABORTED signal cancels the request immediately (no lingering)", async () => {
    const sockPath = tempSocketPath();
    const server = await startServer(sockPath, () => {
      /* accept but never respond */
    });

    configure({ active: true, socketPath: sockPath });
    const controller = new AbortController();
    controller.abort(); // pre-aborted BEFORE ask() is invoked
    const p = ask({ questions: [makeQuestion()] }, "tool-1", controller.signal);

    // A pre-aborted signal never dispatches its "abort" event (it fires exactly
    // once, at abort time), so addEventListener alone would leave the request
    // lingering until the Client responds or the 5-minute timeout. The fix
    // calls cancel() directly when the signal is already aborted → the promise
    // rejects quickly (the socket-close handler settles it).
    await expect(p).rejects.toThrow();

    server.close();
    try { fs.unlinkSync(sockPath); } catch { /* already gone */ }
  });
});

// ── 8b. request timeout override + BridgeTransportError ─────────────────

describe("request timeout override + BridgeTransportError", () => {
  it("timeoutMs: null does NOT reject at 5 minutes (no timer)", async () => {
    vi.useFakeTimers();
    try {
      const sockPath = tempSocketPath();
      const server = await startServer(sockPath, () => {
        /* accept but never respond */
      });

      configure({ active: true, socketPath: sockPath });
      const { promise } = request("dispatch_subagent", { task: "x" }, { toolCallId: "t1", source: "main", timeoutMs: null });
      let settled = false;
      promise.then(() => { settled = true; }, () => { settled = true; });

      // Advance 6 minutes of fake time — the 5-minute timer (if any) would
      // have fired. The promise must still be pending.
      await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
      expect(settled).toBe(false);

      server.close();
      try { fs.unlinkSync(sockPath); } catch { /* already gone */ }
    } finally {
      vi.useRealTimers();
    }
  });

  it("the default (timeoutMs omitted) still rejects after 5 minutes", async () => {
    vi.useFakeTimers();
    try {
      const sockPath = tempSocketPath();
      const server = await startServer(sockPath, () => {
        /* accept but never respond */
      });

      configure({ active: true, socketPath: sockPath });
      const { promise } = request("ask", { questions: [makeQuestion()] });
      // Attach the handler BEFORE advancing (a rejection during the advance
      // with no handler attached would be an unhandled rejection).
      const outcome = promise.then(() => null, (e: unknown) => e);

      await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
      const err = await outcome;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("bridge request timed out");

      server.close();
      try { fs.unlinkSync(sockPath); } catch { /* already gone */ }
    } finally {
      vi.useRealTimers();
    }
  });

  it("a negative timeoutMs is clamped to the 1 ms minimum (the timer still fires — NOT 'no timer')", async () => {
    vi.useFakeTimers();
    try {
      const sockPath = tempSocketPath();
      const server = await startServer(sockPath, () => {
        /* accept but never respond */
      });

      configure({ active: true, socketPath: sockPath });
      const { promise } = request("ask", { questions: [makeQuestion()] }, { timeoutMs: -5000 });
      // `null` is the "never" case; a negative value is clamped to the 1 ms
      // minimum, so a short advance must fire the timeout (not skip it).
      const outcome = promise.then(() => null, (e: unknown) => e);

      await vi.advanceTimersByTimeAsync(2);
      const err = await outcome;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("bridge request timed out");

      server.close();
      try { fs.unlinkSync(sockPath); } catch { /* already gone */ }
    } finally {
      vi.useRealTimers();
    }
  });

  it("a mid-connection close (no response frame) rejects with a BridgeTransportError", async () => {
    const sockPath = tempSocketPath();
    const server = net.createServer((socket) => {
      // Accept then destroy — the desktop is effectively gone.
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(sockPath, resolve));

    configure({ active: true, socketPath: sockPath });
    const { promise } = request("ask", { questions: [makeQuestion()] });
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BridgeTransportError);

    server.close();
    try { fs.unlinkSync(sockPath); } catch { /* already gone */ }
  });

  it("a response-carrying error frame rejects with a plain Error (NOT BridgeTransportError)", async () => {
    const sockPath = tempSocketPath();
    const server = net.createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf-8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed) as { type?: string; id?: string };
            if (msg.type === "request" && msg.id) {
              socket.write(JSON.stringify({ v: 1, type: "response", id: msg.id, error: "cancelled" }) + "\n");
            }
          } catch { /* malformed — ignore */ }
        }
      });
      socket.on("error", () => { /* connection dropped */ });
    });
    await new Promise<void>((resolve) => server.listen(sockPath, resolve));

    configure({ active: true, socketPath: sockPath });
    const { promise } = request("dispatch_subagent", { task: "x" }, { toolCallId: "t1", source: "main", timeoutMs: null });
    const err = await promise.catch((e: unknown) => e);
    // The desktop answered — it is alive and the outcome is authoritative.
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(BridgeTransportError);
    expect((err as Error).message).toBe("cancelled");

    server.close();
    try { fs.unlinkSync(sockPath); } catch { /* already gone */ }
  });

  it("an unreachable channel (no socket target) rejects with a BridgeTransportError", async () => {
    configure({ active: true, socketPath: "/tmp/definitely-does-not-exist-bridge2.sock" });
    const { promise } = request("ask", { questions: [makeQuestion()] });
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BridgeTransportError);
  });
});

// ── 6. seq counter ───────────────────────────────────────────────────────

describe("seq counter", () => {
  it("two sendEvent calls produce seq 1 then seq 2 (coalesced, latest wins)", async () => {
    const sockPath = tempSocketPath();
    const frames: Array<{ seq: number; event: string; payload: unknown }> = [];
    const server = net.createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf-8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed) as { type?: string; seq?: number; event?: string; payload?: unknown };
            if (msg.type === "push") frames.push({ seq: msg.seq!, event: msg.event!, payload: msg.payload });
          } catch { /* malformed — ignore */
          }
        }
        socket.write("ack\n"); // ack so the sender destroys
      });
      socket.on("error", () => { /* connection dropped */ });
    });
    await new Promise<void>((resolve) => server.listen(sockPath, resolve));

    configure({ active: true, socketPath: sockPath });
    sendEvent("state", { state: "working" });
    sendEvent("state", { state: "idle" }); // coalesced (latest wins)

    await vi.waitFor(() => {
      expect(frames.length).toBeGreaterThanOrEqual(2);
    }, 3000);

    expect(frames[0]!.seq).toBe(1);
    expect(frames[1]!.seq).toBe(2);

    server.close();
    try { fs.unlinkSync(sockPath); } catch { /* already gone */ }
  });

  it("the session push is re-emitted on session_start and echoes PI_ARCHIMEDES_BRIDGE_SESSION", async () => {
    const sockPath = tempSocketPath();
    const frames: Array<{ event: string; payload: unknown }> = [];
    const server = net.createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf-8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed) as { type?: string; event?: string; payload?: unknown };
            if (msg.type === "push") frames.push({ event: msg.event!, payload: msg.payload! });
          } catch { /* malformed — ignore */
          }
        }
        socket.write("ack\n");
      });
      socket.on("error", () => { /* connection dropped */ });
    });
    await new Promise<void>((resolve) => server.listen(sockPath, resolve));

    configure({ active: true, socketPath: sockPath });
    process.env.PI_ARCHIMEDES_BRIDGE_SESSION = "my-desktop-session";
    onSessionStart();

    await vi.waitFor(() => {
      expect(frames.some((f) => f.event === "session")).toBe(true);
    }, 3000);

    const sessionFrame = frames.find((f) => f.event === "session")!;
    expect((sessionFrame.payload as { bridgeSession?: string }).bridgeSession).toBe("my-desktop-session");

    server.close();
    try { fs.unlinkSync(sockPath); } catch { /* already gone */ }
  });
});

// ── 7. sendEvent retry/drop (unreachable channel) ────────────────────────

describe("sendEvent retry/drop", () => {
  // The legitimate timeline is ~4.5 s (initial + 2 retries at 500/1500 ms +
  // the 1 s no-ack window each), so give the test an explicit timeout with
  // real headroom against vitest's 5 s default. A unique event name keeps
  // this test hermetic: inFlight is keyed by event type, so a foreign "state"
  // retry chain from an earlier test can't cross-wire into "retry-probe".
  it("retries twice then drops on a channel that never acks (no hang, no leaked timer)", { timeout: 10_000 }, async () => {
    const sockPath = tempSocketPath();
    let connections = 0;
    const server = net.createServer((socket) => {
      connections++;
      // Accept but never ack and never close → the sender's no-ack window
      // (1 s) treats it as a failure and retries (same finish(false) path as
      // an unreachable socket; the retry/backoff/drop machinery is identical).
      socket.on("error", () => { /* connection dropped */ });
    });
    await new Promise<void>((resolve) => server.listen(sockPath, resolve));

    configure({ active: true, socketPath: sockPath });

    // A unique event name (not "state") so a foreign "state" retry chain from
    // an earlier test can't cross-wire into this one (inFlight is keyed by
    // event type).
    sendEvent("retry-probe", { state: "working" });

    // initial + 2 retries (500 ms + 1500 ms) → exactly 3 attempts, then drop.
    await vi.waitFor(() => {
      expect(connections).toBe(3);
    }, 6000);

    // Dropped (not looping): a short wait later it is still exactly 3 (no 4th attempt).
    await new Promise((r) => setTimeout(r, 500));
    expect(connections).toBe(3);

    server.close();
    try { fs.unlinkSync(sockPath); } catch { /* already gone */ }
  });
});

// ── 8. subagent ask success path (end-to-end through the bridge) ─────────

describe("subagent ask success path", () => {
  it("forwards to the Client and settles with the response verbatim (state unblocked)", async () => {
    const sockPath = tempSocketPath();
    const frames: Array<Record<string, unknown>> = [];
    const server = net.createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf-8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed) as Record<string, unknown>;
            frames.push(msg);
            if (msg.type === "request") {
              socket.write(JSON.stringify({
                v: 1,
                type: "response",
                id: msg.id,
                result: { cancelled: false, results: [{ id: "q1", selectedOptions: ["B"], customInput: "extra" }] },
              }) + "\n");
            }
          } catch { /* malformed — ignore */ }
        }
      });
      socket.on("error", () => { /* connection dropped */ });
    });
    await new Promise<void>((resolve) => server.listen(sockPath, resolve));

    start();
    configure({ active: true, socketPath: sockPath });

    const responses: unknown[] = [];
    const unsub = getBus().on(Events.ASK_RESPONSE, (p) => responses.push(p));

    getBus().emit(Events.ASK_REQUEST, {
      source: "subagent:x",
      requestId: "sub-req-2",
      toolCallId: "child-tool-1",
      questions: [makeQuestion()],
    });
    expect(state()).toBe("blocked"); // refcount 1

    // The Client answers → the bridge emits the paired ASK_RESPONSE verbatim
    // (the same .then also drains `pending`, so the emission implies it).
    await vi.waitFor(() => {
      expect(responses.length).toBeGreaterThanOrEqual(1);
    }, 3000);

    const resp = responses[0] as { requestId: string; cancelled: boolean; results: unknown[] };
    expect(resp.requestId).toBe("sub-req-2");
    expect(resp.cancelled).toBe(false);
    expect(resp.results).toEqual([{ id: "q1", selectedOptions: ["B"], customInput: "extra" }]);
    expect(state()).toBe("working"); // refcount back to 0, not settled

    // The forwarded request frame carried the source + toolCallId.
    const reqFrame = frames.find((f) => f.type === "request")!;
    expect(reqFrame.source).toBe("subagent:x");
    expect(reqFrame.toolCallId).toBe("child-tool-1");

    unsub();
    server.close();
    try { fs.unlinkSync(sockPath); } catch { /* already gone */ }
  });
});
