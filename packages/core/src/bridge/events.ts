// ── Bridge events (bus subscriptions — the state machine + subagent
//    forwarding + push events) ─────────────────────────────────────────────
//
// Subscribes the SIX real bus events (nothing emits agent_start/agent_settled/
// session_start on the bus — those are pi extension events dispatched via
// pi.on(...) and handled in registerBridge). Bus event names map to wire names
// as explicit literals at each call site (no lookup table, no string surgery):
//   COST_UPDATE → cost_update, TODOS_UPDATE → todos_update, TODOS_CLEAR →
//   todos_clear. The ASK_* trio is not forwarded as pushes of their own —
//   ASK_REQUEST drives the refcount + subagent forwarding, ASK_CANCEL cancels
//   the pending Client request, and ASK_RESPONSE additionally triggers a
//   `state` push (refcount-- + pushState).
//
// The bridge is the SOLE emitter of child-path ASK_RESPONSE (spawn.ts only
// signals via ASK_CANCEL). Every forwarded ASK_REQUEST is eventually paired
// with an ASK_RESPONSE (success, error, timeout, or ASK_CANCEL) so the
// refcount never leaks.
//
// start() is one-way (no teardown counterpart to channel.configure({active:
// false})). That's safe today because bridge activation is a process-constant
// (isBridgeMode is evaluated once at session_start and never changes within a
// process) — a future mixed-mode change (flipping active per session) would
// need a stop() counterpart or it would leak the bus subscriptions.

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getBus, Events } from "../bus.js";
import { sendEvent, request } from "./channel.js";

let refcount = 0;
let settled = false;
let started = false; // the start() idempotency guard (sole writer is start())
let sessionCtx: ExtensionContext | undefined;

const pending = new Map<string, { source: string; toolCallId?: string; cancel: () => void }>();
const unsubscribers: Array<() => void> = [];

export function state(): "working" | "idle" | "blocked" {
  return refcount > 0 ? "blocked" : (settled ? "idle" : "working");
}

function pushState(): void {
  sendEvent("state", { state: state() });
}

// ── Pi extension events (NOT bus events — nothing emits them on the bus;
//    they're dispatched by the extension runner via pi.on(...) and DO fire in
//    RPC mode, since the RPC driver runs the same session machinery). ──────

export function onAgentStart(): void {
  settled = false;
  pushState();
}

export function onAgentSettled(): void {
  settled = true;
  pushState();
}

export function onSessionStart(ctx?: ExtensionContext): void {
  if (ctx) sessionCtx = ctx;
  // Re-emitted on every session_start so a lost frame is recoverable; the
  // payload echoes PI_ARCHIMEDES_BRIDGE_SESSION so the Client can assert the
  // connection↔session mapping rather than infer it from the socket path.
  // (Does NOT set `started` — start() is the sole writer of that flag, so a
  // call-order flip can't turn start() into a permanent no-op; the session
  // push is unconditional by design.)
  sendEvent("session", { ...sessionRefs(), bridgeSession: process.env.PI_ARCHIMEDES_BRIDGE_SESSION });
}

function sessionRefs(): Record<string, unknown> {
  const sm = sessionCtx?.sessionManager;
  if (!sm) return {};
  const refs: Record<string, unknown> = {};
  try { refs.sessionId = sm.getSessionId?.(); } catch { /* */ }
  try { refs.sessionFile = sm.getSessionFile?.(); } catch { /* */ }
  try { refs.cwd = sm.getCwd?.(); } catch { /* */ }
  try { refs.sessionName = sm.getSessionName?.(); } catch { /* */ }
  return refs;
}

/**
 * Subscribe the six real bus events. Idempotent (a re-start on /reload does
 * not double-subscribe — guarded by the `started` flag; the unsubscribers are
 * stored so a reset can tear them down).
 */
