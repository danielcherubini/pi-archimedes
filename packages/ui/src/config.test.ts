import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@pi-archimedes/core/settings-io", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

import {
  loadUIConfig,
  saveUIConfig,
  DEFAULT_UI_CONFIG,
  ANIMATION_STYLES,
  COMPACT_THINKING_VALUES,
  normalizeCompactThinking,
  SPIN_SPEED_MULT,
} from "./config.js";
import { loadConfig, saveConfig } from "@pi-archimedes/core/settings-io";

describe("loadUIConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses correct namespace archimedes.ui", () => {
    vi.mocked(loadConfig).mockReturnValue(DEFAULT_UI_CONFIG);
    loadUIConfig();
    expect(loadConfig).toHaveBeenCalledWith("archimedes.ui", DEFAULT_UI_CONFIG);
  });

  it("returns default config when no settings exist", () => {
    vi.mocked(loadConfig).mockReturnValue(DEFAULT_UI_CONFIG);
    const result = loadUIConfig();
    expect(result).toEqual({
      bashToolStyling: true,
      mutedTheme: false,
      autoCollapseThinking: false,
      compactThinking: "Off",
      codeUnindent: true,
      labelText: "Thinking...",
      labelColor: "255,215,0",
      animationStyle: "vertical-up",
      editorSpinBorder: true,
      editorSpinSpeed: "normal",
      editorSpinLabel: "Working",
      editorSpinStyle: "pendulum",
    });
  });

  it("passes through merged config from settings-io", () => {
    const merged = { ...DEFAULT_UI_CONFIG, bashToolStyling: false };
    vi.mocked(loadConfig).mockReturnValue(merged);
    const result = loadUIConfig();
    expect(result).toEqual(merged);
  });
});

describe("saveUIConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves with correct namespace archimedes.ui", () => {
    saveUIConfig(DEFAULT_UI_CONFIG);
    expect(saveConfig).toHaveBeenCalledWith("archimedes.ui", DEFAULT_UI_CONFIG);
  });

  it("passes config through unchanged", () => {
    const config = { ...DEFAULT_UI_CONFIG, bashToolStyling: false };
    saveUIConfig(config);
    expect(saveConfig).toHaveBeenCalledWith("archimedes.ui", config);
  });
});

describe("DEFAULT_UI_CONFIG", () => {
  it("has bashToolStyling enabled by default along with core defaults", () => {
    expect(DEFAULT_UI_CONFIG).toEqual({
      bashToolStyling: true,
      mutedTheme: false,
      autoCollapseThinking: false,
      compactThinking: "Off",
      codeUnindent: true,
      labelText: "Thinking...",
      labelColor: "255,215,0",
      animationStyle: "vertical-up",
      editorSpinBorder: true,
      editorSpinSpeed: "normal",
      editorSpinLabel: "Working",
      editorSpinStyle: "pendulum",
    });
  });

  it("exposes a speed→multiplier map (slow/normal/fast = 1.5/1/0.6)", () => {
    expect(SPIN_SPEED_MULT).toEqual({ slow: 1.5, normal: 1, fast: 0.6 });
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

describe("COMPACT_THINKING_VALUES and normalizeCompactThinking", () => {
  it("exports COMPACT_THINKING_VALUES with expected options", () => {
    expect(COMPACT_THINKING_VALUES).toEqual(["Off", "1 line", "3 lines", "5 lines"]);
  });

  it("normalizes valid values as-is", () => {
    for (const val of COMPACT_THINKING_VALUES) {
      expect(normalizeCompactThinking(val)).toBe(val);
    }
  });

  it("normalizes invalid / unknown / non-string values to Off", () => {
    expect(normalizeCompactThinking(undefined)).toBe("Off");
    expect(normalizeCompactThinking(null)).toBe("Off");
    expect(normalizeCompactThinking("")).toBe("Off");
    expect(normalizeCompactThinking(123)).toBe("Off");
    expect(normalizeCompactThinking(true)).toBe("Off");
    expect(normalizeCompactThinking("2 lines")).toBe("Off");
    expect(normalizeCompactThinking("10 lines")).toBe("Off");
    expect(normalizeCompactThinking("off")).toBe("Off");
  });
});
