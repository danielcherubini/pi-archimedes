import { describe, it, expect } from "vitest";
import {
  deriveTitleFromDescription,
  normalizeTodoItem,
  normalizeTodoItems,
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

// Legacy 4-field shape (id/title/description + dashed statuses) that older
// sessions persisted — must normalize to the canonical {content, status}.
const LEGACY_ITEM = { id: 1, title: "Fix auth", description: "Y", status: "not-started" };

describe("prepareTodoArguments", () => {
  it("passes through already-valid canonical arguments unchanged", () => {
    const input = {
      operation: "write",
      todoList: [
        { content: "Fix auth", status: "pending" as const },
        { content: "Ship it", status: "completed" as const },
      ],
    };
    const out = prepareTodoArguments(input);
    expect(out).toEqual(input);
    for (const item of out.todoList!) {
      expect(Object.keys(item as Record<string, unknown>)).not.toContain("id");
      expect(Object.keys(item as Record<string, unknown>)).not.toContain("title");
    }
  });

  it("passes non-object arguments through untouched", () => {
    for (const garbage of [null, undefined, 42, "write", [1, 2]]) {
      expect(prepareTodoArguments(garbage)).toBe(garbage);
    }
  });

  it("normalizes a legacy item (id/title/not-started) to canonical, dropping id", () => {
    const out = prepareTodoArguments({ operation: "write", todoList: [LEGACY_ITEM] });
    expect(out.todoList).toEqual([{ content: "Fix auth", description: "Y", status: "pending" }]);
  });

  it("reads Codex-shaped items ({step, status}) into content", () => {
    const out = prepareTodoArguments({ operation: "write", todoList: [{ step: "X", status: "in_progress" }] });
    expect(out.todoList).toEqual([{ content: "X", status: "in_progress" }]);
  });

  it("strips id (even null) and folds spaced statuses", () => {
    const out = prepareTodoArguments({
      operation: "write",
      todoList: [{ id: null, content: "X", status: "in progress" }],
    });
    expect(out.todoList).toEqual([{ content: "X", status: "in_progress" }]);
  });

  it("recovers content from activeForm alone", () => {
    const out = prepareTodoArguments({ operation: "write", todoList: [{ activeForm: "Adding tests" }] });
    expect(out.todoList).toEqual([{ content: "Adding tests", status: "pending" }]);
  });

  it("wraps bare-string items into canonical items", () => {
    const out = prepareTodoArguments({ operation: "write", todoList: ["write tests", "deploy it"] });
    expect(out.todoList).toEqual([
      { content: "write tests", status: "pending" },
      { content: "deploy it", status: "pending" },
    ]);
  });

  it("parses a stringified todoList (real-world case, incl. mangled quotes)", () => {
    const out = prepareTodoArguments({ operation: "write", todoList: REAL_STRINGIFIED_LIST });
    expect(out.operation).toBe("write");
    expect(out.todoList).toEqual([
      {
        content: "Catalog all undocumented env vars",
        description: "Compare env vars from all K8s manifests against what is in AI-SETUP.md",
        status: "completed",
      },
      {
        content: "Add K8s env vars section",
        description: "Document all container-level env vars",
        status: "in_progress",
      },
    ]);
  });

  it("returns a stringified list it cannot parse, so the schema error still fires", () => {
    const out = prepareTodoArguments({ operation: "write", todoList: "[{ def 《" });
    expect(out.todoList).toBe("[{ def 《");
  });

  it("last-resort scan picks the first unreserved string field", () => {
    const out = prepareTodoArguments({ operation: "write", todoList: [{ instruction: "do X", status: "pending" }] });
    expect(out.todoList).toEqual([{ content: "do X", status: "pending" }]);
  });

  it("last-resort scan does NOT pick up status or id values", () => {
    const out = prepareTodoArguments({ operation: "write", todoList: [{ id: 42, status: "bad" }] });
    expect(out.todoList).toEqual([{ content: "", status: "pending" }]);
  });

  it("copies description from fallback keys (notes)", () => {
    const out = prepareTodoArguments({ operation: "write", todoList: [{ title: "X", notes: "n" }] });
    expect(out.todoList).toEqual([{ content: "X", description: "n", status: "pending" }]);
  });

  it("normalizes status synonyms, spacing and dashes", () => {
    const out = prepareTodoArguments({
      operation: "write",
      todoList: [
        { content: "a", status: "In_Progress" },
        { content: "b", status: "Done" },
        { content: "c", status: "doing" },
        { content: "d", status: "Pending" },
        { content: "e", status: "CLOSED" },
        { content: "f", status: "in-progress" },
        { content: "g", status: "wip" },
        { content: "h", status: "open" },
        { content: "i" },
      ],
    });
    const statuses = (out.todoList as Array<Record<string, unknown>>).map((item) => item?.status);
    expect(statuses).toEqual([
      "in_progress",
      "completed",
      "in_progress",
      "pending",
      "completed",
      "in_progress",
      "in_progress",
      "pending",
      "pending",
    ]);
  });

  it("end-to-end: prepareTodoArguments emits operation and canonical list", () => {
    const out = prepareTodoArguments({
      operation: "write",
      todoList: [{ content: "a", status: "pending" }, LEGACY_ITEM],
    });
    expect(out).toEqual({
      operation: "write",
      todoList: [
        { content: "a", status: "pending" },
        { content: "Fix auth", description: "Y", status: "pending" },
      ],
    });
  });

  it("infers operation from a present list, tolerates casing, and defaults to read", () => {
    const withList = prepareTodoArguments({ operation: "WRITE-please", todoList: ["x"] });
    expect(withList.operation).toBe("write");
    const inferred = prepareTodoArguments({ todoList: ["x"] });
    expect(inferred.operation).toBe("write");
    const read = prepareTodoArguments({});
    expect(read).toEqual({ operation: "read" });
  });

  it("drops a null todoList and doesn't fabricate one", () => {
    const out = prepareTodoArguments({ operation: "write", todoList: null });
    expect(out).toEqual({ operation: "write" });
    expect(Object.hasOwn(out, "todoList")).toBe(false);
  });

  it("wraps a single bare object in an array and drops extra keys (item + top level)", () => {
    const out = prepareTodoArguments({
      operation: "write",
      extraTop: "drop me",
      todoList: { content: "a", fluff: true, status: "completed" },
    });
    expect(out).toEqual({ operation: "write", todoList: [{ content: "a", status: "completed" }] });
  });

  it("keeps null items null so the schema error stays meaningful", () => {
    const out = prepareTodoArguments({ operation: "write", todoList: [null, "x"] });
    expect(out.todoList).toEqual([null, { content: "x", status: "pending" }]);
  });

  it("is idempotent on repaired output", () => {
    const once = prepareTodoArguments({ operation: "write", todoList: REAL_STRINGIFIED_LIST });
    expect(prepareTodoArguments(once)).toEqual(once);
    const legacy = prepareTodoArguments({ operation: "write", todoList: [LEGACY_ITEM] });
    expect(prepareTodoArguments(legacy)).toEqual(legacy);
  });
});

describe("normalizeTodoItem", () => {
  it("returns a fresh canonical object (no id/title/description keys)", () => {
    const out = normalizeTodoItem({ content: "Fix auth", status: "pending" }, 0);
    expect(out).toEqual({ content: "Fix auth", status: "pending" });
  });

  it("keeps a textless item as an empty (valid-string) content item", () => {
    expect(normalizeTodoItem({}, 0)).toEqual({ content: "", status: "pending" });
  });

  it("returns non-object items unchanged", () => {
    expect(normalizeTodoItem(3, 0)).toBe(3);
    expect(normalizeTodoItem("", 0)).toBe("");
  });

  it("derives content from description when only description was given", () => {
    const desc = "Understand what c12d4a0 fixed and how the current base interacts with it";
    const out = normalizeTodoItem({ description: desc, status: "in-progress" }, 0);
    expect(out).toEqual({
      content: deriveTitleFromDescription(desc),
      description: desc,
      status: "in_progress",
    });
  });
});

describe("normalizeTodoItems", () => {
  it("returns canonical items as-is", () => {
    expect(
      normalizeTodoItems([
        { content: "a", status: "pending" },
        { content: "b", status: "in_progress" },
      ])
    ).toEqual([
      { content: "a", status: "pending" },
      { content: "b", status: "in_progress" },
    ]);
  });

  it("normalizes legacy items", () => {
    expect(normalizeTodoItems([LEGACY_ITEM])).toEqual([{ content: "Fix auth", description: "Y", status: "pending" }]);
  });

  it("returns [] for an empty input array", () => {
    expect(normalizeTodoItems([])).toEqual([]);
  });

  it("returns undefined for null/undefined input", () => {
    expect(normalizeTodoItems(null)).toBeUndefined();
    expect(normalizeTodoItems(undefined)).toBeUndefined();
  });

  it("returns undefined when no item survives", () => {
    expect(normalizeTodoItems([{ content: "", status: "pending" }])).toBeUndefined();
    expect(normalizeTodoItems(["", null])).toBeUndefined();
  });

  it("wraps a single looks-like-todo object", () => {
    expect(normalizeTodoItems({ title: "X", status: "not-started" })).toEqual([
      { content: "X", status: "pending" },
    ]);
  });

  it("returns undefined for unrelated values", () => {
    expect(normalizeTodoItems(42)).toBeUndefined();
    expect(normalizeTodoItems("a string")).toBeUndefined();
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
