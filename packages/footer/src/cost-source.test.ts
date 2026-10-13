/**
 * Where the footer's cost total comes from.
 *
 * The subagent used to smuggle a child's usage to the footer over the suite bus
 * (`subagent/src/cost.ts` → `COST_UPDATE` → `CostAccumulator`), which the footer
 * then added to its own read of the session entries. Once the tool result carries
 * native `usage`, pi persists that usage onto the toolResult message and the
 * footer's own entry scan (`utils/stats.ts`, `extractEntryUsage`) already counts
 * it — so the accumulator stops being an addition and becomes a second copy of
 * the same money. These tests are the proof of both halves.
 */

import { describe, it, expect, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getBus, Events } from "@pi-archimedes/core/bus";
import { formatTokenCount } from "./utils/format.js";

interface FooterInstance {
  render(width: number): string[];
  dispose(): void;
  invalidate(): void;
}

type FooterFactory = (
  tui: { requestRender: () => void },
  theme: unknown,
  footerData: unknown,
) => FooterInstance;

const THEME = { fg: (_token: string, s: string) => s };

/** One subagent's worth of usage, big enough to survive two decimal places. */
const CHILD_USAGE = {
  input: 4000,
  output: 1500,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 5500,
  cost: { input: 0.1, output: 0.1, cacheRead: 0, cacheWrite: 0, total: 0.2 },
};

/** The entry pi persists for a tool result that returned `usage`. */
function toolResultEntry(id: string, usage: unknown) {
  return { id, type: "message", message: { role: "toolResult", toolCallId: "t1", toolName: "subagent", usage } };
}

function assistantEntry(id: string) {
  return {
    id,
    type: "message",
    message: {
      role: "assistant",
      content: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    },
  };
}

async function installFooter(entries: unknown[]): Promise<{ rendered: (width?: number) => string[]; shutdown: () => void }> {
  vi.resetModules();
  vi.doMock("./utils/git.js", () => ({
    getGitStatus: () => ({ staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0 }),
    isInsideLinkedWorktree: () => false,
  }));
  vi.doMock("./utils/jj.js", () => ({ getJjBookmark: () => null, getJjChangedFiles: () => 0 }));

  const { registerFooter } = await import("./index.js");

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
    hasUI: true,
    model: undefined,
    ui: {
      setFooter: (f: FooterFactory) => {
        factory = f;
      },
      notify: vi.fn(),
    },
    sessionManager: {
      getEntries: () => entries as never,
      getSessionId: () => "s",
      getLeafId: () => null,
    },
    getContextUsage: () => undefined,
  } as unknown as ExtensionContext;

  registerFooter(pi);
  handlers["session_start"]!({}, ctx);
  if (!factory) throw new Error("footer factory was never installed");
  const footer = factory({ requestRender: vi.fn() }, THEME, {
    onBranchChange: () => vi.fn(),
    getGitBranch: () => "main",
    getExtensionStatuses: () => new Map<string, string>(),
  });
  return {
    rendered: (width = 200) => footer.render(width),
    shutdown: () => handlers["session_shutdown"]!({}, ctx),
  };
}

/** The `$` figure the footer painted, or undefined when it painted none. */
function paintedCost(lines: string[]): string | undefined {
  const match = lines.join(" ").match(/\$\d+\.\d{2}/);
  return match?.[0];
}

describe("the footer counts a subagent's cost once", () => {
  it("a toolResult entry carrying usage is already in the footer's total", async () => {
    const { rendered, shutdown } = await installFooter([
      assistantEntry("e1"),
      toolResultEntry("e2", CHILD_USAGE),
    ]);
    const lines = rendered();
    expect(paintedCost(lines)).toBe("$0.20");
    expect(lines.join(" ")).toContain("↑" + formatTokenCount(CHILD_USAGE.input));
    shutdown();
  });

  it("ignores COST_UPDATE bus traffic: there is no accumulator left to double-count", async () => {
    // The route this replaced (`subagent/src/cost.ts` → `COST_UPDATE` →
    // `CostAccumulator`) added the same usage a second time on top of the entry
    // scan above — measured at `$0.40` / `↑7.8k` for one child before the
    // removal. Anything still publishing on that channel (the bridge's own
    // self-usage emitter does) must not reach the status bar twice.
    const { rendered, shutdown } = await installFooter([
      assistantEntry("e1"),
      toolResultEntry("e2", CHILD_USAGE),
    ]);
    getBus().emit(Events.COST_UPDATE, {
      source: "subagent:reviewer",
      inputTokens: CHILD_USAGE.input,
      outputTokens: CHILD_USAGE.output,
      cost: CHILD_USAGE.cost.total,
    });
    const lines = rendered();
    expect(paintedCost(lines)).toBe("$0.20");
    expect(lines.join(" ")).toContain("↑" + formatTokenCount(CHILD_USAGE.input));
    expect(lines.join(" ")).not.toContain("↑" + formatTokenCount(CHILD_USAGE.input * 2));
    shutdown();
  });

  it("starts a fresh session with nothing carried over from the bus", async () => {
    // No accumulator, no queue replay: a footer installed after earlier
    // COST_UPDATE traffic still reports only what the session entries say.
    getBus().emit(Events.COST_UPDATE, { source: "main", inputTokens: 9999, cost: 9.99 });
    const { rendered, shutdown } = await installFooter([assistantEntry("e1")]);
    const lines = rendered();
    expect(paintedCost(lines)).toBeUndefined();
    expect(lines.join(" ")).not.toContain("$9.99");
    shutdown();
  });
});
