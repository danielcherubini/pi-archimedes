import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { unindentCodeBlocks } from "./unindent.js";

describe("unindentCodeBlocks", () => {
  it("strips common leading whitespace from fenced code blocks", () => {
    const input = "```\n    line1\n    line2\n```";
    expect(unindentCodeBlocks(input)).toBe("```\nline1\nline2\n```");
  });

  it("preserves empty lines structure", () => {
    const input = "```\n    line1\n\n    line2\n```";
    expect(unindentCodeBlocks(input)).toBe("```\nline1\n\nline2\n```");
  });

  it("leaves whitespace-only blocks untouched", () => {
    const input = "```\n    \n    \n```";
    expect(unindentCodeBlocks(input)).toBe("```\n    \n    \n```");
  });

  it("handles CRLF → LF normalization", () => {
    const input = "```\r\n    line1\r\n    line2\r\n```";
    expect(unindentCodeBlocks(input)).toBe("```\nline1\nline2\n```");
  });

  it("handles blocks with 0 indent on some lines (no stripping)", () => {
    const input = "```\n    indented\nnotindented\n    indented\n```";
    expect(unindentCodeBlocks(input)).toBe("```\n    indented\nnotindented\n    indented\n```");
  });

  it("strips trailing empty lines from code blocks", () => {
    const input = "```\n    line1\n    line2\n\n\n```";
    expect(unindentCodeBlocks(input)).toBe("```\nline1\nline2\n```");
  });

  it("handles language tags", () => {
    const input = "```python\n    def foo():\n        pass\n```";
    expect(unindentCodeBlocks(input)).toBe("```python\ndef foo():\n    pass\n```");
  });

  it("leaves text outside code blocks unchanged", () => {
    const input = "Some text\n```\n    code\n```\nMore text";
    expect(unindentCodeBlocks(input)).toBe("Some text\n```\ncode\n```\nMore text");
  });

  it("handles multiple code blocks", () => {
    const input = "```\n    block1\n```\n```\n    block2\n```";
    expect(unindentCodeBlocks(input)).toBe("```\nblock1\n```\n```\nblock2\n```");
  });

  it("handles empty code blocks with content", () => {
    const input = "```\n```";
    expect(unindentCodeBlocks(input)).toBe("```\n```");
  });

  it("property: idempotence — unindentCodeBlocks(unindentCodeBlocks(x)) === unindentCodeBlocks(x)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (s) => {
        const once = unindentCodeBlocks(s);
        const twice = unindentCodeBlocks(once);
        return once === twice;
      }),
    );
  });

  it("property: output never contains CRLF (\\r\\n)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (s) => {
        const result = unindentCodeBlocks(s);
        return !result.includes("\r\n");
      }),
    );
  });
});
