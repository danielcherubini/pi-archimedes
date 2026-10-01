import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@pi-archimedes/core/settings-io", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  removeConfig: vi.fn(),
}));

import { migrateCoreToUIConfig, migrateCompactThinkingToStyle, migrateRemovedToolPatch, UI_CONFIG_KEYS } from "./migration.js";
import { loadConfig, saveConfig, removeConfig } from "@pi-archimedes/core/settings-io";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";

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
    expect(UI_CONFIG_KEYS).toContain("thinkingStyle");
    expect(UI_CONFIG_KEYS).toContain("toolStyle");
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

describe("migrateCompactThinkingToStyle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("converts legacy 'Off' to thinkingStyle 'Full' and deletes compactThinking", () => {
    vi.mocked(loadConfig).mockImplementation((ns: string) => {
      if (ns === "archimedes.ui") return { compactThinking: "Off", mutedTheme: true };
      return {};
    });

    migrateCompactThinkingToStyle();

    expect(saveConfig).toHaveBeenCalledWith("archimedes.ui", {
      mutedTheme: true,
      thinkingStyle: "Full",
    });
  });

  it("converts legacy '1 line' / '3 lines' / '5 lines' to thinkingStyle 'Compact'", () => {
    for (const legacy of ["1 line", "3 lines", "5 lines"] as const) {
      vi.clearAllMocks();
      vi.mocked(loadConfig).mockImplementation((ns: string) => {
        if (ns === "archimedes.ui") return { compactThinking: legacy };
        return {};
      });

      migrateCompactThinkingToStyle();

      expect(saveConfig).toHaveBeenCalledWith("archimedes.ui", {
        thinkingStyle: "Compact",
      });
    }
  });

  it("maps unknown legacy values to thinkingStyle 'Full'", () => {
    vi.mocked(loadConfig).mockImplementation((ns: string) => {
      if (ns === "archimedes.ui") return { compactThinking: "7 lines" };
      return {};
    });

    migrateCompactThinkingToStyle();

    expect(saveConfig).toHaveBeenCalledWith("archimedes.ui", {
      thinkingStyle: "Full",
    });
  });

  it("is a no-op (no saveConfig call) when compactThinking is absent", () => {
    vi.mocked(loadConfig).mockImplementation((ns: string) => {
      if (ns === "archimedes.ui") return { thinkingStyle: "Full" };
      return {};
    });

    migrateCompactThinkingToStyle();

    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("preserves an existing thinkingStyle and deletes compactThinking when both are present", () => {
    vi.mocked(loadConfig).mockImplementation((ns: string) => {
      if (ns === "archimedes.ui")
        return { compactThinking: "1 line", thinkingStyle: "Full", toolStyle: "Compact" };
      return {};
    });

    migrateCompactThinkingToStyle();

    expect(saveConfig).toHaveBeenCalledWith("archimedes.ui", {
      thinkingStyle: "Full",
      toolStyle: "Compact",
    });
  });
});

describe("migrateRemovedToolPatch", () => {
  // The old patch saved the TRUE originals on the shared prototype under
  // Symbol.for markers; the migration restores them and drops the markers.
  // The prototype is process-global, so save/restore the real methods.
  const proto: any = ToolExecutionComponent.prototype;
  const ORIG_UPDATE = Symbol.for("archimedes:toolOrigUpdate");
  const ORIG_SET_EXPANDED = Symbol.for("archimedes:toolOrigSetExpanded");
  const realUpdateDisplay = proto.updateDisplay;
  const realSetExpanded = proto.setExpanded;

  afterEach(() => {
    proto.updateDisplay = realUpdateDisplay;
    proto.setExpanded = realSetExpanded;
    delete proto[ORIG_UPDATE];
    delete proto[ORIG_SET_EXPANDED];
  });

  it("restores the true originals and drops the markers when the old patch is present", () => {
    const sentinelUpdate = function (this: unknown): unknown {
      return "orig";
    };
    const sentinelSetExpanded = function (this: unknown): void {};
    proto[ORIG_UPDATE] = sentinelUpdate;
    proto[ORIG_SET_EXPANDED] = sentinelSetExpanded;
    proto.updateDisplay = function (this: unknown): unknown {
      return "wrapper";
    };
    proto.setExpanded = function (this: unknown): void {};

    migrateRemovedToolPatch();

    expect(proto.updateDisplay).toBe(sentinelUpdate);
    expect(proto.setExpanded).toBe(sentinelSetExpanded);
    expect(proto[ORIG_UPDATE]).toBeUndefined();
    expect(proto[ORIG_SET_EXPANDED]).toBeUndefined();
  });

  it("is a no-op when the markers are absent (fresh process)", () => {
    migrateRemovedToolPatch();
    expect(proto.updateDisplay).toBe(realUpdateDisplay);
    expect(proto.setExpanded).toBe(realSetExpanded);
  });

  it("is idempotent (a second run is a no-op)", () => {
    const sentinelUpdate = function (this: unknown): unknown {
      return "orig";
    };
    proto[ORIG_UPDATE] = sentinelUpdate;
    proto.updateDisplay = function (this: unknown): unknown {
      return "wrapper";
    };

    migrateRemovedToolPatch();
    const restored = proto.updateDisplay;
    migrateRemovedToolPatch();
    expect(proto.updateDisplay).toBe(restored);
  });
});
