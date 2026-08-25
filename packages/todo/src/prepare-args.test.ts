import { describe, it, expect } from "vitest";
import {
  deriveTitleFromDescription,
  normalizeTodoItem,
  prepareTodoArguments,
} from "./prepare-args.js";

// Arguments captured (after JSON decoding) from real failing tool calls in
// archived sessions — the cases this module exists to repair.
const REAL_STRINGIFIED_LIST =
  '[{"id": 1", "title": "Catalog all undocumented env vars", "description": ' +
  '"Compare env vars from all K8s manifests against what is in AI-SETUP.md", ' +
  '"status": "completed"}, {"id": 2", "title": "Add K8s env vars section", ' +
  '"description": "Document all container-level env vars", ' +
  '"status": "in-progress"}]';

const REAL_MISSING_TITLE = {
  operation: "write",
  todoList: [
    { description: "Understand what c12d4a0 fixed and how the current base interacts with it", id: 1, status: "in-progress" },
    { description: "Trace user_api_key_auth() catch-all behaviour", id: 2, status: "not-started" },
  ],
};

const REAL_MISSING_STATUS = {
  operation: "write",
  todoList: [
    { id: 1, title: "Fix shell command interpolation", description: "fetchNewToken() builds cmd as string" },
    { id: 2, title: "Update tests", description: "add regression test" },
  ],
};

