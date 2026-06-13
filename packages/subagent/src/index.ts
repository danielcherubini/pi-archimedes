import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { executeSubagent, executeParallel } from "./execute.js";
import { renderSubagentResult } from "./render.js";
import { discoverAgents, discoverAgentsAll, findAgent } from "./agents.js";
import type {
  SubagentDetails,
  SubagentProgress,
  SubagentResult,
  SubagentToolResult,
} from "./types.js";

// ── JSON Schema for tool parameters (TypeBox) ──────────────────────────────

const TaskItem = Type.Object({
  agent: Type.Optional(Type.String()),
  task: Type.String(),
  model: Type.Optional(Type.String()),
  cwd: Type.Optional(Type.String()),
});

const SUBAGENT_PARAMS_SCHEMA = Type.Object({
  agent: Type.Optional(Type.String({
    description: "Agent name/identifier (optional, defaults to 'general')",
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
      "Delegate tasks to subagents. Provide either 'task' (single) or 'tasks' (parallel). Never omit both. Options: agent, model, cwd.",
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
      // Discover available agents
      const agents = discoverAgents(ctx.cwd);

      // Parallel mode
      if (params.tasks && params.tasks.length > 0) {
        const missingAgents = params.tasks.filter((t) => t.agent && !findAgent(agents, t.agent));
        if (missingAgents.length > 0) {
          const available = agents.map((a) => a.name).join(", ") || "none";
          const unknown = missingAgents.map((t) => `"${t.agent}"`).join(", ");
          return {
            content: [{ type: "text", text: `Unknown agent(s): ${unknown}. Available: ${available}` }],
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
            // Fall back to the parent's currently-selected model when the caller
            // (and the agent frontmatter) didn't specify one.
            model: t.model ?? ctx.model?.id,
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
            progress: results.map(r => r.progress).filter(Boolean) as SubagentProgress[] | undefined,
          },
        };
      }

      // Single mode
      if (params.task) {
        let agentConfig = params.agent ? findAgent(agents, params.agent) : undefined;
        if (params.agent && !agentConfig) {
          const available = agents.map((a) => a.name).join(", ") || "none";
          return {
            content: [{ type: "text", text: `Unknown agent: "${params.agent}". Available: ${available}` }],
            details: {
              mode: "single",
              results: [],
              progress: undefined,
            },
            isError: true,
          };
        }
        const result: SubagentResult = await executeSubagent({
          agent: params.agent ?? undefined,
          agentConfig,
          task: params.task,
          // Fall back to the parent's currently-selected model when the caller
          // (and the agent frontmatter) didn't specify one.
          model: params.model ?? ctx.model?.id,
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
        const label = theme.fg("toolTitle", theme.bold("subagent")) + " " + tasks.length + " tasks";
        text.setText(label);
      } else if (agent) {
        const label = theme.fg("toolTitle", theme.bold("subagent")) + " " + theme.fg("accent", agent);
        text.setText(label);
      } else {
        text.setText(theme.fg("toolTitle", theme.bold("subagent")));
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
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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

// ── Default export ──────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
  registerSubagent(pi);
}
