import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { SPIN_TICK_MS } from "./editor/index.js";

// ── Mock surface ────────────────────────────────────────────────────────
// Only seam that MUST be mocked: loadCoreConfig (drives the spin flag).
// settings-io is mocked the same way as in config.test.ts (its module scope
// calls getAgentDir()); the editor and the rest of index.ts' imports are
// verified side-effect-free at import time, so they stay real — the real
// HephaestusEditor is what makes the setInterval/onSpinInterval assertions
// meaningful.
vi.mock("./settings-io.js", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));
vi.mock("./config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config.js")>();
  return {
    ...actual,
    loadCoreConfig: vi.fn(),
  };
});
vi.mock("./bus.js", () => ({
  initBus: vi.fn(),
}));
vi.mock("./startup/capture.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./startup/capture.js")>();
  return {
    ...actual,
    patchConsoleLog: vi.fn(),
  };
});
vi.mock("./thinking/patch.js", () => ({
  patchThinkingRenderer: vi.fn(),
}));

const { registerCore } = await import("./index.js");
const { loadCoreConfig, DEFAULT_CORE_CONFIG } = await import("./config.js");

// ── Sparse spy handles (real casts strip the spy typing) ───────────────

interface UiSpies {
  setHeader: ReturnType<typeof vi.fn>;
  setEditorComponent: ReturnType<typeof vi.fn>;
  setWorkingVisible: ReturnType<typeof vi.fn>;
}
type TimerSpy = {
  mock: {
    calls: unknown[][];
    results: ReadonlyArray<{ value: unknown }>;
    invocationCallOrder: number[];
  };
  mockRestore(): void;
};

function makeCtx(): { ctx: ExtensionContext; ui: UiSpies } {
  const ui: UiSpies = {
    setHeader: vi.fn(),
    setEditorComponent: vi.fn(),
    setWorkingVisible: vi.fn(),
  };
  const ctx = {
    ui: { ...ui, theme: {} as Theme },
    isIdle: vi.fn(() => true),
    shutdown: vi.fn(),
  } as unknown as ExtensionContext;
  return { ctx, ui };
}

/** Build an editor via the most recently registered factory. */
function buildEditor(ui: UiSpies): unknown {
  const factory = ui.setEditorComponent.mock.calls.at(-1)![0] as (
    tui: unknown,
    theme: unknown,
    keybindings: unknown,
  ) => unknown;
  const editor = factory({}, {}, {});
  constructed.push(editor);
  return editor;
}

function registerAndCapture(): {
  start: (ctx: ExtensionContext) => void;
  shutdown: (ctx: ExtensionContext) => void;
} {
  const onSpy = vi.fn();
  registerCore({ on: onSpy } as unknown as ExtensionAPI);
  // Top-level registrations are exactly: session_shutdown + session_start
  // (message_end is registered inside the session_start handler).
  const calls = onSpy.mock.calls as Array<
    [string, (event: unknown, ctx: ExtensionContext) => void]
  >;
  const startCall = calls.find((c) => c[0] === "session_start");
  const shutdownCall = calls.find((c) => c[0] === "session_shutdown");
  expect(startCall).toBeTruthy();
  expect(shutdownCall).toBeTruthy();
  const startFn = startCall! ? startCall[1] : undefined;
  const shutdownFn = shutdownCall ? shutdownCall[1] : undefined;
  return {
    start: (ctx) => startFn!(null, ctx),
    shutdown: (ctx) => shutdownFn!(null, ctx),
  };
}

let start: (ctx: ExtensionContext) => void;
let shutdown: (ctx: ExtensionContext) => void;
let ctx: ExtensionContext;
let ui: UiSpies;
let si: TimerSpy;
let cl: TimerSpy;
let constructed: unknown[];

/** Count of timers registered with delay SPIN_TICK_MS (the spinner cadence). */
function spinTimerCount(): number {
  return si.mock.calls.filter((c) => c[1] === SPIN_TICK_MS).length;
}

beforeEach(() => {
  const handlers = registerAndCapture();
  start = handlers.start;
  shutdown = handlers.shutdown;
  const made = makeCtx();
  ctx = made.ctx;
  ui = made.ui;
  si = vi.spyOn(globalThis, "setInterval") as unknown as TimerSpy;
  cl = vi.spyOn(globalThis, "clearInterval") as unknown as TimerSpy;
  constructed = [];
});

afterEach(() => {
  // Reap any live spinner timers so the test process never hangs.
  for (const e of constructed.splice(0)) {
    (e as { dispose?: () => void }).dispose?.();
  }
  si.mockRestore();
  cl.mockRestore();
});

