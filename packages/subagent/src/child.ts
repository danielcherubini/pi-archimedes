/**
 * Forked child entry point for IPC-based subagent architecture.
 *
 * This script is forked by the parent process. It receives an "init" message
 * with task and configuration, creates an AgentSession, runs the agent loop,
 * and streams events back to the parent over IPC.
 *
 * Usage: node child.js (forked with stdio: ["pipe", "pipe", "pipe", "ipc"])
 */

import {
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { ParentToChild, ChildToParent, SerializedAgentEvent } from "./ipc-types.ts";
import { createIpcAskTool } from "./ipc-ask-tool.ts";

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

// ── Model resolution ────────────────────────────────────────────────────────

/**
 * Resolve a model reference via a ModelRegistry.
 *
 * Supports:
 * - "provider/modelId" (canonical)
 * - "modelId" (bare — resolved across providers, ambiguous matches rejected)
 *
 * The registry must include extension-registered providers (e.g. "tama"),
 * which is why this is called AFTER createAgentSession has loaded
 * extensions — not with a bare ModelRegistry.create() that only knows
 * built-ins + models.json.
 */
function resolveModel(modelString: string | undefined, registry: { find(p: string, m: string): Model<any> | undefined; getAll(): Model<any>[] }): Model<any> | undefined {
  if (!modelString) return undefined;

  const slashIndex = modelString.indexOf("/");
  if (slashIndex > 0) {
    const provider = modelString.slice(0, slashIndex);
    const modelId = modelString.slice(slashIndex + 1);
    return registry.find(provider, modelId);
  }

  // Bare model id — search all providers, reject ambiguous matches
  const matches = registry.getAll().filter((m) => m.id === modelString);
  if (matches.length === 1) return matches[0];
  return undefined;
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
    case "abort": {
      session?.abort();
      break;
    }
    // "init" is handled synchronously before this listener is set up
    // "ask_response" is handled by the IPC ask tool's own per-execution listener
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

  // Resolve thinking level from agent config.
  const thinkingLevel = parseThinkingLevel(initParams.agentThinking);

  // Build tools allowlist from agent config.
  const tools = initParams.agentTools;

  // Build options object — omit undefined values to satisfy exactOptionalPropertyTypes.
  // NOTE: we deliberately do NOT pass authStorage/modelRegistry/settingsManager —
  // createAgentSession builds a DefaultResourceLoader that loads extensions
  // (including custom providers like "tama") and registers them into the
  // registry. Passing a bare ModelRegistry.create() would skip extension
  // loading and break custom-provider model resolution.
  const sessionOptions: Parameters<typeof createAgentSession>[0] = {
    excludeTools: ["subagent"],
    customTools: [createIpcAskTool()],
    sessionManager: SessionManager.inMemory(),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(initParams.cwd ? { cwd: initParams.cwd } : {}),
    ...(tools ? { tools } : {}),
  };

  // Create the agent session with IPC ask tool for user questions.
  // The session loads extensions (custom providers) and picks the settings
  // default model when none is passed.
  const { session: agentSession } = await createAgentSession(sessionOptions);

  session = agentSession;

  // If a specific model was requested, resolve it through the session's
  // registry (which now includes extension-registered providers) and switch
  // to it. This handles "tama/whatevers-hot-n-fresh" and bare ids like "glm".
  const modelString = initParams.agentModel ?? initParams.model;
  const resolvedModel = resolveModel(modelString, session.modelRegistry);
  if (resolvedModel && (session.model?.provider !== resolvedModel.provider || session.model?.id !== resolvedModel.id)) {
    await session.setModel(resolvedModel);
  }

  // Bind extensions with empty bindings (no UI, no command context).
  await session.bindExtensions({});

  // Subscribe to agent events and stream them to parent.
  session.subscribe((event) => {
    const serialized = serializeEvent(event);
    sendToParent({ type: "event", event: serialized as SerializedAgentEvent });

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
  // Prepend the agent's system prompt to the first prompt (no SDK-level systemPrompt option).
  const fullPrompt = initParams.agentSystemPrompt && initParams.agentSystemPrompt.trim()
    ? `${initParams.agentSystemPrompt}\n\n---\n\n${initParams.task}`
    : initParams.task;
  await session.prompt(fullPrompt);
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
