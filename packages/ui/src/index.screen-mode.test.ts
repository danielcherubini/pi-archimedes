import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

// logo.js decides TRUECOLOR once, at import time, from the environment. Pin it
// before anything imports the splash, so the assertions below are about which
// animation *frame* got rendered rather than about the machine running them.
vi.hoisted(() => {
  process.env.COLORTERM = "truecolor";
});

// ── Screen mode (ADR 0027) ───────────────────────────────────────────────────
//
// Two things used to be gated on the screen: the splash animation and the
// startup resource listing. The listing was scraped out of pi's component tree
// and re-rendered into the header, appending into terminal scrollback — which
// fullscreen screen does not have. Task 8 deleted that half (pi owns its
// listing now, and `quietStartup` is the supported knob), leaving the logo
// animation, which only advances a frame counter and asks *the renderer we were
// just handed* for a frame. That is screen-safe, so the gate is gone; what
// still differs per screen is the height the header sizes itself against, read
// from the same per-call capability check.
//
// Nothing in `./startup/index.js` is stubbed here. These tests are about which
// renderer the animation drives, how tall the header comes out, and whether the
// animation *finishes* — and the finished state is the reveal's doing: the
// `[Version]` row only exists once `revealStartupListing` has fired, and
// `ref.settled` — the flag that stops the redraws — is only ever set by
// `renderHeader` itself. Stub either half and the tests measure a splash
// production never shows, so `requestRender` is wired to actually render the
// header, exactly as pi's renderer does.
//
// `isViewportTUI` is faked by marker so a single test file can present both
// screens to the same module instance: a fake renderer carrying
// `__viewport: true` is a viewport TUI, anything else is the regular one.

vi.mock("@earendil-works/pi-tui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-tui")>();
  return {
    ...actual,
    isViewportTUI: vi.fn((tui: unknown) => (tui as { __viewport?: boolean })?.__viewport === true),
  };
});

// Real `readEffectiveSettings` (the splash reads pi's `quietStartup` through
// it); the namespace helpers are stubbed because the UI config they serve is
// stubbed below.
vi.mock("@pi-archimedes/core/settings-io", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pi-archimedes/core/settings-io")>();
  return {
    ...actual,
    loadConfig: vi.fn(),
    saveConfig: vi.fn(),
    removeConfig: vi.fn(),
  };
});

vi.mock("./config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config.js")>();
  return { ...actual, loadUIConfig: vi.fn() };
});

vi.mock("./thinking/patch.js", () => ({ patchThinkingRenderer: vi.fn() }));
vi.mock("./thinking/transform.js", () => ({ transformThinkingContent: vi.fn() }));

vi.mock("./migration.js", () => ({
  migrateCoreToUIConfig: vi.fn(),
  migrateCompactThinkingToStyle: vi.fn(),
  migrateRemovedToolPatch: vi.fn(),
  UI_CONFIG_KEYS: [],
}));

vi.mock("./bash/index.js", () => ({
  renderBashCall: vi.fn(),
  renderBashResult: vi.fn(),
  clearActiveBashIntervals: vi.fn(),
}));

vi.mock("./codemode/index.js", () => ({
  renderCodemodeCall: vi.fn(),
  renderCodemodeResult: vi.fn(),
  clearActiveCodemodeIntervals: vi.fn(),
}));

import { VERSION } from "@earendil-works/pi-coding-agent";
import { registerUI } from "./index.js";
import { stripAnsi } from "@pi-archimedes/core/text";
import { loadUIConfig, DEFAULT_UI_CONFIG } from "./config.js";
import { stopStartupListing } from "./startup/index.js";
import { getShinedLogo, LOGO, LOGO_SETTLE_FRAME } from "./startup/logo.js";

// ── Harness ─────────────────────────────────────────────────────────────────

const ROWS = 24;
const WIDTH = 80;

