import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerCodemodeToolOverride } from "./tool.js";

const nativeSchema = { type: "object", properties: { code: {} } };
const defFromFactory = {
  name: "codemode",
  label: "codemode",
  description: "native description",
  parameters: { type: "object", properties: { code: {} } },
  execute: async () => ({}),
  prepareLoadout: (loadout: unknown) => loadout,
  exposure: "model-only",
  constrainedSampling: { type: "grammar" },
};

function makePi(
  overrides: {
    allTools?: Array<{ name: string; parameters?: unknown; namespace?: unknown }>;
    getSettings?: () => {
      codemode?: { mode?: string; inlineBudget?: unknown };
    };
  } = {},
) {
  const registerTool = vi.fn();
  const appendEntry = vi.fn();
  const pi = {
    registerTool,
    appendEntry,
    getAllTools: vi.fn(() => overrides.allTools ?? []),
    ...(overrides.getSettings ? { getSettings: overrides.getSettings } : {}),
  };
  return { pi, registerTool, appendEntry } as const;
}

type MockModule = {
  createCodemodeToolDefinition: (options: Record<string, unknown>) => unknown;
  codemodeSchema: unknown;
};

// `vi.mock` is hoisted above the imports, so the mutable module handle must
// live in a hoisted scope (referencing a plain `let` would hit the TDZ when
// the mock factory first runs during the static import of ./tool.js).
const state = vi.hoisted(() => ({
  module: undefined as MockModule | undefined,
}));

vi.mock("./loader.js", () => ({
  loadCodemodeModule: vi.fn(async () => state.module),
}));

beforeEach(() => {
  state.module = {
    createCodemodeToolDefinition: (options) => ({ ...defFromFactory, options }),
    codemodeSchema: nativeSchema,
  };
});

describe("registerCodemodeToolOverride", () => {
  it("registers the native definition with the Archimedes renderers", async () => {
    const { pi, registerTool } = makePi();
    const ok = await registerCodemodeToolOverride(pi as never);

    expect(ok).toBe(true);
    expect(registerTool).toHaveBeenCalledTimes(1);
    const registered = registerTool.mock.calls[0]![0] as Record<string, unknown>;
    // Native definition fields are preserved.
    expect(registered.name).toBe("codemode");
    expect(registered.execute).toBe(defFromFactory.execute);
    expect(registered.prepareLoadout).toBe(defFromFactory.prepareLoadout);
    expect(registered.exposure).toBe("model-only");
    // The built-in registers codemode inactive; the override must match.
    expect(registered.defaultActive).toBe(false);
    // The presentation is replaced.
    expect(typeof registered.renderCall).toBe("function");
    expect(typeof registered.renderResult).toBe("function");
  });

  it("preserves the running CLI's schema reference when the built-in is still registered", async () => {
    const { pi, registerTool } = makePi({
      allTools: [{ name: "codemode", parameters: nativeSchema }],
    });
    await registerCodemodeToolOverride(pi as never);

    const registered = registerTool.mock.calls[0]![0] as Record<string, unknown>;
    expect(registered.parameters).toBe(nativeSchema);
  });

  it("keeps the factory schema when no built-in registration is visible", async () => {
    const { pi, registerTool } = makePi();
    await registerCodemodeToolOverride(pi as never);

    const registered = registerTool.mock.calls[0]![0] as Record<string, unknown>;
    expect(registered.parameters).toBe(defFromFactory.parameters);
  });

  it("wires appendEntry, models, and the settings-backed options", async () => {
    const settings = { codemode: { mode: "only", inlineBudget: 1500 } };
    const { pi, registerTool, appendEntry } = makePi({
      getSettings: () => settings,
    });
    await registerCodemodeToolOverride(pi as never);

    const registered = registerTool.mock.calls[0]![0] as Record<string, unknown>;
    const options = (registered as { options?: Record<string, unknown> }).options!;
    const getMode = options.getMode as () => string;
    const getInlineBudget = options.getInlineBudget as () => number | undefined;
    expect(options.models).toBe(true);
    expect(typeof options.appendEntry).toBe("function");
    expect(typeof options.getToolNamespace).toBe("function");
    expect(getMode()).toBe("only");
    expect(getInlineBudget()).toBe(1500);

    // appendEntry forwards to pi.appendEntry.
    await (options.appendEntry as (t: string, d: unknown) => void)(
      "codemode-store",
      { set: {} },
    );
    expect(appendEntry).toHaveBeenCalledWith("codemode-store", { set: {} });
  });

  it("defaults mode to on and inlineBudget to undefined without settings", async () => {
    const { pi, registerTool } = makePi();
    await registerCodemodeToolOverride(pi as never);

    const registered = registerTool.mock.calls[0]![0] as Record<string, unknown>;
    const options = (registered as { options?: Record<string, unknown> }).options!;
    expect((options.getMode as () => string)()).toBe("on");
    expect((options.getInlineBudget as () => number | undefined)()).toBeUndefined();
  });

  it("treats a non-finite inlineBudget as undefined", async () => {
    const { pi, registerTool } = makePi({
      getSettings: () => ({ codemode: { inlineBudget: Number.NaN } }),
    });
    await registerCodemodeToolOverride(pi as never);

    const registered = registerTool.mock.calls[0]![0] as Record<string, unknown>;
    const options = (registered as { options?: Record<string, unknown> }).options!;
    expect((options.getInlineBudget as () => number | undefined)()).toBeUndefined();
  });

  it("returns false and registers nothing when the module cannot be loaded", async () => {
    state.module = undefined;
    const { pi, registerTool } = makePi();
    const ok = await registerCodemodeToolOverride(pi as never);
    expect(ok).toBe(false);
    expect(registerTool).not.toHaveBeenCalled();
  });
});
