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

import { HephaestusEditor } from "./index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const BRAILLE_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
];
const FALLBACK_FRAMES = ["|", "/", "-", "\\"];

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

// ── 1. Static prefix when idle (spin on, never busy) ──────────────────────

describe("idle-static prefix", () => {
  it("tickSpin is a no-op while idle: no render, frameIdx stays 0", () => {
    const { editor, tui } = makeEditor({ spin: true });
    tick(editor);
    expect(tui.requestRender).not.toHaveBeenCalled();
    expect((editor as any).frameIdx).toBe(0);
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
});

// ── 2. Busy advances, idle-after-busy repaints exactly once ─────────────────

describe("busy/idle tick state machine", () => {
  it("advances frames while busy, resets + repaints once on idle, then no-ops", () => {
    // isIdle() returns false, false, true, true across the four ticks
    const { editor, tui } = makeEditor({ spin: true, idleSeq: [false, false, true, true] });

    tick(editor); // busy #1
    expect((editor as any).frameIdx).toBe(0);
    expect(tui.requestRender).toHaveBeenCalledTimes(1);

    tick(editor); // busy #2
    expect((editor as any).frameIdx).toBe(1);
    expect(tui.requestRender).toHaveBeenCalledTimes(2);

    tick(editor); // idle after busy — reset + exactly one repaint
    expect((editor as any).frameIdx).toBe(0);
    expect(tui.requestRender).toHaveBeenCalledTimes(3);

    tick(editor); // idle after idle — full no-op
    expect((editor as any).frameIdx).toBe(0);
    expect(tui.requestRender).toHaveBeenCalledTimes(3);
  });

  it("busy streak wraps around the frame set", () => {
    const ed = makeEditor({ spin: true, idleSeq: [false, false, false, false] });
    const n = (ed.editor as any).spinFrames.length;
    tick(ed.editor);
    tick(ed.editor);
    tick(ed.editor);
    // Three busy ticks: 0, 1, 2
    expect((ed.editor as any).frameIdx).toBe(2);
    for (let i = 0; i < n - 2; i++) tick(ed.editor); // up to n-1
    tick(ed.editor); // wraps to 0
    expect((ed.editor as any).frameIdx).toBe(0);
  });
});

// ── 3. Timer lifecycle & gating ────────────────────────────────────────────

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
    expect(setSpy.mock.calls[0]![1]).toBe(80);
    expect(onSpinInterval).toHaveBeenCalledTimes(1);
    const spy = onSpinInterval!; // makeEditor always provisions a spy
    expect(spy).toHaveBeenCalledTimes(1);
    const handle = spy.mock.calls[0]![0];
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
    vi.advanceTimersByTime(80);
    expect(tui.requestRender).toHaveBeenCalledTimes(1);
  });
});

// ── 4. EAW width fallback ──────────────────────────────────────────────────

describe("EAW width fallback", () => {
  it("all-braille-width-2 → uses |/-\\ set and wraps over 4 frames", () => {
    widthProbe = (s: string) => (BRAILLE_FRAMES.includes(s) ? 2 : 1);
    const { editor, tui } = makeEditor({ spin: true, idleSeq: [false, false] });

    expect((editor as any).spinFrames).toEqual(FALLBACK_FRAMES);

    tick(editor); // busy #1
    tick(editor); // busy #2
    expect((editor as any).frameIdx).toBe(1);
    expect(tui.requestRender).toHaveBeenCalledTimes(2);

    // The painted prefix must come from the fallback set
    (editor as any).isIdle = () => false;
    const lines = editor.render(60);
    // Prefix is attached to the first content line (mock's "input line" row);
    // wrapped lines start with an SGR — strip before the position check
    const prefixLine = lines.find((l) => l.includes("input line"));
    expect(prefixLine).toBeDefined();
    // Position-based: prefix at start is exactly one fallback frame + space
    expect(
      FALLBACK_FRAMES.some(
        (f) => plain(prefixLine!).trimStart().startsWith(f + " "),
      ),
    ).toBe(true);
    expect(BRAILLE_FRAMES.some((f) => prefixLine!.includes(f))).toBe(false);
  });

  it("any single braille frame width 2 also triggers the fallback", () => {
    const { editor } = makeEditor({ spin: true });
    // default probe: width 1 for everything → braille set
    expect((editor as any).spinFrames).toEqual(BRAILLE_FRAMES);

    // Flip: only the first frame is wide — `every(...===1)` must fail
    widthProbe = (s: string) => (s === "⠋" ? 2 : 1);
    const { editor: ed2 } = makeEditor({ spin: true });
    expect((ed2 as any).spinFrames).toEqual(FALLBACK_FRAMES);
  });
});
