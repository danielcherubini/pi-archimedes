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
  OUTPUT_STYLE_VALUES,
  SPINNER_STYLES,
  normalizeOutputStyle,
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
      codemodeToolStyling: true,
      mutedTheme: false,
      autoCollapseThinking: false,
      thinkingStyle: "Full",
      toolStyle: "Minimal",
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
  it("has bashToolStyling and codemodeToolStyling enabled by default along with core defaults", () => {
    expect(DEFAULT_UI_CONFIG).toEqual({
      bashToolStyling: true,
      codemodeToolStyling: true,
      mutedTheme: false,
      autoCollapseThinking: false,
      thinkingStyle: "Full",
      toolStyle: "Minimal",
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

describe("DEFAULT_UI_CONFIG output styles", () => {
  it("defaults thinkingStyle to Full and toolStyle to Minimal", () => {
    expect(DEFAULT_UI_CONFIG.thinkingStyle).toBe("Full");
    expect(DEFAULT_UI_CONFIG.toolStyle).toBe("Minimal");
  });
});

describe("OUTPUT_STYLE_VALUES", () => {
  it("exports [Full, Compact]", () => {
    expect(OUTPUT_STYLE_VALUES).toEqual(["Full", "Compact", "Minimal"]);
  });
});

describe("SPINNER_STYLES", () => {
  it("contains the 10 editorSpinStyle values in order", () => {
    expect(SPINNER_STYLES).toEqual([
      "typing",
      "pulse",
      "rain",
      "cascade",
      "columns",
      "wave-rows",
      "diagonal-swipe",
      "sparkle",
      "pendulum",
      "marquee",
    ]);
  });
});

describe("normalizeOutputStyle", () => {
  it("normalizes current values as-is", () => {
    expect(normalizeOutputStyle("Full")).toBe("Full");
    expect(normalizeOutputStyle("Compact")).toBe("Compact");
    expect(normalizeOutputStyle("Minimal")).toBe("Minimal");
  });

  it("maps legacy Off to Full", () => {
    expect(normalizeOutputStyle("Off")).toBe("Full");
  });

  it("maps legacy N-lines values to Compact", () => {
    expect(normalizeOutputStyle("1 line")).toBe("Compact");
    expect(normalizeOutputStyle("3 lines")).toBe("Compact");
    expect(normalizeOutputStyle("5 lines")).toBe("Compact");
  });

  it("normalizes invalid / unknown / non-string values to Full", () => {
    expect(normalizeOutputStyle(undefined)).toBe("Full");
    expect(normalizeOutputStyle(null)).toBe("Full");
    expect(normalizeOutputStyle("")).toBe("Full");
    expect(normalizeOutputStyle(123)).toBe("Full");
    expect(normalizeOutputStyle(true)).toBe("Full");
    expect(normalizeOutputStyle("off")).toBe("Full");
    expect(normalizeOutputStyle("2 lines")).toBe("Full");
  });
});
