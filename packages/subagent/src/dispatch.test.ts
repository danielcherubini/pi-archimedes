// ── Bridge-mode dispatch (dispatchViaBridge) ─────────────────────────────
//
// A fake bridge server (a `net` server on a temp socket — the pattern from
// packages/core's bridge index.test.ts end-to-end section) stands in for the
// desktop. The bridge is activated through the real env-gated session_start
// path (registerBridge), so `getBridge().active` is the real gate.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { registerBridge } from "@pi-archimedes/core/bridge";
import { dispatchViaBridge } from "./dispatch.js";
import { resolveModel } from "./spawn.js";
import type { ExecuteOptions } from "./execute.js";
import type { AgentConfig } from "./agents.js";
import type { SubagentResult } from "./types.js";

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
  // registerBridge evaluates isBridgeMode at session_start — fire the handler.
  const onSpy = vi.fn();
  registerBridge({ on: onSpy } as unknown as ExtensionAPI);
  const calls = onSpy.mock.calls as Array<[string, (e: unknown, ctx: unknown) => void]>;
  const startCall = calls.find((c) => c[0] === "session_start");
  expect(startCall).toBeTruthy();
  startCall![1](null, { mode: "rpc" });
}

function tempSocketPath(): string {
  return path.join(os.tmpdir(), `dispatch-test-${randomUUID()}.sock`);
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

/** A fake bridge server: reply to every request frame with the given frame body. */
function startFakeDesktop(
  sockPath: string,
  reply: (msg: { id?: string; type?: string; method?: string; source?: string; toolCallId?: string; params?: unknown }) => unknown,
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
          const msg = JSON.parse(trimmed) as { type?: string; id?: string; method?: string; source?: string; toolCallId?: string; params?: unknown };
          if (msg.type === "request" && msg.id) {
            const body = reply(msg);
            if (body !== undefined) socket.write(JSON.stringify(body) + "\n");
          }
        } catch { /* malformed — ignore */ }
      }
    });
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
});

// ── dispatchViaBridge: response mapping ───────────────────────────────────

