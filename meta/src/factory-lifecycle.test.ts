import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Factory lifecycle: image-paste registration (session_start) vs ─────────
// teardown (session_shutdown), gated by a *mutable* config that can be
// toggled mid-session via /plugins. Teardown must be liveness-based (the
// module-level ref itself records "this session registered image-paste"),
// not config-based.

// ── Mock settings-io with an in-memory store (mirrors plugins.test.ts) ────

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

// ── Mock every package the factory touches so the factory test is hermetic ─

// Static top-level imports of the factory
vi.mock("@pi-archimedes/core/profiler", () => ({
  time: vi.fn(),
  print: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("@pi-archimedes/core", () => ({
  registerCore: vi.fn(),
}));
vi.mock("@pi-archimedes/ui", () => ({
  registerUI: vi.fn(),
  unpatchConsoleLog: vi.fn(),
}));
vi.mock("@pi-archimedes/footer", () => ({ registerFooter: vi.fn() }));
vi.mock("@pi-archimedes/todo", () => ({ registerTodo: vi.fn() }));
vi.mock("@pi-archimedes/ask", () => ({ registerAsk: vi.fn() }));
vi.mock("@pi-archimedes/notify", () => ({ registerNotify: vi.fn() }));
vi.mock("@pi-archimedes/session-name", () => ({ registerSessionName: vi.fn() }));
vi.mock("@pi-archimedes/sudo", () => ({ registerSudo: vi.fn() }));

// Dynamic imports done in the session_start handler — mock EXACTLY the
// properties index.ts uses via destructured `ipMod.*` / `diffMod` / `saMod`
// access (import result objects, not named destructure).
vi.mock("@pi-archimedes/diff", () => ({
  registerDiffTools: vi.fn(),
}));
vi.mock("@pi-archimedes/image-paste", () => ({
  registerImagePaste: vi.fn(),
  shutdownImagePaste: vi.fn(),
  initImagePasteSession: vi.fn(),
}));
vi.mock("@pi-archimedes/image-paste/keybinding-offer", () => ({
  offerKeybindingFix: vi.fn(),
}));
vi.mock("@pi-archimedes/subagent", () => ({
  registerSubagent: vi.fn(),
  registerAgentsCommand: vi.fn(),
}));

// Meta-local modules the factory imports — not under test here
vi.mock("./config.js", () => ({ loadDiffConfig: vi.fn(() => ({})) }));
vi.mock("./settings.js", () => ({ openSettings: vi.fn() }));
vi.mock("./plugin-manager.js", () => ({ registerPluginsCommand: vi.fn() }));
vi.mock("./onboarding/index.js", () => ({ runOnboarding: vi.fn(async () => {}) }));

// The real plugins.ts gate semantics are what these tests exercise
// (read via the mocked settings-io on each call → mutable mid-session).
const { default: metaFactory } = await import("./index.js");

const { registerImagePaste, shutdownImagePaste, initImagePasteSession } =
  await import("@pi-archimedes/image-paste");
const { unpatchConsoleLog } = await import("@pi-archimedes/ui");

const { offerKeybindingFix } =
  await import("@pi-archimedes/image-paste/keybinding-offer");
const { runOnboarding } = await import("./onboarding/index.js");

// ── Stub pi: record pi.on() registrations and command/tool registrations ───

interface PiHarness {
  pi: never;
  handlers: Record<string, Array<(...args: unknown[]) => unknown>>;
  commands: Map<string, unknown>;
  tools: string[];
}

function makePi(): PiHarness {
  const handlers: Record<string, Array<(...args: unknown[]) => unknown>> = {};
  const commands = new Map<string, unknown>();
  const tools: string[] = [];
  const pi = {
    on(event: string, handler: (...args: unknown[]) => unknown) {
      (handlers[event] ??= []).push(handler);
    },
    registerCommand: (name: string, def: unknown) => {
      commands.set(name, def);
    },
    registerTool: (name: string) => {
      tools.push(name);
    },
  };
  return { pi: pi as never, handlers, commands, tools };
}

/** Run the meta factory against a fresh stub pi and expose the latest
 *  session_start / session_shutdown handlers captured by pi.on(). */
function freshFactory(): {
  harness: PiHarness;
  startSession: (ctx: unknown) => Promise<unknown>;
  shutdownSession: () => unknown;
  /** Fire ONLY the first-run (merged) session_start handler (the one
   *  registered before the lazy-load handler). Useful for isolating the
   *  offer → onboarding sequencing without triggering the heavy
   *  dynamic-import path. */
  fireFirstRunHandler: (ctx: unknown) => void;
  /** Number of session_start handlers the factory registered. */
  startRcCount: number;
} {
  const harness = makePi();
  metaFactory(harness.pi);

  const startRcs = harness.handlers["session_start"] ?? [];
  const shutdownRcs = harness.handlers["session_shutdown"] ?? [];
  expect(startRcs.length).toBeGreaterThan(0);
  expect(shutdownRcs.length).toBeGreaterThan(0);
  // The LAST session_start handler is the lazy-load one (existing tests rely on this).
  const startRc = (startRcs[startRcs.length - 1] ?? expect.fail("no session_start handler")) as (...args: unknown[]) => unknown;
  const shutdownRc = (shutdownRcs[shutdownRcs.length - 1] ?? expect.fail("no session_shutdown handler")) as (...args: unknown[]) => unknown;
  // The first-run MERGED handler (offer + onboarding, sequenced) is at
  // index 0 in this fully-mocked harness — all earlier package
  // registrations are stubbed to no-op vi.fn(); if a package is un-mocked
  // here, update the index.
  const firstRunRc = (startRcs[0] ?? expect.fail("no first-run session_start handler")) as (...args: unknown[]) => unknown;

  return {
    harness,
    startSession: (ctx: unknown) => startRc(undefined, ctx) as Promise<unknown>,
    shutdownSession: () => shutdownRc(undefined, {}),
    fireFirstRunHandler: (ctx: unknown) => {
      firstRunRc(undefined, ctx);
    },
    startRcCount: startRcs.length,
  };
}

beforeEach(() => {
  for (const key of Object.keys(mockStore)) delete mockStore[key];
  vi.clearAllMocks();
});

describe("image-paste factory lifecycle (registration is config-gated, teardown is liveness-gated)", () => {
  it("still runs shutdownImagePaste when the plugin is toggled OFF mid-session (via /plugins)", async () => {
    // Store empty → image-paste enabled by default at session start
    const { startSession, shutdownSession } = freshFactory();
    await startSession({});
    expect(vi.mocked(registerImagePaste)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(initImagePasteSession)).toHaveBeenCalledTimes(1);

    // Mid-session: user toggles image-paste OFF via /plugins (persists
    // immediately to its own namespace).
    mockStore["archimedes.imagePaste"] = { enabled: false };

    // Session ends → cleanup MUST still run for this session's registration.
    shutdownSession();
    expect(vi.mocked(shutdownImagePaste)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(unpatchConsoleLog)).toHaveBeenCalledTimes(1);
  });

  it("registers nothing and tears down nothing when config is off at session start", async () => {
    mockStore["archimedes.imagePaste"] = { enabled: false };
    const { startSession, shutdownSession } = freshFactory();
    await startSession({});
    expect(vi.mocked(registerImagePaste)).not.toHaveBeenCalled();
    expect(vi.mocked(initImagePasteSession)).not.toHaveBeenCalled();

    shutdownSession();
    expect(vi.mocked(shutdownImagePaste)).not.toHaveBeenCalled();
  });

  it("does not re-execute a stale shutdown ref from a previous session", async () => {
    // Session A: enabled → registered → shutdown (cleanup runs, once).
    const { startSession, shutdownSession } = freshFactory();
    await startSession({});
    expect(vi.mocked(registerImagePaste)).toHaveBeenCalledTimes(1);
    shutdownSession();
    expect(vi.mocked(shutdownImagePaste)).toHaveBeenCalledTimes(1);

    // Session B: toggled off before start → NOT registered.
    mockStore["archimedes.imagePaste"] = { enabled: false };
    await startSession({});
    expect(vi.mocked(registerImagePaste)).toHaveBeenCalledTimes(1); // still 1

    // Session B shutdown must not re-run the (stale) session-A ref.
    shutdownSession();
    expect(vi.mocked(shutdownImagePaste)).toHaveBeenCalledTimes(1); // exactly once total
  });
});

describe("first-run sequencing (session_start → offerKeybindingFix, then runOnboarding)", () => {
  it("registers exactly two session_start handlers (merged first-run + lazy-load)", () => {
    const { startRcCount } = freshFactory();
    // The keybinding offer and the onboarding are ONE merged handler — not
    // two stacked first-run dialogs (which is what this guards against).
    expect(startRcCount).toBe(2);
  });

  it("calls offerKeybindingFix exactly once with the session ctx (before the onboarding)", () => {
    const ctx = { ui: { theme: "dark" } };
    // The merged handler awaits the offer; resolve false so the onboarding
    // branch runs (a resolved promise, so nothing is left pending).
    vi.mocked(offerKeybindingFix).mockResolvedValueOnce(false);
    const { fireFirstRunHandler } = freshFactory();

    fireFirstRunHandler(ctx);

    expect(vi.mocked(offerKeybindingFix)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(offerKeybindingFix)).toHaveBeenCalledWith(ctx);
  });

  it("when offerKeybindingFix resolves true (reloaded), runOnboarding is NOT called", async () => {
    // The offer triggered a reload: the reloaded session runs this handler
    // again (where the offer is a no-op), so the onboarding must NOT run on
    // the now-stale ctx.
    vi.mocked(offerKeybindingFix).mockResolvedValueOnce(true);
    const ctx = { ui: { theme: "dark" } };
    const { fireFirstRunHandler } = freshFactory();

    fireFirstRunHandler(ctx);
    // Drain the microtask queue so the awaited offer has resolved.
    await new Promise((r) => setTimeout(r, 0));

    expect(vi.mocked(offerKeybindingFix)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runOnboarding)).not.toHaveBeenCalled();
  });

  it("when offerKeybindingFix resolves false, runOnboarding IS called (fire-and-forget)", async () => {
    vi.mocked(offerKeybindingFix).mockResolvedValueOnce(false);
    const ctx = { ui: { theme: "dark" } };
    const { fireFirstRunHandler } = freshFactory();

    fireFirstRunHandler(ctx);
    // Drain the microtask queue so the awaited offer has resolved and the
    // (fire-and-forget) onboarding has been kicked off.
    await new Promise((r) => setTimeout(r, 0));

    expect(vi.mocked(offerKeybindingFix)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runOnboarding)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runOnboarding)).toHaveBeenCalledWith(ctx);
  });

  it("session_start resolves even when offerKeybindingFix rejects (fire-and-forget safety)", async () => {
    // Arrange: make the mock reject once to simulate an unexpected failure.
    vi.mocked(offerKeybindingFix).mockRejectedValueOnce(new Error("boom"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const ctx = { ui: { theme: "dark" } };
    const { fireFirstRunHandler } = freshFactory();

    // Act: invoke the handler; it must not throw synchronously.
    expect(() => fireFirstRunHandler(ctx)).not.toThrow();

    // Drain the microtask queue so the .catch() branch has had time to run.
    await new Promise((r) => setTimeout(r, 0));

    // The rejection must have been swallowed and logged — not re-thrown.
    expect(consoleSpy).toHaveBeenCalledWith(
      "[archimedes] keybinding offer failed:",
      expect.any(Error),
    );
    // A failed offer must not block the onboarding (reloaded stays false).
    expect(vi.mocked(runOnboarding)).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });
});
