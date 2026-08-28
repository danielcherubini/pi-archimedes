import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
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

// ── Mock every package's settings-items provider so meta/settings.ts can be
// exercised without pulling the real extensions (and shiki) into the test ──

vi.mock("@pi-archimedes/core", () => ({
  getCoreSettingsItems: vi.fn(() => [
    { id: "mutedTheme", label: "Muted theme", currentValue: "Off", values: ["On", "Off"] },
  ]),
}));

vi.mock("@pi-archimedes/footer/config", () => ({
  getFooterSettingsItems: vi.fn(() => [
    { id: "splitThreshold", label: "Footer split threshold", currentValue: "120" },
  ]),
}));

vi.mock("@pi-archimedes/notify", () => ({
  getNotifySettingsItems: vi.fn(() => [
    { id: "enabled", label: "Notify enabled", currentValue: "On", values: ["On", "Off"] },
    { id: "delayMs", label: "Notify delay (seconds)", currentValue: "30s" },
  ]),
}));

vi.mock("@pi-archimedes/session-name", () => ({
  getSessionNameSettingsItems: vi.fn(() => [
    { id: "sessionNameEnabled", label: "Session name enabled", currentValue: "On", values: ["On", "Off"] },
  ]),
}));

// Spy on the diff items so tests can assert the lazy import is skipped when
// the diff plugin is disabled (shiki must never be pulled in).
vi.mock("@pi-archimedes/diff", () => ({
  getDiffSettingsItems: vi.fn(() => [
    { id: "diffTheme", label: "Diff theme", currentValue: "github-dark" },
  ]),
}));
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

// ── Task 2: settings-item gate, /plugins command, plugin manager ──────────

const { buildSettingsItems } = await import("./settings.js");
const { getDiffSettingsItems } = await import("@pi-archimedes/diff");
const { registerPluginsCommand, buildPluginManager } = await import("./plugin-manager.js");

// Raw terminal input for the right-arrow key (legacy sequence)
const ARROW_RIGHT = "\x1b[C";

/** All enabled: empty plugins config means every default-enabled plugin is on. */
function fakeAllConfig(): Parameters<typeof buildSettingsItems>[0] {
  // Minimal shape — buildSettingsItems only reads core/notify/sessionName
  // through the (mocked) item builders, so missing fields never surface.
  return {
    core: { mutedTheme: false },
    footer: { splitThreshold: 120 },
    diff: { diffTheme: "github-dark", diffSplitMinWidth: 150, diffSplitMinCodeWidth: 60 },
    notify: { enabled: true, delayMs: 30000, notifyOnAgentEnd: true, notifyOnQuestion: true },
    sessionName: { enabled: true },
  } as unknown as Parameters<typeof buildSettingsItems>[0];
}

describe("buildSettingsItems (settings gate)", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStore)) delete mockStore[key];
    vi.mocked(getDiffSettingsItems).mockClear();
  });

  it("includes all packages' items when everything is enabled, and lazy-imports diff", async () => {
    const items = await buildSettingsItems(fakeAllConfig());
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["mutedTheme", "splitThreshold", "diffTheme", "enabled", "sessionNameEnabled"]));
    expect(vi.mocked(getDiffSettingsItems)).toHaveBeenCalledTimes(1);
  });

  it("excludes disabled packages' items and never lazy-imports diff when disabled", async () => {
    mockStore["archimedes.plugins"] = { footer: false, diff: false, "session-name": false, notify: false };
    const items = await buildSettingsItems(fakeAllConfig());
    // Core items are always present
    expect(items.map((i) => i.id)).toContain("mutedTheme");
    // No item from a disabled package
    for (const id of ["splitThreshold", "diffTheme", "enabled", "delayMs", "sessionNameEnabled"]) {
      expect(items.map((i) => i.id)).not.toContain(id);
    }
    // Diff must never be lazy-imported (shiki stays out of /archimedes)
    expect(vi.mocked(getDiffSettingsItems)).not.toHaveBeenCalled();
  });

  it("keeps enabled packages when others are disabled", async () => {
    mockStore["archimedes.plugins"] = { footer: false, "session-name": false };
    const items = await buildSettingsItems(fakeAllConfig());
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["mutedTheme", "diffTheme", "enabled"]));
    expect(ids).not.toContain("splitThreshold");
    expect(ids).not.toContain("sessionNameEnabled");
  });
});

// ── /plugins command registration ────────────────────────────────────────

