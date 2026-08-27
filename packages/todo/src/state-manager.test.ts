import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { TodoStateManager } from "./state-manager.js";
import type { TodoItem, TodoStatus } from "./types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTodo(content: string, status: TodoStatus, description?: string): TodoItem {
  return description === undefined ? { content, status } : { content, status, description };
}

// ── TodoStateManager ────────────────────────────────────────────────────────

describe("TodoStateManager", () => {
  let manager: TodoStateManager;

  beforeEach(() => {
    manager = new TodoStateManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("read", () => {
    it("returns empty array initially", () => {
      expect(manager.read()).toEqual([]);
    });

    it("returns copy (mutations don't affect internal state)", () => {
      manager.write([makeTodo("Task", "pending")]);
      const copy = manager.read();
      copy.push(makeTodo("Injected", "pending"));
      expect(manager.read()).toHaveLength(1);
    });
  });

  describe("write", () => {
    it("stores todos correctly", () => {
      manager.write([
        makeTodo("Task 1", "pending"),
        makeTodo("Task 2", "in_progress"),
      ]);
      expect(manager.read()).toHaveLength(2);
      expect(manager.read()[0]?.content).toBe("Task 1");
      expect(manager.read()[1]?.status).toBe("in_progress");
    });

    it("with all completed schedules auto-clear", () => {
      manager.write([makeTodo("Done", "completed")]);
      expect(manager.read()).toHaveLength(1);
      vi.advanceTimersByTime(2000);
      expect(manager.read()).toHaveLength(0);
    });

    it("does not schedule auto-clear when not all completed", () => {
      manager.write([
        makeTodo("Done", "completed"),
        makeTodo("Pending", "pending"),
      ]);
      vi.advanceTimersByTime(2000);
      expect(manager.read()).toHaveLength(2);
    });
  });

  describe("clear", () => {
    it("empties todos", () => {
      manager.write([makeTodo("Task", "pending")]);
      manager.clear();
      expect(manager.read()).toEqual([]);
    });
  });

  describe("getStats", () => {
    it("computes correct counts incl. pending", () => {
      manager.write([
        makeTodo("A", "pending"),
        makeTodo("B", "in_progress"),
        makeTodo("C", "completed"),
        makeTodo("D", "completed"),
      ]);
      expect(manager.getStats()).toEqual({
        total: 4,
        completed: 2,
        inProgress: 1,
        pending: 1,
      });
    });

    it("returns zero stats for empty list", () => {
      expect(manager.getStats()).toEqual({
        total: 0,
        completed: 0,
        inProgress: 0,
        pending: 0,
      });
    });
  });

  describe("validate", () => {
    it("accepts canonical items with optional description", () => {
      const result = manager.validate([
        { content: "Task", status: "pending" },
        { content: "Task 2", status: "in_progress", description: "desc" },
        { content: "Task 3", status: "completed" },
      ]);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("rejects empty content", () => {
      const result = manager.validate([{ content: "  ", status: "pending" }]);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("content"))).toBe(true);
    });

    it("rejects missing content", () => {
      const result = manager.validate([{ status: "pending" } as unknown as TodoItem]);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("content"))).toBe(true);
    });

    it("rejects dashed legacy statuses (validate stays canonical-strict)", () => {
      const result = manager.validate([{ content: "Test", status: "in-progress" } as unknown as TodoItem]);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("pending, in_progress, completed"))).toBe(true);
    });

    it("rejects non-string description", () => {
      const result = manager.validate([{ content: "x", status: "pending", description: 42 } as unknown as TodoItem]);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("description"))).toBe(true);
    });

    it("rejects undefined items", () => {
      const result = manager.validate([undefined, { content: "x", status: "pending" }] as unknown as TodoItem[]);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("undefined item"))).toBe(true);
    });

    it("catches non-array input", () => {
      const result = manager.validate("not an array" as unknown as TodoItem[]);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toBe("todoList must be an array");
    });

    it("property: validate(write(x)).valid === true after write (round-trip)", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              content: fc.string({ minLength: 1, maxLength: 50 }),
              description: fc.string({ minLength: 0, maxLength: 100 }),
              status: fc.oneof(fc.constant("pending"), fc.constant("in_progress"), fc.constant("completed")),
            }),
          ),
          (todos) => {
            const mgr = new TodoStateManager();
            mgr.write(todos.filter((t) => t.content.trim() !== "") as TodoItem[]);
            const readTodos = mgr.read();
            const result = mgr.validate(readTodos);
            if (!result.valid) {
              throw new Error(`Round-trip validation failed: ${JSON.stringify(result.errors)}`);
            }
          },
        ),
        { verbose: false },
      );
    });
  });

  describe("loadFromSession", () => {
    function fakeCtx(branch: unknown[]): unknown {
      return { sessionManager: { getBranch: () => branch } };
    }

    function toolResultEntry(details: unknown): unknown {
      return { type: "message", message: { role: "toolResult", toolName: "manage_todo_list", details } };
    }

    it("normalizes legacy persisted items to canonical shape (id dropped)", () => {
      const ctx = fakeCtx([
        toolResultEntry({
          todos: [{ id: 1, title: "Old", status: "not-started" }],
        }),
      ]);
      manager.loadFromSession(ctx as never);
      expect(manager.read()).toEqual([{ content: "Old", status: "pending" }]);
    });

    it("keeps current canonical items verbatim", () => {
      const ctx = fakeCtx([
        toolResultEntry({
          todos: [
            { content: "A", status: "in_progress" },
            { content: "B", status: "completed", description: "d" },
          ],
        }),
      ]);
      manager.loadFromSession(ctx as never);
      expect(manager.read()).toEqual([
        { content: "A", status: "in_progress" },
        { content: "B", status: "completed", description: "d" },
      ]);
    });

    it("ignores other tools and non-message entries", () => {
      const ctx = fakeCtx([
        { type: "message", message: { role: "toolResult", toolName: "run_read", details: { todos: [] } } },
        toolResultEntry({ todos: [{ content: "X", status: "pending" }] }),
      ]);
      manager.loadFromSession(ctx as never);
      expect(manager.read()).toEqual([{ content: "X", status: "pending" }]);
    });

    it("ignores unrecoverable persisted entries (leaves earlier state)", () => {
      const ctx = fakeCtx([
        toolResultEntry({ todos: [{ content: "Good", status: "pending" }] }),
        toolResultEntry({ todos: "a bare string" }),
      ]);
      manager.loadFromSession(ctx as never);
      expect(manager.read()).toEqual([{ content: "Good", status: "pending" }]);
    });
  });
});
