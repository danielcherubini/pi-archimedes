import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { OnboardingResult } from "./overlay.js";
import { runOnboarding } from "./index.js";

// ── Mock settings-io with an in-memory store ────────────────────────────

vi.mock("@pi-archimedes/core/settings-io", () => {
  const store: Record<string, Record<string, unknown>> = {};
  return {
    loadConfig: vi.fn(
      (ns: string, defaults: object) =>
        ({ ...defaults, ...(store[ns] ?? {}) } as object),
    ),
    saveConfig: vi.fn((ns: string, config: object) => {
      store[ns] = { ...config };
    }),
    removeConfig: vi.fn((ns: string) => {
      delete store[ns];
    }),
    isConfigEnabled: vi.fn((ns: string) => {
      const cfg = store[ns] ?? {};
      return cfg.enabled !== false;
    }),
    setConfigEnabled: vi.fn((ns: string, enabled: boolean) => {
      if (enabled) {
        const cfg = { ...(store[ns] ?? {}) };
        delete cfg.enabled;
        if (Object.keys(cfg).length === 0) delete store[ns];
        else store[ns] = cfg;
      } else {
        store[ns] = { ...(store[ns] ?? {}), enabled: false };
      }
    }),
    // Concurrency-safe read-modify-write: apply the mutation to the merged
    // current state, persist it, return the result (mirrors the real shape).
    updateConfig: vi.fn(
      (ns: string, defaults: object, mutate: (c: object) => object) => {
        const current = { ...defaults, ...(store[ns] ?? {}) };
        const next = mutate(current);
        store[ns] = { ...next };
        return next;
      },
    ),
    // Exposed for test setup/teardown only
    __store: store,
  };
});

const settingsIo = await import("@pi-archimedes/core/settings-io");
const mockStore = (settingsIo as unknown as { __store: Record<string, Record<string, unknown>> }).__store;
const { loadConfig, updateConfig } = settingsIo;

// ── Mock the ui config module (the pre-selection source) ─────────────────

vi.mock("@pi-archimedes/ui/config", () => ({
  DEFAULT_UI_CONFIG: {
    thinkingStyle: "Full",
    toolStyle: "Compact",
    editorSpinStyle: "pendulum",
  },
  loadUIConfig: vi.fn(() => ({
    thinkingStyle: "Full",
    toolStyle: "Compact",
    editorSpinStyle: "pendulum",
  })),
  normalizeOutputStyle: vi.fn((v: unknown) => (v === "Compact" ? "Compact" : "Full")),
  SPINNER_STYLES: ["typing", "pulse", "rain"],
}));

// ── Mock the plugin gate (per-plugin enabled flags) ──────────────────────

// Current on/off state the (mocked) isPluginEnabled reads; setPluginEnabled
// mutates it, so the changed-only diff is observable across calls.
const pluginState: Record<string, boolean> = {
  ui: true,
  footer: true,
  todo: false,
};

vi.mock("../plugins.js", () => ({
  PLUGINS: [
    { id: "ui", label: "UI", description: "", namespace: "archimedes.ui", load: () => Promise.resolve() },
    { id: "footer", label: "Footer", description: "", namespace: "archimedes.footer", load: () => Promise.resolve() },
    { id: "todo", label: "Todo", description: "", namespace: "archimedes.todo", load: () => Promise.resolve() },
  ],
  isPluginEnabled: vi.fn((id: string) => pluginState[id] ?? true),
  setPluginEnabled: vi.fn((id: string, enabled: boolean) => {
    pluginState[id] = enabled;
    return true;
  }),
}));

const { setPluginEnabled } = await import("../plugins.js");

// ── Mock the overlay component (capture the onDone callback) ─────────────

const captured = vi.hoisted(() => ({
  onDone: undefined as ((r: OnboardingResult) => void) | undefined,
  thinkingDefault: undefined as string | undefined,
  toolDefault: undefined as string | undefined,
}));

