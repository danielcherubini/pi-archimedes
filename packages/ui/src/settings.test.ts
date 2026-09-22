import { describe, it, expect } from "vitest";
import { getUISettingsItems } from "./settings.js";
import { DEFAULT_UI_CONFIG, ANIMATION_STYLES, type UIConfig } from "./config.js";

describe("getUISettingsItems", () => {
  it("exposes all 12 UI setting items with correct defaults", () => {
    const items = getUISettingsItems(DEFAULT_UI_CONFIG);
    expect(items).toHaveLength(12);

    const ids = items.map((i) => i.id);
    expect(ids).toEqual([
      "bashToolStyling",
      "mutedTheme",
      "autoCollapseThinking",
      "compactThinking",
      "codeUnindent",
      "labelText",
      "labelColor",
      "animationStyle",
      "editorSpinBorder",
      "editorSpinSpeed",
      "editorSpinStyle",
      "editorSpinLabel",
    ]);

    expect(items.find((i) => i.id === "bashToolStyling")?.currentValue).toBe("On");
    expect(items.find((i) => i.id === "mutedTheme")?.currentValue).toBe("Off");
    expect(items.find((i) => i.id === "autoCollapseThinking")?.currentValue).toBe("Off");
    expect(items.find((i) => i.id === "compactThinking")?.currentValue).toBe("Off");
    expect(items.find((i) => i.id === "codeUnindent")?.currentValue).toBe("On");
    expect(items.find((i) => i.id === "labelText")?.currentValue).toBe("Thinking...");
    expect(items.find((i) => i.id === "labelColor")?.currentValue).toBe("255,215,0");
    expect(items.find((i) => i.id === "animationStyle")?.currentValue).toBe("vertical-up");
    expect(items.find((i) => i.id === "editorSpinBorder")?.currentValue).toBe("On");
    expect(items.find((i) => i.id === "editorSpinSpeed")?.currentValue).toBe("Normal");
    expect(items.find((i) => i.id === "editorSpinStyle")?.currentValue).toBe("Pendulum");
    expect(items.find((i) => i.id === "editorSpinLabel")?.currentValue).toBe("Working");
  });

  it("exposes bashToolStyling correctly when toggled off", () => {
    const items = getUISettingsItems({ ...DEFAULT_UI_CONFIG, bashToolStyling: false });
    const item = items.find((i) => i.id === "bashToolStyling");
    expect(item).toBeDefined();
    expect(item!.currentValue).toBe("Off");
    expect(item!.values).toEqual(["On", "Off"]);
  });

  it("exposes compactThinking and normalizes invalid values", () => {
    const items = getUISettingsItems({ ...DEFAULT_UI_CONFIG, compactThinking: "invalid" as any });
    const item = items.find((i) => i.id === "compactThinking");
    expect(item).toBeDefined();
    expect(item!.currentValue).toBe("Off");
    expect(item!.values).toEqual(["Off", "1 line", "3 lines", "5 lines"]);
  });

  it("exposes animationStyle with ANIMATION_STYLES values", () => {
    const item = getUISettingsItems(DEFAULT_UI_CONFIG).find((i) => i.id === "animationStyle");
    expect(item?.values).toEqual([...ANIMATION_STYLES]);
  });

  describe("robustness with hand-edited (corrupt) values", () => {
    it("an empty-string editorSpinSpeed projects to 'Normal'", () => {
      const items = getUISettingsItems({
        ...DEFAULT_UI_CONFIG,
        editorSpinSpeed: "" as never,
      });
      expect(items.find((i) => i.id === "editorSpinSpeed")?.currentValue).toBe("Normal");
    });

    it("a number editorSpinSpeed projects to 'Normal'", () => {
      const items = getUISettingsItems({
        ...DEFAULT_UI_CONFIG,
        editorSpinSpeed: 42 as never,
      });
      expect(items.find((i) => i.id === "editorSpinSpeed")?.currentValue).toBe("Normal");
    });

    it("a trailing-dash editorSpinStyle projects without throwing", () => {
      const items = getUISettingsItems({
        ...DEFAULT_UI_CONFIG,
        editorSpinStyle: "wave-" as never,
      });
      expect(items.find((i) => i.id === "editorSpinStyle")?.currentValue).toBe("Wave");
    });

    it("a null editorSpinStyle projects to 'Typing'", () => {
      const items = getUISettingsItems({
        ...DEFAULT_UI_CONFIG,
        editorSpinStyle: null as never,
      });
      expect(items.find((i) => i.id === "editorSpinStyle")?.currentValue).toBe("Typing");
    });
  });
});
