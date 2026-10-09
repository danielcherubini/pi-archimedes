import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

// ── Panel wiring guard ──────────────────────────────────────────────────────
//
// A SettingItem is only changeable in the /archimedes overlay if it either has
// `values` (←/→ cycles them) or is registered in PROMPTS (Enter opens a
// free-text/number field). An item with neither renders as a read-only row:
// the cursor lands on it, every key does nothing, and the user cannot tell the
// control is inert. `sessionNameModel` shipped that way — it even has a
// working `onChange` case waiting for a value it could never receive.
//
// The second assertion guards the other half of the same class of bug: an item
// whose id has no `case` in the onChange switch. Such a row can be changed on
// screen but the edit is never written to settings.json — the same shape as the
// dead reasoning row reported on #81, caught before it ships again.

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
    removeConfig: vi.fn((ns: string) => {
      delete store[ns];
    }),
    isConfigEnabled: vi.fn(() => true),
    setConfigEnabled: vi.fn(),
    __store: store,
  };
});

import { buildSettingsItems, openSettings, PROMPTS } from "./settings.js";
import { loadAllConfig } from "./config.js";

// Capture what openSettings hands the manager so the onChange switch can be
// driven directly, and what lands in settings.json after onSave.
const managerCalls: Array<{
  onChange: (id: string, value: string) => void;
  onSave: () => void;
}> = [];

vi.mock("./settings-manager.js", async (importOriginal) => ({
  ...(await importOriginal as object),
  createSettingsManager: vi.fn((opts: any) => {
    managerCalls.push({ onChange: opts.onChange, onSave: opts.onSave });
    return { render: () => [], handleInput: () => {}, invalidate: () => {}, dispose: () => {} };
  }),
}));

const store = (vi.mocked(await import("@pi-archimedes/core/settings-io")) as any).__store;

const SOURCE = readFileSync(new URL("./settings.ts", import.meta.url), "utf8");

describe("/archimedes settings panel wiring", () => {
  it("every item is editable in the panel (has values or a prompt)", async () => {
    const items = await buildSettingsItems(loadAllConfig());
    expect(items.length).toBeGreaterThan(0);

    const inert = items
      .filter((item) => item.values === undefined && !(item.id in PROMPTS))
      .map((item) => item.id);

    // e.g. ["sessionNameModel"] — a row that renders but swallows every key.
    expect(inert).toEqual([]);
  });

  it("every item persists through onChange", async () => {
    const items = await buildSettingsItems(loadAllConfig());

    const unhandled = items
      .filter((item) => !SOURCE.includes(`case "${item.id}":`))
      .map((item) => item.id);

    expect(unhandled).toEqual([]);
  });

  it("every prompt has a matching label", () => {
    for (const [id, descriptor] of Object.entries(PROMPTS)) {
      expect(descriptor.label, id).not.toBe("");
      expect(["text", "number"]).toContain(descriptor.kind);
    }
  });
});

describe("sessionNameModel editing", () => {
  async function openPanel() {
    managerCalls.length = 0;
    const custom = vi.fn((factory: any) => factory({}, {}, {}, () => {}));
    // openSettings awaits buildSettingsItems (diff is lazy-imported) before
    // it reaches ctx.ui.custom, so this must be awaited, not fired and forgotten.
    await openSettings({} as any, { ui: { custom } } as any);
    expect(custom).toHaveBeenCalledTimes(1);
    const panel = managerCalls.at(-1);
    if (!panel) throw new Error("openSettings never built a settings manager");
    return panel;
  }

  function savedModel() {
    return (store["archimedes.sessionName"] as any)?.model;
  }

  it("stores a typed model reference", async () => {
    const panel = await openPanel();
    panel.onChange("sessionNameModel", "openai/gpt-4o-mini");
    panel.onSave();
    expect(savedModel()).toBe("openai/gpt-4o-mini");
  });

  it("treats a blank field as 'use the current model' and leaves the key unset", async () => {
    const panel = await openPanel();
    panel.onChange("sessionNameModel", "   ");
    panel.onSave();
    expect(savedModel()).toBeUndefined();
    expect(JSON.stringify(store["archimedes.sessionName"])).not.toContain('"model"');
  });

  it("treats the displayed placeholder the same way", async () => {
    const panel = await openPanel();
    panel.onChange("sessionNameModel", "(current model)");
    panel.onSave();
    expect(savedModel()).toBeUndefined();
  });

  it("trims whitespace around a reference", async () => {
    const panel = await openPanel();
    panel.onChange("sessionNameModel", "  anthropic/claude  ");
    panel.onSave();
    expect(savedModel()).toBe("anthropic/claude");
  });
});