describe("registerPluginsCommand", () => {
  it("registers a 'plugins' command with a description and handler", () => {
    const commands = new Map<string, { description?: string; handler?: unknown }>();
    const fakePi = { registerCommand: (name: string, def: unknown) => commands.set(name, def as never) };
    registerPluginsCommand(fakePi as never);
    expect(commands.has("plugins")).toBe(true);
    expect(typeof commands.get("plugins")?.description).toBe("string");
    expect(commands.get("plugins")?.description?.length).toBeGreaterThan(0);
    expect(typeof commands.get("plugins")?.handler).toBe("function");
  });
});

// ── Plugin manager (buildPluginManager) ───────────────────────────────────

interface CustomCapture {
  factory: ((tui: unknown, theme: unknown, kb: unknown, done: () => void) => unknown) | null;
  options: unknown | null;
  customCalls: number;
  notifyMessage: string | null;
}

function makeCtx(): { ctx: unknown; captured: CustomCapture } {
  const captured: CustomCapture = { factory: null, options: null, customCalls: 0, notifyMessage: null };
  const ctx = {
    ui: {
      custom: (factory: CustomCapture["factory"], options: unknown) => {
        captured.factory = factory as never;
        captured.options = options;
        captured.customCalls++;
        return Promise.resolve();
      },
      notify: (msg: string) => {
        captured.notifyMessage = msg;
      },
    },
  };
  return { ctx, captured };
}

// Minimal theme stub — render()/handleInput() only ever call theme.fg/error
const stubTheme = {
  fg: (_color: string, text?: string) => text ?? "",
  error: (text?: string) => text ?? "",
} as never;

const footerPlugin: PluginDef = {
  id: "footer", label: "Footer status bar", description: "Status bar with cost/timer", defaultEnabled: true,
  load: () => Promise.resolve({}),
};
const ghostPlugin: PluginDef = {
  id: "ghost", label: "Ghost Plugin", description: "Not installed", defaultEnabled: true,
  load: () => Promise.reject(new Error("module not found")),
};

describe("buildPluginManager", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStore)) delete mockStore[key];
  });

  it("opens the settings overlay with rows only for installed plugins", async () => {
    const { ctx, captured } = makeCtx();
    await buildPluginManager(ctx as never, [footerPlugin, ghostPlugin]);

    expect(captured.customCalls).toBe(1);
    expect(captured.options).toEqual({ overlay: true, overlayOptions: expect.anything() });
    expect(captured.factory).not.toBeNull();

    const component = captured.factory!(null, stubTheme, null, () => {});
    const lines = (component as { render(w: number): string[] }).render(80);
    const text = lines.join("\n");
    // Installed plugin visible, load-failing plugin absent
    expect(text).toContain("Footer status bar");
    expect(text).not.toContain("Ghost Plugin");
    // Current state shown as On for a default-enabled plugin
    expect(text).toContain("On");
  });

  it("toggling a row On → Off persists to archimedes.plugins via savePluginsConfig", async () => {
    mockStore["archimedes.plugins"] = { footer: true };
    const { ctx, captured } = makeCtx();
    await buildPluginManager(ctx as never, [footerPlugin]);

    const component = captured.factory!(null, stubTheme, null, () => {});
    // ←/→ cycle the value on the selected row (single row, pre-selected)
    (component as { handleInput(d: string): void }).handleInput(ARROW_RIGHT);
    expect(mockStore["archimedes.plugins"]).toEqual({ footer: false });

    // Cyclic: one more right press goes Off → On
    (component as { handleInput(d: string): void }).handleInput(ARROW_RIGHT);
    expect(mockStore["archimedes.plugins"]).toEqual({ footer: true });
  });

  it("starts from Off when the plugin is already disabled", async () => {
    mockStore["archimedes.plugins"] = { footer: false };
    const { ctx, captured } = makeCtx();
    await buildPluginManager(ctx as never, [footerPlugin]);
    const component = captured.factory!(null, stubTheme, null, () => {});
    const text = (component as { render(w: number): string[] }).render(80).join("\n");
    expect(text).toContain("Footer status bar");
    expect(text).toContain("Off");
  });

  it("notifies instead of opening the overlay when no optional plugins are installed", async () => {
    const { ctx, captured } = makeCtx();
    await buildPluginManager(ctx as never, [ghostPlugin]);
    expect(captured.customCalls).toBe(0);
    expect(captured.notifyMessage).toContain("No optional plugins installed");
  });
});

// ── Docs ──────────────────────────────────────────────────────────────────

describe("docs", () => {
  it("README documents the /plugins command", () => {
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    expect(readme).toContain("/plugins");
  });
});
