import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text, type TUI } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { SUBAGENT_PARAMS_SCHEMA } from "./tool-schema.js";
import { executeSubagent, executeParallel } from "./execute.js";
import { formatParallelResults, formatSingleResult } from "./format.js";
// agent-manager.js lazy-loaded below to keep subagent tool registration fast
import { renderSubagentResult } from "./render.js";
import { OVERLAY_CHROME } from "@pi-archimedes/core/overlay";
import { renderToolHeader } from "@pi-archimedes/core/tool-render";
import { reportPiSupport } from "@pi-archimedes/core/pi-support";
import { diag, describeError } from "@pi-archimedes/core/log";
import { discoverAgents, discoverAgentsAll, findAgent, formatAgentList } from "./agents.js";
import { validateModel, firstError } from "./model-validation.js";
import {
  unknownToolEntries,
  formatUnknownToolsWarning,
} from "./tool-validation.js";
import { toNativeUsage, sumNativeUsage } from "./usage.js";
import type {
  SubagentDetails,
  SubagentProgress,
  SubagentResult,
  SubagentToolResult,
} from "./types.js";

// ── Theme helper type for render functions ──────────────────────────────────

interface RenderTheme {
  fg: (token: string, text: string) => string;
  bold: (text: string) => string;
}

// ── Tool registration ───────────────────────────────────────────────────────

export function registerSubagent(pi: ExtensionAPI): void {
  // Floor check before anything that can fail (ADR 0026). This package spawns
  // pi with flags and reads event fields that only behave correctly on 1.x
  // (`--tools` semantics, `agent_settled.aborted`, print-mode exit codes), and a
  // peer range cannot say so at install time. Warn and register anyway — the
  // tool must still show up in /plugins. Entry point for both meta and the
  // standalone default export, so `registerAgentsCommand` needs no second call.
  reportPiSupport("subagent", "1.2.0");

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
          // A `tools:` list the config read rejected is never applied, so the task
          // cannot run as configured — say so before anything spawns.
          if (taskAgentConfig?.toolsError) errors.push(taskAgentConfig.toolsError);
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
        // Membership only becomes knowable here, with the handle in scope — and
        // it is a warning, so the batch still runs (see warnUnavailableTools).
        const warnedTools = new Set<string>();
        for (const t of params.tasks) {
          warnUnavailableTools(
            pi,
            ctx,
            warnedTools,
            t.agent ?? "subagent",
            t.agent ? findAgent(agents, t.agent)?.tools : undefined,
          );
        }
        const results: SubagentResult[] = await executeParallel({
          tasks: params.tasks.map((t) => ({
            agent: t.agent ?? undefined,
            agentConfig: t.agent ? findAgent(agents, t.agent) : undefined,
            task: t.task,
            model: t.model,
            activeModel: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
            cwd: t.cwd ?? undefined,
            // All N tasks share the single subagent tool-call's id (the frame
            // carries it for Client correlation).
            toolCallId: _id,
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

        const nativeUsage = sumNativeUsage(results);
        return {
          content: [{ type: "text", text: formatParallelResults(results) }],
          ...(nativeUsage ? { usage: nativeUsage } : {}),
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
        // A rejected `tools:` list is a config error, not a runtime one: the child
        // would run with a different tool set than the config asked for, so it
        // does not run at all.
        if (agentConfig?.toolsError) {
          return {
            content: [{ type: "text", text: agentConfig.toolsError }],
            details: { mode: "single", results: [], progress: undefined },
            isError: true,
          };
        }
        warnUnavailableTools(pi, ctx, new Set(), params.agent ?? "subagent", agentConfig?.tools);
        const result: SubagentResult = await executeSubagent({
          agent: params.agent ?? undefined,
          agentConfig,
          task: params.task,
          model: params.model,
          activeModel: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
          cwd: params.cwd ?? undefined,
          signal: signal ?? undefined,
          toolCallId: _id,
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
          content: [{ type: "text", text: formatSingleResult(result) }],
          // The cost report — but only for a run this session performed. A
          // bridge-dispatched run is a session of the desktop's own and books
          // its usage there; pi folds a tool result's `usage` into THIS
          // session's totals, so publishing it here would count the money twice
          // (the same reason the `COST_UPDATE` route was deleted).
          ...(result.usageAccountedElsewhere ? {} : { usage: toNativeUsage(result.usage) }),
          details: {
            mode: "single",
            results: [result],
            progress: result.progress ? [result.progress] : undefined,
          },
          // Only a *failed* run is a tool error. A truncated answer and a
          // cancelled one both produced something, and `isError` is how the model
          // and the Client decide to retry or give up (ADR 0028). `error` is the
          // predicate because the exit code is not one — a json child exits 0 for
          // an errored run — and `stream.ts` guarantees a failed run always
          // carries an explanation while a completed/truncated/aborted one never
          // does.
          isError: result.error !== undefined,
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

/**
 * Warn (never fail) about allowlist entries no registered tool satisfies right
 * now, naming each one.
 *
 * Membership cannot be checked any earlier: `pi.getAllTools()` needs this
 * handle, and the config read is pure filesystem. And it must not fail the run:
 * a legitimate name is missing whenever its plugin is toggled off or its MCP
 * server is disconnected, so a hard error would make `tools: web_search` unusable
 * for anyone who disabled `web`. One warning per entry per tool call — a parallel
 * batch of eight agents sharing a list warns once, not eight times.
 *
 * Diagnostics go to `diag()` because a `console.*` write is discarded by a
 * subagent child and smears the fullscreen frame (see `core/log.ts`); the
 * on-screen copy only goes out where there is a UI to receive it.
 */
function warnUnavailableTools(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  alreadyWarned: Set<string>,
  agentName: string,
  tools: string[] | undefined,
): void {
  if (!tools || tools.length === 0) return;
  let unknown: string[];
  try {
    const known = pi.getAllTools().map((t) => t.name);
    unknown = unknownToolEntries(tools, known).filter((entry) => !alreadyWarned.has(entry));
  } catch (e) {
    // A handle that cannot answer is not a reason to lose the dispatch.
    diag("subagent", `tool-membership check skipped for "${agentName}": ${describeError(e)}`);
    return;
  }
  if (unknown.length === 0) return;
  for (const entry of unknown) alreadyWarned.add(entry);
  const message = formatUnknownToolsWarning(agentName, unknown);
  diag("subagent", message);
  if (!ctx.hasUI) return;
  try {
    ctx.ui.notify(message, "warning");
  } catch {
    // A context too stale to notify must not fail the run it is only warning about.
  }
}

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
