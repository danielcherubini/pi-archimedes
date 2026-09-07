import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import type {
  Theme,
  KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { TUI, EditorTheme } from "@earendil-works/pi-tui";

// ── Mocks ────────────────────────────────────────────────────────────────────

const widthProbe = vi.hoisted(() => ({
  /** Mutable EAW probe: default reports every char as width 1 (non-EAW). */
  probe: (_s: string): number => 1,
}));

vi.mock("@earendil-works/pi-tui", () => ({
  truncateToWidth: (s: string, _w: number, _pad?: string, _incl?: boolean) => s,
  isKeyRelease: () => false,
  visibleWidth: (s: string) => widthProbe.probe!(s),
}));

vi.mock("@earendil-works/pi-coding-agent", () => {
  // Minimal stand-in for pi's CustomEditor: mirrors the verified 0.85.1
  // behavior of reading `tui.terminal.rows` in render() and touching
  // `borderColor` (set from theme.borderColor in the ctor) so missing
  // stubs fail fast.
  class CustomEditor {
    tui: TUI;
    borderColor: (s: string) => string;
    text = "";
    constructor(
      tui: TUI,
      editorTheme: { borderColor: (s: string) => string },
    ) {
      this.tui = tui;
      this.borderColor = editorTheme.borderColor;
    }
    getText(): string {
      return this.text;
    }
    setText(t: string): void {
      this.text = t;
    }
    handleInput(_data: string): void {}
    render(_width: number): string[] {
      void this.tui.terminal.rows;
      return [
        this.borderColor("┌───┐"),
        "input line",
        this.borderColor("└───┘"),
      ];
    }
  }
  return { CustomEditor };
});

import {
  HephaestusEditor,
  SPIN_TICK_MS,
  SPIN_TYPE_CYCLE,
  SPIN_TYPE_START,
  SPIN_TYPE_CELLS,
} from "./index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const stubTheme = {
  fg: (_k: string, t: string) => t,
} as unknown as Theme;

interface ConstructOpts {
  spin?: boolean;
  /** Values consumed one per isIdle() call (idle if no values left). */
  idleSeq?: boolean[];
  onSpinInterval?: (h: ReturnType<typeof setInterval> | undefined) => void;
}

const createdEditors: HephaestusEditor[] = [];

function makeEditor(opts: ConstructOpts = {}): {
  editor: HephaestusEditor;
  tui: ReturnType<typeof makeTui>;
  onSpinInterval?: ReturnType<typeof vi.fn>;
} {
  const tui = makeTui() as unknown as TUI;
  const editorTheme = {
    borderColor: (s: string) => s,
  } as unknown as EditorTheme;
  const keybindings = {} as KeybindingsManager;
  const seq = opts.idleSeq ? opts.idleSeq.slice() : [];
  const onSpinInterval = opts.onSpinInterval
    ? opts.onSpinInterval
    : vi.fn();
  const editor = new HephaestusEditor(tui, editorTheme, keybindings, {
    getTheme: () => stubTheme,
    isIdle: () => (seq.length > 0 ? (seq.shift() as boolean) : true),
    shutdown: vi.fn(),
    spin: opts.spin,
    onSpinInterval,
  } as any);
  createdEditors.push(editor);
  return { editor, tui, onSpinInterval: onSpinInterval as ReturnType<typeof vi.fn> };
}

function makeTui(): { requestRender: () => void; terminal: { rows: number } } {
  return { requestRender: vi.fn(), terminal: { rows: 24 } };
}

const tick = (ed: HephaestusEditor): void => {
  (ed as any).tickSpin();
};

