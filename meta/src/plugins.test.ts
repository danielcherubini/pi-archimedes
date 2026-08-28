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
    // Core-exact semantics: strict `enabled !== false`; delete-on-On with
    // empty-namespace removal — so meta's flow is verified through the same
    // primitives core uses.
    removeConfig: vi.fn((ns: string) => {
      delete store[ns];
    }),
    isConfigEnabled: vi.fn((ns: string) => {
      const cfg = (store[ns] ?? {}) as Record<string, unknown>;
      return cfg.enabled !== false;
    }),
    setConfigEnabled: vi.fn((ns: string, enabled: boolean) => {
      if (enabled) {
        const cfg = { ...((store[ns] as object) ?? {}) } as Record<string, unknown>;
        delete cfg.enabled;
        if (Object.keys(cfg).length === 0) delete store[ns];
        else store[ns] = cfg;
      } else {
        store[ns] = { ...((store[ns] as object) ?? {}), enabled: false };
      }
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
  setPluginEnabled,
  migrateLegacyPluginsMap,
} = await import("./plugins.js");

describe("isPluginEnabled (per-namespace gate)", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStore)) delete mockStore[key];
  });

  it("defaults to enabled when config is empty", () => {
    expect(isPluginEnabled("mcp")).toBe(true);
    expect(isPluginEnabled("footer")).toBe(true);
    expect(isPluginEnabled("diff")).toBe(true);
  });

  it("returns false only for the plugin disabled in its own namespace", () => {
    mockStore["archimedes.mcp"] = { enabled: false };
    expect(isPluginEnabled("mcp")).toBe(false);
    expect(isPluginEnabled("footer")).toBe(true);
    expect(isPluginEnabled("todo")).toBe(true);
  });

  it("treats explicit enabled: true as enabled", () => {
    mockStore["archimedes.footer"] = { enabled: true };
    expect(isPluginEnabled("footer")).toBe(true);
  });

  it("defaults to enabled for unknown ids", () => {
    expect(isPluginEnabled("does-not-exist")).toBe(true);
  });
});

describe("migrateLegacyPluginsMap", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStore)) delete mockStore[key];
  });

  it("moves explicit false entries to package namespaces, drops true/unknown, removes the map", () => {
    mockStore["archimedes.plugins"] = { footer: false, ask: true, junk: false };
    migrateLegacyPluginsMap();
    expect(mockStore["archimedes.footer"]).toEqual({ enabled: false });
    // explicit true = default-on: nothing written
    expect(mockStore["archimedes.ask"]).toBeUndefined();
    // unknown id: dropped
    expect(Object.keys(mockStore).some((k) => k.includes("junk"))).toBe(false);
    // legacy map removed
    expect("archimedes.plugins" in mockStore).toBe(false);
  });

  it("is idempotent — a second run changes nothing", () => {
    mockStore["archimedes.plugins"] = { footer: false, ask: true, junk: false };
    migrateLegacyPluginsMap();
    const afterFirst: Record<string, unknown> = JSON.parse(JSON.stringify(mockStore));
    migrateLegacyPluginsMap();
    expect(mockStore).toEqual(afterFirst);
  });

  it("is a no-op when there is no legacy map", () => {
    mockStore["archimedes.footer"] = { enabled: false };
    migrateLegacyPluginsMap();
    expect(mockStore).toEqual({ "archimedes.footer": { enabled: false } });
  });

  it("merges into a namespace that already carries real settings", () => {
    mockStore["archimedes.notify"] = { delayMs: 30000 };
    mockStore["archimedes.plugins"] = { notify: false };
    migrateLegacyPluginsMap();
    expect(mockStore["archimedes.notify"]).toEqual({ delayMs: 30000, enabled: false });
    expect("archimedes.plugins" in mockStore).toBe(false);
  });
});

