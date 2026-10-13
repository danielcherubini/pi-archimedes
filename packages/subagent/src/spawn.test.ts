import { describe, it, expect, vi, afterEach } from "vitest";
import * as net from "node:net";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { getBus, Events } from "@pi-archimedes/core/bus";
import type { AgentConfig } from "./agents.js";

// The child's argv is a contract with the `pi` CLI, and CLI strings are invisible
// to tsc — these tests are the only guard on what the child actually receives.
// `node:child_process` is mocked so no real pi process is spawned.
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

const { startAskSocketServer, spawnSubagent } = await import("./spawn.js");

// startAskSocketServer is tested directly (not via spawnSubagent, which would
// spawn a real `pi` process). The real bus is used — subscriptions are
// unsubscribed in afterEach so they don't leak into other test files in the
// same worker (the bus is a globalThis singleton).

const cleanups: Array<() => void> = [];
const unsubs: Array<() => void> = [];

afterEach(() => {
  unsubs.splice(0).forEach((u) => u());
  cleanups.splice(0).forEach((c) => c());
});

function track(fn: () => void): void {
  cleanups.push(fn);
}

// ── spawnSubagent argv ──────────────────────────────────────────────────────

/** A minimal spawn target: the argv assertions never touch the process. */
function fakeSpawnResult(): ChildProcess {
  const child = new EventEmitter() as ChildProcess & { pid: number };
  Object.assign(child, { pid: 4242, killed: false, kill: () => true });
  return child;
}

/** Run spawnSubagent against the mocked spawn and return the argv it received. */
function argvFor(agent: Partial<AgentConfig> | undefined): string[] {
  spawnMock.mockReset();
  spawnMock.mockReturnValue(fakeSpawnResult());
  const socket = startAskSocketServer(agent?.name ?? "general");
  track(socket.cleanup);
  spawnSubagent({
    task: "do the thing",
    model: undefined,
    activeModel: undefined,
    cwd: "/tmp",
    signal: undefined,
    agent: agent
      ? { name: agent.name ?? "general", description: "d", systemPrompt: "p", source: "user", filePath: "/tmp/a.md", ...agent }
      : undefined,
  });
  const call = spawnMock.mock.calls[0] as [string, string[]] | undefined;
  if (!call) throw new Error("spawn was not called");
  return call[1];
}

describe("spawnSubagent tool allowlist (closed set, ADR 0028)", () => {
  afterEach(() => {
    spawnMock.mockReset();
  });

  it("a non-empty tools allowlist also passes --no-mcp, so the list stays closed", () => {
    const argv = argvFor({ tools: ["read", "bash"] });
    expect(argv).toContain("--tools");
    expect(argv[argv.indexOf("--tools") + 1]).toBe("read,bash");
    expect(argv).toContain("--no-mcp");
  });

  it("mcp: true is the only way the allowlist stops being closed", () => {
    const argv = argvFor({ tools: ["read", "bash"], mcp: true });
    expect(argv).toContain("--tools");
    expect(argv).not.toContain("--no-mcp");
  });

  it("an empty tools list changes neither the tool set nor MCP", () => {
    const argv = argvFor({ tools: [] });
    expect(argv).not.toContain("--tools");
    expect(argv).not.toContain("--no-mcp");
  });

  it("mcp: true without an allowlist passes neither flag (nothing to close)", () => {
    const argv = argvFor({ mcp: true });
    expect(argv).not.toContain("--tools");
    expect(argv).not.toContain("--no-mcp");
  });

  it("the recursion guard survives the closed allowlist", () => {
    const argv = argvFor({ tools: ["read"] });
    const excludeIdx = argv.indexOf("--exclude-tools");
    expect(excludeIdx).toBeGreaterThan(-1);
    expect(argv[excludeIdx + 1]).toContain("subagent");
  });

  it("an agent with no config at all gets neither --tools nor --no-mcp", () => {
    const argv = argvFor(undefined);
    expect(argv).not.toContain("--tools");
    expect(argv).not.toContain("--no-mcp");
    expect(argv).toContain("--exclude-tools");
  });
});

