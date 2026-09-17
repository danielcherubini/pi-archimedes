// ── Bridge channel (connection layer — herdr + subagent precedents) ──────
//
// The Client (desktop) is the server (a 0600 Unix socket / Windows named
// pipe); the suite is the client (an ephemeral net.createConnection per
// message, herdr-style). This module owns the socket lifecycle:
//   - sendEvent: best-effort push (initial + 2 retries at 500/1500 ms, then
//     drop; coalesced to at most one in-flight connection per event type).
//   - request: interactive (a single request/response over one connection;
//     5-minute timeout (unref'd) → immediate reject + socket destroy;
//     connection close = immediate cancel; unreachable channel → fail fast).
//     Returns a cancellable handle ({ promise, cancel }).
//
// The `active` flag does NOT depend on a successful connection (lazy,
// per-message connect). A failed connect is a no-op.

import * as net from "node:net";
import { randomUUID } from "node:crypto";

let active = false;
let socketPath: string | undefined;
let seq = 0; // starts at 0; the first frame is seq: 1

// Generation guard: bumped by __resetForTests so a stale retry chain (a retry
// setTimeout scheduled on a detached entry after a reset) dies at the reset
// boundary. Without it, the per-attempt ackTimer is never tracked in the entry
// and the socket's close → finish(false) fires AFTER the reset, scheduling a
// fresh retry timer on the now-detached entry — a timer nothing will ever
// clear (it would also cross-wire into a fresh same-event entry from the next
// test). A stale chain is a no-op when the timer fires (g !== generation).
let generation = 0;

// Coalescing guard: at most one in-flight connection per event type. While one
// is in flight, a newer sendEvent for the same event queues its payload
// (latest wins) and it is sent when the current one settles.
const inFlight = new Map<string, { queued: unknown; timer?: ReturnType<typeof setTimeout> }>();

// Track open sockets so __resetForTests can reap them (prevents test hangs).
const openSockets = new Set<net.Socket>();

export function configure(opts: { active: boolean; socketPath: string | undefined }): void {
  active = opts.active;
  socketPath = opts.socketPath;
}

export function isActive(): boolean {
  return active;
}

function socketTarget(): string | undefined {
  // env value is the bare pipe name on Windows (the Client contract — unlike
  // PI_SUBAGENT_SOCKET, which is a full pipe path).
  if (!socketPath) return undefined;
  return process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath;
}

function trackSocket(socket: net.Socket): void {
  openSockets.add(socket);
  socket.on("close", () => openSockets.delete(socket));
}

/** Test seam: reset the module singletons and reap any open sockets. */
export function __resetForTests(): void {
  active = false;
  socketPath = undefined;
  seq = 0;
  generation++; // kill any stale retry chain scheduled on a detached entry
  for (const entry of inFlight.values()) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  inFlight.clear();
  for (const socket of openSockets) {
    try { socket.destroy(); } catch { /* already closed */ }
  }
  openSockets.clear();
}

// ── Best-effort push ─────────────────────────────────────────────────────

export function sendEvent(event: string, payload: unknown): void {
  const existing = inFlight.get(event);
  if (existing) {
    existing.queued = payload; // latest wins
    return;
  }
  inFlight.set(event, { queued: undefined });
  runAttempt(event, 0, payload);
}

