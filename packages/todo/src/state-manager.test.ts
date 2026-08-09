import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { TodoStateManager } from "./state-manager.js";
import type { TodoItem } from "./types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTodo(id: number, title: string, description: string, status: TodoItem["status"]): TodoItem {
  return { id, title, description, status };
}

// ── TodoStateManager ────────────────────────────────────────────────────────

describe("TodoStateManager", () => {
  let manager: TodoStateManager;

  beforeEach(() => {
    manager = new TodoStateManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("read", () => {
    it("returns empty array initially", () => {
      expect(manager.read()).toEqual([]);
    });

    it("returns copy (mutations don't affect internal state)", () => {
      manager.write([makeTodo(1, "Test", "desc", "not-started")]);
      const copy = manager.read();
      copy.push(makeTodo(2, "Injected", "desc", "not-started"));
      expect(manager.read()).toHaveLength(1);
    });
  });

  describe("write", () => {
    it("stores todos correctly", () => {
      manager.write([
        makeTodo(1, "Task 1", "desc 1", "not-started"),
        makeTodo(2, "Task 2", "desc 2", "in-progress"),
      ]);
      expect(manager.read()).toHaveLength(2);
      expect(manager.read()[0]?.title).toBe("Task 1");
      expect(manager.read()[1]?.status).toBe("in-progress");
    });

    it("with all completed schedules auto-clear", () => {
      let cleared = false;
      manager.write([makeTodo(1, "Done", "desc", "completed")]);
      expect(manager.read()).toHaveLength(1);
      vi.advanceTimersByTime(2000);
      expect(manager.read()).toHaveLength(0);
    });

    it("does not schedule auto-clear when not all completed", () => {
      manager.write([
        makeTodo(1, "Done", "desc", "completed"),
        makeTodo(2, "Pending", "desc", "not-started"),
      ]);
      vi.advanceTimersByTime(2000);
      expect(manager.read()).toHaveLength(2);
    });
  });

  describe("clear", () => {
    it("empties todos", () => {
      manager.write([makeTodo(1, "Task", "desc", "not-started")]);
      manager.clear();
      expect(manager.read()).toEqual([]);
    });
  });

  describe("getStats", () => {
    it("computes correct counts", () => {
      manager.write([
        makeTodo(1, "A", "desc", "not-started"),
        makeTodo(2, "B", "desc", "in-progress"),
        makeTodo(3, "C", "desc", "completed"),
        makeTodo(4, "D", "desc", "completed"),
      ]);
      expect(manager.getStats()).toEqual({
        total: 4,
        completed: 2,
        inProgress: 1,
        notStarted: 1,
      });
    });

    it("returns zero stats for empty list", () => {
      expect(manager.getStats()).toEqual({
        total: 0,
        completed: 0,
        inProgress: 0,
        notStarted: 0,
      });
    });
  });

  describe("validate", () => {
    it("catches missing fields", () => {
      const result = manager.validate([{ id: 1, title: "", description: "", status: "" } as any]);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("catches invalid status values", () => {
      const result = manager.validate([{ id: 1, title: "Test", description: "desc", status: "invalid" } as any]);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("status");
    });

    it("catches non-array input", () => {
      const result = manager.validate("not an array" as any);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toBe("todoList must be an array");
    });

    it("accepts valid input", () => {
      const result = manager.validate([
        makeTodo(1, "Task", "desc", "not-started"),
        makeTodo(2, "Task 2", "desc", "in-progress"),
        makeTodo(3, "Task 3", "desc", "completed"),
      ]);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("property: validate(write(x)).valid === true after write (round-trip)", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.nat({ max: 1000 }),
              title: fc.string({ minLength: 1, maxLength: 50 }),
              description: fc.string({ minLength: 1, maxLength: 100 }),
              status: fc.oneof(fc.constant("not-started"), fc.constant("in-progress"), fc.constant("completed")),
            }),
          ),
          (todos) => {
            const mgr = new TodoStateManager();
            mgr.write(todos as TodoItem[]);
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
});