describe("prepareTodoArguments", () => {
  it("passes through already-valid arguments unchanged", () => {
    const input = {
      operation: "write",
      todoList: [
        { id: 1, title: "Task", description: "Desc", status: "in-progress" },
        { id: 2, title: "Other", description: "More", status: "completed" },
      ],
    } as const;
    expect(prepareTodoArguments(input)).toEqual(input);
  });

  it("passes non-object arguments through untouched", () => {
    for (const garbage of [null, undefined, 42, "write", [1, 2]]) {
      expect(prepareTodoArguments(garbage)).toBe(garbage);
    }
  });

  it("parses a stringified todoList (real-world case, incl. mangled quotes)", () => {
    const out = prepareTodoArguments({ operation: "write", todoList: REAL_STRINGIFIED_LIST });
    expect(out.operation).toBe("write");
    const list = out.todoList as Array<Record<string, unknown>>;
    expect(Array.isArray(list)).toBe(true);
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({ id: 1, title: "Catalog all undocumented env vars", description: "Compare env vars from all K8s manifests against what is in AI-SETUP.md", status: "completed" });
    expect(list[1]).toEqual({ id: 2, title: "Add K8s env vars section", description: "Document all container-level env vars", status: "in-progress" });
  });

  it("returns a stringified list it cannot parse, so the schema error still fires", () => {
    const out = prepareTodoArguments({ operation: "write", todoList: "[{ def 《" });
    expect(out.todoList).toBe("[{ def 《");
  });

  it("derives a title when the model only sent description", () => {
    const out = prepareTodoArguments(parseJSON(JSON.stringify(REAL_MISSING_TITLE)));
    const list = out.todoList as Array<Record<string, unknown>>;
    expect(list[0]?.title).not.toBe("");
    expect(list[0]?.description).toBe("Understand what c12d4a0 fixed and how the current base interacts with it");
    expect(list[1]).toEqual({ id: 2, title: expect.any(String), description: "Trace user_api_key_auth() catch-all behaviour", status: "not-started" });
  });

  it("defaults missing status to not-started", () => {
    const out = prepareTodoArguments(parseJSON(JSON.stringify(REAL_MISSING_STATUS)));
    const list = out.todoList as Array<Record<string, unknown>>;
    expect(list.every((item) => item?.status === "not-started")).toBe(true);
  });

  it("normalizes status synonyms and spacing", () => {
    const out = prepareTodoArguments({
      operation: "write",
      todoList: [
        { id: 1, title: "a", description: "a", status: "In_Progress" },
        { id: 2, title: "b", description: "b", status: "Done" },
        { id: 3, title: "c", description: "c", status: "doing" },
        { id: 4, title: "d", description: "d", status: "Pending" },
        { id: 5, title: "e", description: "e", status: "CLOSED" },
        { id: 6, title: "f", description: "f", status: "in-progress" },
      ],
    });
    const list = out.todoList as Array<Record<string, unknown>>;
    const statuses = list.map((item) => item?.status);
    expect(statuses).toEqual(["in-progress", "completed", "in-progress", "not-started", "completed", "in-progress"]);
  });

  it("repairs missing ids (string, null, missing) to sequential numbers", () => {
    const out = prepareTodoArguments({
      operation: "write",
      todoList: [
        { title: "a", description: "a", status: "not-started" },
        { id: "4", title: "b", description: "b", status: "not-started" },
        { id: null, title: "c", description: "c", status: "not-started" },
      ],
    });
    const list = out.todoList as Array<Record<string, unknown>>;
    expect(list.map((item) => item?.id)).toEqual([1, 4, 3]);
  });

  it("wraps bare-string items into full items", () => {
    const out = prepareTodoArguments({ operation: "write", todoList: ["write tests", "deploy it"] });
    const list = out.todoList as Array<Record<string, unknown>>;
    expect(list).toEqual([
      { id: 1, title: "write tests", description: "write tests", status: "not-started" },
      { id: 2, title: "deploy it", description: "deploy it", status: "not-started" },
    ]);
  });

  it("wraps a single bare object in an array and drops extra keys (item + top level)", () => {
    const out = prepareTodoArguments({
      operation: "write",
      extraTop: "drop me",
      todoList: { id: 1, title: "a", description: "a", status: "completed", fluff: true },
    });
    expect(out).toEqual({
      operation: "write",
      todoList: [{ id: 1, title: "a", description: "a", status: "completed" }],
    });
  });

  it("drops a null todoList and doesn't fabricate one", () => {
    const out = prepareTodoArguments({ operation: "write", todoList: null });
    expect(out).toEqual({ operation: "write" });
    expect(Object.hasOwn(out, "todoList")).toBe(false);
  });

  it("infers operation from a present list, tolerates casing, and defaults to read", () => {
    const withList = prepareTodoArguments({ operation: "WRITE-please", todoList: ["x"] });
    expect(withList.operation).toBe("write");
    const read = prepareTodoArguments({});
    expect(read).toEqual({ operation: "read" });
  });

  it("looks up title/description under the keys models sometimes pick", () => {
    const out = prepareTodoArguments({
      operation: "write",
      todoList: [{ id: 1, content: "Write the thing", details: "Long context here", status: "not-started" }],
    });
    const item = (out.todoList as Array<Record<string, unknown>>)[0];
    expect(item).toEqual({ id: 1, title: "Write the thing", description: "Long context here", status: "not-started" });
  });

  it("keeps null items null so the schema error stays meaningful", () => {
    const out = prepareTodoArguments({ operation: "write", todoList: [null, "x"] });
    expect(out.todoList).toEqual([null, { id: 2, title: "x", description: "x", status: "not-started" }]);
  });

  it("is idempotent on repaired output", () => {
    const parsed = parseJSON(
      JSON.stringify({ ...REAL_MISSING_TITLE, extra: "gap", todoListX: [null] }),
    ) as Record<string, unknown>;
    const once = prepareTodoArguments(parsed);
    const twice = prepareTodoArguments(once);
    expect(twice).toEqual(once);
  });

  it("is idempotent on the real-world string + missing-title failures", () => {
    const once = prepareTodoArguments({ operation: "write", todoList: REAL_STRINGIFIED_LIST });
    expect(prepareTodoArguments(once)).toEqual(once);
    expect(prepareTodoArguments(prepareTodoArguments(REAL_MISSING_TITLE))).toEqual(
      prepareTodoArguments(REAL_MISSING_TITLE),
    );
  });
});

describe("deriveTitleFromDescription", () => {
  it("returns short descriptions verbatim", () => {
    expect(deriveTitleFromDescription("  Fix   the  build ")).toBe("Fix the build");
  });

  it("cuts long descriptions at a word boundary with an ellipsis", () => {
    const long = "Understand what c12d4a0 fixed and how the current base interacts with it including patch 8";
    const title = deriveTitleFromDescription(long);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title.endsWith(" ")).toBe(false);
  });
});

describe("normalizeTodoItem", () => {
  it("keeps a textless item as an empty item", () => {
    expect(normalizeTodoItem({}, 0)).toEqual({ id: 1, title: "", description: "", status: "not-started" });
  });

  it("returns non-object items unchanged", () => {
    expect(normalizeTodoItem(3, 0)).toBe(3);
    expect(normalizeTodoItem("", 0)).toBe("");
  });
});

// ── helpers ─────────────────────────────────────────────────────────────────

// Deep-clone fixture objects, mirroring how arguments arrive (post-JSON).
function parseJSON(s: string): unknown {
  return JSON.parse(s) as unknown;
}
