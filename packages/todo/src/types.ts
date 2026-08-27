/**
 * Core types for the todo list extension.
 */

/** Status of a single todo item (Claude Code aligned). */
export type TodoStatus = "pending" | "in_progress" | "completed";

/** A single todo item. No `id` — display numbering is array position. */
export interface TodoItem {
  /** Short imperative label of the task (3-10 words). Displayed in UI. */
  content: string;
  /** Optional detailed context: file paths, methods, acceptance criteria. */
  description?: string;
  /** Current status. */
  status: TodoStatus;
}

/** Stored in tool result details for session persistence */
export interface TodoDetails {
  operation: "read" | "write";
  todos: TodoItem[];
  error?: string;
}

/** Stats about the current todo list */
export interface TodoStats {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
}

/** Validation result */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Status icons for each todo state */
export const STATUS_ICONS: Record<TodoStatus, string> = {
  completed: "✓",
  in_progress: "◉ ",
  pending: "○",
};
