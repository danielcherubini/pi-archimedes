// ── Bridge public API ────────────────────────────────────────────────────
//
// getBridge() is the singleton Tasks 2-3 import. The bridge is env-gated and
// root-only: active iff (all 4 env vars present ∧ ctx.mode !== "tui" ∧
// PI_SUBAGENT_SOCKET absent), evaluated at session_start. TUI always wins; a
// subagent child (env present) is inactive. The `active` flag does not depend
// on a successful connection (lazy, per-message connect).
//
// Inactive API: ask → throws BridgeInactiveError (loud); confirm → false;
// password → "" (cancel).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AskResponsePayload, AskRequestPayload } from "../bus.js";
import * as channel from "./channel.js";
import * as events from "./events.js";

export { BridgeTransportError, BridgeCancelledError } from "./channel.js";

export class BridgeInactiveError extends Error {
  constructor() {
    super("bridge is not active");
    this.name = "BridgeInactiveError";
  }
}

function channelActive(): boolean {
  return channel.isActive();
}

function eventsState(): "working" | "idle" | "blocked" {
  return events.state();
}

export function getBridge() {
  return { active: channelActive(), ask, confirm, password, dispatch, state: eventsState };
}

/**
 * Delegate a subagent task to the Client (desktop) instead of forking a
 * child pi process. The desktop runs the subagent session (a full ACP
 * session on its worker runtime) and answers with the final output +
 * metrics.
 *
 * The request opts OUT of the 5-minute timeout (`timeoutMs: null`): the
 * desktop's lifecycle (parent close / EOF / app exit) is the cancel path —
 * the tool's AbortSignal cancels the request (the promise settles
 * deterministically with a BridgeCancelledError — NOT a
 * BridgeTransportError, so it can never trigger a fork fallback) and the
 * socket close delivers the desktop's EOF → the subagent session cancels.
 * An unreachable bridge rejects with BridgeTransportError (the subagent's
 * fork-fallback trigger); a response-carrying `error` (incl. the terminal
 * `"cancelled"` frame) is authoritative and never a fallback.
 */
export interface DispatchParams {
  agentName: string;
  task: string;
  systemPrompt: string | null;
  model: string | null;
  thinking: string | null;
  tools: string[] | null;
}

export interface DispatchResult {
  output: string;
  metrics: { inputTokens: number; outputTokens: number; cost: number; durationMs: number };
}

export function dispatch(params: DispatchParams, toolCallId: string | undefined, signal?: AbortSignal): Promise<DispatchResult> {
  if (!channelActive()) throw new BridgeInactiveError();
  const handle = channel.request<DispatchResult>("dispatch_subagent", params, { toolCallId, source: "main", timeoutMs: null });
  if (signal) {
    // Same abort wiring as ask (see there for the full rationale): a
    // pre-aborted signal cancels immediately, the listener is removed on
    // settle via the .then(onFulfilled, onRejected) form.
    if (signal.aborted) handle.cancel();
    else signal.addEventListener("abort", handle.cancel, { once: true });
    handle.promise.then(
      () => { signal?.removeEventListener("abort", handle.cancel); },
      () => { signal?.removeEventListener("abort", handle.cancel); },
    );
  }
  return handle.promise;
}

/**
 * Ask the Client (the root's direct Client request — NOT the relay/bridge bus
 * subscription). The param is typed structurally from the bus payload —
 * AskQuestion lives in packages/ask, which core cannot import.
 */
export function ask(params: { questions: AskRequestPayload["questions"] }, toolCallId: string, signal?: AbortSignal): Promise<AskResponsePayload> {
  if (!channelActive()) throw new BridgeInactiveError();
  const handle = channel.request<AskResponsePayload>("ask", params, { toolCallId, source: "main" });
  if (signal) {
    // Abort the turn → cancel the Client request (the tool's catch converts the
    // cancel-rejection into the paired cancelled ASK_RESPONSE, so the refcount
    // stays balanced). A signal that is ALREADY aborted never dispatches its
    // "abort" event (it fires exactly once, at abort time), so an addEventListener
    // alone would leave the request lingering until the Client responds or the
    // 5-minute timeout — call cancel() directly in that case. cancel() is
    // idempotent and settles the promise deterministically (the
    // socket-close handler it triggers is a no-op once settled), so both
    // branches coexist safely. The listener is removed on settle; the
    // .then(onFulfilled, onRejected) form (not .finally) avoids an unhandled
    // rejection from the derived promise when the request rejects.
    if (signal.aborted) handle.cancel();
    else signal.addEventListener("abort", handle.cancel, { once: true });
    handle.promise.then(
      () => { signal?.removeEventListener("abort", handle.cancel); },
      () => { signal?.removeEventListener("abort", handle.cancel); },
    );
  }
  return handle.promise;
}

export function confirm(params: { command: string; reason: string }): Promise<boolean> {
  if (!channelActive()) return Promise.resolve(false);
  return channel.request<{ confirmed: boolean }>("confirm", params, { source: "main" }).promise
    .then((r) => r.confirmed)
    .catch(() => false);
}

export function password(params: { command: string; reason: string }): Promise<string> {
  if (!channelActive()) return Promise.resolve("");
  return channel.request<{ password?: string }>("password", params, { source: "main" }).promise
    .then((r) => r.password ?? "")
    .catch(() => "");
}

/**
 * Bridge-mode gate. PI_ARCHIMEDES_BRIDGE_SERVER_PID is presence-checked only
 * in v1: agent-side server-pid verification is unimplemented on both
 * platforms (Node's `net` exposes neither `GetNamedPipeServerProcessId` nor
 * `SO_PEERCRED`); the desktop-side descendant check is the real defense.
 */
function isBridgeMode(ctx: { mode: string }): boolean {
  return (
    process.env.PI_ARCHIMEDES_BRIDGE === "1" &&
    !!process.env.PI_ARCHIMEDES_BRIDGE_SOCKET &&
    !!process.env.PI_ARCHIMEDES_BRIDGE_SESSION &&
    !!process.env.PI_ARCHIMEDES_BRIDGE_SERVER_PID &&
    ctx.mode !== "tui" &&
    !process.env.PI_SUBAGENT_SOCKET
  );
}

/**
 * Subscribe the pi EXTENSION events (NOT the bus — nothing emits
 * agent_start/agent_settled/session_start on the bus). The extension events DO
 * fire in RPC mode (the RPC driver runs the same session machinery).
 */
export function registerBridge(pi: ExtensionAPI): void {
  pi.on("session_start", (_e, ctx) => {
    const active = isBridgeMode(ctx);
    channel.configure({ active, socketPath: process.env.PI_ARCHIMEDES_BRIDGE_SOCKET });
    if (active) {
      events.start();
      events.onSessionStart(ctx);
    }
  });
  pi.on("agent_start", () => {
    if (channelActive()) events.onAgentStart();
  });
  pi.on("agent_settled", () => {
    if (channelActive()) events.onAgentSettled();
  });
}
