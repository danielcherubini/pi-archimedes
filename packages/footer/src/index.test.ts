import { describe, it, expect, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * The footer paints git/jj facts that are refreshed in the background, so a
 * refresh has to ask for a frame or the stale value stays on screen. These
 * tests cover the wiring — git.test.ts / jj.test.ts cover when the bus
 * publishes.
 */

interface FooterInstance {
  render(width: number): string[];
  dispose(): void;
  invalidate(): void;
}

type FooterFactory = (tui: { requestRender: () => void }, theme: unknown, footerData: unknown) => FooterInstance;

interface Harness {
  factory: FooterFactory;
  notify: () => void;
  shutdown: () => void;
}

const THEME = { fg: (_token: string, s: string) => s };

function makeFooterData() {
  return {
    onBranchChange: () => vi.fn(),
    getGitBranch: () => "main",
    getExtensionStatuses: () => new Map<string, string>(),
  };
}

async function loadFooter(): Promise<Harness> {
  vi.resetModules();
  vi.doMock("./utils/git.js", () => ({
    getGitStatus: () => ({ staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0 }),
    isInsideLinkedWorktree: () => false,
  }));
  vi.doMock("./utils/jj.js", () => ({ getJjBookmark: () => null, getJjChangedFiles: () => 0 }));

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

  let factory: FooterFactory | undefined;
  const ctx = {
    model: undefined,
    ui: {
      setFooter: (f: FooterFactory) => {
        factory = f;
      },
    },
    sessionManager: { getEntries: () => [], getSessionId: () => "s", getLeafId: () => null },
    getContextUsage: () => undefined,
  } as unknown as ExtensionContext;

  registerFooter(pi);
  handlers["session_start"]!({}, ctx);
  if (!factory) throw new Error("footer factory was never installed");
  return {
    factory,
    notify: notifyVcsChange,
    shutdown: () => handlers["session_shutdown"]!({}, ctx),
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
