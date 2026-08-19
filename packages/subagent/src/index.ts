import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text, type TUI } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { executeSubagent, executeParallel } from "./execute.js";
// agent-manager.js lazy-loaded below to keep subagent tool registration fast
import { renderSubagentResult } from "./render.js";
import { OVERLAY_CHROME } from "@pi-archimedes/core/overlay";
import { renderToolHeader } from "@pi-archimedes/core/tool-render";
import { discoverAgents, discoverAgentsAll, findAgent, formatAgentList } from "./agents.js";
import { validateModel, firstError } from "./model-validation.js";
import type {
  SubagentDetails,
  SubagentProgress,
  SubagentResult,
  SubagentToolResult,
} from "./types.js";

// ── JSON Schema for tool parameters (TypeBox) ──────────────────────────────

const TaskItem = Type.Object({
  agent: Type.Optional(Type.String({
    description: "Agent name for this task (optional). If omitted, runs config-less.",
  })),
  task: Type.String(),
  model: Type.Optional(Type.String()),
  cwd: Type.Optional(Type.String()),
});

const SUBAGENT_PARAMS_SCHEMA = Type.Object({
  agent: Type.Optional(Type.String({
    description: "Agent name (optional). If omitted, the subagent runs config-less — parent's current model, all tools, no system-prompt override. Call list_agents to see available agents.",
  })),
  task: Type.Optional(Type.String({
    description: "Task description for the subagent. Required when not using 'tasks' array.",
  })),
  tasks: Type.Optional(Type.Array(TaskItem, {
    description: "Multiple tasks for parallel execution. Required when not using 'task'.",
  })),
  model: Type.Optional(Type.String({
    description: "Model override for the subagent",
  })),
  async: Type.Optional(Type.Boolean({
    description: "Run asynchronously (fire-and-forget)",
  })),
  cwd: Type.Optional(Type.String({
    description: "Working directory for the subagent",
  })),
});

// ── Theme helper type for render functions ──────────────────────────────────

interface RenderTheme {
  fg: (token: string, text: string) => string;
  bold: (text: string) => string;
}

// ── Tool registration ───────────────────────────────────────────────────────

