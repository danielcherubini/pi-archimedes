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
  SPIN_TYPE_START,
  SPIN_TYPE_CELLS,
} from "./index.js";

/** The default label (no `spinLabel` in the ctor options), including the leading AND trailing spaces the renderer contributes (`" " + label + " "`). */
const LABEL = " Working ";

// ── Helpers ──────────────────────────────────────────────────────────────────

const stubTheme = {
  fg: (_k: string, t: string) => t,
} as unknown as Theme;

interface ConstructOpts {
  spin?: boolean;
  /** Tick period in ms; maps the `editorSpinSpeed` setting onto the ctor. */
  spinTickMs?: number;
  /** Label typed after the window (empty hides it; unset → "Working"). */
  spinLabel?: string;
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
    spinTickMs: opts.spinTickMs,
    spinLabel: opts.spinLabel,
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
function busyAt(step: number, opts: ConstructOpts = {}): HephaestusEditor {
  const { editor } = makeEditor({
    spin: true,
    ...opts,
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
// stage chars, spaces, and the label chars of ` Working ` when present)
// as cells, the whole row firms up to all dashes.
const rowFirmsToDashes = (run: string, len: number): void => {
  expect(run.replace(/[^─]/g, "─")).toBe("─".repeat(len));
};

// Compensated width for a 60-wide box (inner = 56): the block sits at start 0
// right at the corner (leading space at column 0, the 4-cell window at 1–4,
// ` Working ` with its leading AND trailing space at 5–13): the row minus the
// block's 14 columns is all hard `─` — those columns replaced trailing dashes,
// so the row width stays constant.
const compensatedAt60 = (run: string): void => {
  const end = SPIN_TYPE_START + 1 + SPIN_TYPE_CELLS + LABEL.length; // 0 + 1 + 4 + 9 = 14
  const rest = run.slice(0, SPIN_TYPE_START) + run.slice(end);
  expect(rest).toBe(
    "─".repeat(56 - 1 - SPIN_TYPE_CELLS - LABEL.length), // 42
  );
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
  it("tickSpin is a no-op while idle: no render", () => {
    const { editor, tui } = makeEditor({ spin: true });
    tick(editor);
    expect(tui.requestRender).not.toHaveBeenCalled();
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

// ── 2. Busy/idle repaint at the render level ───────────────────────────────
// (the tick state machine itself — advance, wrap, reset, repaint counts,
// and the full frame table — is tested against BorderTypeSpinner in
// spin.test.ts; here the edge is the plain-border repaint, which the
// typing strip must NOT freeze on screen — an idle→no-op would.)

describe("busy/idle repaint at the render level", () => {
  it("busy→idle: the plain border repaints exactly once, then idle ticks are no-ops", () => {
    // isIdle() returns false, false, true, true across the four ticks
    const { editor, tui } = makeEditor({ spin: true, idleSeq: [false, false, true, true] });

    tick(editor); // busy #1
    expect(tui.requestRender).toHaveBeenCalledTimes(1);

    tick(editor); // busy #2
    expect(tui.requestRender).toHaveBeenCalledTimes(2);

    tick(editor); // idle after busy — reset + exactly one repaint
    expect(tui.requestRender).toHaveBeenCalledTimes(3);

    tick(editor); // idle after idle — full no-op
    expect(tui.requestRender).toHaveBeenCalledTimes(3);
  });

  it("busy streak wraps at the 38-step cycle: clear beat is 4 spaces + ` Working ` (label stays up), then the block grows again", () => {
    // 40 busy values: 37 to reach step 37, then the wrap tick (→ 0, clear beat)
    // and the regrowth tick (→ step 1); the render decision uses the
    // overridden isIdle below, the tick machine uses the constructor sequence.
    const { editor } = makeEditor({ spin: true, idleSeq: Array.from({ length: 40 }, () => false) });
    for (let i = 0; i < 37; i++) tick(editor); // s=1..37
    (editor as any).isIdle = () => false;
    tick(editor); // wraps to 0 — the clear beat
    const cleared = borderRun(editor.render(60), 60);
    expect(
      cleared.slice(
        SPIN_TYPE_START,
        SPIN_TYPE_START + 1 + SPIN_TYPE_CELLS + LABEL.length,
      ),
    ).toBe( // `     Working` — the leading space + 4 clear spaces + the label
      " " + "    " + LABEL,
    );
    tick(editor); // back to step 1 — cell 1 enters at ⠁
    const regrown = borderRun(editor.render(60), 60);
    expect(
      regrown.slice(
        SPIN_TYPE_START,
        SPIN_TYPE_START + 1 + SPIN_TYPE_CELLS + LABEL.length,
      ),
    ).toBe(" ⠁   " + LABEL); // `⠁    Working`
    
  });
});

// ── 3. Typing strip on the top border row (serpentine line fill) ─────────
// Cells fill cell-by-cell left→right, each cell walking the 8 chart-order
// stages in 2-step line pairs (⠁⠉ / ⠋⠛ / ⠟⠿ / ⡿⣿): line 1 is steps 1–8,
// line 2 9–16, line 3 17–24, line 4 25–32, hold 33–37, clear at the wrap (0).

describe("typing strip on the top border row", () => {
  // 60-wide box (inner = 56): the full beat = leading space at 0 + 4-cell
  // window + ` Working ` label (leading AND trailing space) when labelFit
  // (16 for the default label) is met.
  const beat = (ed: HephaestusEditor): string =>
    borderRun(ed.render(60), 60).slice(
      SPIN_TYPE_START,
      SPIN_TYPE_START + 1 + SPIN_TYPE_CELLS + LABEL.length,
    );

  it("step 1: leading space at 0, then only cell 1 is `⠁` (dot block starts to grow), ` Working ` label follows", () => {
    expect(beat(busyAt(1))).toBe(" ⠁   " + LABEL);
    rowFirmsToDashes(borderRun(busyAt(1).render(60), 60), 56);
    compensatedAt60(borderRun(busyAt(1).render(60), 60));
  });

  it("step 8 (line 1 complete): leading space at 0, all 4 cells are `⠉`, label follows", () => {
    const ed = busyAt(8);
    expect(beat(ed)).toBe(" ⠉⠉⠉⠉" + LABEL);
    rowFirmsToDashes(borderRun(ed.render(60), 60), 56);
    compensatedAt60(borderRun(ed.render(60), 60));
  });

  it("step 32 (fully grown): leading space at 0, all 4 cells are `⣿`, label follows", () => {
    const ed = busyAt(32);
    expect(beat(ed)).toBe(" ⣿⣿⣿⣿" + LABEL);
    rowFirmsToDashes(borderRun(ed.render(60), 60), 56);
    compensatedAt60(borderRun(ed.render(60), 60));
  });

  it("hold region (step 37): leading space at 0, full block holds — `⣿`×4 on, label still up (the hold clamp 33–38 is covered in spin.test.ts)", () => {
    expect(beat(busyAt(37))).toBe(" ⣿⣿⣿⣿" + LABEL);
  });

  it("narrow width (14, inner 10): block at the corner (leading space at 0), window at 1, no label, row dash-compensated", () => {
    // inner = 10 → 7 ≤ 10 < 16: window-only tier at start 0; trailing = 10 − 1 − 4 = 5
    const run = borderRun(busyAt(4).render(14), 14);
    expect(run.slice(0, 1)).toBe(" ");
    expect(run.slice(1, 5)).toBe("⠉⠉  ");
    expect(run.slice(5)).toBe("─".repeat(5));
    expect(run).not.toContain("Working");
    rowFirmsToDashes(run, 10);
  });

  it("label-fit tiers: window-only at inner 15 (19, 10 trailing dashes); label on at inner 16 (20 = L + 9) — verbatim beat ` ⠛⠛⠛⠛ Working ` with 2 trailing dashes", () => {
    const run15 = borderRun(busyAt(16).render(19), 19);
    expect(run15).not.toContain("Working"); // inner 15 < 16 → window-only tier
    expect(run15.slice(0, 1)).toBe(" ");
    expect(run15.slice(1, 5)).toBe("⠛⠛⠛⠛");
    expect(run15.slice(5)).toBe("─".repeat(10)); // trailing = 15 − 1 − 4 = 10
    rowFirmsToDashes(run15, 15);
    const run = borderRun(busyAt(16).render(20), 20); // inner = 16 = 0 + 1 + 4 + (1 + 7 + 1) + 2 (labelFit for L = 7)
    expect(run.slice(0, 1)).toBe(" ");
    expect(run.slice(1, 5)).toBe("⠛⠛⠛⠛");
    expect(run.slice(5, 14)).toBe(LABEL); // ` Working ` — leading AND trailing space
    expect(run.slice(14)).toBe("─".repeat(2)); // trailing = 16 − 0 − 1 − 4 − (1 + 7 + 1) = 2
    rowFirmsToDashes(run, 16);
  });

  it("below the floor (width 10, inner 6): no window, no label, plain border", () => {
    const run = borderRun(busyAt(4).render(10), 10);
    expect(run).toBe("─".repeat(6));
    expect(run).not.toContain("Working");
  });

  it("idle: all-dash border row — no leading space, no window, no stage chars, no label (spin on, never busy)", () => {
    const { editor } = makeEditor({ spin: true });
    const run = borderRun(editor.render(60), 60);
    expect(run).toBe("─".repeat(56));
    for (const c of ["⠁", "⠉", "⠋", "⠛", "⠟", "⠿", "⡿", "⣿", "░", "▒", "▓", "█"]) {
      expect(run).not.toContain(c);
    }
    expect(run).not.toContain("Working");
  });

  // ── Configurable label (archimedes.core.editorSpinLabel) ────────────────

  it("custom label (\"Thinking\"): the wide beat ends in ` Thinking ` (leading AND trailing space), no ` Working ` anywhere in the row", () => {
    const ed = busyAt(1, { spinLabel: "Thinking" });
    const run = borderRun(ed.render(60), 60);
    expect(run).toContain(" Thinking ");
    expect(run).not.toContain("Working");
    expect(run.slice(SPIN_TYPE_START, SPIN_TYPE_START + 1 + SPIN_TYPE_CELLS + "Thinking".length + 2)).toBe(
      " ⠁   " + " Thinking ",
    );
    // Compensated: trailing = 56 − 0 − 1 − 4 − (1 + 8 + 1) = 41 dashes
    expect(run.slice(SPIN_TYPE_START + 1 + SPIN_TYPE_CELLS + "Thinking".length + 2)).toBe("─".repeat(41));
    rowFirmsToDashes(run, 56);
  });

  it("custom label (\"Thinking\") survives the cycle: clear beat holds the label, regrowth keeps it (the spin machine is untouched by the label)", () => {
    const { editor } = makeEditor({
      spin: true,
      spinLabel: "Thinking",
      idleSeq: Array.from({ length: 40 }, () => false),
    });
    for (let i = 0; i < 37; i++) tick(editor);
    (editor as any).isIdle = () => false;
    tick(editor); // wraps to 0 — clear beat
    expect(borderRun(editor.render(60), 60)).toContain(" Thinking");
    tick(editor); // step 1
    expect(borderRun(editor.render(60), 60)).toContain(" ⠁   " + " Thinking ");
    // Label drop-off on narrow boxes follows the same width tiers as the default label (labelFit = 8 + 9 = 17 > 10)
    const run14 = borderRun(editor.render(14), 14);
    expect(run14).not.toContain("Thinking");
  });

  it("empty label (\"\"): no label text in any tier — wide (win + trailing dashes), narrow (window-only tier identical)", () => {
    const wide = borderRun(busyAt(4, { spinLabel: "" }).render(60), 60);
    expect(wide).not.toContain("Working");
    expect(wide.slice(0, 1)).toBe(" ");
    expect(wide.slice(1, 5)).toBe("⠉⠉  ");
    expect(wide.slice(5)).toBe("─".repeat(51)); // trailing = 56 − 1 − 4 = 51
    rowFirmsToDashes(wide, 56);
    const narrow = borderRun(busyAt(4, { spinLabel: "" }).render(14), 14);
    expect(narrow).not.toContain("Working");
    expect(narrow.slice(5)).toBe("─".repeat(5)); // window-only tier (inner 10), same as a narrow default-label box
    rowFirmsToDashes(narrow, 10);
  });

  it("label longer than the inner width can host (60 chars at inner 56, labelFit = 60 + 9 = 69 > 56): window-only tier even at the wide width, no negative trailing — row width constant", () => {
    const run = borderRun(busyAt(4, { spinLabel: "A".repeat(60) }).render(60), 60);
    expect(run).not.toContain("A");
    expect(run.slice(0, 1)).toBe(" ");
    expect(run.slice(1, 5)).toBe("⠉⠉  ");
    expect(run.slice(5)).toBe("─".repeat(51));
    rowFirmsToDashes(run, 56);
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

  it("spin=true (default ctor): one 80ms interval; onSpinInterval receives the handle", () => {
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const { editor, onSpinInterval } = makeEditor({ spin: true });
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0]![1]).toBe(SPIN_TICK_MS);
    expect(onSpinInterval).toHaveBeenCalledTimes(1);
    const handle = onSpinInterval!.mock.calls[0]![0];
    expect(handle).not.toBeUndefined();
    expect(handle).toBe((editor as any).spinTimer);
  });

  it("explicit spinTickMs (160 — editorSpinSpeed \"slow\"): the interval period is the mapped value", () => {
    const setSpy = vi.spyOn(globalThis, "setInterval");
    makeEditor({ spin: true, spinTickMs: 160 });
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0]![1]).toBe(160);
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
    const { editor, tui } = makeEditor({ spin: true, idleSeq: [false] });
    (editor as any).isIdle = () => false;
    vi.advanceTimersByTime(SPIN_TICK_MS);
    expect(tui.requestRender).toHaveBeenCalledTimes(1);
  });

  it("fast tick (48ms — editorSpinSpeed \"fast\"): the mapped period drives the render", () => {
    const { editor, tui } = makeEditor({ spin: true, spinTickMs: 48, idleSeq: [false] });
    (editor as any).isIdle = () => false;
    vi.advanceTimersByTime(48);
    expect(tui.requestRender).toHaveBeenCalledTimes(1);
  });
});

// ── 5. EAW fallback (⣿ reports width 2 → stage set flips to shading) ──────

describe("EAW terminal fallback", () => {
  it("⣿ reports width 2: the window uses the shade set (░→█) in the same cell-wise order, no braille in the row, the ` Working ` label stays (ASCII-safe)", () => {
    const braille = ["⠁", "⠉", "⠋", "⠛", "⠟", "⠿", "⡿", "⣿"];
    widthProbe.probe = (s: string) => (s === "⣿" ? 2 : 1);
    try {
      const expectWindow = (s: number, window: string) => {
        const run = borderRun(busyAt(s).render(60), 60);
        expect(run.slice(SPIN_TYPE_START, SPIN_TYPE_START + 1)).toBe(" ");
        expect(
          run.slice(
            SPIN_TYPE_START + 1,
            SPIN_TYPE_START + 1 + SPIN_TYPE_CELLS,
          ),
        ).toBe(window);
        expect(
          run.slice(
            SPIN_TYPE_START + 1 + SPIN_TYPE_CELLS,
            SPIN_TYPE_START + 1 + SPIN_TYPE_CELLS + LABEL.length,
          ),
        ).toBe(LABEL);
        for (const c of braille) expect(run).not.toContain(c);
        rowFirmsToDashes(run, 56);
        compensatedAt60(run);
      };
      expectWindow(1, "░   ");
      expectWindow(3, "░░  ");
      expectWindow(8, "░░░░");
      expectWindow(17, "▒░░░");
      expectWindow(19, "▒▒░░");
      expectWindow(26, "█▒▒▒");
      expectWindow(32, "████");
    } finally {
      widthProbe.probe = (_s: string) => 1;
    }
  });
});
