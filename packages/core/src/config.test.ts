import { describe, it, expect } from "vitest";
import { loadCoreConfig, saveCoreConfig, DEFAULT_CORE_CONFIG } from "./config.js";

describe("loadCoreConfig", () => {
  it("returns empty config", () => {
    expect(loadCoreConfig()).toEqual({});
  });
});

describe("saveCoreConfig", () => {
  it("does nothing", () => {
    expect(() => saveCoreConfig({})).not.toThrow();
  });
});

describe("DEFAULT_CORE_CONFIG", () => {
  it("is empty", () => {
    expect(DEFAULT_CORE_CONFIG).toEqual({});
  });
});
