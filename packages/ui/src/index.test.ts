import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import defaultExport, { registerUI } from "./index.js";

describe("packages/ui entry points", () => {
  it("exports a named registerUI function", () => {
    expect(typeof registerUI).toBe("function");
    const fakePi = {} as ExtensionAPI;
    expect(() => registerUI(fakePi)).not.toThrow();
  });

  it("exports a default function that delegates to registerUI", () => {
    expect(typeof defaultExport).toBe("function");
    const fakePi = {} as ExtensionAPI;
    expect(() => defaultExport(fakePi)).not.toThrow();
  });
});