type HeaderFactory = (tui: TUI, theme: Theme) => {
  render(width: number): string[];
  invalidate(): void;
  dispose(): void;
};

/** Start a session the way pi does and hand back the header factory it installed. */
function startSession(): { headerFactory: HeaderFactory } {
  const listeners: Record<string, ((event: any, ctx: any) => void)[]> = {};
  const pi = {
    on: vi.fn((event: string, handler: (event: any, ctx: any) => void) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event]!.push(handler);
    }),
    registerTool: vi.fn(),
    getSettings: vi.fn(() => ({})),
  } as unknown as ExtensionAPI;

  const setHeader = vi.fn();
  const ctx = {
    hasUI: true,
    cwd: "/workspace/test-project",
    scopedModels: [],
    ui: {
      setHeader,
      setEditorComponent: vi.fn(),
      setWorkingVisible: vi.fn(),
      theme: {} as Theme,
    },
    isIdle: vi.fn(() => true),
    shutdown: vi.fn(),
  } as unknown as ExtensionContext;

  registerUI(pi);
  for (const handler of listeners["session_start"] ?? []) handler(null, ctx);

  return { headerFactory: setHeader.mock.calls[0]![0] as HeaderFactory };
}

const THEME = { fg: (_token: string, text: string) => text } as unknown as Theme;

/**
 * Install the splash on a renderer for one of the two screens, with
 * `requestRender` doing what pi's renderer does — draw the header — so the
 * animation can reach the state that stops it.
 */
function installSplash(viewport: boolean, rows = ROWS): Splash {
  const { headerFactory } = startSession();
  const holder: { comp?: HeaderFactory extends (t: TUI, th: Theme) => infer C ? C : never } = {};
  const frames: string[][] = [];
  const tui = {
    terminal: { rows },
    requestRender: vi.fn(() => {
      if (holder.comp) frames.push(holder.comp.render(WIDTH).map((line) => line.trim()));
    }),
    __viewport: viewport,
  } as unknown as TUI;
  const comp = headerFactory(tui, THEME);
  holder.comp = comp;
  return {
    tui,
    comp,
    frames,
    requestRender: (tui as unknown as { requestRender: Mock }).requestRender,
  };
}

interface Splash {
  tui: TUI;
  comp: { render(width: number): string[]; dispose(): void };
  /** Every frame the renderer drew, oldest first (trimmed of padding). */
  frames: string[][];
  requestRender: Mock;
}

/** The settled logo rows, as the completed splash draws them. */
const settledLogoRows = (): string[] =>
  getShinedLogo(LOGO_SETTLE_FRAME, DEFAULT_UI_CONFIG.animationStyle, DEFAULT_UI_CONFIG.colorfulLogo)
    .map((l) => l.trim());

/**
 * The settled logo, drawn contiguously somewhere in the header. Contiguously
 * rather than "at line 0", because on regular screen the splash is padded to
 * the terminal above and below, so the logo starts part-way down the block.
 */
const drawsSettledLogo = (lines: readonly string[]): boolean => {
  const haystack = lines.join("\n");
  return haystack.includes(settledLogoRows().join("\n"));
};

const hasVersionRow = (lines: readonly string[]): boolean =>
  lines.some((l) => l.includes("[Version]")) && lines.some((l) => l.includes(`v${VERSION}`));