describe("dispatchViaBridge", () => {
  it("(1) maps a success response to a SubagentResult (no fork)", async () => {
    const sockPath = tempSocketPath();
    const frames: Array<Record<string, unknown>> = [];
    const server = await startFakeDesktop(sockPath, (msg) => {
      frames.push(msg);
      return {
        v: 1,
        type: "response",
        id: msg.id,
        result: { output: "done", metrics: { inputTokens: 1, outputTokens: 2, cost: 0.01, durationMs: 5 } },
      };
    });
    activateBridge(sockPath);

    const outcome = await dispatchViaBridge(makeOptions(), undefined, "tc-1");

    // A SubagentResult — NOT the fallback marker.
    expect("fallback" in outcome).toBe(false);
    const result = outcome as SubagentResult;
    expect(result.exitCode).toBe(0);
    expect(result.finalOutput).toBe("done");
    expect(result.error).toBeUndefined();
    expect(result.usage).toEqual({ input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.01, turns: 0 });
    expect(result.model).toBe("anthropic/claude-agent"); // agent.model wins
    // Synthesized progress (the same defensive synthesis executeSubagent does).
    expect(result.progress).toBeDefined();
    expect(result.progress!.status).toBe("completed");
    expect(result.progress!.agent).toBe("reviewer");
    expect(result.progress!.durationMs).toBe(5);
    expect(result.progressSummary).toEqual({ toolCount: 0, tokens: 3, durationMs: 5 });

    // The frame follows the wire contract.
    const frame = frames.find((f) => f.type === "request");
    expect(frame).toBeDefined();
    expect(frame!.method).toBe("dispatch_subagent");
    expect(frame!.source).toBe("main");
    expect(frame!.toolCallId).toBe("tc-1");
    const params = frame!.params as Record<string, unknown>;
    expect(params.agentName).toBe("reviewer");
    expect(params.task).toBe("review this code");
    expect(params.systemPrompt).toBe("You are a reviewer."); // trimmed
    expect(params.model).toBe("anthropic/claude-agent");
    expect(params.thinking).toBe("medium");
    expect(params.tools).toEqual(["read", "bash"]);
    expect("cwd" in params).toBe(false); // intentionally NOT sent

    server.close();
    try { fs.unlinkSync(sockPath); } catch { /* already gone */ }
  });

  it("(2) a terminal error: 'cancelled' frame → a FAILED SubagentResult (NOT a fallback)", async () => {
    const sockPath = tempSocketPath();
    const server = await startFakeDesktop(sockPath, (msg) => {
      return { v: 1, type: "response", id: msg.id, error: "cancelled" };
    });
    activateBridge(sockPath);

    const outcome = await dispatchViaBridge(makeOptions(), undefined, "tc-1");

    // The desktop answered — its outcome is authoritative, never a fallback.
    expect("fallback" in outcome).toBe(false);
    const result = outcome as SubagentResult;
    expect(result.exitCode).toBe(1);
    expect(result.error).toBe("cancelled");
    expect(result.finalOutput).toBeUndefined();
    expect(result.progress!.status).toBe("failed");
    expect(result.progress!.error).toBe("cancelled");

    server.close();
    try { fs.unlinkSync(sockPath); } catch { /* already gone */ }
  });

  it("a mid-dispatch abort settles as a FAILED SubagentResult with error 'cancelled' (NOT a fallback — no fork)", async () => {
    const sockPath = tempSocketPath();
    const server = await startFakeDesktop(sockPath, () => {
      /* accept but never respond */
    });
    activateBridge(sockPath);

    const controller = new AbortController();
    const p = dispatchViaBridge(makeOptions({ signal: controller.signal }), controller.signal, "tc-1");
    await new Promise((r) => setTimeout(r, 50)); // let the socket connect (request sent)
    controller.abort(); // mid-dispatch: after the request, before the response

    const outcome = await p;
    // A deliberate cancel must NEVER fork: a FAILED SubagentResult with the
    // "cancelled" outcome (the same as the desktop's terminal `error:
    // "cancelled" frame) — NOT the fallback marker.
    expect("fallback" in outcome).toBe(false);
    const result = outcome as SubagentResult;
    expect(result.exitCode).toBe(1);
    expect(result.error).toBe("cancelled");
    expect(result.finalOutput).toBeUndefined();
    expect(result.progress!.status).toBe("failed");
    expect(result.progress!.error).toBe("cancelled");

    server.close();
    try { fs.unlinkSync(sockPath); } catch { /* already gone */ }
  });

  it("any other response-carrying error → a FAILED SubagentResult with the error message (NOT a fallback)", async () => {
    const sockPath = tempSocketPath();
    const server = await startFakeDesktop(sockPath, (msg) => {
      return { v: 1, type: "response", id: msg.id, error: "worker runtime unavailable" };
    });
    activateBridge(sockPath);

    const outcome = await dispatchViaBridge(makeOptions(), undefined, "tc-1");

    expect("fallback" in outcome).toBe(false);
    const result = outcome as SubagentResult;
    expect(result.exitCode).toBe(1);
    expect(result.error).toBe("worker runtime unavailable");
    expect(result.progress!.status).toBe("failed");

    server.close();
    try { fs.unlinkSync(sockPath); } catch { /* already gone */ }
  });

  it("(3) an unreachable bridge (no response frame) → { fallback: true }", async () => {
    // No server on this socket → ECONNREFUSED → BridgeTransportError.
    activateBridge(tempSocketPath());

    const outcome = await dispatchViaBridge(makeOptions(), undefined, "tc-1");
    expect(outcome).toEqual({ fallback: true });
  });

  it("nullifies the params (model/thinking/tools/systemPrompt) for a config-less run", async () => {
    const sockPath = tempSocketPath();
    const frames: Array<Record<string, unknown>> = [];
    const server = await startFakeDesktop(sockPath, (msg) => {
      frames.push(msg);
      return { v: 1, type: "response", id: msg.id, result: { output: "ok", metrics: { inputTokens: 0, outputTokens: 0, cost: 0, durationMs: 1 } } };
    });
    activateBridge(sockPath);

    const outcome = await dispatchViaBridge(
      makeOptions({ agent: undefined, agentConfig: undefined, model: undefined, activeModel: undefined }),
      undefined,
      "tc-1",
    );
    expect("fallback" in outcome).toBe(false);

    const params = (frames.find((f) => f.type === "request")?.params ?? {}) as Record<string, unknown>;
    expect(params.agentName).toBe("subagent");
    expect(params.systemPrompt).toBeNull();
    expect(params.model).toBeNull();
    expect(params.thinking).toBeNull();
    expect(params.tools).toBeNull();
    // The result's model is the (un-nullified) resolution — undefined here.
    expect((outcome as SubagentResult).model).toBeUndefined();

    server.close();
    try { fs.unlinkSync(sockPath); } catch { /* already gone */ }
  });
});

// ── resolveModel precedence (shared fork + bridge) ────────────────────────

describe("resolveModel", () => {
  it("(4) agent.model > call model > activeModel; all undefined → undefined", () => {
    expect(resolveModel({ model: "call-model", activeModel: "active-model", agent: AGENT })).toBe("anthropic/claude-agent");
    expect(resolveModel({ model: "call-model", activeModel: "active-model", agent: undefined })).toBe("call-model");
    expect(resolveModel({ model: undefined, activeModel: "active-model", agent: undefined })).toBe("active-model");
    expect(resolveModel({ model: undefined, activeModel: undefined, agent: undefined })).toBeUndefined();
  });
});
