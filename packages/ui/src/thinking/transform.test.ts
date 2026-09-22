import { describe, it, expect } from "vitest";
import { transformThinkingContent } from "./transform.js";

describe("transformThinkingContent", () => {
  it("modifies thinking content on assistant messages", () => {
    const message = {
      role: "assistant" as const,
      content: [
        { type: "thinking" as const, thinking: "  some thinking  " },
      ],
    };
    transformThinkingContent(message);
    expect(message.content[0]!.thinking).toBe("some thinking");
  });

  it("skips non-assistant messages", () => {
    const message = {
      role: "user" as const,
      content: [
        { type: "thinking" as const, thinking: "  should not change  " },
      ],
    };
    transformThinkingContent(message);
    expect(message.content[0]!.thinking).toBe("  should not change  ");
  });

  it("skips empty thinking", () => {
    const message = {
      role: "assistant" as const,
      content: [
        { type: "thinking" as const, thinking: "   " },
      ],
    };
    transformThinkingContent(message);
    expect(message.content[0]!.thinking).toBe("   ");
  });

  it("skips thinking with undefined value", () => {
    const message = {
      role: "assistant" as const,
      content: [
        { type: "thinking" as const } as { type: string; thinking?: string },
      ],
    };
    transformThinkingContent(message);
    expect(message.content[0]!.thinking).toBeUndefined();
  });

  it("calls unindentCodeBlocks on thinking content", () => {
    const message = {
      role: "assistant" as const,
      content: [
        {
          type: "thinking" as const,
          thinking: "```\n    indented code\n    more code\n```",
        },
      ],
    };
    transformThinkingContent(message);
    expect(message.content[0]!.thinking).toBe("```\nindented code\nmore code\n```");
  });

  it("handles mixed content types", () => {
    const message = {
      role: "assistant" as const,
      content: [
        { type: "text" as const, text: "some text" },
        { type: "thinking" as const, thinking: "  thinking content  " },
        { type: "text" as const, text: "more text" },
      ],
    };
    transformThinkingContent(message);
    expect(message.content[0]).toEqual({ type: "text", text: "some text" });
    expect(message.content[1]!.thinking).toBe("thinking content");
    expect(message.content[2]).toEqual({ type: "text", text: "more text" });
  });

  it("after transform, thinking is trimmed", () => {
    const message = {
      role: "assistant" as const,
      content: [
        { type: "thinking" as const, thinking: "  hello world  " },
      ],
    };
    transformThinkingContent(message);
    const thinking = message.content[0]!.thinking;
    expect(thinking).toBe(thinking?.trim());
  });
});
