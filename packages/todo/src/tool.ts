import { type Static, StringEnum, Type } from "@earendil-works/pi-ai";
import type { AgentToolResult, ExtensionContext, Theme, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { getBus, Events } from "@pi-archimedes/core/bus";
import { renderToolHeader, renderStatusLabel } from "@pi-archimedes/core/tool-render";
import { prepareTodoArguments } from "./prepare-args.js";
import type { TodoStateManager } from "./state-manager.js";
import { STATUS_ICONS } from "./types.js";
import type { TodoDetails } from "./types.js";

const TodoItemSchema = Type.Object({
  id: Type.Number({ description: "Unique identifier for the todo. Use sequential numbers starting from 1." }),
  title: Type.String({ description: "Concise action-oriented todo label (3-7 words). Displayed in UI." }),
  description: Type.String({
    description: "Detailed context, requirements, or implementation notes. Include file paths, specific methods, or acceptance criteria.",
  }),
  status: StringEnum(["not-started", "in-progress", "completed"] as const, {
    description: "not-started: Not begun | in-progress: Currently working (multiple allowed for parallel work) | completed: Fully finished with no blockers",
  }),
});

export const ManageTodoListParams = Type.Object({
  operation: StringEnum(["write", "read"] as const, {
    description: "write: Replace entire todo list with new content. read: Retrieve current todo list. ALWAYS provide complete list when writing - partial updates not supported.",
  }),
  todoList: Type.Optional(
    Type.Array(TodoItemSchema, {
      description: "Complete array of all todo items (required for write operation, ignored for read). Must include ALL items - both existing and new.",
    })
  ),
});

export type ManageTodoListInput = Static<typeof ManageTodoListParams>;

export const TOOL_DESCRIPTION = `Manage a structured todo list to track progress and plan tasks throughout your coding session. Use this tool VERY frequently to ensure task visibility and proper planning.

When to use this tool:
- Complex multi-step work requiring planning and tracking
- When user provides multiple tasks or requests (numbered, comma-separated)
- After receiving new instructions that require multiple steps
- BEFORE starting work on any todo (mark as in-progress)
- IMMEDIATELY after completing each todo (mark completed individually)
- When breaking down larger tasks into smaller actionable steps
- To give users visibility into your progress and planning

When NOT to use:
- Single, trivial tasks that can be completed in one step
- Purely conversational/informational requests
- When just reading files or performing simple searches

CRITICAL workflow:
1. Plan tasks by writing todo list with specific, actionable items
2. Mark todo(s) as in-progress before starting work
3. Complete the work for that specific todo
4. Mark that todo as completed IMMEDIATELY
5. Move to next todo and repeat

Todo states:
- not-started: Todo not yet begun
- in-progress: Currently working (multiple allowed for parallel work/subagents)
- completed: Finished successfully

IMPORTANT: Mark todos completed as soon as they are done. Do not batch completions.
When all todos are completed, the list auto-clears after a brief delay.`;

export function createManageTodoListTool(state: TodoStateManager, onUpdate: () => void) {
  return {
    name: "manage_todo_list",
    label: "Todo List",
    description: TOOL_DESCRIPTION,
    parameters: ManageTodoListParams,

    // Repair common model mistakes (stringified arrays, missing
    // title/status, bare-string items) BEFORE schema validation. See
    // prepare-args.ts.
    prepareArguments: prepareTodoArguments,

    async execute(
      _toolCallId: string,
      params: ManageTodoListInput,
      _signal: AbortSignal | undefined,
      _onStreamUpdate: undefined,
      _ctx: ExtensionContext
    ) {
      if (params.operation === "read") {
        const todos = state.read();
        return {
          content: [
            {
              type: "text" as const,
              text: todos.length
                ? JSON.stringify(todos, null, 2)
                : "No todos. Use write operation to create a todo list.",
            },
          ],
          details: { operation: "read", todos } as TodoDetails,
        };
      }

      // write
      const todoList = params.todoList;
      if (!todoList || !Array.isArray(todoList)) {
        return {
          content: [{ type: "text" as const, text: "Error: todoList is required for write operation." }],
          details: { operation: "write", todos: state.read(), error: "todoList required" } as TodoDetails,
          isError: true,
        };
      }

      const validation = state.validate(todoList);
      if (!validation.valid) {
        return {
          content: [{ type: "text" as const, text: `Validation failed:\n${validation.errors.map((e) => `  - ${e}`).join("\n")}` }],
          details: { operation: "write", todos: state.read(), error: validation.errors.join("; ") } as TodoDetails,
          isError: true,
        };
      }

      state.write(todoList);
      onUpdate();

      // Emit bus event for widget update
      try {
        getBus().emit(Events.TODOS_UPDATE, { source: "main", todos: state.read() });
      } catch {
        // Bus may not be initialized in subagent child process — ignore
      }

      const stats = state.getStats();
      const todos = state.read();

      let message = `Todos have been modified successfully. ${stats.completed}/${stats.total} completed. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable.`;

      if (todoList.length < 3) {
        message += `\n\nWarning: Small todo list (<3 items). This task might not need a todo list.`;
      }

      return {
        content: [{ type: "text" as const, text: message }],
        details: { operation: "write", todos } as TodoDetails,
      };
    },

    renderCall(args: ManageTodoListInput, theme: Theme) {
      return new Text(renderToolHeader("todo", args.operation, theme), 0, 0);
    },

    renderResult(
      result: AgentToolResult<TodoDetails | undefined>,
      { expanded, isPartial }: ToolRenderResultOptions,
      theme: Theme
    ) {
      const details = result.details;

      // No `details` means execute() never ran — the harness produced this
      // result (schema-validation failure, blocked call, abort). Collapsed,
      // show a single red ✗ line; the full message is revealed on expand.
      if (!details) {
        const first = result.content[0];
        const text = first && "text" in first && typeof first.text === "string" ? first.text : "";
        if (!expanded) {
          const label = /validation failed for tool/i.test(text)
            ? "invalid arguments"
            : text.replace(/\s+/g, " ").trim().slice(0, 100);
          return new Text(label ? renderStatusLabel("error", label, theme) : "", 0, 0);
        }
        return new Text(text, 0, 0);
      }

      if (details.error) {
        return new Text(renderStatusLabel("error", details.error, theme), 0, 0);
      }

      const todos = details.todos;
      const completed = todos.filter((t) => t.status === "completed").length;
      const total = todos.length;
      const label = `${completed}/${total} completed`;

      if (isPartial) {
        return new Text(renderStatusLabel("running", label, theme), 0, 0);
      }

      if (total === 0) {
        return new Text(theme.fg("dim", "No todos"), 0, 0);
      }

      let text = renderStatusLabel("success", label, theme);

      if (expanded) {
        for (const todo of todos) {
          const iconChar = STATUS_ICONS[todo.status] ?? "?";
          const icon =
            todo.status === "completed"
              ? theme.fg("success", iconChar)
              : todo.status === "in-progress"
                ? theme.fg("warning", iconChar)
                : theme.fg("dim", iconChar);
          const title =
            todo.status === "completed"
              ? theme.fg("dim", theme.strikethrough(todo.title))
              : todo.status === "in-progress"
                ? theme.fg("warning", todo.title)
                : theme.fg("muted", todo.title);
          text += `\n  ${icon} ${theme.fg("accent", `${todo.id}.`)} ${title}`;
        }
      }

      return new Text(text, 0, 0);
    },
  };
}
