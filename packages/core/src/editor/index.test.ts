import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import type {
  Theme,
  KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { TUI, EditorTheme } from "@earendil-works/pi-tui";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Probe-driven width so the EAW fallback test can flip the answer.
let widthProbe: (s: string) => number = () => 1;

vi.mock("@earendil-works/pi-tui", () => ({
  truncateToWidth: (s: string, _w: number, _pad?: string, _incl?: boolean) => s,
  isKeyRelease: () => false,
  visibleWidth: (s: string) => widthProbe(s),
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
  SPIN_TYPE_CELLS,
  SPIN_TYPE_CYCLE,
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

// The 4-cell typing window on the first rendered line (the top edge).
const topEdgeWindow = (lines: string[], width: number): string => {
  const first = plain(lines[0]!);
  const start = Math.floor((width - SPIN_TYPE_CELLS) / 2);
  return first.slice(start, start + SPIN_TYPE_CELLS);
};
const litCount = (window: string): number =>
  [...window].filter((c) => c !== "▁").length;

// ── Setup / teardown ────────────────────────────────────────────────────────

beforeAll(() => {
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  widthProbe = () => 1;
});

afterEach(() => {
  for (const ed of createdEditors) {
    (ed as any).dispose?.();
  }
  createdEditors.length = 0;
  vi.restoreAllMocks();
});

// ── 1. Static prefix (always >), plain edge while idle ──────────────────

describe("static prefix, plain idle edge", () => {
  it("tickSpin is a no-op while idle: no render, typeStep stays 0, blink stays on", () => {
    const { editor, tui } = makeEditor({ spin: true });
    tick(editor);
    expect(tui.requestRender).not.toHaveBeenCalled();
    expect((editor as any).typeStep).toBe(0);
    expect((editor as any).blinkOn).toBe(true);
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

  it("idle renders a plain edge row (no lit chars anywhere)", () => {
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

// ── 2. Busy typing state machine ────────────────────────────────────────

describe("busy/idle typing state machine", () => {
  it("advances typeStep while busy, resets + repaints once on idle, then no-ops", () => {
    // isIdle() returns false, false, true, true across the four ticks
    const { editor, tui } = makeEditor({ spin: true, idleSeq: [false, false, true, true] });

    tick(editor); // busy #1
    expect((editor as any).typeStep).toBe(1);
    expect((editor as any).blinkOn).toBe(false);
    expect(tui.requestRender).toHaveBeenCalledTimes(1);

    tick(editor); // busy #2
    expect((editor as any).typeStep).toBe(2);
    expect((editor as any).blinkOn).toBe(true);
    expect(tui.requestRender).toHaveBeenCalledTimes(2);

    tick(editor); // idle after busy — reset + exactly one repaint
    expect((editor as any).typeStep).toBe(0);
    expect((editor as any).blinkOn).toBe(true);
    expect(tui.requestRender).toHaveBeenCalledTimes(3);

    tick(editor); // idle after idle — full no-op
    expect((editor as any).typeStep).toBe(0);
    expect(tui.requestRender).toHaveBeenCalledTimes(3);
  });

  it("busy streak wraps at SPIN_TYPE_CYCLE (10)", () => {
    const editor = busyAt(SPIN_TYPE_CYCLE - 1); // 9 toggling: s=1..9
    expect((editor as any).typeStep).toBe(SPIN_TYPE_CYCLE - 1);
    tick(editor); // wraps to 0
    (editor as any).isIdle = () => false;
    expect((editor as any).typeStep).toBe(0);
  });
});

// ── 3. Typing strip on the top edge ─────────────────────────────────────

describe("typing strip on the top edge", () => {
  it("s=1: one literal in the centered 4-cell window", () => {
    const window = topEdgeWindow(busyAt(1).render(60), 60);
    expect(window.length).toBe(SPIN_TYPE_CELLS);
    expect(litCount(window)).toBe(1);
  });

  it("s=4 (fill complete): four lit, the rest of the row is ▁", () => {
    const editor = busyAt(4);
    const lines = editor.render(60);
    expect(litCount(topEdgeWindow(lines, 60))).toBe(4);
    expect(plain(lines[0]!).replace(/[⠰·]/g, "▁")).toBe("▁".repeat(60));
  });

  it("hold region (s=6, s=9): all 4 still lit, cursor overlap included", () => {
    expect(litCount(topEdgeWindow(busyAt(6).render(60), 60))).toBe(4);
    expect(litCount(topEdgeWindow(busyAt(9).render(60), 60))).toBe(4);
  });

  it("window is centered: everything outside it on the row is ▁", () => {
    const first = plain(busyAt(4).render(60)[0]!);
    const start = Math.floor((60 - SPIN_TYPE_CELLS) / 2);
    expect(first.slice(0, start)).toBe("▁".repeat(start));
    expect(first.slice(start + SPIN_TYPE_CELLS)).toBe("▁".repeat(60 - start - SPIN_TYPE_CELLS));
  });

  it("narrow width (below CELLS + 2): no window, edge stays plain", () => {
    expect(plain(busyAt(4).render(5)[0]!)).toBe("▁".repeat(5));
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

// ── 5. EAW width fallback ──────────────────────────────────────────────────

describe("EAW width fallback", () => {
  it("visibleWidth(\"⠰\") === 2 → lit char is \"·\", 4-cell window intact, no ⠰", () => {
    widthProbe = (s: string) => (s === "⠰" ? 2 : 1);
    const editor = busyAt(4);
    expect((editor as any).spinLitChar).toBe("·");
    const lines = editor.render(60);
    expect(litCount(topEdgeWindow(lines, 60))).toBe(4);
    expect(
      [...topEdgeWindow(lines, 60)].every((c) => c === "·" || c === "▁"),
    ).toBe(true);
    expect(plain(lines[0]!).includes("⠰")).toBe(false);
  });

  it("default probe (width 1) → lit char is \"⠰\"", () => {
    const editor = busyAt(4);
    expect((editor as any).spinLitChar).toBe("⠰");
  });
});
