import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { executeSubagent, executeParallel } from "./execute.js";
import { renderSubagentResult } from "./render.js";
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
  count: Type.Optional(Type.Number()),
  model: Type.Optional(Type.String()),
  cwd: Type.Optional(Type.String()),
});

const SUBAGENT_PARAMS_SCHEMA = Type.Object({
  agent: Type.Optional(Type.String({
    description: "Agent name/identifier (optional, defaults to 'general')",
  })),
  task: Type.Optional(Type.String({
    description: "Task description for the subagent",
  })),
  tasks: Type.Optional(Type.Array(TaskItem, {
    description: "Multiple tasks for parallel execution",
  })),
  model: Type.Optional(Type.String({
    description: "Model override (e.g. 'anthropic/claude-sonnet-4')",
  })),
  async: Type.Optional(Type.Boolean({
    description: "Run asynchronously (fire-and-forget)",
  })),
  context: Type.Optional(Type.Union([Type.Literal("fresh"), Type.Literal("fork")], {
    description: "Session context mode",
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
      "Delegate tasks to subagents. Single: { agent, task }. Parallel: { tasks: [{ agent, task }] }. Options: model, cwd, context (fresh|fork).",
    parameters: SUBAGENT_PARAMS_SCHEMA,

    async execute(
      _id: string,
      params: {
        agent?: string;
        task?: string;
        tasks?: Array<{ agent?: string; task: string; count?: number; model?: string; cwd?: string }>;
        model?: string;
        context?: "fresh" | "fork";
        cwd?: string;
        async?: boolean;
      },
      signal: AbortSignal | undefined,
      onUpdate: ((update: SubagentToolResult) => void) | undefined,
      _ctx: ExtensionContext,
    ): Promise<SubagentToolResult> {
      // Parallel mode
      if (params.tasks && params.tasks.length > 0) {
        const results: SubagentResult[] = await executeParallel({
          tasks: params.tasks,
          signal,
          onUpdate: (progress: SubagentProgress[]) => {
            onUpdate?.({
              content: [{ type: "text", text: formatProgressSummary(progress) }],
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
          },
        };
      }

      // Single mode
      if (params.task) {
        const result: SubagentResult = await executeSubagent({
          agent: params.agent,
          task: params.task,
          model: params.model,
          cwd: params.cwd,
          context: params.context,
          signal,
          onUpdate: (progress: SubagentProgress) => {
            onUpdate?.({
              content: [{ type: "text", text: formatProgressSummary([progress]) }],
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
          },
          isError: result.exitCode !== 0,
        };
      }

      return {
        content: [{ type: "text", text: "Missing task parameter" }],
        details: {
          mode: "single",
          results: [],
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
      const expanded = ((context as Record<string, unknown>)?.expanded ??
        (options as Record<string, unknown>)?.expanded ??
        false) as boolean;

      const renderTheme = theme as unknown as RenderTheme;
      return renderSubagentResult(toolResult, { expanded }, renderTheme, context as any);
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