export function registerSubagent(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Delegate tasks to subagents. Provide either 'task' (single) or 'tasks' (parallel). Agent is optional — omit for a config-less run with the parent's model and all tools. Model override is rarely needed; the agent config or parent model is used by default.",
    parameters: SUBAGENT_PARAMS_SCHEMA,

    async execute(
      _id: string,
      params: {
        agent?: string;
        task?: string;
        tasks?: Array<{ agent?: string; task: string; count?: number; model?: string; cwd?: string }>;
        model?: string;
        cwd?: string;
        async?: boolean;
      },
      signal: AbortSignal | undefined,
      onUpdate: ((update: SubagentToolResult) => void) | undefined,
      ctx: ExtensionContext,
    ): Promise<SubagentToolResult> {
      const agents = discoverAgents(ctx.cwd);

      // Parallel mode
      if (params.tasks && params.tasks.length > 0) {
        // Combined pre-spawn checks for parallel mode: unknown agents + invalid
        // models. If ANY task is invalid, abort the whole batch with a single
        // tool result listing all errors (no tasks spawn).
        const errors: string[] = [];
        const unknownAgents = params.tasks
          .filter((t) => t.agent && !findAgent(agents, t.agent!))
          .map((t) => `"${t.agent}"`);
        if (unknownAgents.length > 0) {
          const available = agents.map((a) => a.name).join(", ") || "none";
          errors.push(`Unknown agent(s): ${unknownAgents.join(", ")}. Available: ${available}. Call list_agents for details.`);
        }
        const unknownAgentSet = new Set(unknownAgents.map((n) => n.replace(/"/g, '')));
        for (const t of params.tasks) {
          // Skip model validation for tasks already caught by unknown-agent check
          if (t.agent && unknownAgentSet.has(t.agent)) continue;
          const taskAgentConfig = t.agent ? findAgent(agents, t.agent) : undefined;
          const me = firstError(
            validateModel(t.model, ctx.modelRegistry, { agentName: t.agent }),
            validateModel(taskAgentConfig?.model, ctx.modelRegistry, {
              agentName: t.agent,
              agentFilePath: taskAgentConfig?.filePath,
            }),
          );
          if (me) errors.push(me);
        }
        if (errors.length > 0) {
          return {
            content: [{ type: "text", text: errors.join("\n") }],
            details: {
              mode: "parallel",
              results: [],
              progress: undefined,
            },
            isError: true,
          };
        }
        const results: SubagentResult[] = await executeParallel({
          tasks: params.tasks.map((t) => ({
            agent: t.agent ?? undefined,
            agentConfig: t.agent ? findAgent(agents, t.agent) : undefined,
            task: t.task,
            model: t.model,
            activeModel: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
            cwd: t.cwd ?? undefined,
          })),
          signal: signal ?? undefined,
          onUpdate: (progress: SubagentProgress[]) => {
            onUpdate?.({
              content: [],
              details: {
                mode: "parallel",
                results: [],
                progress,
              },
            });
          },
        });

        return {
          content: [{ type: "text", text: formatResultsSummary(results) }],
          details: {
            mode: "parallel",
            results,
            // progress is always defined for each result (executeSubagent synthesizes
            // a failed-progress object in its catch block) so we keep alignment with
            // results by index. Do NOT filter(Boolean) here — that would misalign
            // details.progress[i] with details.results[i] in the renderer.
            progress: results.map(r => r.progress) as SubagentProgress[],
          },
        };
      }

      // Single mode
      if (params.task) {
        let agentConfig = params.agent ? findAgent(agents, params.agent) : undefined;
        if (params.agent && !agentConfig) {
          const available = agents.map((a) => a.name).join(", ") || "none";
          return {
            content: [{ type: "text", text: `Unknown agent: "${params.agent}". Available: ${available}. Call list_agents for details.` }],
            details: {
              mode: "single",
              results: [],
              progress: undefined,
            },
            isError: true,
          };
        }
        // Pre-spawn model validation (P2): fail fast with a friendly error
        // instead of spawning a child that will crash on a bogus --model.
        const modelError = firstError(
          validateModel(params.model, ctx.modelRegistry, { agentName: params.agent }),
          validateModel(agentConfig?.model, ctx.modelRegistry, {
            agentName: params.agent,
            agentFilePath: agentConfig?.filePath,
          }),
        );
        if (modelError) {
          return {
            content: [{ type: "text", text: modelError }],
            details: { mode: "single", results: [], progress: undefined },
            isError: true,
          };
        }
        const result: SubagentResult = await executeSubagent({
          agent: params.agent ?? undefined,
          agentConfig,
          task: params.task,
          model: params.model,
          activeModel: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
          cwd: params.cwd ?? undefined,
          signal: signal ?? undefined,
          onUpdate: (progress: SubagentProgress) => {
            onUpdate?.({
              content: [],
              details: {
                mode: "single",
                results: [],
                progress: [progress],
              },
            });
          },
        });

        return {
          content: [{ type: "text", text: result.finalOutput ?? result.error ?? "completed" }],
          details: {
            mode: "single",
            results: [result],
            progress: result.progress ? [result.progress] : undefined,
          },
          isError: result.exitCode !== 0,
        };
      }

      return {
        content: [{ type: "text", text: "Missing task parameter" }],
        details: {
          mode: "single",
          results: [],
          progress: undefined,
        },
        isError: true,
      };
    },

    renderCall(args: unknown, theme: Theme, ctx: unknown): import("@earendil-works/pi-tui").Component {
      const params = args as Record<string, unknown> | undefined;
      const tasks = params?.tasks as Array<unknown> | undefined;
      const agent = params?.agent as string | undefined;

      const lastComponent = (ctx as { lastComponent?: import("@earendil-works/pi-tui").Component })?.lastComponent;
      const text = (lastComponent instanceof Text ? lastComponent : new Text("", 0, 0)) as Text;
      (ctx as Record<string, unknown>).lastComponent = text;

      if (tasks && tasks.length > 0) {
        text.setText(
          renderToolHeader("subagent", `${tasks.length} tasks`, theme),
        );
      } else if (agent) {
        text.setText(renderToolHeader("subagent", agent, theme));
      } else {
        text.setText(renderToolHeader("subagent", undefined, theme));
      }

      return text;
    },

    renderResult(result: unknown, options: unknown, theme: Theme, context: unknown): import("@earendil-works/pi-tui").Component {
      const toolResult = result as unknown as SubagentToolResult;
      const debugText = new Text("", 0, 0);
      const expanded = ((context as Record<string, unknown>)?.expanded ??
        (options as Record<string, unknown>)?.expanded ??
        false) as boolean;

      const renderTheme = theme as unknown as RenderTheme;
      const text = new Text("", 0, 0);
      const renderContext = {
        expanded,
        isError: toolResult.isError ?? false,
        lastComponent: (context as { lastComponent?: Text })?.lastComponent,
        state: (context as Record<string, unknown>)?.state ?? {},
        invalidate: () => {},
      };
      (context as Record<string, unknown>).lastComponent = text;

      try {
        const rendered = renderSubagentResult(text, toolResult, { expanded }, renderTheme, renderContext as any);
        return rendered;
      } catch (e) {
        debugText.setText("render error: " + (e instanceof Error ? e.message : String(e)));
        return debugText;
      }
    },
  });

  registerListAgentsTool(pi);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function registerListAgentsTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "list_agents",
    label: "Agents",
    description:
      "List available subagent configurations (name, description, source, model/tools overrides). Call before dispatching if unsure which agents exist or which fits the task.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const agents = discoverAgents(ctx.cwd);
      return {
        content: [{ type: "text" as const, text: formatAgentList(agents) }],
        details: { count: agents.length },
      };
    },
  });
}