vi.mock("./overlay.js", () => ({
  createOnboardingOverlay: vi.fn(
    (opts: {
      thinkingDefault?: string;
      toolDefault?: string;
      onDone: (r: OnboardingResult) => void;
    }) => {
      captured.onDone = opts.onDone;
      captured.thinkingDefault = opts.thinkingDefault;
      captured.toolDefault = opts.toolDefault;
      return {
        render: () => [] as string[],
        handleInput: () => {},
        invalidate: () => {},
        dispose: () => {},
      };
    },
  ),
}));

// ── Mock ExtensionContext ─────────────────────────────────────────────────

/** Build a mock ctx whose `ui.custom` INVOKES the passed factory (so the
 *  mocked createOnboardingOverlay runs and captured.onDone is set). */
function makeCtx(mode: "tui" | "rpc") {
  const custom = vi.fn(
    (factory: (
      tui: unknown,
      theme: unknown,
      keybindings: unknown,
      done: (result: unknown) => void,
    ) => unknown) => {
      factory(
        {} as never,
        { fg: (_t: string, s: string) => s } as never,
        {} as never,
        vi.fn(),
      );
      return Promise.resolve(undefined);
    },
  );
  const ctx = {
    mode,
    ui: { custom, notify: vi.fn() },
  } as unknown as ExtensionContext;
  return { ctx, custom };
}

beforeEach(() => {
  for (const key of Object.keys(mockStore)) delete mockStore[key];
  vi.clearAllMocks();
  pluginState.ui = true;
  pluginState.footer = true;
  pluginState.todo = false;
  captured.onDone = undefined;
  captured.thinkingDefault = undefined;
  captured.toolDefault = undefined;
});

// ── Gates ─────────────────────────────────────────────────────────────────

describe("runOnboarding gates", () => {
  it("opens the onboarding overlay in TUI mode when the marker is unset", async () => {
    const { ctx, custom } = makeCtx("tui");
    await runOnboarding(ctx);
    expect(custom).toHaveBeenCalledTimes(1);
    expect(captured.onDone).toBeDefined();
  });

  it("passes the normalized thinking + tool defaults independently to the overlay", async () => {
    // The mocked loadUIConfig returns thinkingStyle "Full" / toolStyle "Compact";
    // normalizeOutputStyle maps "Compact" → "Compact" and anything else → "Full".
    const { ctx } = makeCtx("tui");
    await runOnboarding(ctx);
    expect(captured.thinkingDefault).toBe("Full");
    expect(captured.toolDefault).toBe("Compact");
  });

  it("does not open the overlay in non-TUI modes (marker not consumed)", async () => {
    const { ctx, custom } = makeCtx("rpc");
    await runOnboarding(ctx);
    expect(custom).not.toHaveBeenCalled();
    // "marker not consumed" verified: the marker was NOT written — the store's
    // archimedes.meta stays untouched (a later TUI session still gets the
    // onboarding). No settings write of any kind happened either.
    expect(mockStore["archimedes.meta"]).toBeUndefined();
    expect(vi.mocked(updateConfig)).not.toHaveBeenCalled();
  });

  it("re-checks the marker after the defer (a concurrent session may have set it)", async () => {
    // Simulate the marker being set BETWEEN the two loadConfig reads: the first
    // read (gate 2) still sees it unset (as a side effect, the concurrent
    // session sets it), so the post-defer re-check (the second read) sees it
    // set and bails before opening the overlay.
    vi.mocked(loadConfig)
      .mockImplementationOnce(() => {
        mockStore["archimedes.meta"] = { onboarded: true };
        return { onboarded: false } as object;
      })
      .mockImplementationOnce(
        ((ns: string, defaults: object) =>
          ({ ...defaults, ...(mockStore[ns] ?? {}) } as object)) as typeof loadConfig,
      );
    const { ctx, custom } = makeCtx("tui");
    await runOnboarding(ctx);
    expect(custom).not.toHaveBeenCalled(); // the re-check caught it
    expect(captured.onDone).toBeUndefined();
  });

  it("does not open the overlay when the marker is already set", async () => {
    mockStore["archimedes.meta"] = { onboarded: true };
    const { ctx, custom } = makeCtx("tui");
    await runOnboarding(ctx);
    expect(custom).not.toHaveBeenCalled();
  });
});

