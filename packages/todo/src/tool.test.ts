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
  strikethrough: (text: unknown) => `[s]${text}`,
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

describe("tool schema", () => {
  const params = tool.parameters as unknown as {
    properties: Record<string, { type?: string; enum?: string[]; items?: unknown }>;
    required?: string[];
  };
  const itemSchema = params.properties.todoList?.items as unknown as {
    properties: Record<string, { type?: string; enum?: string[] }>;
    required?: string[];
  };

  it("declares content + canonical status enum, with no id/title and optional description", () => {
    const props = itemSchema.properties;
    expect(props.id).toBeUndefined();
    expect(props.title).toBeUndefined();
    expect(props.content?.type).toBe("string");
    expect(props.status?.enum).toEqual(["pending", "in_progress", "completed"]);
    expect(itemSchema.required).toContain("content");
    expect(itemSchema.required).toContain("status");
    expect(itemSchema.required).not.toContain("description");
  });

  it("keeps the manage_todo_list tool name, op and prepareArguments wiring", () => {
    expect(tool.name).toBe("manage_todo_list");
    expect(typeof tool.prepareArguments).toBe("function");
    expect(params.properties.operation?.enum).toEqual(["write", "read"]);
  });

  it("model-facing description uses canonical status tokens only", () => {
    expect(tool.description).not.toMatch(/not-started|in-progress/);
    expect(tool.description).toContain("in_progress");
    expect(tool.description).toContain("\"content\": \"Fix the auth middleware\"");
  });
});

describe("renderResult — successful results unchanged", () => {
  it("renders the completed counter from details.todos", () => {
    const result = {
      content: [{ type: "text" as const, text: "3/3 completed." }],
      details: {
        operation: "write" as const,
        todos: [
          { content: "a", status: "completed" as const },
          { content: "b", status: "completed" as const },
          { content: "c", status: "completed" as const },
        ],
      },
    } as unknown as AgentToolResult<TodoDetails>;
    const [line] = renderLines(result, false).split("\n");
    expect(line).toContain("3/3 completed");
  });

  it("numbers items by array position and renders content", () => {
    const result = {
      content: [{ type: "text" as const, text: "1/3 completed." }],
      details: {
        operation: "write" as const,
        todos: [
          { content: "First", status: "completed" as const },
          { content: "Second", status: "in_progress" as const },
          { content: "Third", status: "pending" as const },
        ],
      },
    } as unknown as AgentToolResult<TodoDetails>;
    const lines = renderLines(result, true);
    expect(lines).toContain("[accent]1.");
    expect(lines).toContain("[accent]2.");
    expect(lines).toContain("[accent]3.");
    expect(lines).toContain("[s]First");
    expect(lines).toContain("[warning]Second");
    expect(lines).toContain("[muted]Third");
    expect(lines).not.toContain("undefined");
  });
});