function connectClient(socketPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const client = net.connect(socketPath, () => resolve(client));
    client.on("error", (err) => reject(err));
  });
}

function writeAskRequest(client: net.Socket, requestId: string, toolCallId?: string): void {
  client.write(
    JSON.stringify({
      type: "ask_request",
      requestId,
      toolCallId,
      questions: [{ id: "q1", question: "Which?", options: [{ label: "A" }] }],
    }) + "\n",
  );
}

describe("startAskSocketServer", () => {
  it("a child ask_request carrying toolCallId → the bus ASK_REQUEST carries the same toolCallId", async () => {
    const { socketPath, cleanup } = startAskSocketServer("test-agent");
    track(cleanup);
    await new Promise((r) => setTimeout(r, 50)); // let the server listen

    const requests: unknown[] = [];
    unsubs.push(getBus().on(Events.ASK_REQUEST, (p) => requests.push(p)));

    const client = await connectClient(socketPath);
    writeAskRequest(client, "req-1", "tool-9");

    await vi.waitFor(() => expect(requests.length).toBe(1));
    const req = requests[0] as { source: string; requestId: string; toolCallId?: string; questions: unknown[] };
    expect(req.source).toBe("subagent:test-agent");
    expect(req.requestId).toBe("req-1");
    expect(req.toolCallId).toBe("tool-9");
    expect(req.questions).toEqual([{ id: "q1", question: "Which?", options: [{ label: "A" }] }]);

    // Deliver the response (drains pending) before closing so no ASK_CANCEL
    // leaks onto the global bus queue for the next test
    getBus().emit(Events.ASK_RESPONSE, {
      requestId: "req-1",
      cancelled: false,
      results: [{ id: "q1", selectedOptions: ["A"] }],
    });
    await new Promise((r) => setTimeout(r, 50));
    client.destroy();
    await new Promise((r) => setTimeout(r, 50)); // close handler ran (no-op)
  });

  it("closing the child socket → ASK_CANCEL for the pending requestId + source", async () => {
    const { socketPath, cleanup } = startAskSocketServer("test-agent");
    track(cleanup);
    await new Promise((r) => setTimeout(r, 50)); // let the server listen

    const cancels: unknown[] = [];
    unsubs.push(getBus().on(Events.ASK_CANCEL, (p) => cancels.push(p)));
    const requests: unknown[] = [];
    unsubs.push(getBus().on(Events.ASK_REQUEST, (p) => requests.push(p)));

    const client = await connectClient(socketPath);
    writeAskRequest(client, "req-2");

    // Wait until the request is registered (pending) before closing
    await vi.waitFor(() => expect(requests.length).toBe(1));
    client.destroy();

    await vi.waitFor(() => expect(cancels.length).toBe(1));
    expect(cancels[0]).toEqual({ requestId: "req-2", source: "subagent:test-agent" });
  });

  it("no ASK_CANCEL once the response has already been delivered (pending drained)", async () => {
    const { socketPath, cleanup } = startAskSocketServer("test-agent");
    track(cleanup);
    await new Promise((r) => setTimeout(r, 50)); // let the server listen

    const cancels: unknown[] = [];
    unsubs.push(getBus().on(Events.ASK_CANCEL, (p) => cancels.push(p)));
    const requests: unknown[] = [];
    unsubs.push(getBus().on(Events.ASK_REQUEST, (p) => requests.push(p)));

    const client = await connectClient(socketPath);
    writeAskRequest(client, "req-3");
    await vi.waitFor(() => expect(requests.length).toBe(1));

    // Deliver the response (drains pending) before the socket closes
    getBus().emit(Events.ASK_RESPONSE, {
      requestId: "req-3",
      cancelled: false,
      results: [{ id: "q1", selectedOptions: ["A"] }],
    });
    await new Promise((r) => setTimeout(r, 50));
    client.destroy();
    await new Promise((r) => setTimeout(r, 50)); // close handler ran

    expect(cancels.length).toBe(0);
  });
});
