import { describe, it, expect, vi, afterEach } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * The footer paints git/jj facts that are refreshed in the background, so a
 * refresh has to ask for a frame or the stale value stays on screen. These
 * tests cover the wiring — git.test.ts / jj.test.ts cover when the bus
 * publishes.
 */

// Load the footer's module graph at COLLECT time, before any test starts.
//
// Every test below builds a footer from a freshly imported module (`vi.resetModules`
// + dynamic import), and the first of those imports used to happen inside the
// first test — so the first test was charged the one-off cost of transforming
// and instantiating the whole graph (`index.ts` → `pi-tui` → `@pi-archimedes/core`
// → …): 1.1s when this file runs alone, 2.6s in a full suite run, 8.3s measured
// on a loaded machine. That is not a test failure, it is a test that spent the
// 5s default budget loading code, so under CPU contention the run dies with
// "Test timed out in 5000ms" on whichever test happened to be cold — this one,
// in practice, and it passed on every re-run, which is what made it look like an
// ordering race. Collection has no per-test timeout, so paying the cost here
// removes the race instead of outwaiting it; the tests still get a fresh module
// instance each time from `vi.resetModules()`, now against a warm graph (~20ms).
import "./index.js";

interface FooterInstance {
  render(width: number): string[];
  dispose(): void;
  invalidate(): void;
}

type FooterFactory = (tui: { requestRender: () => void }, theme: unknown, footerData: unknown) => FooterInstance;

interface HarnessOptions {
  /** Make the session-entry read the footer depends on throw. */
  failStats?: boolean;
  /** Override `ctx.ui.notify` (to simulate a UI that cannot be told). */
  brokenNotify?: boolean;
}

interface Harness {
  factory: FooterFactory;
  notify: () => void;
  shutdown: () => void;
  /** What the footer pushed at `ctx.ui.notify`. */
  userNotice: ReturnType<typeof vi.fn>;
  /** The mocked `getGitStatus`, spied so a test can prove the footer loaded it. */
  gitStatus: ReturnType<typeof vi.fn>;
  /** What the footer pushed at the diagnostics sink. */
  diagCalls: Array<[string, string]>;
}

const THEME = { fg: (_token: string, s: string) => s };

function makeFooterData() {
  return {
    onBranchChange: () => vi.fn(),
    getGitBranch: () => "main",
    getExtensionStatuses: () => new Map<string, string>(),
  };
}

/**
 * Footers built by the test that is currently running, so `afterEach` can hand
 * each one back. The VCS-change bus is a module-level listener set, so a test
 * that built a footer and never disposed it leaves a subscriber behind; today
 * that is invisible only because `loadFooter` resets the module registry and
 * takes a fresh listener set with it. Disposing here keeps each test owning its
 * own subscriptions rather than relying on the reset to launder them — and what
 * `dispose()` actually hands back is asserted by the tests below, not assumed
 * by this hook: drop a release from `dispose()` and one of them goes red.
 */
let builtFooters: FooterInstance[] = [];

afterEach(() => {
  for (const footer of builtFooters) footer.dispose();
  builtFooters = [];
});

async function loadFooter(options: HarnessOptions = {}): Promise<Harness> {
  vi.resetModules();
  // Spied, so a test can tell whether the footer loaded the mock below or the
  // real module: `doMock` applies only to imports after the reset, so a module
  // graph that survived the collect-time warm-up would mean every assertion in
  // this file was reading the developer's own repository instead.
  const getGitStatus = vi.fn(() => ({ staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0 }));
  vi.doMock("./utils/git.js", () => ({
    getGitStatus,
    isInsideLinkedWorktree: () => false,
  }));
  vi.doMock("./utils/jj.js", () => ({ getJjBookmark: () => null, getJjChangedFiles: () => 0 }));
  // Pin the footer's own settings to the shipped defaults. `session_start` calls
  // `loadFooterConfig()`, which reads the developer's `settings.json`, so a saved
  // `archimedes.footer.branchMaxLength` of 1–3 truncates the branch the fixtures
  // assert on and a small `splitThreshold` repaginates the line: with
  // `branchMaxLength: 2` set, three tests here fail on a footer that works
  // perfectly. Mocked against the real defaults, so the numbers below are the
  // ones the test claims rather than the ones a laptop happens to hold.
  vi.doMock("./config.js", async (importOriginal) => {
    const real = await importOriginal<typeof import("./config.js")>();
    return { ...real, loadFooterConfig: () => real.DEFAULT_FOOTER_CONFIG };
  });

  const diagCalls: Array<[string, string]> = [];
  // Partial mock: the sink is fake (that is what the assertions read), while
  // `describeError` stays the real one, so a stack assertion here tests the
  // footer's call site rather than a copy of the formatter.
  vi.doMock("@pi-archimedes/core/log", async (importOriginal) => {
    const real = await importOriginal<typeof import("@pi-archimedes/core/log")>();
    return {
      ...real,
      diag: (scope: string, message: string) => {
        diagCalls.push([scope, message]);
      },
    };
  });

  const { registerFooter } = await import("./index.js");
  const { notifyVcsChange } = await import("./utils/vcs-change-events.js");

  const handlers: Record<string, (event: unknown, ctx: ExtensionContext) => void> = {};
  const pi = {
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => void) => {
      handlers[event] = handler;
      return () => {};
    },
    getThinkingLevel: () => "off",
  } as unknown as ExtensionAPI;

  let installed: FooterFactory | undefined;
  const userNotice = vi.fn(() => {
    if (options.brokenNotify) throw new Error("stale UI");
  });
  const ctx = {
    hasUI: true,
    model: undefined,
    ui: {
      setFooter: (f: FooterFactory) => {
        installed = f;
      },
      notify: userNotice,
    },
    sessionManager: {
      getEntries: () => {
        if (options.failStats) throw new Error("session store exploded");
        return [];
      },
      getSessionId: () => "s",
      getLeafId: () => null,
    },
    getContextUsage: () => undefined,
  } as unknown as ExtensionContext;

  registerFooter(pi);
  handlers["session_start"]!({}, ctx);
  if (!installed) throw new Error("footer factory was never installed");
  // Wrap the installed factory so teardown can dispose whatever a test builds
  // (see `builtFooters`); the tests themselves are unchanged by the wrapper.
  const factory: FooterFactory = (tui, theme, footerData) => {
    const footer = installed!(tui, theme, footerData);
    builtFooters.push(footer);
    return footer;
  };
  return {
    factory,
    notify: notifyVcsChange,
    shutdown: () => handlers["session_shutdown"]!({}, ctx),
    userNotice,
    gitStatus: getGitStatus,
    diagCalls,
  };
}

