/**
 * Core types for the todo list extension.
 */

/** Status of a single todo item */
export type TodoStatus = "not-started" | "in-progress" | "completed";

/** A single todo item */
export interface TodoItem {
  /** Sequential identifier starting from 1 */
  id: number;
  /** Concise action-oriented label (3-7 words). Displayed in UI. */
  title: string;
  /** Detailed context, requirements, or implementation notes. */
  description: string;
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
  notStarted: number;
}

/** Validation result */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Status icons for each todo state */
export const STATUS_ICONS: Record<TodoStatus, string> = {
  "completed": "✓",
  "in-progress": "◉ ",
  "not-started": "○",
};