// Rendered lines are wrapped in SGR sequences by wrap(); strip them so a
// position-based prefix check sees pad + prefix + content.
const plain = (l: string) => l.replace(/\x1b\[[0-9;]*m/g, "");

// An editor that has been `step` busy ticks and reports busy to render.
function busyAt(step: number): HephaestusEditor {
  const { editor } = makeEditor({
    spin: true,
    idleSeq: Array.from({ length: step }, () => false),
  });
  for (let i = 0; i < step; i++) tick(editor);
  (editor as any).isIdle = () => false;
  return editor;
}

// The `┌───┐` border row is the second rendered line (first is the plain
// `▁` top edge, which is un-padded; wrapped raw lines carry one PAD_X space).
// Strip pad + corners and SGR; width→inner = width - 4 (PAD_X = 1).
const borderRun = (lines: string[], width: number): string => {
  const top = plain(lines[1]!);
  return top.slice(2, 2 + (width - 4));
};

// Row shape: counting the window's cells (any char other than `─`, i.e.
// stage chars or spaces) as cells, the whole row firms up to all dashes.
const rowFirmsToDashes = (run: string, len: number): void => {
  expect(run.replace(/[^─]/g, "─")).toBe("─".repeat(len));
};

// ── Setup / teardown ────────────────────────────────────────────────────────

beforeAll(() => {
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

afterEach(() => {
  for (const ed of createdEditors) {
    (ed as any).dispose?.();
  }
  createdEditors.length = 0;
  vi.restoreAllMocks();
});

// ── 1. Static prefix, plain idle edge ──────────────────────────────────────

describe("static prefix, plain idle edge", () => {
  it("tickSpin is a no-op while idle: no render, typeStep stays 0", () => {
    const { editor, tui } = makeEditor({ spin: true });
    tick(editor);
    expect(tui.requestRender).not.toHaveBeenCalled();
    expect((editor as any).typeStep).toBe(0);
  });

  it("renders the static > prefix while idle", () => {
    const { editor } = makeEditor({ spin: true });
    tick(editor);
    const lines = editor.render(60);
    // Prefix is attached to the first content line (mock's "input line" row);
    // wrapped lines start with an SGR, so strip it before checking the position
    const prefixLine = lines.find((l) => l.includes("input line"));
    expect(prefixLine).toBeDefined();
    expect(plain(prefixLine!).trimStart().startsWith("> ")).toBe(true);
  });

  it("spin=false also renders the static > prefix", () => {
    const { editor } = makeEditor({ spin: false });
    const lines = editor.render(60);
    const prefixLine = lines.find((l) => l.includes("input line"));
    expect(prefixLine).toBeDefined();
    expect(plain(prefixLine!).trimStart().startsWith("> ")).toBe(true);
  });

  it("prefix is the static > even while busy (chevron never animates)", () => {
    const editor = busyAt(4);
    const lines = editor.render(60);
    const prefixLine = lines.find((l) => l.includes("input line"));
    expect(prefixLine).toBeDefined();
    expect(plain(prefixLine!).trimStart().startsWith("> ")).toBe(true);
  });

  it("idle renders a plain edge row (no stage chars anywhere)", () => {
    const { editor } = makeEditor({ spin: true }); // never went busy
    const lines = editor.render(60);
    const first = plain(lines[0]!);
    expect(first).toBe("▁".repeat(60));
  });

  it("spin=false leaves the edge plain while busy", () => {
    const { editor } = makeEditor({
      spin: false,
      idleSeq: Array(4).fill(false),
    });
    for (let i = 0; i < 4; i++) tick(editor);
    (editor as any).isIdle = () => false;
    const first = plain(editor.render(60)[0]!);
    expect(first).toBe("▁".repeat(60));
  });
});

// ── 2. Busy/idle typing state machine ──────────────────────────────────────

describe("busy/idle typing state machine", () => {
  it("advances typeStep while busy, resets + repaints once on idle, then no-ops", () => {
    // isIdle() returns false, false, true, true across the four ticks
    const { editor, tui } = makeEditor({ spin: true, idleSeq: [false, false, true, true] });

    tick(editor); // busy #1
    expect((editor as any).typeStep).toBe(1);
    expect(tui.requestRender).toHaveBeenCalledTimes(1);

    tick(editor); // busy #2
    expect((editor as any).typeStep).toBe(2);
    expect(tui.requestRender).toHaveBeenCalledTimes(2);

    tick(editor); // idle after busy — reset + exactly one repaint
    expect((editor as any).typeStep).toBe(0);
    expect(tui.requestRender).toHaveBeenCalledTimes(3);

    tick(editor); // idle after idle — full no-op
    expect((editor as any).typeStep).toBe(0);
    expect(tui.requestRender).toHaveBeenCalledTimes(3);
  });

  it("busy streak wraps at SPIN_TYPE_CYCLE (14): clear beat is 4 spaces, then the block grows again", () => {
    const editor = busyAt(SPIN_TYPE_CYCLE - 1); // 13 ticks: s=1..13
    expect((editor as any).typeStep).toBe(SPIN_TYPE_CYCLE - 1);
    tick(editor); // wraps to 0 — the clear beat
    (editor as any).isIdle = () => false;
    expect((editor as any).typeStep).toBe(0);
    const cleared = borderRun(editor.render(60), 60);
    expect(
      cleared.slice(SPIN_TYPE_START, SPIN_TYPE_START + SPIN_TYPE_CELLS),
    ).toBe("    ");
    tick(editor); // back to stage 1
    expect((editor as any).typeStep).toBe(1);
    const regrown = borderRun(editor.render(60), 60);
    expect(
      regrown.slice(SPIN_TYPE_START, SPIN_TYPE_START + SPIN_TYPE_CELLS),
    ).toBe("⠁⠁⠁⠁");
  });
});

// ── 3. Typing strip on the top border row ─────────────────────────────────────

describe("typing strip on the top border row", () => {
  it("stage 1: all 4 cells clone `⠁` (block starts to grow)", () => {
    const run = borderRun(busyAt(1).render(60), 60);
    expect(run.slice(SPIN_TYPE_START, SPIN_TYPE_START + SPIN_TYPE_CELLS)).toBe("⠁⠁⠁⠁");
    rowFirmsToDashes(run, 56);
  });

  it("stage 2: all 4 cells clone `⠉`", () => {
    const run = borderRun(busyAt(2).render(60), 60);
    expect(run.slice(SPIN_TYPE_START, SPIN_TYPE_START + SPIN_TYPE_CELLS)).toBe("⠉⠉⠉⠉");
    rowFirmsToDashes(run, 56);
  });

  it("stage 3: all 4 cells clone `⠋`", () => {
    const run = borderRun(busyAt(3).render(60), 60);
    expect(run.slice(SPIN_TYPE_START, SPIN_TYPE_START + SPIN_TYPE_CELLS)).toBe("⠋⠋⠋⠋");
    rowFirmsToDashes(run, 56);
  });

  it("stage 4: all 4 cells clone `⠛`", () => {
    const run = borderRun(busyAt(4).render(60), 60);
    expect(run.slice(SPIN_TYPE_START, SPIN_TYPE_START + SPIN_TYPE_CELLS)).toBe("⠛⠛⠛⠛");
    rowFirmsToDashes(run, 56);
  });

  it("stage 5: all 4 cells clone `⠟`", () => {
    const run = borderRun(busyAt(5).render(60), 60);
    expect(run.slice(SPIN_TYPE_START, SPIN_TYPE_START + SPIN_TYPE_CELLS)).toBe("⠟⠟⠟⠟");
    rowFirmsToDashes(run, 56);
  });

  it("stage 6: all 4 cells clone `⠿`", () => {
    const run = borderRun(busyAt(6).render(60), 60);
    expect(run.slice(SPIN_TYPE_START, SPIN_TYPE_START + SPIN_TYPE_CELLS)).toBe("⠿⠿⠿⠿");
    rowFirmsToDashes(run, 56);
  });

  it("stage 7: all 4 cells clone `⡿`", () => {
    const run = borderRun(busyAt(7).render(60), 60);
    expect(run.slice(SPIN_TYPE_START, SPIN_TYPE_START + SPIN_TYPE_CELLS)).toBe("⡿⡿⡿⡿");
    rowFirmsToDashes(run, 56);
  });

  it("stage 8: all 4 cells clone `⣿` (block fully grown)", () => {
    const run = borderRun(busyAt(8).render(60), 60);
    expect(run.slice(SPIN_TYPE_START, SPIN_TYPE_START + SPIN_TYPE_CELLS)).toBe("⣿⣿⣿⣿");
    rowFirmsToDashes(run, 56);
  });

  it("hold region (s=9, s=13): full block holds — all 4 cells still `⣿`", () => {
    expect(borderRun(busyAt(9).render(60), 60).slice(SPIN_TYPE_START, SPIN_TYPE_START + SPIN_TYPE_CELLS)).toBe("⣿⣿⣿⣿");
    expect(borderRun(busyAt(13).render(60), 60).slice(SPIN_TYPE_START, SPIN_TYPE_START + SPIN_TYPE_CELLS)).toBe("⣿⣿⣿⣿");
  });

  it("narrow-but-adequate width (15): window shifted left, rest is ─", () => {
    // inner = 11 → start = max(2, 11 - 4 - 2) = 5
    const run = borderRun(busyAt(4).render(15), 15);
    expect(run.slice(5, 9)).toBe("⠛⠛⠛⠛");
    rowFirmsToDashes(run, 11);
  });

  it("narrowest adequate width (12, inner 8): window at start 2, no trailing run", () => {
    const run = borderRun(busyAt(4).render(12), 12);
    expect(run.slice(2, 6)).toBe("⠛⠛⠛⠛");
    rowFirmsToDashes(run, 8);
  });

  it("below the floor (width 11, inner < CELLS + 4): no window, plain border", () => {
    expect(borderRun(busyAt(4).render(11), 11)).toBe("─".repeat(7));
  });

  it("idle: all-dash border row — no spaces in the window positions (spin on, never busy)", () => {
    const { editor } = makeEditor({ spin: true });
    const run = borderRun(editor.render(60), 60);
    expect(run).toBe("─".repeat(56));
  });
});

// ── 4. Timer lifecycle & gating ────────────────────────────────────────────

describe("timer lifecycle & gating", () => {
  it("spin=false: no interval is set up", () => {
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const before = setSpy.mock.calls.length;
    makeEditor({ spin: false });
    expect(setSpy.mock.calls.length).toBe(before);
  });

  it("spin=true: one 80ms interval; onSpinInterval receives the handle", () => {
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const { editor, onSpinInterval } = makeEditor({ spin: true });
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0]![1]).toBe(SPIN_TICK_MS);
    expect(onSpinInterval).toHaveBeenCalledTimes(1);
    const handle = onSpinInterval!.mock.calls[0]![0];
    expect(handle).not.toBeUndefined();
    expect(handle).toBe((editor as any).spinTimer);
  });

  it("dispose clears the interval and notifies onSpinInterval(undefined)", () => {
    const { editor, onSpinInterval } = makeEditor({ spin: true });
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    editor.dispose();
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect((editor as any).spinTimer).toBeUndefined();
    expect(onSpinInterval).toHaveBeenLastCalledWith(undefined);
  });

  it("dispose with spin=false is a no-op (no interval, no notification)", () => {
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const { editor, onSpinInterval } = makeEditor({ spin: false });
    editor.dispose();
    expect(clearSpy).not.toHaveBeenCalled();
    expect(onSpinInterval).not.toHaveBeenCalled();
  });

  it("fake 80ms ticks drive render while the agent is busy", () => {
    const { editor, tui } = makeEditor({ spin: true });
    (editor as any).isIdle = () => false;
    vi.advanceTimersByTime(SPIN_TICK_MS);
    expect(tui.requestRender).toHaveBeenCalledTimes(1);
  });
});

// ── 5. EAW fallback (⣿ reports width 2 → stage set flips to shading) ──────

describe("EAW terminal fallback", () => {
  it("⣿ reports width 2: the window uses the shade set (░→█), no braille in the row, 4 cells wide", () => {
    const braille = ["⠁", "⠉", "⠋", "⠛", "⠟", "⠿", "⡿", "⣿"];
    widthProbe.probe = (s: string) => (s === "⣿" ? 2 : 1);
    try {
      const expectWindow = (s: number, window: string) => {
        const run = borderRun(busyAt(s).render(60), 60);
        expect(run.slice(SPIN_TYPE_START, SPIN_TYPE_START + SPIN_TYPE_CELLS)).toBe(window);
        for (const c of braille) expect(run).not.toContain(c);
        rowFirmsToDashes(run, 56);
      };
      expectWindow(1, "░░░░");
      expectWindow(5, "▒▒▒▒");
      expectWindow(8, "████");
    } finally {
      widthProbe.probe = (_s: string) => 1;
    }
  });
});