function runAttempt(event: string, attempt: number, payload: unknown): void {
  const entry = inFlight.get(event);
  if (!entry) return;
  // Consume the latest queued payload (latest wins).
  const framePayload = entry.queued !== undefined ? entry.queued : payload;
  entry.queued = undefined;

  const target = socketTarget();
  if (!target) {
    settle(event); // unreachable channel → no-op
    return;
  }

  const frame = { v: 1, type: "push", seq: ++seq, event, payload: framePayload };
  const socket = net.createConnection(target);
  trackSocket(socket);

  let done = false;
  const finish = (ok: boolean) => {
    if (done) return;
    done = true;
    clearTimeout(ackTimer);
    try { socket.destroy(); } catch { /* already closed */ }
    if (ok) {
      settle(event);
    } else if (attempt < 2) {
      // Retry: initial → 500 ms → 1500 ms → drop.
      const delay = attempt === 0 ? 500 : 1500;
      const g = generation; // generation guard: a stale chain (a reset happened
      // between scheduling and firing) is a no-op when it fires — the timer
      // dies at the reset boundary instead of leaking a retry on a detached
      // entry (the close → finish(false) that schedules it fires AFTER reset).
      const timer = setTimeout(() => {
        if (g !== generation) return;
        runAttempt(event, attempt + 1, framePayload);
      }, delay);
      timer.unref?.();
      entry.timer = timer;
    } else {
      settle(event);
    }
  };

  // No-ack window: if the connection is alive but never acks, treat it as a
  // failure and retry. (The Client acks promptly after receiving a push.)
  const ackTimer = setTimeout(() => finish(false), 1000);
  ackTimer.unref?.();

  socket.on("connect", () => {
    try { socket.write(JSON.stringify(frame) + "\n"); } catch { finish(false); }
  });
  socket.on("data", () => finish(true)); // first data = the ack line
  socket.on("error", () => finish(false));
  socket.on("close", () => finish(false));
}

function settle(event: string): void {
  const entry = inFlight.get(event);
  if (!entry) return;
  if (entry.timer) { clearTimeout(entry.timer); delete entry.timer; }
  if (entry.queued !== undefined) {
    // A newer payload accumulated while in flight — send it (latest wins).
    const queued = entry.queued;
    entry.queued = undefined;
    runAttempt(event, 0, queued);
  } else {
    inFlight.delete(event);
  }
}

// ── Interactive request ───────────────────────────────────────────────────

export function request<T>(
  method: string,
  params: unknown,
  opts?: { toolCallId?: string; source?: string },
): { promise: Promise<T>; cancel: () => void } {
  const id = randomUUID();
  const frame = {
    v: 1,
    type: "request",
    id,
    method,
    source: opts?.source ?? "main",
    toolCallId: opts?.toolCallId,
    params,
  };

  let settled = false;
  let socket: net.Socket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const promise = new Promise<T>((resolve, reject) => {
    const target = socketTarget();
    if (!target) {
      // Unreachable channel → fail fast.
      settled = true;
      reject(new Error("bridge channel unreachable"));
      return;
    }

    const finish = (err?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { socket?.destroy(); } catch { /* already closed */ }
      if (err) reject(err);
      else resolve(value as T);
    };

    // 5-minute timeout (unref'd) → immediate reject + socket destroy.
    timer = setTimeout(() => {
      finish(new Error("bridge request timed out"));
    }, 5 * 60 * 1000);
    timer.unref?.();

    socket = net.createConnection(target);
    const sock = socket; // capture non-undefined for the handlers below
    trackSocket(sock);
    let buffer = "";

    sock.on("connect", () => {
      try { sock.write(JSON.stringify(frame) + "\n"); } catch { finish(new Error("failed to write request")); }
    });
    sock.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed) as { type?: string; id?: string; result?: T; error?: string };
          if (msg.type === "response" && msg.id === id) {
            if (msg.error !== undefined) finish(new Error(msg.error));
            else finish(undefined, msg.result);
          }
        } catch { /* malformed line — ignore */ }
      }
    });
    // error / close before a response → cancel.
    sock.on("error", () => finish(new Error("bridge channel error")));
    sock.on("close", () => finish(new Error("bridge channel closed before response")));
  });

  // cancel() closes the socket (→ the promise rejects with a cancel error) and
  // is idempotent. A bare Promise cannot be cancelled, so the ASK_CANCEL path
  // needs this surface.
  const cancel = () => {
    if (settled) return;
    try { socket?.destroy(); } catch { /* already closed */ }
  };

  return { promise, cancel };
}