// ── Write logic (finish) ──────────────────────────────────────────────────

describe("runOnboarding write logic (onDone)", () => {
  it("writes answered-only settings and sets the marker last when all steps are answered", async () => {
    const { ctx } = makeCtx("tui");
    await runOnboarding(ctx);
    const onDone = captured.onDone;
    expect(onDone).toBeDefined();
    onDone!({
      thinkingAnswered: true,
      thinkingValue: "Compact",
      toolAnswered: true,
      toolValue: "Full", // independent of thinkingValue
      pluginsAnswered: true,
      pluginSelections: { ui: true, footer: false, todo: true },
      spinnerAnswered: true,
      spinnerValue: "pulse",
    });

    // ui namespace: thinkingStyle and toolStyle are written INDEPENDENTLY
    // (different values here prove there is no shared seeding), plus the
    // spinner choice.
    const ui = mockStore["archimedes.ui"] ?? {};
    expect(ui.thinkingStyle).toBe("Compact");
    expect(ui.toolStyle).toBe("Full");
    expect(ui.editorSpinStyle).toBe("pulse");

    // plugins: only CHANGED flags written (footer on→off, todo off→on; ui unchanged)
    expect(vi.mocked(setPluginEnabled)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(setPluginEnabled)).toHaveBeenCalledWith("footer", false);
    expect(vi.mocked(setPluginEnabled)).toHaveBeenCalledWith("todo", true);
    expect(vi.mocked(setPluginEnabled)).not.toHaveBeenCalledWith("ui", true);

    // marker written LAST and set
    const namespaces = vi.mocked(updateConfig).mock.calls.map((c) => c[0] as string);
    expect(namespaces[namespaces.length - 1]).toBe("archimedes.meta");
    expect(mockStore["archimedes.meta"]?.onboarded).toBe(true);
  });

  it("leaves an UNANSWERED style untouched when only the other is answered (strict: pre-seeded, not default-merged)", async () => {
    // Pre-seed the store with values that DIFFER from the mocked defaults
    // (defaults: thinkingStyle "Full", toolStyle "Compact", editorSpinStyle
    // "pendulum"), so the assertions can distinguish "the user's existing
    // value was left untouched" from "the default was written" — updateConfig
    // merges the defaults into the stored state, so an empty store would
    // materialize the defaults either way.
    mockStore["archimedes.ui"] = {
      thinkingStyle: "Compact", // non-default (default is "Full")
      toolStyle: "Compact",
      editorSpinStyle: "pulse", // non-default
    };
    const { ctx } = makeCtx("tui");
    await runOnboarding(ctx);
    captured.onDone!({
      thinkingAnswered: false,
      thinkingValue: "Full", // differs from the pre-seeded "Compact" — must NOT be seeded in
      toolAnswered: true,
      toolValue: "Full", // differs from the pre-seeded "Compact" — must be written
      pluginsAnswered: false,
      pluginSelections: {},
      spinnerAnswered: false,
      spinnerValue: "",
    });

    const ui = mockStore["archimedes.ui"] ?? {};
    expect(ui.toolStyle).toBe("Full"); // the payload value — the ANSWERED step was written (updated, not left at the pre-seeded "Compact")
    expect(ui.thinkingStyle).toBe("Compact"); // the PRE-SEEDED value, untouched (not the default "Full", not the payload "Full")
    expect(ui.editorSpinStyle).toBe("pulse"); // pre-seeded, untouched
  });

  it("writes the answered thinking style and leaves an UNANSWERED tool style untouched (mirror of the above)", async () => {
    // Mirror of the test above: only the THINKING step is answered. Pre-seed
    // with non-default values so an unanswered step is provably left untouched
    // rather than clobbered with the default.
    mockStore["archimedes.ui"] = {
      thinkingStyle: "Full",
      toolStyle: "Full", // non-default (default is "Compact")
      editorSpinStyle: "pulse", // non-default
    };
    const { ctx } = makeCtx("tui");
    await runOnboarding(ctx);
    captured.onDone!({
      thinkingAnswered: true,
      thinkingValue: "Compact", // differs from the pre-seeded "Full" — must be written
      toolAnswered: false,
      toolValue: "Compact", // differs from the pre-seeded "Full" — must NOT be seeded in
      pluginsAnswered: false,
      pluginSelections: {},
      spinnerAnswered: false,
      spinnerValue: "",
    });

    const ui = mockStore["archimedes.ui"] ?? {};
    expect(ui.thinkingStyle).toBe("Compact"); // the payload value — the ANSWERED step was written (updated, not left at the pre-seeded "Full")
    expect(ui.toolStyle).toBe("Full"); // the PRE-SEEDED value, untouched (not the default "Compact", not the payload "Compact")
    expect(ui.editorSpinStyle).toBe("pulse"); // pre-seeded, untouched
  });

  it("skips all settings/plugin writes but still sets the marker when nothing is answered", async () => {
    const { ctx } = makeCtx("tui");
    await runOnboarding(ctx);
    captured.onDone!({
      thinkingAnswered: false,
      thinkingValue: "Full",
      toolAnswered: false,
      toolValue: "Full",
      pluginsAnswered: false,
      pluginSelections: {},
      spinnerAnswered: false,
      spinnerValue: "",
    });

    expect(vi.mocked(updateConfig)).not.toHaveBeenCalledWith(
      "archimedes.ui",
      expect.anything(),
      expect.anything(),
    );
    expect(vi.mocked(setPluginEnabled)).not.toHaveBeenCalled();
    expect(mockStore["archimedes.meta"]?.onboarded).toBe(true);
  });

  it("leaves the marker unset when a settings write fails (self-heal)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // The first write in finish() is the ui write → make it throw.
    vi.mocked(updateConfig).mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    const { ctx } = makeCtx("tui");
    await runOnboarding(ctx);
    captured.onDone!({
      thinkingAnswered: true,
      thinkingValue: "Compact",
      toolAnswered: true,
      toolValue: "Compact",
      pluginsAnswered: true,
      pluginSelections: { ui: true, footer: true, todo: false },
      spinnerAnswered: true,
      spinnerValue: "pulse",
    });

    // The failed write aborts before the marker write → NOT set (a later
    // session re-runs the onboarding and retries).
    expect(mockStore["archimedes.meta"]?.onboarded).not.toBe(true);
    consoleSpy.mockRestore();
  });

  it("runs the write at most once per invocation (onDone idempotence)", async () => {
    const { ctx } = makeCtx("tui");
    await runOnboarding(ctx);
    const result: OnboardingResult = {
      thinkingAnswered: true,
      thinkingValue: "Compact",
      toolAnswered: true,
      toolValue: "Full",
      pluginsAnswered: true,
      pluginSelections: { ui: true, footer: true, todo: false },
      spinnerAnswered: true,
      spinnerValue: "pulse",
    };
    captured.onDone!(result);
    captured.onDone!(result);

    const uiCalls = vi.mocked(updateConfig).mock.calls.filter(
      (c) => c[0] === "archimedes.ui",
    );
    expect(uiCalls.length).toBe(1);
    // No plugin flags changed → no writes on either invocation.
    expect(vi.mocked(setPluginEnabled)).not.toHaveBeenCalled();
  });
});
