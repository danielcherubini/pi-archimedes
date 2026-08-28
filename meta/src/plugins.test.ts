import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PluginDef } from "./plugins.js";

// ── Mock settings-io with an in-memory store (mirrors core config.test.ts) ──

vi.mock("@pi-archimedes/core/settings-io", () => {
  const store: Record<string, unknown> = {};
  return {
    loadConfig: vi.fn(
      (ns: string, defaults: object) =>
        ({ ...defaults, ...((store[ns] as object) ?? {}) }),
    ),
    saveConfig: vi.fn((ns: string, config: object) => {
      store[ns] = config;
    }),
    // Exposed for test setup/teardown only
    __store: store,
  };
});

const settingsIo = await import("@pi-archimedes/core/settings-io");
const mockStore = (settingsIo as unknown as { __store: Record<string, unknown> }).__store;
const {
  PLUGINS,
  isPluginEnabled,
  loadPluginsConfig,
  savePluginsConfig,
} = await import("./plugins.js");

describe("isPluginEnabled", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStore)) delete mockStore[key];
  });

  it("defaults to enabled when config is empty", () => {
    expect(isPluginEnabled("mcp")).toBe(true);
    expect(isPluginEnabled("footer")).toBe(true);
    expect(isPluginEnabled("diff")).toBe(true);
  });

  it("returns false for a plugin explicitly disabled in archimedes.plugins", () => {
    mockStore["archimedes.plugins"] = { mcp: false };
    expect(isPluginEnabled("mcp")).toBe(false);
  });

  it("leaves other plugins enabled when one is disabled", () => {
    mockStore["archimedes.plugins"] = { mcp: false };
    expect(isPluginEnabled("footer")).toBe(true);
    expect(isPluginEnabled("todo")).toBe(true);
  });

  it("treats explicit true as enabled", () => {
    mockStore["archimedes.plugins"] = { footer: true };
    expect(isPluginEnabled("footer")).toBe(true);
  });

  it("defaults to enabled for unknown ids", () => {
    expect(isPluginEnabled("does-not-exist")).toBe(true);
  });
});

describe("loadPluginsConfig / savePluginsConfig", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStore)) delete mockStore[key];
  });

  it("returns the persisted archimedes.plugins map", () => {
    mockStore["archimedes.plugins"] = { mcp: false, footer: true };
    expect(loadPluginsConfig()).toEqual({ mcp: false, footer: true });
  });

  it("returns {} when nothing is persisted", () => {
    expect(loadPluginsConfig()).toEqual({});
  });

  it("saves to the archimedes.plugins namespace (round-trips a partial map)", () => {
    savePluginsConfig({ mcp: false });
    expect(mockStore["archimedes.plugins"]).toEqual({ mcp: false });
    // Round-trip: what was saved drives the gate
    expect(isPluginEnabled("mcp")).toBe(false);
    expect(isPluginEnabled("subagent")).toBe(true);
  });

  it("saves explicit true when toggling a plugin on", () => {
    savePluginsConfig({ footer: true });
    expect(mockStore["archimedes.plugins"]).toEqual({ footer: true });
    expect(isPluginEnabled("footer")).toBe(true);
  });
});

describe("PLUGINS manifest integrity", () => {
  const EXPECTED_IDS = [
    "footer",
    "todo",
    "ask",
    "notify",
    "session-name",
    "diff",
    "image-paste",
    "subagent",
    "mcp",
  ];

  it("lists exactly the 9 non-core packages (no drift)", () => {
    expect([...PLUGINS.map((p) => p.id)].sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("has no duplicate ids", () => {
    const ids = PLUGINS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("defaults all current plugins to enabled", () => {
    for (const plugin of PLUGINS) {
      expect(plugin.defaultEnabled).toBe(true);
    }
  });

  it("gives every entry a label, description, and load function", () => {
    for (const plugin of PLUGINS) {
      expect(plugin.label.length).toBeGreaterThan(0);
      expect(plugin.description.length).toBeGreaterThan(0);
      expect(typeof plugin.load).toBe("function");
    }
  });

  it("load() resolves for a real installed package (footer probe)", async () => {
    const footer = PLUGINS.find((p): p is PluginDef => p.id === "footer");
    expect(footer).toBeDefined();
    const mod = await footer!.load();
    expect(mod).toBeTruthy();
  });
});
