import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerCore } from "./index.js";
import { initBus } from "./bus.js";
import { registerBridge } from "./bridge/index.js";

vi.mock("./bus.js", () => ({
  initBus: vi.fn(),
}));
vi.mock("./bridge/index.js", () => ({
  registerBridge: vi.fn(),
}));

describe("registerCore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers bus and bridge", () => {
    const pi = {} as ExtensionAPI;
    registerCore(pi);
    expect(initBus).toHaveBeenCalled();
    expect(registerBridge).toHaveBeenCalledWith(pi);
  });
});