describe("footer repaint wiring", () => {
  it("requests a render when a background VCS refresh reports a change", async () => {
    const { factory, notify } = await loadFooter();
    const tui = { requestRender: vi.fn() };
    factory(tui, THEME, makeFooterData());

    notify();
    expect(tui.requestRender).toHaveBeenCalledTimes(1);
  });

  it("stops requesting renders once the footer is disposed", async () => {
    const { factory, notify } = await loadFooter();
    const tui = { requestRender: vi.fn() };
    const footer = factory(tui, THEME, makeFooterData());

    notify();
    expect(tui.requestRender).toHaveBeenCalledTimes(1);

    footer.dispose();
    notify();
    expect(tui.requestRender).toHaveBeenCalledTimes(1);
  });

  it("releases the host's branch-change subscription when the footer is disposed", async () => {
    // `dispose()` has two subscriptions to hand back. The VCS-change one is
    // observable through `requestRender`, which is how the tests above cover it.
    // The host's branch-change callback is not observable from here, so nothing
    // read it: deleting `unsubscribe()` from `dispose()` left every test in this
    // file green (measured: 125/125 in the package) while a disposed footer
    // stayed subscribed to the host and kept repainting a screen nobody shows.
    // This test is what makes that mutation illegal.
    const branchUnsubscribe = vi.fn();
    const { factory } = await loadFooter();
    const footer = factory({ requestRender: vi.fn() }, THEME, {
      onBranchChange: () => branchUnsubscribe,
      getGitBranch: () => "main",
      getExtensionStatuses: () => new Map<string, string>(),
    });

    expect(branchUnsubscribe).not.toHaveBeenCalled();
    footer.dispose();
    expect(branchUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("repaints only the newest footer when the footer is rebuilt without disposal", async () => {
    // A /reload or a second setFooter() call can install a new footer without
    // disposing the old one; a listener left on the previous TUI would paint a
    // dead screen (and accumulate one per reload).
    const { factory, notify } = await loadFooter();
    const staleTui = { requestRender: vi.fn() };
    factory(staleTui, THEME, makeFooterData());

    const liveTui = { requestRender: vi.fn() };
    factory(liveTui, THEME, makeFooterData());

    notify();
    expect(liveTui.requestRender).toHaveBeenCalledTimes(1);
    expect(staleTui.requestRender).not.toHaveBeenCalled();
  });

  it("gives every fixture its own module graph, so no subscription crosses tests", async () => {
    // The graph is warmed at collect time and the registry is reset per
    // `loadFooter()` call. Should the warm-up ever leave one graph shared, the
    // second fixture's `notify()` would drive the FIRST module instance's
    // listener set and a footer from an earlier fixture would repaint through
    // it — the order coupling these tests are meant to be free of, and the one
    // thing a collect-time import could plausibly break. So: assert the reset
    // is still real, rather than trusting that it is.
    const earlier = await loadFooter();
    const earlierTui = { requestRender: vi.fn() };
    earlier.factory(earlierTui, THEME, makeFooterData());
    earlier.notify();
    expect(earlierTui.requestRender).toHaveBeenCalledTimes(1);

    const later = await loadFooter();
    const laterTui = { requestRender: vi.fn() };
    later.factory(laterTui, THEME, makeFooterData());

    earlierTui.requestRender.mockClear();
    later.notify();
    expect(laterTui.requestRender).toHaveBeenCalledTimes(1);
    expect(earlierTui.requestRender).not.toHaveBeenCalled();
  });

  it("paints a frame from the fixture's git mock, not from the machine's repository", async () => {
    // Companion check to the one above, and about the fixture's own honesty:
    // `vi.doMock` only reaches imports made after the reset, so a registry that
    // survived the warm-up would swap the real `./utils/git.js` back in and
    // every assertion in this file would quietly be reading the developer's
    // working copy — including the two render tests below, which only ever
    // exercise the FAILED render path. This asserts a real frame is painted and
    // that the mock is the module the footer actually called.
    const { factory, gitStatus } = await loadFooter();
    const footer = factory({ requestRender: vi.fn() }, THEME, makeFooterData());

    const lines = footer.render(200);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join(" ")).toContain("main");
    expect(gitStatus).toHaveBeenCalled();
  });

  it("stops requesting renders once session_shutdown fires", async () => {
    // The session is over, so the subscription has to go with it — a listener
    // left behind would outlive the session and repaint a dead footer.
    const { factory, notify, shutdown } = await loadFooter();
    const tui = { requestRender: vi.fn() };
    factory(tui, THEME, makeFooterData());

    notify();
    expect(tui.requestRender).toHaveBeenCalledTimes(1);

    shutdown();
    notify();
    expect(tui.requestRender).toHaveBeenCalledTimes(1);
  });

  it("keeps the live footer subscribed when a replaced footer is disposed afterwards", async () => {
    // The stale footer is disposed after a newer footer already took the
    // module-level handle, so its dispose() must release only its own
    // subscription — releasing whatever the handle points at now would
    // unsubscribe the live footer and freeze the screen on background refresh.
    const { factory, notify } = await loadFooter();
    const staleTui = { requestRender: vi.fn() };
    const staleFooter = factory(staleTui, THEME, makeFooterData());

    const liveTui = { requestRender: vi.fn() };
    factory(liveTui, THEME, makeFooterData());

    staleFooter.dispose();
    notify();
    expect(staleTui.requestRender).not.toHaveBeenCalled();
    expect(liveTui.requestRender).toHaveBeenCalledTimes(1);
  });

  it("releases the live subscription on rebuild after a replaced footer was disposed", async () => {
    // Same interleaving as above, then a further rebuild. The guard is what
    // keeps the handle pointing at the live subscription, so the next footer
    // can still release it; clear the handle too eagerly and the replaced
    // footer leaks and keeps painting a screen nobody shows.
    const { factory, notify } = await loadFooter();
    const staleTui = { requestRender: vi.fn() };
    const staleFooter = factory(staleTui, THEME, makeFooterData());

    const midTui = { requestRender: vi.fn() };
    factory(midTui, THEME, makeFooterData());

    staleFooter.dispose();

    const newestTui = { requestRender: vi.fn() };
    factory(newestTui, THEME, makeFooterData());

    notify();
    expect(newestTui.requestRender).toHaveBeenCalledTimes(1);
    expect(midTui.requestRender).not.toHaveBeenCalled();
    expect(staleTui.requestRender).not.toHaveBeenCalled();
  });
});

describe("footer render failure surface", () => {
  it("diagnoses the failure to the log and tells the user exactly once", async () => {
    // A failed render is a blank status bar — the user must be told — but
    // `render()` runs on every frame, so the console AND a notify per frame are
    // both unacceptable: detail to the log, one line to the user.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { factory, userNotice, diagCalls } = await loadFooter({ failStats: true });
      const footer = factory({ requestRender: vi.fn() }, THEME, makeFooterData());

      expect(footer.render(80)).toEqual([]);
      expect(footer.render(80)).toEqual([]);

      expect(consoleError).not.toHaveBeenCalled();
      // One diagnosis per failed frame — the detail is what debugging needs.
      expect(diagCalls.length).toBe(2);
      expect(diagCalls[0]![0]).toBe("footer");
      expect(diagCalls[0]![1]).toContain("session store exploded");
      // …and it carries the origin, not just the message: `console.error(scope,
      // err)` used to print the stack, and for a swallowed render failure the
      // log is the only place that stack ever appears.
      expect(diagCalls[0]![1]).toMatch(/\n\s+at\s+\S/);
      expect(userNotice).toHaveBeenCalledTimes(1);
      expect(userNotice.mock.calls[0]![0]).not.toContain("\n");
      expect(userNotice.mock.calls[0]![1]).toBe("warning");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("still records the diagnosis when the UI cannot be told", async () => {
    // After a session replacement the context can be stale, and a failed
    // report must not turn into a second failure inside the render path.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { factory, diagCalls } = await loadFooter({ failStats: true, brokenNotify: true });
      const footer = factory({ requestRender: vi.fn() }, THEME, makeFooterData());

      expect(() => footer.render(80)).not.toThrow();
      expect(footer.render(80)).toEqual([]);
      expect(consoleError).not.toHaveBeenCalled();
      expect(diagCalls.length).toBeGreaterThanOrEqual(1);
      expect(diagCalls[0]![1]).toContain("session store exploded");
    } finally {
      consoleError.mockRestore();
    }
  });
});
