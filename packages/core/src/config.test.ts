import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./settings-io.js", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

const { loadCoreConfig, saveCoreConfig, DEFAULT_CORE_CONFIG, ANIMATION_STYLES } =
  await import("./config.js");
const { loadConfig, saveConfig } = await import("./settings-io.js");

describe("loadCoreConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses correct namespace", () => {
    vi.mocked(loadConfig).mockReturnValue(DEFAULT_CORE_CONFIG);
    loadCoreConfig();
    expect(loadConfig).toHaveBeenCalledWith("archimedes.core", DEFAULT_CORE_CONFIG);
  });

  it("returns default config when no settings exist", () => {
    vi.mocked(loadConfig).mockReturnValue(DEFAULT_CORE_CONFIG);
    const result = loadCoreConfig();
    expect(result).toEqual({
      mutedTheme: false,
      codeUnindent: true,
      labelText: "Thinking...",
      labelColor: "255,215,0",
      animationStyle: "vertical-up",
    });
  });

  it("passes through merged config from settings-io", () => {
    const merged = { ...DEFAULT_CORE_CONFIG, mutedTheme: true };
    vi.mocked(loadConfig).mockReturnValue(merged);
    const result = loadCoreConfig();
    expect(result).toEqual(merged);
  });
});

describe("saveCoreConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves with correct namespace", () => {
    saveCoreConfig(DEFAULT_CORE_CONFIG);
    expect(saveConfig).toHaveBeenCalledWith("archimedes.core", DEFAULT_CORE_CONFIG);
  });

  it("passes config through unchanged", () => {
    const config = { ...DEFAULT_CORE_CONFIG, mutedTheme: true };
    saveCoreConfig(config);
    expect(saveConfig).toHaveBeenCalledWith("archimedes.core", config);
  });
});

describe("DEFAULT_CORE_CONFIG", () => {
  it("has the expected shape", () => {
    expect(DEFAULT_CORE_CONFIG).toEqual({
      mutedTheme: false,
      codeUnindent: true,
      labelText: "Thinking...",
      labelColor: "255,215,0",
      animationStyle: "vertical-up",
    });
  });
});

describe("ANIMATION_STYLES", () => {
  it("contains all expected styles", () => {
    expect(ANIMATION_STYLES).toEqual([
      "diagonal",
      "top-right",
      "bottom-left",
      "bottom-right",
      "center-out",
      "wave",
      "horizontal",
      "vertical",
      "vertical-up",
    ]);
  });
});
