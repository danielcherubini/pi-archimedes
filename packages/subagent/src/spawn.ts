import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { getBus, Events } from "@pi-archimedes/core/bus";
import type { AgentConfig } from "./agents.js";

export interface SpawnOptions {
  task: string;
  model: string | undefined;
  activeModel: string | undefined;
  cwd: string | undefined;
  signal: AbortSignal | undefined;
  agent: AgentConfig | undefined;
}

/**
 * Resolve the pi binary path.
 *
 * Walk up from process.argv[1] (the pi CLI entry point) looking for the
 * @earendil-works/pi-coding-agent package root, then resolve its bin.pi field.
 * Falls back to "pi" (PATH lookup) if resolution fails.
 */
function resolvePiBinary(): string {
  try {
    const entry = process.argv[1];
    if (!entry) return "pi";

    let dir = path.dirname(fs.realpathSync(entry));
    const root = path.parse(dir).root;

    while (dir !== root) {
      const pkgPath = path.join(dir, "package.json");
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
          name?: string;
          bin?: string | Record<string, string>;
        };
        if (pkg.name === "@earendil-works/pi-coding-agent") {
          const binField = pkg.bin;
          const binRelative =
            typeof binField === "string"
              ? binField
              : binField?.pi ?? Object.values(binField ?? {})[0];
          if (binRelative) {
            const resolved = path.resolve(dir, binRelative);
            if (fs.existsSync(resolved)) return resolved;
          }
          break;
        }
      } catch {
        // package.json missing or invalid — keep walking
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // fall through
  }
  return "pi";
}

/**
 * Start a Unix socket server that bridges the child's ask tool to the parent bus.
 *
 * The child's ask tool (in packages/ask) connects to PI_SUBAGENT_SOCKET and sends:
 *   { type: "ask_request", requestId, questions } as a JSON line
 * and waits for:
 *   { type: "ask_response", requestId, cancelled, results } as a JSON line
 *
 * We forward the request onto the bus (ASK_REQUEST), the ask package shows the
 * parent TUI dialog, then emits ASK_RESPONSE on the bus, and we write it back
 * to the socket connection.
 *
 * Returns the socket path and a cleanup function.
 */
function startAskSocketServer(agentName: string): { socketPath: string; cleanup: () => void } {
  // Use named pipes on Windows, Unix domain sockets elsewhere.
  // Linux socket path limit is 108 chars — keep it short.
  // 16 hex chars = 64 bits of entropy; prevents socket path collision attacks
  const id = randomUUID().slice(0, 16);
  const socketPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\pi-ask-${id}`
      : path.join(os.tmpdir(), `pi-ask-${id}.sock`);

  // Map of pending ask requests: requestId → write-back callback
  const pending = new Map<string, (response: unknown) => void>();

  // Listen for ASK_RESPONSE from the bus and route back to the waiting socket conn
  const unsubResponse = getBus().on(Events.ASK_RESPONSE, (payload: unknown) => {
    const data = payload as {
      requestId: string;
      cancelled: boolean;
      results: Array<{ id: string; selectedOptions: string[]; customInput?: string }>;
    };
    const send = pending.get(data.requestId);
    if (send) {
      pending.delete(data.requestId);
      send({
        type: "ask_response",
        requestId: data.requestId,
        cancelled: data.cancelled,
        results: data.results,
      });
    }
  });

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
          const msg = JSON.parse(trimmed) as {
            type: string;
            requestId: string;
            questions: unknown[];
          };
          if (msg.type === "ask_request") {
            // Register write-back so ASK_RESPONSE handler can find this socket
            pending.set(msg.requestId, (response) => {
              try {
                socket.write(JSON.stringify(response) + "\n");
              } catch {
                // socket already closed
              }
            });
            // Forward to bus — ask package will show the TUI dialog
            getBus().emit(Events.ASK_REQUEST, {
              source: `subagent:${agentName}`,
              requestId: msg.requestId,
              questions: msg.questions,
            });
          }
        } catch {
          // malformed JSON — ignore
        }
      }
    });

    socket.on("error", () => { /* connection dropped */ });
  });

  server.listen(socketPath);

  // Restrict socket permissions on Unix to prevent unauthorized access
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(socketPath, 0o600); // Owner read/write only
    } catch {
      // chmod may fail if socket file isn't created yet; not critical
    }
  }

  const cleanup = () => {
    unsubResponse();
    server.close();
    // Named pipes on Windows are cleaned up automatically; only unlink on Unix
    if (process.platform !== "win32") {
      try { fs.unlinkSync(socketPath); } catch { /* already gone */ }
    }
  };

  return { socketPath, cleanup };
}

/**
 * Spawn a subagent as a fresh `pi --mode json --no-session -p <task>` process.
 *
 * A Unix socket server is started in the parent to bridge the child's ask tool
 * back to the parent's TUI dialog. The socket path is passed via PI_SUBAGENT_SOCKET.
 */
export function spawnSubagent(options: SpawnOptions): ChildProcess {
  const piBinary = resolvePiBinary();
  const agentName = options.agent?.name ?? "general";

  // Start ask bridge socket before spawning so the env var is ready
  const { socketPath, cleanup: cleanupSocket } = startAskSocketServer(agentName);

  // Build CLI args
  const args: string[] = ["--mode", "json", "--no-session", "-p"];

  // Model: agent.model > options.model > options.activeModel
  const model = options.agent?.model ?? options.model ?? options.activeModel;
  if (model) {
    args.push("--model", model);
  }

  // Thinking level from agent config
  if (options.agent?.thinking) {
    args.push("--thinking", options.agent.thinking);
  }

  // Tool allowlist from agent config
  if (options.agent?.tools && options.agent.tools.length > 0) {
    args.push("--tools", options.agent.tools.join(","));
  }

  // Always exclude the subagent tool itself to prevent infinite recursion
  args.push("--exclude-tools", "subagent");

  // Agent system prompt
  const systemPrompt = options.agent?.systemPrompt?.trim();
  if (systemPrompt) {
    args.push("--system-prompt", systemPrompt);
  }

  // The task is the final positional argument
  args.push(options.task);

  const child = spawn(piBinary, args, {
    cwd: options.cwd || process.cwd(),
    env: {
      ...process.env,
      PI_SUBAGENT_SOCKET: socketPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Clean up socket server when child exits
  child.on("exit", cleanupSocket);
  child.on("error", cleanupSocket);

  // Handle abort signal
  if (options.signal) {
    const abortHandler = () => {
      if (child.pid && !child.killed) {
        child.kill("SIGTERM");
        const forceKill = setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 3000);
        forceKill.unref();
      }
    };
    options.signal.addEventListener("abort", abortHandler, { once: true });
    child.on("exit", () => options.signal!.removeEventListener("abort", abortHandler));
  }

  return child;
}