describe("startup splash on either screen", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadUIConfig).mockReturnValue({ ...DEFAULT_UI_CONFIG });
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stopStartupListing();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  for (const [label, viewport] of [
    ["regular screen", false],
    ["fullscreen screen", true],
  ] as const) {
    it(`animates the splash on ${label}, driving the renderer it was handed`, () => {
      vi.useFakeTimers();
      const splash = installSplash(viewport);
      vi.advanceTimersByTime(100);

      // The frame timer runs, and it asks *this* renderer for its frames.
      expect(splash.requestRender).toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    });

    // The reveal is production's own path — `ui/src/index.ts` calls
    // `revealStartupListing` on every install, even with no model scope to
    // show — and it carries the header's second half: the `[Version]` row.
    // A splash that stops repainting before the text arrived is the failure
    // #92 was about, so "the redraws stopped" is only worth asserting *after*
    // the revealed text is on screen, and on both screens: the text ramp is
    // what sets `ref.settled`, the flag that stops the timer.
    it(`draws the revealed version row on ${label}, then stops asking for frames`, () => {
      vi.useFakeTimers();
      const splash = installSplash(viewport);

      vi.advanceTimersByTime(5_000);
      const framesAtSettle = splash.requestRender.mock.calls.length;
      expect(framesAtSettle).toBeGreaterThan(0);

      // The text half arrived and finished ramping — the header is at rest.
      const last = splash.frames.at(-1);
      expect(last, "the renderer was asked for frames but nothing was drawn").toBeDefined();
      expect(hasVersionRow(last!)).toBe(true);
      expect(drawsSettledLogo(last!)).toBe(true);

      vi.advanceTimersByTime(5_000);
      expect(splash.requestRender.mock.calls.length).toBe(framesAtSettle);
    });

    // `settleHeader()` is gone (Task 8): nothing has to freeze the header at
    // `LOGO_SETTLE_FRAME` any more, because the frame timer runs on both
    // screens and settles by itself. This is that claim, per screen — the
    // first frame the renderer is asked to draw is already mid-reveal and the
    // last one is the finished logo, so a header rendered after the timer
    // stopped cannot come out frozen at frame 0 (an invisible logo).
    it(`finishes the logo on ${label} without anything freezing it`, () => {
      vi.useFakeTimers();
      const splash = installSplash(viewport);

      vi.advanceTimersByTime(5_000);
      const last = splash.frames.at(-1)!;
      expect(drawsSettledLogo(last)).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    });

    // pi disposes the previous header before it builds the next one
    // (`setExtensionHeader()`), and this splash has no stored renderer to lean
    // on, so `dispose()` is the only thing that can stop the timers. If it
    // missed, a replaced splash would keep asking a renderer nobody draws from.
    it(`stops the old splash when the header is replaced on ${label}`, () => {
      vi.useFakeTimers();
      const oldSplash = installSplash(viewport);
      vi.advanceTimersByTime(50);
      const framesBeforeReplace = oldSplash.requestRender.mock.calls.length;
      expect(framesBeforeReplace).toBeGreaterThan(0);

      oldSplash.comp.dispose();
      vi.advanceTimersByTime(1_000);
      expect(oldSplash.requestRender.mock.calls.length).toBe(framesBeforeReplace);
    });
  }

  it("re-reads the screen per install instead of caching the first renderer", () => {
    // Same factory, renderer swapped underneath it. Note what pi actually
    // re-invokes: `setExtensionHeader()` calls the factory again on `/reload`
    // and on any `setHeader()` replacement. A `tuiMode` switch does *not* — it
    // re-mounts the components it already has (`switchTuiMode()` never touches
    // `customHeader`), which is why the header keeps the sizing of the screen
    // it was installed on. That is pi's contract, not a choice here; the
    // splash only promises to follow the renderer in hand at install time.
    const regular = installSplash(false);
    expect(regular.comp.render(WIDTH)).toHaveLength(ROWS - 3);

    const viewport = installSplash(true);
    expect(viewport.comp.render(WIDTH).length).toBeLessThan(ROWS - 3);

    const backToRegular = installSplash(false);
    expect(backToRegular.comp.render(WIDTH)).toHaveLength(ROWS - 3);
  });
});

