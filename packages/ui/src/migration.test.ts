import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@pi-archimedes/core/settings-io", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  removeConfig: vi.fn(),
}));

import { migrateCoreToUIConfig, UI_CONFIG_KEYS } from "./migration.js";
import { loadConfig, saveConfig, removeConfig } from "@pi-archimedes/core/settings-io";

describe("migrateCoreToUIConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is a no-op when archimedes.core has no keys", () => {
    vi.mocked(loadConfig).mockReturnValue({});
    migrateCoreToUIConfig();
    expect(saveConfig).not.toHaveBeenCalled();
    expect(removeConfig).not.toHaveBeenCalled();
  });

  it("is a no-op when archimedes.core has no UI keys", () => {
    vi.mocked(loadConfig).mockImplementation((ns: string) => {
      if (ns === "archimedes.core") return { nonUIKey: "value" };
      return {};
    });
    migrateCoreToUIConfig();
    expect(saveConfig).not.toHaveBeenCalled();
    expect(removeConfig).not.toHaveBeenCalled();
  });

  it("migrates UI keys from archimedes.core to archimedes.ui and removes empty archimedes.core", () => {
    const coreSettings: Record<string, unknown> = {
      mutedTheme: true,
      editorSpinSpeed: "fast",
      animationStyle: "wave",
    };
    const uiSettings: Record<string, unknown> = {};

    vi.mocked(loadConfig).mockImplementation((ns: string) => {
      if (ns === "archimedes.core") return { ...coreSettings };
      if (ns === "archimedes.ui") return { ...uiSettings };
      return {};
    });

    migrateCoreToUIConfig();

    expect(saveConfig).toHaveBeenCalledWith("archimedes.ui", {
      mutedTheme: true,
      editorSpinSpeed: "fast",
      animationStyle: "wave",
    });
    expect(removeConfig).toHaveBeenCalledWith("archimedes.core");
  });

  it("preserves non-UI keys in archimedes.core", () => {
    const coreSettings: Record<string, unknown> = {
      mutedTheme: true,
      otherPluginKey: 42,
    };

    vi.mocked(loadConfig).mockImplementation((ns: string) => {
      if (ns === "archimedes.core") return { ...coreSettings };
      if (ns === "archimedes.ui") return {};
      return {};
    });

    migrateCoreToUIConfig();

    expect(saveConfig).toHaveBeenCalledWith("archimedes.ui", {
      mutedTheme: true,
    });
    expect(saveConfig).toHaveBeenCalledWith("archimedes.core", {
      otherPluginKey: 42,
    });
    expect(removeConfig).not.toHaveBeenCalled();
  });

  it("does not overwrite already existing keys in archimedes.ui", () => {
    const coreSettings: Record<string, unknown> = {
      mutedTheme: true,
      labelText: "Old label",
    };
    const uiSettings: Record<string, unknown> = {
      mutedTheme: false,
    };

    vi.mocked(loadConfig).mockImplementation((ns: string) => {
      if (ns === "archimedes.core") return { ...coreSettings };
      if (ns === "archimedes.ui") return { ...uiSettings };
      return {};
    });

    migrateCoreToUIConfig();

    expect(saveConfig).toHaveBeenCalledWith("archimedes.ui", {
      mutedTheme: false,
      labelText: "Old label",
    });
    expect(removeConfig).toHaveBeenCalledWith("archimedes.core");
  });

  it("exports UI_CONFIG_KEYS containing all UI setting keys", () => {
    expect(UI_CONFIG_KEYS).toContain("bashToolStyling");
    expect(UI_CONFIG_KEYS).toContain("mutedTheme");
    expect(UI_CONFIG_KEYS).toContain("autoCollapseThinking");
    expect(UI_CONFIG_KEYS).toContain("compactThinking");
    expect(UI_CONFIG_KEYS).toContain("codeUnindent");
    expect(UI_CONFIG_KEYS).toContain("labelText");
    expect(UI_CONFIG_KEYS).toContain("labelColor");
    expect(UI_CONFIG_KEYS).toContain("animationStyle");
    expect(UI_CONFIG_KEYS).toContain("editorSpinBorder");
    expect(UI_CONFIG_KEYS).toContain("editorSpinSpeed");
    expect(UI_CONFIG_KEYS).toContain("editorSpinLabel");
    expect(UI_CONFIG_KEYS).toContain("editorSpinStyle");
  });
});
