import { describe, it, expect, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBashToolOverride } from "./tool.js";
import { renderBashCall, renderBashResult } from "./renderer.js";

describe("registerBashToolOverride", () => {
  it("registers bash tool with custom renderCall and renderResult while preserving definition", () => {
    let capturedTool: any = null;
    const pi = {
      registerTool: vi.fn((tool: any) => {
        capturedTool = tool;
      }),
    } as unknown as ExtensionAPI;

    registerBashToolOverride(pi, "/test/cwd");

    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    expect(capturedTool).toBeDefined();
    expect(capturedTool.name).toBe("bash");
    expect(capturedTool.label).toBe("bash");
    expect(capturedTool.parameters).toBeDefined();
    expect(typeof capturedTool.execute).toBe("function");
    expect(capturedTool.renderCall).toBe(renderBashCall);
    expect(capturedTool.renderResult).toBe(renderBashResult);
  });
});
