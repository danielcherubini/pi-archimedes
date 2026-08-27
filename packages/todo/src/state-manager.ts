import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { normalizeTodoItems } from "./prepare-args.js";
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
    const inProgress = this.todos.filter((t) => t.status === "in_progress").length;
    const pending = this.todos.filter((t) => t.status === "pending").length;
    return { total, completed, inProgress, pending };
  }

  validate(todos: TodoItem[]): ValidationResult {
    const errors: string[] = [];
    if (!Array.isArray(todos)) {
      return { valid: false, errors: ["todoList must be an array"] };
    }
    const validStatuses = new Set(["pending", "in_progress", "completed"]);
    for (let i = 0; i < todos.length; i++) {
      const item = todos[i];
      const prefix = `Item ${i + 1}`;
      if (!item) {
        errors.push(`${prefix}: undefined item`);
        continue;
      }
      if (typeof item.content !== "string" || item.content.trim() === "") {
        errors.push(`${prefix}: missing or invalid 'content'`);
      }
      if (typeof item.status !== "string" || !validStatuses.has(item.status)) {
        errors.push(`${prefix}: 'status' must be one of: pending, in_progress, completed`);
      }
      if (item.description !== undefined && typeof item.description !== "string") {
        errors.push(`${prefix}: 'description' must be a string`);
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
      const details = msg.details as { todos?: unknown } | undefined;
      // Legacy persisted items (id/title/not-started) and newer canonical
      // items both go through the same normalizer. Unrecoverable entries
      // leave state untouched for that entry.
      const items = normalizeTodoItems(details?.todos);
      if (items) {
        this.todos = items.map((t) => ({ ...t }));
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
