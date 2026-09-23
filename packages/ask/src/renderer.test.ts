import { describe, it, expect, vi } from "vitest";
import { Text } from "@earendil-works/pi-tui";
import { renderAskCall, renderAskResult } from "./renderer.js";
import { type QuestionResult } from "./tool.js";

// Mocking dependencies if necessary
vi.mock("@pi-archimedes/core/tool-render", () => ({
  renderToolHeader: (name: string) => `Header:${name}`,
  renderStatusLabel: (status: string, message: string) => `[${status}] ${message}`,
}));

function createMockText() {
  const text = new Text("", 0, 0) as any;
  text._text = "";
  text.setText = (t: string) => { text._text = t; };
  text.getText = () => text._text;
  return text;
}

const mockTheme = {
  fg: (color: string, text: string) => `${color}:${text}`,
} as any;

describe("renderer", () => {
  it("renderAskCall renders header", () => {
    const text = createMockText();
    renderAskCall({}, mockTheme, { lastComponent: text });
    expect(text.getText()).toBe("Header:ask");
  });

  it("renderAskResult with isPartial: true renders waiting", () => {
    const text = createMockText();
    renderAskResult({}, { isPartial: true }, mockTheme, { lastComponent: text });
    expect(text.getText()).toBe("[running] waiting for input...");
  });

  it("renderAskResult completed single question renders correct selection", () => {
    const text = createMockText();
    const result = {
      details: {
        results: [{
          id: "test",
          question: "q",
          options: ["A", "B"],
          multi: false,
          selectedOptions: ["A"],
        }]
      }
    };
    renderAskResult(result, {}, mockTheme, { lastComponent: text });
    expect(text.getText()).toBe("[success] A");
  });

  it("renderAskResult completed multi-select renders [A, B]", () => {
    const text = createMockText();
    const result = {
      details: {
        results: [{
          id: "test",
          question: "q",
          options: ["A", "B"],
          multi: true,
          selectedOptions: ["A", "B"],
        }]
      }
    };
    renderAskResult(result, {}, mockTheme, { lastComponent: text });
    expect(text.getText()).toBe("[success] [A, B]");
  });

  it("renderAskResult completed custom input renders custom note", () => {
    const text = createMockText();
    const result = {
      details: {
        results: [{
          id: "test",
          question: "q",
          options: ["A"],
          multi: false,
          selectedOptions: [],
          customInput: "custom note"
        }]
      }
    };
    renderAskResult(result, {}, mockTheme, { lastComponent: text });
    expect(text.getText()).toBe("[success] \"custom note\"");
  });

  it("renderAskResult completed combo choice + custom input renders A + Other", () => {
    const text = createMockText();
    const result = {
      details: {
        results: [{
          id: "test",
          question: "q",
          options: ["A"],
          multi: false,
          selectedOptions: ["A"],
          customInput: "custom note"
        }]
      }
    };
    renderAskResult(result, {}, mockTheme, { lastComponent: text });
    expect(text.getText()).toBe("[success] A + Other: \"custom note\"");
  });

  it("renderAskResult completed multiple questions renders comma separated", () => {
    const text = createMockText();
    const result = {
      details: {
        results: [
          { id: "auth", question: "q", options: ["A"], multi: false, selectedOptions: ["OAuth"] },
          { id: "cache", question: "q", options: ["B"], multi: false, selectedOptions: ["Redis"] }
        ]
      }
    };
    renderAskResult(result, {}, mockTheme, { lastComponent: text });
    expect(text.getText()).toBe("[success] auth: OAuth, cache: Redis");
  });

  it("renderAskResult cancelled renders (cancelled)", () => {
    const text = createMockText();
    const result = {
      content: [{ type: "text", text: "User cancelled the question." }],
      details: { results: [] }
    };
    renderAskResult(result, {}, mockTheme, { lastComponent: text });
    expect(text.getText()).toBe("[error] (cancelled)");
  });

  it("renderAskResult error renders failed", () => {
    const text = createMockText();
    renderAskResult({}, {}, mockTheme, { lastComponent: text, isError: true });
    expect(text.getText()).toBe("[error] failed");
  });

  it("renderAskResult expanded renders clean Q&A breakdown", () => {
    const text = createMockText();
    const result = {
      details: {
        results: [{
          id: "test",
          question: "Question prompt?",
          options: ["A"],
          multi: false,
          selectedOptions: ["A"],
        }]
      }
    };
    renderAskResult(result, { expanded: true }, mockTheme, { lastComponent: text });
    expect(text.getText()).toContain("dim:Question prompt?");
    expect(text.getText()).toContain("success:✓");
    expect(text.getText()).toContain("toolOutput:A");
  });
});