// ── 1. Default (on) ────────────────────────────────────────────────────

describe("editorSpinPrompt = true (default)", () => {
  it("session_start hides the Working line; the editor drives an 80ms timer stored onSpinInterval; shutdown restores and reaps", () => {
    vi.mocked(loadCoreConfig).mockReturnValue(DEFAULT_CORE_CONFIG);

    start(ctx);
    expect(ui.setWorkingVisible.mock.calls.map((c: unknown[]) => c[0])).toEqual(
      [false],
    );

    buildEditor(ui); // real ctor: setInterval(fn, 80) + onSpinInterval(token)
    expect(spinTimerCount()).toBe(1);
    const setCall = si.mock.calls.at(-1)!;
    expect(typeof setCall[0]).toBe("function");
    expect(setCall[1]).toBe(80);

    // onSpinInterval stored the handle: shutdown() clears it.
    shutdown(ctx);
    const visCalls = ui.setWorkingVisible.mock.calls.map((c: unknown[]) => c[0]);
    expect(visCalls.at(-1)).toBe(true);
    expect(cl.mock.calls.length).toBeGreaterThan(0);
    const token = si.mock.results[si.mock.calls.length - 1]!.value;
    expect(cl.mock.calls.some((c) => c[0] === token)).toBe(true);
  });

  it("a second shutdown is a no-op (no restore, no clear)", () => {
    vi.mocked(loadCoreConfig).mockReturnValue(DEFAULT_CORE_CONFIG);
    start(ctx);
    buildEditor(ui);
    shutdown(ctx);
    const visAfter = ui.setWorkingVisible.mock.calls.length;
    const clearAfter = cl.mock.calls.length;
    shutdown(ctx); // spinFlag already reset, handle already cleared
    expect(ui.setWorkingVisible.mock.calls.length).toBe(visAfter);
    expect(cl.mock.calls.length).toBe(clearAfter);
  });
});

// ── 2. Off ──────────────────────────────────────────────────────────────

describe("editorSpinPrompt = false", () => {
  it("no timer; setWorkingVisible(true) (default); shutdown is inert; re-start re-applies the flag", () => {
    vi.mocked(loadCoreConfig).mockReturnValue({
      ...DEFAULT_CORE_CONFIG,
      editorSpinPrompt: false,
    });

    start(ctx);
    expect(ui.setWorkingVisible.mock.calls.at(-1)?.[0]).toBe(true);

    buildEditor(ui);
    expect(spinTimerCount()).toBe(0);

    const visBeforeShutdown = ui.setWorkingVisible.mock.calls.length;
    const clearBeforeShutdown = cl.mock.calls.length;
    shutdown(ctx); // nothing to restore or reap
    expect(ui.setWorkingVisible.mock.calls.length).toBe(visBeforeShutdown);
    expect(cl.mock.calls.length).toBe(clearBeforeShutdown);

    // Idempotent restore: the flag is re-stored on the next session_start.
    start(ctx);
    expect(ui.setWorkingVisible.mock.calls.at(-1)?.[0]).toBe(true);
  });
});

// ── 3. Orphaned-timer reaping (/reload rebind) ─────────────────────────

describe("orphaned timer reaping", () => {
  it("a re-invoked session_start (the /reload rebind) reaps the previous editor's timer before the new editor constructs", () => {
    vi.mocked(loadCoreConfig).mockReturnValue(DEFAULT_CORE_CONFIG);

    // (1) First session_start
    start(ctx);
    buildEditor(ui); // real ctor starts the timer → onSpinInterval stores it
    const tokenA = si.mock.results[si.mock.calls.length - 1]!.value;
    expect(spinTimerCount()).toBe(1);

    // (3) /reload rebind — session_start runs BEFORE factory B is built,
    // so merely calling factory A again would NOT trigger the reap.
    const reconnectsBefore = ui.setEditorComponent.mock.calls.length;
    start(ctx);
    expect(ui.setEditorComponent.mock.calls.length).toBe(reconnectsBefore + 1);
    expect(cl.mock.calls.at(-1)?.[0]).toBe(tokenA);
    const clearOrderA =
      cl.mock.invocationCallOrder[cl.mock.calls.length - 1]!;

    // (4) Build factory B's editor (new constructor, new timer)
    buildEditor(ui);
    expect(spinTimerCount()).toBe(2);
    const setOrderB =
      si.mock.invocationCallOrder[si.mock.calls.length - 1]!;

    // (5) The orphan was reaped BEFORE the new editor's setInterval
    expect(clearOrderA).toBeLessThan(setOrderB);
  });
});