function formatProgressSummary(progress: SubagentProgress[]): string {
  if (progress.length === 0) return "";
  const lines = progress.map((p) => {
    const tool = p.currentTool ? ` [${p.currentTool}]` : "";
    const stats = [
      p.toolCount > 0 ? p.toolCount + " tools" : "",
      p.tokens > 0 ? Math.round(p.tokens / 1000) + "k tok" : "",
    ].filter(Boolean).join(" · ");
    return p.agent + tool + (stats ? " " + stats : "");
  });
  return lines.join("\n");
}

function formatResultsSummary(results: SubagentResult[]): string {
  const lines = results.map((r) => {
    const status = r.exitCode === 0 ? "✓" : "✗";
    const summary = r.progressSummary
      ? `${r.progressSummary.toolCount} tools · ${Math.round(r.progressSummary.tokens / 1000)}k tok · ${Math.round(r.progressSummary.durationMs / 1000)}s`
      : "";
    return `${status} ${r.agent}${summary ? " " + summary : ""}`;
  });
  return lines.join("\n");
}

// ── Command registration ────────────────────────────────────────────────────

export function registerAgentsCommand(pi: ExtensionAPI): void {
  pi.registerCommand("agents", {
    description: "Open the Agents Manager",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      // Lazy-load: 1689-line TUI component only needed when /agents is invoked
      const { createAgentManager } = await import("./agent-manager.js");
      const { global: globalAgents, user, project, globalDir, userDir, projectDir } = discoverAgentsAll(ctx.cwd);

      const availableModels = ctx.modelRegistry.getAvailable().map((m) => ({
        id: m.id,
        provider: m.provider,
        fullId: `${m.provider}/${m.id}`,
      }));

      const availableTools = pi.getAllTools().map((t) => ({
        name: t.name,
        description: t.description ?? "",
      }));

      await ctx.ui.custom<void>(
        (tui: TUI, theme: Theme, _keybindings, done: () => void) => {
          return createAgentManager(globalAgents, user, project, globalDir, userDir, projectDir, tui, theme, done, availableModels, availableTools);
        },
        { overlay: true, overlayOptions: OVERLAY_CHROME },
      );
    },
  });
}

// ── Default export ──────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
  registerSubagent(pi);
}