// ── What the header actually draws on each screen ───────────────────────────
//
// Installing the splash on both screens is only half of it. The header is
// drawn from the animation ref, so it must arrive at the finished state
// whatever the screen, and it must not be sized to a terminal it does not
// scroll through: inside a viewport a header padded to `rows - 3` would crowd
// out everything the layout still has to fit.
describe("header output per screen mode", () => {
  beforeEach(() => {
    vi.mocked(loadUIConfig).mockReturnValue({ ...DEFAULT_UI_CONFIG });
  });

  afterEach(() => {
    stopStartupListing();
    vi.useRealTimers();
  });

  /** Install the splash, then let the animation run to its end. */
  function settled(viewport: boolean, rows = ROWS): string[] {
    vi.useFakeTimers();
    const splash = installSplash(viewport, rows);
    vi.advanceTimersByTime(5_000);
    return splash.comp.render(WIDTH).map((l) => l.trim());
  }

  it("draws the settled logo on fullscreen screen, not the animation's first frame", () => {
    const lines = settled(true);

    expect(drawsSettledLogo(lines)).toBe(true);
    // Stripped: a truecolor logo colours every block character separately, so
    // a run of blocks is not a literal run of block code points.
    expect(stripAnsi(lines.join("\n"))).toContain("████");
  });

  it("draws the version row on both screens at rest", () => {
    expect(hasVersionRow(settled(false))).toBe(true);
    expect(hasVersionRow(settled(true))).toBe(true);
  });

  it("does not pad the header to terminal height on a frame-bounded screen", () => {
    const lines = settled(true);

    // The viewport allocates its own height, so the header is its own content:
    // logo, separator, version block. `CONTENT_ONLY_HEIGHT` is what keeps it
    // that way — padded to `rows - 3` it would be the whole screen.
    expect(lines.length).toBe(LOGO.length + 3);
    expect(lines.length).toBeLessThan(ROWS - 3);
    // Only the structural blanks: the separator under the logo and the spacer
    // `formatColumns` puts under the version block. No centre-the-splash
    // padding rows.
    expect(lines.filter((l) => l === "")).toHaveLength(2);
  });

  it("keeps a frame-bounded header the same height whatever the terminal rows", () => {
    // The viewport owns the height, so the terminal must not leak into it —
    // `CONTENT_ONLY_HEIGHT` means "content", not "content plus a guess".
    expect(settled(true, 24)).toEqual(settled(true, 60));
  });

  it("still sizes the header to the terminal on regular screen, where the splash scrolls away", () => {
    vi.useFakeTimers();
    const splash = installSplash(false);
    vi.advanceTimersByTime(5_000);

    expect(splash.comp.render(WIDTH)).toHaveLength(ROWS - 3);
  });

  // A finished splash caches its lines to avoid re-running the text layout on
  // every frame, and those lines carry the theme's colours. pi tells a
  // component to drop cached rendering state by calling `invalidate()`, and it
  // does that for the whole tree on every theme change (`onThemeChange()` →
  // `ui.invalidate()`, interactive-mode.js:792) and from the theme file
  // watcher. So the hook exists, the cache has to honour it, and the cache key
  // (width, height) cannot save it: a theme switch changes neither.
  it("drops its cached lines when pi invalidates it, so a theme change shows", () => {
    vi.useFakeTimers();
    let colour = "38;2;100;100;100";
    const theme = {
      fg: (_token: string, text: string) => `\x1b[${colour}m${text}\x1b[0m`,
      getFgAnsi: () => "",
    } as unknown as Theme;

    const { headerFactory } = startSession();
    const tui = { terminal: { rows: ROWS }, requestRender: vi.fn() } as unknown as TUI;
    const comp = headerFactory(tui, theme);
    vi.advanceTimersByTime(5_000);

    const before = comp.render(WIDTH).join("\n");
    expect(before).toContain(`\x1b[${colour}m`);

    colour = "38;2;0;200;0";
    comp.invalidate();
    const after = comp.render(WIDTH).join("\n");

    expect(after).toContain(`\x1b[${colour}m`);
    expect(after).not.toContain("\x1b[38;2;100;100;100m");
  });
});
