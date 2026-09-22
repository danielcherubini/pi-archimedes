// ── executeSubagent bridge branch: a deliberate cancel must never fork ──
//
// The "no fork on cancel" guarantee at the execute layer: a mid-dispatch
// abort settles the bridge dispatch as a FAILED result (error "cancelled")
// and `spawnSubagent` (the fork path) is NEVER called. The bridge is
// activated through the real env-gated session_start path (registerBridge),
// so `getBridge().active` is the real gate.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { registerBridge } from "@pi-archimedes/core/bridge";
import * as channel from "@pi-archimedes/core/bridge/channel";
import * as spawn from "./spawn.js";
import { executeSubagent } from "./execute.js";
import type { ExecuteOptions } from "./execute.js";
import type { AgentConfig } from "./agents.js";
import type { SubagentProgress } from "./types.js";

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

/** Activate the bridge (env-gated, root-only) pointing at the given socket. */
function activateBridge(socketPath: string): void {
  clearBridgeEnv();
  process.env.PI_ARCHIMEDES_BRIDGE = "1";
  process.env.PI_ARCHIMEDES_BRIDGE_SOCKET = socketPath;
  process.env.PI_ARCHIMEDES_BRIDGE_SESSION = "test-desktop-session";
  process.env.PI_ARCHIMEDES_BRIDGE_SERVER_PID = "12345";
  const onSpy = vi.fn();
  registerBridge({ on: onSpy } as unknown as ExtensionAPI);
  const calls = onSpy.mock.calls as Array<[string, (e: unknown, ctx: unknown) => void]>;
  const startCall = calls.find((c) => c[0] === "session_start");
  expect(startCall).toBeTruthy();
  startCall![1](null, { mode: "rpc" });
}

function tempSocketPath(): string {
  return path.join(os.tmpdir(), `execute-test-${randomUUID()}.sock`);
}

const AGENT: AgentConfig = {
  name: "reviewer",
  description: "Code reviewer",
  systemPrompt: "You are a reviewer.\n",
  source: "global",
  filePath: "/tmp/reviewer.md",
  model: "anthropic/claude-agent",
  thinking: "medium",
  tools: ["read", "bash"],
};

function makeOptions(overrides: Partial<ExecuteOptions> = {}): ExecuteOptions {
  return {
    agent: "reviewer",
    agentConfig: AGENT,
    task: "review this code",
    model: "call-model",
    activeModel: "active-model",
    cwd: undefined,
    signal: undefined,
    onUpdate: undefined,
    toolCallId: "tc-1",
    ...overrides,
  };
}

function startSilentDesktop(sockPath: string): Promise<net.Server> {
  const server = net.createServer((socket) => {
    /* accept but never respond */
    socket.on("error", () => { /* connection dropped */ });
  });
  return new Promise((resolve) => server.listen(sockPath, () => resolve(server)));
}

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  clearBridgeEnv();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  clearBridgeEnv();
  vi.restoreAllMocks();
});

describe("executeSubagent (bridge branch)", () => {
  it("a mid-dispatch abort settles as a FAILED result and NEVER forks (spawnSubagent not called)", async () => {
    const sockPath = tempSocketPath();
    const server = await startSilentDesktop(sockPath);
    activateBridge(sockPath);

    // The fork path: if a deliberate cancel ever fell through to it, the
    // spy catches the call (the implementation throws so a fall-through is
    // also loud).
    const spawnSpy = vi.spyOn(spawn, "spawnSubagent").mockImplementation(() => {
      throw new Error("fork must not happen on a deliberate cancel");
    });

    const controller = new AbortController();
    const p = executeSubagent(makeOptions({ signal: controller.signal }));
    await new Promise((r) => setTimeout(r, 50)); // let the socket connect (request sent)
    controller.abort(); // mid-dispatch: after the request, before the response

    const result = await p;
    // The bridge outcome is authoritative (a FAILED result) — the fork path
    // (spawnSubagent) is NEVER called for a task the user just cancelled.
    expect(result.exitCode).toBe(1);
    expect(result.error).toBe("cancelled");
    expect(result.progress!.status).toBe("failed");
    expect(spawnSpy).not.toHaveBeenCalled();

    spawnSpy.mockRestore();
    server.close();
    try { fs.unlinkSync(sockPath); } catch { /* already gone */ }
  });

  it("a pre-aborted signal short-circuits to a FAILED result and NEVER forks (no 'dispatched' placeholder, no fork)", async () => {
    // The corner: an UNREACHABLE channel (the executor's early return leaves
    // `finish` as a safe no-op, so `handle.cancel()` is a no-op and
    // `channel.request` rejects with a BridgeTransportError → { fallback: true }
    // → the fork path would run for an already-cancelled task). Simulated with
    // `active: true` + no socket target (the ECONNREFUSED variant is NOT the
    // corner — there the async socket error loses the race to the synchronous
    // cancel() and the outcome is already a deterministic "cancelled").
    activateBridge(tempSocketPath());
    channel.configure({ active: true, socketPath: undefined });

    // The fork path: if the pre-abort corner ever fell through to it, the spy
    // catches the call (the implementation throws so a fall-through is also
    // loud).
    const spawnSpy = vi.spyOn(spawn, "spawnSubagent").mockImplementation(() => {
      throw new Error("fork must not happen for a pre-aborted signal");
    });

    const controller = new AbortController();
    controller.abort(); // pre-aborted BEFORE dispatch

    const updates: SubagentProgress[] = [];
    const result = await executeSubagent(
      makeOptions({ signal: controller.signal, onUpdate: (p) => updates.push(p) }),
    );

    // A deliberate cancel must NEVER fork — even in the unreachable-channel
    // corner: a FAILED SubagentResult with the "cancelled" outcome, and the
    // task does not claim it was "dispatched" (no placeholder before the
    // short-circuit; the final-failure progress still updates the
    // executeParallel slot from the pending placeholder to "failed").
    expect(result.exitCode).toBe(1);
    expect(result.error).toBe("cancelled");
    expect(result.progress!.status).toBe("failed");
    expect(result.progress!.error).toBe("cancelled");
    expect(spawnSpy).not.toHaveBeenCalled();
    // Exactly ONE update: the final-failure progress (no "dispatched"
    // placeholder — a cancelled task does not claim it was dispatched).
    expect(updates).toHaveLength(1);
    expect(updates[0]?.status).toBe("failed");
    expect(updates[0]?.error).toBe("cancelled");

    spawnSpy.mockRestore();
  });
});