export function start(): void {
  if (started) return;
  started = true;

  unsubscribers.push(getBus().on(Events.ASK_REQUEST, (payload: unknown) => {
    const p = payload as {
      source: string;
      requestId: string;
      toolCallId?: string;
      questions: Array<{ id: string }>;
    };
    refcount++;
    // A subagent ask is forwarded to the Client. A source === "main" ask is
    // NOT forwarded here — the root's Client request comes from bridge.ask()
    // directly; the bus event is for the refcount only.
    if (p.source !== "main") {
      const { cancel } = requestAskToClient(p);
      const entry: { source: string; toolCallId?: string; cancel: () => void } = { source: p.source, cancel };
      if (p.toolCallId !== undefined) entry.toolCallId = p.toolCallId;
      pending.set(p.requestId, entry);
    }
  }));

  unsubscribers.push(getBus().on(Events.ASK_RESPONSE, () => {
    // Defensive floor: a spurious/duplicated ASK_RESPONSE must not drive the
    // refcount negative — a negative count would make every later ask
    // off-by-one (state reports working/idle while a prompt is pending, never
    // blocked again). The floor keeps the machine honest. A decrement at
    // refcount === 0 is a bug signal (by the module's own invariant, every
    // ASK_REQUEST is paired) — log it so the protocol violation doesn't
    // disappear without a trace.
    if (refcount === 0) console.warn("[archimedes:bridge] unpaired ASK_RESPONSE received (refcount already 0)");
    refcount = Math.max(0, refcount - 1);
    pushState();
  }));

  unsubscribers.push(getBus().on(Events.ASK_CANCEL, (payload: unknown) => {
    const p = payload as { requestId: string };
    const entry = pending.get(p.requestId);
    // cancel() closes the socket → the request rejects → the .catch below
    // emits the cancelled ASK_RESPONSE → refcount-- + pending.delete. The
    // ASK_CANCEL itself does not touch the refcount (no double-decrement).
    if (entry) entry.cancel();
  }));

  // Bus payload types ARE the wire types — forward verbatim.
  unsubscribers.push(getBus().on(Events.TODOS_UPDATE, (payload: unknown) => {
    sendEvent("todos_update", payload);
  }));

  unsubscribers.push(getBus().on(Events.TODOS_CLEAR, (payload: unknown) => {
    sendEvent("todos_clear", payload);
  }));

  unsubscribers.push(getBus().on(Events.COST_UPDATE, (payload: unknown) => {
    sendEvent("cost_update", payload);
  }));
}

/**
 * Send a forwarded (subagent) ask to the Client and wire the response. The
 * bridge is the sole emitter of child-path ASK_RESPONSE: on a settled ask it
 * emits the Client's response verbatim; on a failure (error / timeout /
 * cancel / child exit) it emits a cancelled ASK_RESPONSE so the refcount
 * always pairs.
 */
function requestAskToClient(
  payload: {
    requestId: string;
    source: string;
    toolCallId?: string;
    questions: Array<{ id: string }>;
  },
): { cancel: () => void } {
  const opts: { toolCallId?: string; source?: string } = { source: payload.source };
  if (payload.toolCallId !== undefined) opts.toolCallId = payload.toolCallId;
  const handle = request<{
    cancelled: boolean;
    results: Array<{ id: string; selectedOptions: string[]; customInput?: string }>;
  }>("ask", payload.questions, opts);

  handle.promise
    .then((resp) => {
      getBus().emit(Events.ASK_RESPONSE, {
        requestId: payload.requestId,
        cancelled: resp.cancelled,
        results: resp.results,
      });
      pending.delete(payload.requestId);
    })
    .catch(() => {
      getBus().emit(Events.ASK_RESPONSE, {
        requestId: payload.requestId,
        cancelled: true,
        results: payload.questions.map((q) => ({ id: q.id, selectedOptions: [] })),
      });
      pending.delete(payload.requestId);
    });

  return { cancel: handle.cancel };
}

/** Test seam: reset the module singletons and tear down the bus subscriptions. */
export function __resetForTests(): void {
  refcount = 0;
  settled = false;
  started = false;
  sessionCtx = undefined;
  pending.clear();
  for (const u of unsubscribers) u();
  unsubscribers.length = 0;
}
