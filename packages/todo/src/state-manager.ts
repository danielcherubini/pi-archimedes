import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TodoItem, TodoStats, ValidationResult } from "./types.js";

/** Manages the in-memory todo list state. */
export class TodoStateManager {
  private todos: TodoItem[] = [];
  private autoClearTimer: ReturnType<typeof setTimeout> | undefined;

  read(): TodoItem[] {
    return [...this.todos];
  }

  write(todos: TodoItem[]): void {
    this.cancelAutoClear();
    this.todos = todos.map((t) => ({ ...t }));
    // If all completed and non-empty, schedule auto-clear
    if (todos.length > 0 && todos.every((t) => t.status === "completed")) {
      this.scheduleAutoClear(() => this.clear());
    }
  }

  clear(): void {
    this.cancelAutoClear();
    this.todos = [];
  }

  getStats(): TodoStats {
    const total = this.todos.length;
    const completed = this.todos.filter((t) => t.status === "completed").length;
    const inProgress = this.todos.filter((t) => t.status === "in-progress").length;
    const notStarted = this.todos.filter((t) => t.status === "not-started").length;
    return { total, completed, inProgress, notStarted };
  }

  validate(todos: TodoItem[]): ValidationResult {
    const errors: string[] = [];
    if (!Array.isArray(todos)) {
      return { valid: false, errors: ["todoList must be an array"] };
    }
    const validStatuses = new Set(["not-started", "in-progress", "completed"]);
    for (let i = 0; i < todos.length; i++) {
      const item = todos[i];
      const prefix = `Item ${i + 1}`;
      if (!item) {
        errors.push(`${prefix}: undefined item`);
        continue;
      }
      if (item.id == null) {
        errors.push(`${prefix}: missing 'id'`);
      } else if (typeof item.id !== "number") {
        errors.push(`${prefix}: 'id' must be a number`);
      }
      if (!item.title || typeof item.title !== "string") {
        errors.push(`${prefix}: missing or invalid 'title'`);
      }
      if (!item.description || typeof item.description !== "string") {
        errors.push(`${prefix}: missing or invalid 'description'`);
      }
      if (!item.status || !validStatuses.has(item.status)) {
        errors.push(`${prefix}: 'status' must be one of: not-started, in-progress, completed`);
      }
    }
    return { valid: errors.length === 0, errors };
  }

  loadFromSession(ctx: ExtensionContext): void {
    this.todos = [];
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role !== "toolResult" || msg.toolName !== "manage_todo_list") continue;
      const details = msg.details as { todos?: TodoItem[] } | undefined;
      if (details?.todos) {
        this.todos = details.todos.map((t) => ({ ...t }));
      }
    }
  }

  scheduleAutoClear(callback: () => void): void {
    this.cancelAutoClear();
    this.autoClearTimer = setTimeout(() => {
      this.autoClearTimer = undefined;
      callback();
    }, 2000);
  }

  cancelAutoClear(): void {
    if (this.autoClearTimer) {
      clearTimeout(this.autoClearTimer);
      this.autoClearTimer = undefined;
    }
  }
}