describe("setPluginEnabled (save path)", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStore)) delete mockStore[key];
  });

  it("off: writes enabled: false to the package's own namespace only", () => {
    expect(setPluginEnabled("footer", false)).toBe(true);
    expect(mockStore["archimedes.footer"]).toEqual({ enabled: false });
    expect("archimedes.plugins" in mockStore).toBe(false);
    expect(isPluginEnabled("footer")).toBe(false);
    expect(isPluginEnabled("todo")).toBe(true);
  });

  it("on: deletes the enabled key and removes a namespace that held nothing else", () => {
    setPluginEnabled("footer", false);
    expect(setPluginEnabled("footer", true)).toBe(true);
    expect("archimedes.footer" in mockStore).toBe(false);
    expect(isPluginEnabled("footer")).toBe(true);
  });

  it("on: other keys in the namespace survive the delete", () => {
    mockStore["archimedes.notify"] = { delayMs: 30000, enabled: false };
    expect(setPluginEnabled("notify", true)).toBe(true);
    expect(mockStore["archimedes.notify"]).toEqual({ delayMs: 30000 });
  });

  it("returns false and writes nothing for an unknown id", () => {
    expect(setPluginEnabled("does-not-exist", true)).toBe(false);
    expect(setPluginEnabled("does-not-exist", false)).toBe(false);
    expect(mockStore).toEqual({});
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

  it("gives every entry a unique, non-empty namespace", () => {
    const namespaces = PLUGINS.map((p) => p.namespace);
    for (const ns of namespaces) {
      expect(ns.length).toBeGreaterThan(0);
      expect(ns).toMatch(/^archimedes\./);
    }
    expect(new Set(namespaces).size).toBe(namespaces.length);
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

/** All enabled — no `enabled` keys persisted anywhere. */
function fakeAllConfig(): Parameters<typeof buildSettingsItems>[0] {
  // Minimal shape — buildSettingsItems only reads core/notify/sessionName
  // through the (mocked) item builders, so missing fields never surface.
  return {
    core: { mutedTheme: false },
    footer: { splitThreshold: 120 },
    diff: { diffTheme: "github-dark", diffSplitMinWidth: 150, diffSplitMinCodeWidth: 60 },
    notify: { delayMs: 30000, notifyOnAgentEnd: true, notifyOnQuestion: true },
    sessionName: {},
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
    mockStore["archimedes.footer"] = { enabled: false };
    mockStore["archimedes.diff"] = { enabled: false };
    mockStore["archimedes.sessionName"] = { enabled: false };
    mockStore["archimedes.notify"] = { enabled: false };
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
    mockStore["archimedes.footer"] = { enabled: false };
    mockStore["archimedes.sessionName"] = { enabled: false };
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
  id: "footer", label: "Footer status bar", description: "Status bar with cost/timer", namespace: "archimedes.footer",
  load: () => Promise.resolve({}),
};
const ghostPlugin: PluginDef = {
  id: "ghost", label: "Ghost Plugin", description: "Not installed", namespace: "archimedes.ghost",
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

  it("toggling a row On → Off → On persists to the package's own namespace", async () => {
    mockStore["archimedes.footer"] = { enabled: true };
    const { ctx, captured } = makeCtx();
    await buildPluginManager(ctx as never, [footerPlugin]);

    const component = captured.factory!(null, stubTheme, null, () => {});
    // ←/→ cycle the value on the selected row (single row, pre-selected)
    (component as { handleInput(d: string): void }).handleInput(ARROW_RIGHT);
    expect(mockStore["archimedes.footer"]).toEqual({ enabled: false });

    // Cyclic: one more right press goes Off → On — the namespace held only
    // `enabled`, so the whole namespace key is removed again.
    (component as { handleInput(d: string): void }).handleInput(ARROW_RIGHT);
    expect("archimedes.footer" in mockStore).toBe(false);
  });

  it("starts from Off when the plugin is already disabled", async () => {
    mockStore["archimedes.footer"] = { enabled: false };
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
