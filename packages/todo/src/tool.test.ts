import { describe, it, expect } from "vitest";
import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { createManageTodoListTool } from "./tool.js";
import { TodoStateManager } from "./state-manager.js";
import type { TodoDetails } from "./types.js";

const VALIDATION_ERROR_TEXT = [
  'Validation failed for tool "manage_todo_list":',
  '  - todoList.0: must be object',
  "",
  "Received arguments:",
  '{',
  '  "operation": "write",',
  '  "todoList": "this is definitely not a list, ascii only"',
  "}",
].join("\n");

// Theme stub: render (token, text) as [token]text so assertions can
// tell apart the status colour, the glyph, and the label.
const theme = {
  fg: (token: unknown, text: unknown) => `[${token}]${text}`,
} as unknown as Theme;

const tool = createManageTodoListTool(new TodoStateManager(), () => {});

function renderLines(result: AgentToolResult<TodoDetails | undefined>, expanded: boolean): string {
  const view = tool.renderResult(result, { expanded, isPartial: false }, theme) as {
    render(width: number): string[];
  };
  expect(view).toBeDefined();
  return view.render(200).map((line) => line.trimEnd()).join("\n");
}

const harnessErrorResult = (text: string) =>
  ({
    content: [{ type: "text" as const, text }],
    // Exactly what the harness attaches to rejected calls (createErrorToolResult):
    // a truthy empty details object.
    details: {},
  }) as unknown as AgentToolResult<TodoDetails | undefined>;

describe("renderResult — harness error shapes", () => {
  it("collapsed validation failure → single red ✗ line, no raw argument dump", () => {
    const lines = renderLines(harnessErrorResult(VALIDATION_ERROR_TEXT), false).split("\n");
      expect(lines.length).toBe(1);
      const [line] = lines;
      expect(line).toContain("✗");
      expect(line).toContain("invalid arguments");
      expect(line).not.toContain("Validation failed");
      expect(line).not.toContain("Received arguments");
      expect(line).not.toContain("definitely not a list");
  });

  it("expanded validation failure → the full harness message", () => {
    const lines = renderLines(harnessErrorResult(VALIDATION_ERROR_TEXT), true);
    expect(lines).toBe(VALIDATION_ERROR_TEXT);
  });

  it("results without any details at all → same compact treatment", () => {
    const noDetails = {
      content: [{ type: "text" as const, text: "Tool execution was blocked" }],
    } as unknown as AgentToolResult<TodoDetails | undefined>;
    const [line] = renderLines(noDetails, false).split("\n");
    expect(line).toContain("✗");
    expect(line).toContain("blocked");
  });

  it("non-validation errors stay short and line-less-newline", () => {
    const [line] = renderLines(harnessErrorResult("Some multi-line\nharness message here"), false).split("\n");
    expect(line).toContain("✗");
    expect(line).not.toContain("\n");
  });
});

describe("renderResult — successful results unchanged", () => {
  it("renders the completed counter from details.todos", () => {
    const result = {
      content: [{ type: "text" as const, text: "3/3 completed." }],
      details: {
        operation: "write" as const,
        todos: [
          { id: 1, title: "a", description: "a", status: "completed" as const },
          { id: 2, title: "b", description: "b", status: "completed" as const },
          { id: 3, title: "c", description: "c", status: "completed" as const },
        ],
      },
    } as unknown as AgentToolResult<TodoDetails>;
    const [line] = renderLines(result, false).split("\n");
    expect(line).toContain("3/3 completed");
  });
});
