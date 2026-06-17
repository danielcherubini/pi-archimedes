/**
 * Forked child entry point for IPC-based subagent architecture.
 *
 * This script is forked by the parent process. It receives an "init" message
 * with task and configuration, creates an AgentSession, runs the agent loop,
 * and streams events back to the parent over IPC.
 *
 * Usage: node child.js (forked with stdio: ["pipe", "pipe", "pipe", "ipc"])
 */

import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { getModel, type Model } from "@earendil-works/pi-ai";
import type { ParentToChild, ChildToParent } from "./ipc-types.js";

// ── Types ───────────────────────────────────────────────────────────────────

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

interface InitParams {
  task: string;
  model: string | undefined;
  agentName: string | undefined;
  agentSystemPrompt: string | undefined;
  agentTools: string[] | undefined;
  agentModel: string | undefined;
  agentThinking: string | undefined;
  cwd: string | undefined;
}

// ── Pending ask tracking (for IPC ask tool in Task 2) ───────────────────────
// The IPC ask tool (created in Task 2) will register pending asks here.
// Parent messages of type "ask_response" resolve them.
const pendingAsks = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
>();

// ── Model resolution ────────────────────────────────────────────────────────

/**
 * Parse a model string like "anthropic/claude-opus-4-5" into a Model object.
 * Returns undefined if the string is empty or cannot be parsed.
 */
function resolveModel(modelString: string | undefined): Model<any> | undefined {
  if (!modelString) return undefined;

  const slashIndex = modelString.indexOf("/");
  if (slashIndex <= 0) return undefined;

  const provider = modelString.slice(0, slashIndex);
  const modelId = modelString.slice(slashIndex + 1);

  try {
    return getModel(provider as any, modelId as any);
  } catch {
    return undefined;
  }
}

// ── Thinking level parsing ──────────────────────────────────────────────────

function parseThinkingLevel(level: string | undefined): ThinkingLevel | undefined {
  if (!level) return undefined;
  const validLevels: readonly ThinkingLevel[] = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ];
  if (validLevels.includes(level as ThinkingLevel)) {
    return level as ThinkingLevel;
  }
  return undefined;
}

// ── Parent message handler ──────────────────────────────────────────────────

let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | null = null;

function handleParentMessage(msg: ParentToChild): void {
  switch (msg.type) {
    case "ask_response": {
      const pending = pendingAsks.get(msg.requestId);
      if (pending) {
        pendingAsks.delete(msg.requestId);
        pending.resolve({
          cancelled: msg.cancelled,
          results: msg.results,
        });
      }
      break;
    }
    case "abort": {
      session?.abort();
      break;
    }
    // "init" is handled synchronously before this listener is set up
  }
}

// ── Event serialization ─────────────────────────────────────────────────────

/**
 * Strip non-serializable fields (functions, symbols) from events.
 */
function serializeEvent(event: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(event));
}

// ── Send helper ─────────────────────────────────────────────────────────────

function sendToParent(msg: ChildToParent): void {
  process.send?.(msg);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Wait for the "init" message from parent.
  let initParams: InitParams | null = null;

  const initPromise = new Promise<InitParams>((resolve) => {
    const handler = (msg: ParentToChild) => {
      if (msg.type === "init") {
        process.removeListener("message", handler);
        resolve({
          task: msg.task,
          model: msg.model,
          agentName: msg.agentName,
          agentSystemPrompt: msg.agentSystemPrompt,
          agentTools: msg.agentTools,
          agentModel: msg.agentModel,
          agentThinking: msg.agentThinking,
          cwd: msg.cwd,
        });
      }
    };
    process.on("message", handler);
  });

  initParams = await initPromise;

  // Resolve model: agent-level model takes priority, then top-level model.
  const modelString = initParams.agentModel ?? initParams.model;
  const model = resolveModel(modelString);

  // Resolve thinking level from agent config.
  const thinkingLevel = parseThinkingLevel(initParams.agentThinking);

  // Build tools allowlist from agent config.
  const tools = initParams.agentTools;

  // Build options object — omit undefined values to satisfy exactOptionalPropertyTypes.
  const sessionOptions: Parameters<typeof createAgentSession>[0] = {
    excludeTools: ["subagent"],
    customTools: [],
    sessionManager: SessionManager.inMemory(),
    ...(model ? { model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(initParams.cwd ? { cwd: initParams.cwd } : {}),
    ...(tools ? { tools } : {}),
  };

  // Create the agent session.
  // customTools: TODO — wire up IPC ask tool (created in Task 2).
  // For now, empty array. Will be replaced with: import { createIpcAskTool } from "./ipc-ask-tool.js"
  const { session: agentSession } = await createAgentSession(sessionOptions);

  session = agentSession;

  // Bind extensions with empty bindings (no UI, no command context).
  await session.bindExtensions({});

  // Subscribe to agent events and stream them to parent.
  session.subscribe((event) => {
    const serialized = serializeEvent(event);
    sendToParent({ type: "event", event: serialized });

    // On agent_end, exit the process.
    if (event.type === "agent_end") {
      const willRetry = (event as { willRetry?: boolean }).willRetry ?? false;
      if (!willRetry) {
        // Give events time to flush, then exit.
        setTimeout(() => {
          process.exit(0);
        }, 100);
      }
    }
  });

  // Set up parent message handler for ask_response and abort.
  process.on("message", handleParentMessage);

  // Send ready signal to parent.
  sendToParent({ type: "ready" });

  // Start the agent loop.
  await session.prompt(initParams.task);
}

// ── Graceful shutdown ───────────────────────────────────────────────────────

function gracefulShutdown(signal: string): void {
  if (session) {
    session.abort();
    session.dispose();
  }
  process.exit(signal === "SIGTERM" ? 143 : 130);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// ── Entry point ─────────────────────────────────────────────────────────────

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  sendToParent({ type: "error", message });
  process.exit(1);
});
