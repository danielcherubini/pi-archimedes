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
  unpatchConsoleLog: vi.fn(),
}));
vi.mock("@pi-archimedes/footer", () => ({ registerFooter: vi.fn() }));
vi.mock("@pi-archimedes/todo", () => ({ registerTodo: vi.fn() }));
vi.mock("@pi-archimedes/ask", () => ({ registerAsk: vi.fn() }));
vi.mock("@pi-archimedes/notify", () => ({ registerNotify: vi.fn() }));
vi.mock("@pi-archimedes/session-name", () => ({ registerSessionName: vi.fn() }));
vi.mock("@pi-archimedes/sudo", () => ({ registerSudo: vi.fn() }));

// Dynamic imports done in the session_start handler — mock EXACTLY the
// properties index.ts uses via destructured `ipMod.*` / `diffMod` / `saMod` /
// `mcpMod` access (import result objects, not named destructure).
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
vi.mock("@pi-archimedes/mcp", () => ({
  registerMcp: vi.fn(),
}));

// Meta-local modules the factory imports — not under test here
vi.mock("./config.js", () => ({ loadDiffConfig: vi.fn(() => ({})) }));
vi.mock("./settings.js", () => ({ openSettings: vi.fn() }));
vi.mock("./plugin-manager.js", () => ({ registerPluginsCommand: vi.fn() }));

// The real plugins.ts gate semantics are what these tests exercise
// (read via the mocked settings-io on each call → mutable mid-session).
const { default: metaFactory } = await import("./index.js");

const { registerImagePaste, shutdownImagePaste, initImagePasteSession } =
  await import("@pi-archimedes/image-paste");

const { offerKeybindingFix } =
  await import("@pi-archimedes/image-paste/keybinding-offer");

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
  /** Fire ONLY the keybinding-offer session_start handler (the one registered
   *  before the lazy-load handler). Useful for isolating offer behaviour
   *  without triggering the heavy dynamic-import path. */
  fireOfferHandler: (ctx: unknown) => void;
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
  // The keybinding-offer handler is at index 0 in this fully-mocked harness —
  // all earlier package registrations are stubbed to no-op vi.fn(); if a
  // package is un-mocked here, update the index.
  const offerRc = (startRcs[0] ?? expect.fail("no offer session_start handler")) as (...args: unknown[]) => unknown;

  return {
    harness,
    startSession: (ctx: unknown) => startRc(undefined, ctx) as Promise<unknown>,
    shutdownSession: () => shutdownRc(undefined, {}),
    fireOfferHandler: (ctx: unknown) => {
      offerRc(undefined, ctx);
    },
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

describe("keybinding-offer wiring (session_start → offerKeybindingFix, fire-and-forget)", () => {
  it("calls offerKeybindingFix exactly once with the session ctx", () => {
    const ctx = { ui: { theme: "dark" } };
    // Return a resolved promise so the handler's .catch() has nothing to report.
    vi.mocked(offerKeybindingFix).mockResolvedValueOnce(undefined);
    const { fireOfferHandler } = freshFactory();

    // The offer handler is synchronous from the caller's perspective (fire-and-forget).
    fireOfferHandler(ctx);

    expect(vi.mocked(offerKeybindingFix)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(offerKeybindingFix)).toHaveBeenCalledWith(ctx);
  });

  it("session_start resolves even when offerKeybindingFix rejects (fire-and-forget safety)", async () => {
    // Arrange: make the mock reject once to simulate an unexpected failure.
    vi.mocked(offerKeybindingFix).mockRejectedValueOnce(new Error("boom"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const ctx = { ui: { theme: "dark" } };
    const { fireOfferHandler } = freshFactory();

    // Act: invoke the offer handler; it must not throw synchronously.
    expect(() => fireOfferHandler(ctx)).not.toThrow();

    // Drain the microtask queue so the .catch() branch has had time to run.
    await new Promise((r) => setTimeout(r, 0));

    // The rejection must have been swallowed and logged — not re-thrown.
    expect(consoleSpy).toHaveBeenCalledWith(
      "[archimedes] keybinding offer failed:",
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });
});
