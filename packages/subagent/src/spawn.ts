import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getBus, Events } from "@pi-archimedes/core/bus";
import type { ParentToChild, ChildToParent } from "./ipc-types.js";
import type { AgentConfig } from "./agents.js";

// Resolve child script path from this file's location
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const childScriptPath = join(__dirname, "child.js");

export interface SpawnOptions {
  task: string;
  model: string | undefined;
  activeModel: string | undefined;
  cwd: string | undefined;
  signal: AbortSignal | undefined;
  agent: AgentConfig | undefined;
}

/**
 * Spawn a child process via fork() with IPC channel.
 */
export function spawnSubagent(options: SpawnOptions): ChildProcess {
  // Fork the child script with IPC channel
  const child = fork(childScriptPath, [], {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });

  // Send init message to child with all configuration
  // Model priority: agent.model > options.model > options.activeModel
  const model = options.agent?.model ?? options.model ?? options.activeModel;
  const initBase: Partial<ParentToChild> & { type: "init"; task: string } = {
    type: "init",
    task: options.task,
  };
  if (model) initBase.model = model;
  if (options.agent?.name) initBase.agentName = options.agent.name;
  if (options.agent?.systemPrompt) initBase.agentSystemPrompt = options.agent.systemPrompt;
  if (options.agent?.tools) initBase.agentTools = options.agent.tools;
  if (options.agent?.model) initBase.agentModel = options.agent.model;
  if (options.agent?.thinking) initBase.agentThinking = options.agent.thinking;
  if (options.cwd) initBase.cwd = options.cwd;
  child.send(initBase as ParentToChild);

  // Handle messages from child
  child.on("message", (msg: ChildToParent) => {
    switch (msg.type) {
      case "event": {
        // Forward events to streamEvents via the child's message handler
        // (streamEvents attaches its own listener)
        break;
      }
      case "ask_request": {
        // Forward ask requests to the bus for parent's ask dialog
        getBus().emit(Events.ASK_REQUEST, {
          source: `subagent:${options.agent?.name ?? "general"}`,
          requestId: msg.requestId,
          questions: msg.questions,
        });
        break;
      }
      case "ready": {
        // Child is ready — session created
        break;
      }
      case "error": {
        console.error(`[subagent:child] ${msg.message}`);
        break;
      }
    }
  });

  // Handle ask responses from bus → send to child via IPC
  const unsubAskResponse = getBus().on(Events.ASK_RESPONSE, (payload: unknown) => {
    const data = payload as {
      requestId: string;
      cancelled: boolean;
      results: Array<{ id: string; selectedOptions: string[]; customInput?: string }>;
    };
    const responseMsg: ParentToChild = {
      type: "ask_response",
      requestId: data.requestId,
      cancelled: data.cancelled,
      results: data.results,
    };
    child.send(responseMsg);
  });

  // Handle abort signal
  let abortHandler: (() => void) | undefined;
  if (options.signal) {
    abortHandler = () => {
      // Send abort message to child before killing
      child.send({ type: "abort" });
      if (child.pid && !child.killed) {
        child.kill("SIGTERM");
        const forceKill = setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 3000);
        forceKill.unref();
      }
    };
    options.signal.addEventListener("abort", abortHandler, { once: true });
  }

  // Clean up on exit
  const exitCleanup = (): void => {
    child.removeListener("exit", exitCleanup);
    child.removeListener("error", exitCleanup);
    if (abortHandler && options.signal) {
      options.signal.removeEventListener("abort", abortHandler);
    }
    unsubAskResponse();
  };
  child.on("exit", exitCleanup);
  child.on("error", exitCleanup);

  return child;
}
