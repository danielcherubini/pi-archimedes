import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getBus, Events } from "@pi-archimedes/core/bus";
import { TodoStateManager } from "./state-manager.js";
import { createManageTodoListTool } from "./tool.js";
import { updateWidget, clearWidget } from "./ui/todo-widget.js";
import type { TodoItem } from "./types.js";

export default function (pi: ExtensionAPI): void {
  registerTodo(pi);
}

export function registerTodo(pi: ExtensionAPI): void {
  const state = new TodoStateManager();
  const subagentTodos = new Map<string, TodoItem[]>();
  const unsubscribes: Array<() => void> = [];
  let currentCtx: ExtensionContext | undefined;

  const refreshWidget = () => {
    if (currentCtx) {
      updateWidget(state, currentCtx, subagentTodos);
    }
  };

  // Subscribe to bus events for subagent todos
  const unsubTodosUpdate = getBus().on(Events.TODOS_UPDATE, (payload: unknown) => {
    const data = payload as { source: string; todos: TodoItem[] };
    if (data.source === "main") return; // main handled locally
    subagentTodos.set(data.source, data.todos);
    refreshWidget();
  });
  unsubscribes.push(unsubTodosUpdate);

  const unsubTodosClear = getBus().on(Events.TODOS_CLEAR, (payload: unknown) => {
    const data = payload as { source: string };
    subagentTodos.delete(data.source);
    refreshWidget();
  });
  unsubscribes.push(unsubTodosClear);

  // Reconstruct state from session on load/resume/fork/tree
  const reconstructState = (ctx: ExtensionContext) => {
    currentCtx = ctx;
    state.loadFromSession(ctx);
    updateWidget(state, ctx, subagentTodos);
  };

  pi.on("session_start", async (_event, ctx) => reconstructState(ctx));
  pi.on("session_tree", async (_event, ctx) => reconstructState(ctx));

  // Keep ctx reference fresh on every turn
  pi.on("turn_start", async (_event, ctx) => {
    currentCtx = ctx;
  });

  // Update widget after each turn (in case tool was called)
  pi.on("turn_end", async (_event, ctx) => {
    currentCtx = ctx;
    updateWidget(state, ctx, subagentTodos);
  });

  // session_shutdown handler (top-level to prevent accumulation on /reload)
  pi.on("session_shutdown", (_event, _ctx) => {
    unsubscribes.forEach((unsub) => unsub());
    unsubscribes.length = 0;
    subagentTodos.clear();
    state.cancelAutoClear();
    if (currentCtx) {
      clearWidget(currentCtx);
    }
  });

  // Register the manage_todo_list tool
  const tool = createManageTodoListTool(state, refreshWidget);
  pi.registerTool(tool);

  // Register /todos command
  pi.registerCommand("todos", {
    description: "Toggle todo list widget or clear todos (/todos clear)",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      currentCtx = ctx;

      if (args?.trim().toLowerCase() === "clear") {
        state.clear();
        clearWidget(ctx);
        ctx.ui.notify("Todo list cleared.", "info");
        return;
      }

      const todos = state.read();
      if (todos.length === 0) {
        ctx.ui.notify("No todos. The LLM will create them when working on complex tasks.", "info");
      } else {
        updateWidget(state, ctx, subagentTodos);
        const stats = state.getStats();
        ctx.ui.notify(`${stats.completed}/${stats.total} todos completed.`, "info");
      }
    },
  });
}
