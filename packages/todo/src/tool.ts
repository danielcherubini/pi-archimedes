import { Type, type Static } from "typebox";
import type { AgentToolResult, EventBus, ExtensionContext, Theme, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Events, emitOn } from "@pi-archimedes/core/events";
import { renderToolHeader, renderStatusLabel } from "@pi-archimedes/core/tool-render";
import { prepareTodoArguments } from "./prepare-args.js";
import type { TodoStateManager } from "./state-manager.js";
import { STATUS_ICONS } from "./types.js";
import type { TodoDetails, TodoItem, TodoStatus } from "./types.js";

/**
 * pi-ai shipped this helper; typebox has no equivalent, and pi 1.5.0 dropped
 * pi-ai's typebox re-exports, so the suite no longer takes schema symbols from
 * the host. Emits the identical JSON Schema: { type: "string", enum: [...] }.
 * pi-ai's version also accepted a `default`; no caller here does, so it is not
 * carried.
 */
function StringEnum<T extends readonly string[]>(
  values: readonly [...T],
  options?: { description?: string },
) {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: [...values],
    ...(options?.description ? { description: options.description } : {}),
  });
}

const TodoItemSchema = Type.Object({
  content: Type.String({
    description: "Short imperative label for the task (3-10 words). Displayed in UI. Example: \"Fix the auth middleware\".",
  }),
  status: StringEnum(["pending", "in_progress", "completed"] as const, {
    description: "pending: Not begun | in_progress: Currently working (multiple allowed for parallel work/subagents) | completed: Fully finished with no blockers",
  }),
  description: Type.Optional(Type.String({
    description: "Optional detailed context: file paths, specific methods, or acceptance criteria.",
  })),
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

/**
 * The machine-readable result, for programmatic callers.
 *
 * `structuredContent` mirrors `details` on success — the list as it now stands,
 * which is the whole answer for both operations. pi hands it to a codemode
 * script *instead of* the text, but only when the tool declares this schema, and
 * it never checks one against the other (`pi: dist/extensions/codemode/execute.js`,
 * `toScriptValue()`), so `tool.output-schema.test.ts` is the referee: it runs the
 * handler and validates the payload against this schema.
 *
 * Failure results carry none of it. pi's own `bash` does attach structured
 * content to a non-zero exit, because there the failing command *is* the
 * observation; here every failure is a call that produced no observation (no
 * list supplied, or a list the validator rejected), and pi's codemode script
 * keeps rejecting with the text — same as before this schema existed.
 */
const TodoItemOutputSchema = Type.Object({
  content: Type.String(),
  status: StringEnum(["pending", "in_progress", "completed"] as const),
  description: Type.Optional(Type.String()),
});

export const ManageTodoListOutput = Type.Object({
  /** Which operation ran; the shape is the same for both. */
  operation: StringEnum(["read", "write"] as const),
  /** The list as it stands after the call. */
  todos: Type.Array(TodoItemOutputSchema),
});

/**
 * The JSON-shaped copy of a stored item. `TodoItem` is an interface, which
 * TypeScript will not match against `JsonValue`'s index signature, and copying
 * also pins the payload to exactly the three fields the schema declares.
 */
type TodoItemOutput = { content: string; status: TodoStatus; description?: string };

function toOutputTodos(todos: TodoItem[]): TodoItemOutput[] {
  return todos.map((item) => ({
    content: item.content,
    status: item.status,
    ...(item.description !== undefined && { description: item.description }),
  }));
}

/** `{ operation, todos }` — the successful result of either operation. */
function todoOutput(operation: "read" | "write", todos: TodoItem[]): { operation: "read" | "write"; todos: TodoItemOutput[] } {
  return { operation, todos: toOutputTodos(todos) };
}

export const TOOL_DESCRIPTION = `Manage a structured todo list to track progress and plan tasks throughout your coding session. Use this tool VERY frequently to ensure task visibility and proper planning.

When to use this tool:
- Complex multi-step work requiring planning and tracking
- When user provides multiple tasks or requests (numbered, comma-separated)
- After receiving new instructions that require multiple steps
- BEFORE starting work on any todo (mark as in_progress)
- IMMEDIATELY after completing each todo (mark completed individually)
- When breaking down larger tasks into smaller actionable steps
- To give users visibility into your progress and planning

When NOT to use:
- Single, trivial tasks that can be completed in one step
- Purely conversational/informational requests
- When just reading files or performing simple searches

CRITICAL workflow:
1. Plan tasks by writing todo list with specific, actionable items
2. Mark todo(s) as in_progress before starting work
3. Complete the work for that specific todo
4. Mark that todo as completed IMMEDIATELY
5. Move to next todo and repeat

Todo item shape:
{"content": "Fix the auth middleware", "status": "pending", "description": "optional: file paths, acceptance criteria"}
- content: the short displayed label — do NOT assign ids (numbering is order)
- status: exactly one of pending | in_progress | completed

Todo states:
- pending: Todo not yet begun
- in_progress: Currently working (multiple allowed for parallel work/subagents)
- completed: Finished successfully

IMPORTANT: Mark todos completed as soon as they are done. Do not batch completions.
When all todos are completed, the list auto-clears after a brief delay.`;

/**
 * Build the `manage_todo_list` tool.
 *
 * @param events the caller's host handle (`pi.events`). The tool is a factory,
 *               not an extension, so it has no `pi` of its own — the handle is
 *               injected rather than reached for, which is what keeps the suite
 *               free of a `globalThis` bus. A child pi runs the same tool with
 *               its OWN handle, and its writes stay inside the child.
 */
export function createManageTodoListTool(state: TodoStateManager, onUpdate: () => void, events: EventBus) {
  return {
    name: "manage_todo_list",
    label: "Todo List",
    description: TOOL_DESCRIPTION,
    parameters: ManageTodoListParams,
    outputSchema: ManageTodoListOutput,

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
          structuredContent: todoOutput("read", todos),
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

      // Announce the new list on the handle: the bridge relays it to the
      // desktop as a `todos_update` frame (and any other in-process listener,
      // e.g. a second todo instance, sees the same payload). `onUpdate()` above
      // is the local widget path; this is the outward one.
      emitOn(events, Events.TODOS_UPDATE, { source: "main", todos: state.read() });

      const stats = state.getStats();
      const todos = state.read();

      let message = `Todos have been modified successfully. ${stats.completed}/${stats.total} completed. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable.`;

      if (todoList.length < 3) {
        message += `\n\nWarning: Small todo list (<3 items). This task might not need a todo list.`;
      }

      return {
        content: [{ type: "text" as const, text: message }],
        details: { operation: "write", todos } as TodoDetails,
        structuredContent: todoOutput("write", todos),
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

      // execute() always carries details.todos. Anything else — including
      // the harness' rejection results, which attach details: {} — means
      // execute() never ran (validation failure, blocked call, abort).
      // Collapsed, show a single red ✗ line; the full message on expand.
      if (!details || !Array.isArray(details.todos)) {
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
        for (let i = 0; i < todos.length; i++) {
          const todo = todos[i]!;
          const iconChar = (STATUS_ICONS[todo.status] ?? "?").trim();
          const icon =
            todo.status === "completed"
              ? theme.fg("success", iconChar)
              : todo.status === "in_progress"
                ? theme.fg("warning", iconChar)
                : theme.fg("dim", iconChar);
          const title =
            todo.status === "completed"
              ? theme.fg("dim", theme.strikethrough(todo.content ?? ""))
              : todo.status === "in_progress"
                ? theme.fg("warning", todo.content ?? "")
                : theme.fg("muted", todo.content ?? "");
          text += `\n  ${icon} ${theme.fg("accent", `${i + 1}.`)} ${title}`;
        }
      }

      return new Text(text, 0, 0);
    },
  };
}
