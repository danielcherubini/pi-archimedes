import { describe, it, expect } from "vitest";
import {
  BorderTypeSpinner,
  SPIN_INTERVALS,
  SPIN_VARIANTS,
  STAGE_MASKS,
  normalizeSpinnerStyle,
  shadeForMask,
} from "./spin.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A spinner (the `typing` style, the one that ships in batch 1) whose isIdle() consumes `seq` one value per call (idle afterwards). */
function spinner(
  seq: boolean[],
  probe: (s: string) => number,
): BorderTypeSpinner {
  return new BorderTypeSpinner(
    () => (seq.length > 0 ? (seq.shift() as boolean) : true),
    "typing",
    probe,
  );
}

/** A always-busy spinner: enough `false` isIdle values for `n` ticks. */
function busyAt(
  seq: boolean[],
  probe: (s: string) => number,
  n: number,
): BorderTypeSpinner {
  const sp = spinner(seq, probe);
  for (let i = 0; i < n; i++) sp.tick();
  return sp;
}

const probe1 = (s: string): number => (s === "⣿" ? 1 : 1); // non-EAW: braille set
const probe2 = (s: string): number => (s === "⣿" ? 2 : 1); // EAW: shade set
const allBusy = (n: number): boolean[] => Array.from({ length: n }, () => false);

// ── 1. Frame table: 32 distinct beats, fill cell-by-cell line by line ───────
// Cells fill cell-by-cell left→right, each cell walking the 8 chart-order
// stages in 2-step line pairs (⠁⠉ / ⠋⠛ / ⠟⠿ / ⡿⣿): line 1 1–8,
// line 2 9–16, line 3 17–24, line 4 25–32 — the 2×4 dot block grows
// across the 4-cell window line by line; hold clamps; the wrap clears.

describe("frame table (non-EAW braille set)", () => {
  const beat = (n: number): string => busyAt(allBusy(n), probe1, n).frame();

  it("exposes the 4-cell window width as a static", () => {
    expect(BorderTypeSpinner.CELLS).toBe(4);
  });

  it("step 0 (never ticked): the frame is 4 spaces", () => {
    expect(spinner([true], probe1).frame()).toBe("    ");
  });

  it("the 32 frames are all distinct, 4 cells wide, and tile-free", () => {
    const seq = spinner(allBusy(32).concat(true, true), probe1);
    const frames: string[] = [];
    for (let i = 0; i < 32; i++) {
      seq.tick();
      frames.push(seq.frame());
    }
    expect(frames).toHaveLength(32);
    expect(new Set(frames).size).toBe(32);
    for (const f of frames) {
      expect(f.length).toBe(4);
      expect(f.split("").every((c) => c === " " || "⠁⠉⠋⠛⠟⠿⡿⣿".includes(c))).toBe(true);
    }
  });

  it("step 1: only cell 1 is `⠁` (dot block starts to grow)", () => {
    expect(beat(1)).toBe("⠁   ");
  });

  it("step 2: cell 1 advances to `⠉`", () => {
    expect(beat(2)).toBe("⠉   ");
  });

  it("step 3: cell 2 enters at `⠁`, cell 1 holds `⠉`", () => {
    expect(beat(3)).toBe("⠉⠁  ");
  });

  it("step 4: cell 2 completes its line pair at `⠉`", () => {
    expect(beat(4)).toBe("⠉⠉  ");
  });

  it("step 8 (line 1 complete): all 4 cells are `⠉`", () => {
    expect(beat(8)).toBe("⠉⠉⠉⠉");
  });

  it("step 9 (inter-line 1→2): cell 1 re-enters at `⠋`, the rest hold `⠉`", () => {
    expect(beat(9)).toBe("⠋⠉⠉⠉");
  });

  it("step 10: cell 1 completes at `⠛`", () => {
    expect(beat(10)).toBe("⠛⠉⠉⠉");
  });

  it("step 16 (line 2 complete): all 4 cells are `⠛`", () => {
    expect(beat(16)).toBe("⠛⠛⠛⠛");
  });

  it("step 17 (inter-line 2→3): cell 1 re-enters at `⠟`, the rest hold `⠛`", () => {
    expect(beat(17)).toBe("⠟⠛⠛⠛");
  });

  it("step 22: cells 2–3 are `⠿` (cell 3 just completed), cells 1 and 4 hold `⠛`", () => {
    expect(beat(22)).toBe("⠿⠿⠿⠛");
  });

  it("step 24 (line 3 complete): all 4 cells are `⠿`", () => {
    expect(beat(24)).toBe("⠿⠿⠿⠿");
  });

  it("step 25 (inter-line 3→4): cell 1 re-enters at `⡿`, the rest hold `⠿`", () => {
    expect(beat(25)).toBe("⡿⠿⠿⠿");
  });

  it("step 32 (fully grown): all 4 cells are `⣿`", () => {
    expect(beat(32)).toBe("⣿⣿⣿⣿");
  });

  it("hold clamps (steps 33–37): the full block holds — all 4 cells still `⣿`", () => {
    for (const n of [33, 34, 35, 36, 37]) {
      expect(beat(n)).toBe("⣿⣿⣿⣿");
    }
    expect(beat(38)).toBe("    "); // step 38 is the clear beat, not hold
  });

  it("step 39 wraps to step 1: the step-38 clear beat is 4 spaces, then the block grows again at `⠁`", () => {
    const seq = spinner(allBusy(39), probe1);
    for (let i = 0; i < 37; i++) seq.tick();
    expect(seq.frame()).toBe("⣿⣿⣿⣿"); // hold tail
    seq.tick(); // step 38 — the clear beat
    expect(seq.frame()).toBe("    ");
    seq.tick(); // step 39 % 38 = step 1
    expect(seq.frame()).toBe("⠁   ");
  });
});

// ── 2. Busy/idle tick state machine ─────────────────────────────────────────
// idle→idle no repaint; idle→busy advances; busy→busy advances;
// busy→idle resets + exactly one repaint; the machine re-arms after idle.

describe("busy/idle tick state machine", () => {
  it("idle→idle is a full no-op: no repaint, frame holds at 4 spaces", () => {
    const sp = spinner([true, true], probe1);
    expect(sp.tick()).toBe(false);
    expect(sp.tick()).toBe(false);
    expect(sp.frame()).toBe("    ");
  });

  it("idle→busy advances; busy→busy advances; busy→idle resets + repaints once; then no-op", () => {
    // isIdle(): true, true, false, false, false, true, across the ticks
    const sp = spinner([true, true, false, false, false, true], probe1);

    expect(sp.tick()).toBe(false); // idle #1 — no repaint
    expect(sp.tick()).toBe(false); // idle #2 — no repaint
    expect(sp.tick()).toBe(true); // busy #1 — repaint, step 1
    expect(sp.frame()).toBe("⠁   ");
    expect(sp.tick()).toBe(true); // busy #2 — repaint, step 2
    expect(sp.frame()).toBe("⠉   ");
    expect(sp.tick()).toBe(true); // busy #3 — repaint, step 3
    expect(sp.frame()).toBe("⠉⠁  ");
    expect(sp.tick()).toBe(true); // idle after busy — reset + exactly one repaint
    expect(sp.frame()).toBe("    "); // reset to the empty clear frame
    expect(sp.frame()).toBe("    "); // and it stays reset (no further repaint)
  });

  it("the machine re-arms after idle: a new busy streak restarts at step 1", () => {
    // isIdle(): false, true, false, false
    const sp = spinner([false, true, false, false], probe1);
    sp.tick(); // busy → step 1
    expect(sp.frame()).toBe("⠁   ");
    sp.tick(); // idle → reset + repaint
    sp.tick(); // busy again → step 1, not step 2
    expect(sp.frame()).toBe("⠁   ");
    sp.tick(); // busy → step 2
    expect(sp.frame()).toBe("⠉   ");
  });

  it("a busy streak wraps at the 38-step cycle: the step-38 clear beat is 4 spaces, then the block grows again", () => {
    const sp = spinner(allBusy(40), probe1);
    for (let i = 0; i < 37; i++) sp.tick();
    expect(sp.frame()).toBe("⣿⣿⣿⣿"); // hold region
    sp.tick(); // step 38 — the clear beat: border-line broken spaces
    expect(sp.frame()).toBe("    ");
    sp.tick(); // step 1 — cell 1 enters at ⠁
    expect(sp.frame()).toBe("⠁   ");
  });
});

// ── 3. EAW probe (⣿ reports width 2 → shade set, braille never appears) ───

describe("EAW terminal fallback (ctor probe)", () => {
  const braille = ["⠁", "⠉", "⠋", "⠛", "⠟", "⠿", "⡿", "⣿"];

  it("probe('⣿') === 2: the window uses the shade set (░→█) in the same cell-wise order, no braille in any frame", () => {
    const sp = spinner(allBusy(38), probe2);
    const frames: string[] = [];
    for (let i = 0; i < 38; i++) {
      sp.tick();
      frames.push(sp.frame());
    }
    expect(frames[0]).toBe("░   "); // step 1
    expect(frames[2]).toBe("░░  "); // step 3
    expect(frames[7]).toBe("░░░░"); // step 8 (line 1 complete)
    expect(frames[16]).toBe("▒░░░"); // step 17 (inter-line 2→3)
    expect(frames[31]).toBe("████"); // step 32 (fully grown)
    expect(frames[32]).toBe("████"); // hold clamps
    expect(frames[37]).toBe("    "); // step 38 clear beat
    for (const f of frames) {
      for (const c of braille) expect(f).not.toContain(c);
    }
  });

  it("probe('⣿') === 1: the braille set is used; the shade chars never appear", () => {
    const sp = spinner(allBusy(38), probe1);
    for (let i = 0; i < 38; i++) {
      sp.tick();
      const f = sp.frame();
      for (const c of ["░", "▒", "▓", "█"]) expect(f).not.toContain(c);
    }
  });
});

// ── 4. Style-selector architecture (batch 1: SPIN_INTERVALS, variants,
// normalize, shade mapping, mask sets, typing compute round-trip) ────────

describe("SPIN_INTERVALS (native per-tick ms from the source library)", () => {
  it("is the exact ten-style map — the 32 ms tick floor is applied at the editor, not here", () => {
    expect(SPIN_INTERVALS).toEqual({
      typing: 80,
      pulse: 60,
      rain: 40,
      cascade: 40,
      columns: 40,
      "wave-rows": 40,
      "diagonal-swipe": 30,
      sparkle: 40,
      pendulum: 12,
      marquee: 55,
    });
  });
});

describe("normalizeSpinnerStyle (library normalizeVariant fallback)", () => {
  it("each registered variant name normalizes to itself", () => {
    expect(normalizeSpinnerStyle("typing")).toBe("typing");
  });

  it("unregistered gallery styles (batches 2–4) and unknown strings normalize to typing", () => {
    for (const s of ["wave-rows", "columns", "pulse", "marquee", "pendulum", "rain", "cascade", "diagonal-swipe", "sparkle", "nope", "", "Typing"]) {
      expect(normalizeSpinnerStyle(s)).toBe("typing");
    }
  });
});

describe("shadeForMask (EAW density tier by popcount)", () => {
  it("tier 0 (0 dots) → space", () => {
    expect(shadeForMask(0)).toBe(" ");
  });

  it("tier 1–2 → ░ (e.g. mask 0x81 popcount 2)", () => {
    expect(shadeForMask(0x01)).toBe("░");
    expect(shadeForMask(0x81)).toBe("░");
  });

  it("tier 3–4 → ▒", () => {
    expect(shadeForMask(0b111)).toBe("▒");
    expect(shadeForMask(0b1111)).toBe("▒");
  });

  it("tier 5–6 → ▓", () => {
    expect(shadeForMask(0b11111)).toBe("▓");
    expect(shadeForMask(0b110111)).toBe("▓");
  });

  it("tier 7–8 → █ (e.g. the two extreme masks)", () => {
    expect(shadeForMask(0b1111111)).toBe("█");
    expect(shadeForMask(0xff)).toBe("█");
  });

  it("the 8 chart-order STAGE_MASKS query the tiers 1/2/3/4/5/6/7/8 (e.g. 0x0B popcount 3 → ▒) through the density mapping (the hypothetical port-mask set the EAW leg port-styles will use)", () => {
    expect(STAGE_MASKS.map(shadeForMask)).toEqual([
      "░", "░", "▒", "▒", "▓", "▓", "█", "█",
    ]);
  });
});

describe("STAGE_MASKS (the 8 chart-order masks)", () => {
  const BRAILLE = ["⠁", "⠉", "⠋", "⠛", "⠟", "⠿", "⡿", "⣿"];
  const SHADE = ["░", "░", "░", "░", "▒", "▒", "▓", "█"];

  it("char k = String.fromCharCode(0x2800 + mask) exactly reproduces the old braille stage set (8 non-empty chars, all SE-width-by-mask)", () => {
    expect(STAGE_MASKS).toHaveLength(8);
    for (let k = 0; k < 8; k++) {
      const mask = STAGE_MASKS[k]!;
      expect(String.fromCharCode(0x2800 + mask)).toBe(BRAILLE[k]);
      expect(String.fromCharCode(0x2800 + mask)).not.toBe(" ");
    }
  });

  it("the STAGE_SHADE lookup index covers all 8: mask → old shade char is the char at the same index (STAGE_MASKS.indexOf(m) covers 0–7)", () => {
    for (let k = 0; k < 8; k++) {
      const mask = STAGE_MASKS[k]!;
      expect(STAGE_MASKS.indexOf(mask)).toBe(k);
      expect(SHADE[STAGE_MASKS.indexOf(mask)]).toBe(SHADE[k]);
    }
  });

  it("each mask is exactly 8-bit (0 ≤ m ≤ 0xff) and distinct", () => {
    for (const m of STAGE_MASKS) {
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(0xff);
    }
    expect(new Set(STAGE_MASKS).size).toBe(8);
  });
});

describe("typing compute round-trip (SPIN_VARIANTS.typing)", () => {
  const typing = SPIN_VARIANTS.typing!;

  it("is registered with steps 38, hold 6 (the 38-cycle machine)", () => {
    expect(typing.steps).toBe(38);
    expect(typing.hold).toBe(6);
    expect(normalizeSpinnerStyle("typing")).toBe("typing");
  });

  it("compute returns 4 8-bit masks; the braille path renders byte-identical to the old frames (spot: step 1/8/16/17/24/32)", () => {
    const render = (f: number): string =>
      typing
        .compute(f)
        .map((m) => (m === 0 ? " " : String.fromCharCode(0x2800 + m)))
        .join("");
    expect(render(0)).toBe("⠁   "); // fill step 1
    expect(render(7)).toBe("⠉⠉⠉⠉"); // fill step 8
    expect(render(15)).toBe("⠛⠛⠛⠛"); // fill step 16
    expect(render(16)).toBe("⠟⠛⠛⠛"); // fill step 17
    expect(render(23)).toBe("⠿⠿⠿⠿"); // fill step 24
    expect(render(31)).toBe("⣿⣿⣿⣿"); // fill step 32
  });

  it("compute(15) (fill step 16) is all cell masks of the 4th chart-order stage (0x1B)", () => {
    expect(typing.compute(15)).toEqual([0x1b, 0x1b, 0x1b, 0x1b]);
  });

  it("the EAW path (typing → STAGE_SHADE by STAGE_MASKS index) renders byte-identical to the old EAW frames via the live spinner: steps 1/8/16/17 (stage for ⠛ is the 4th → ░, NOT ▒)", () => {
    const sp = busyAt(Array.from({ length: 17 }, () => false), (s: string) => (s === "⣿" ? 2 : 1), 1);
    expect(sp.frame()).toBe("░   ");
    const sp8 = busyAt(Array.from({ length: 8 }, () => false), (s: string) => (s === "⣿" ? 2 : 1), 8);
    expect(sp8.frame()).toBe("░░░░");
    const sp16 = busyAt(Array.from({ length: 16 }, () => false), (s: string) => (s === "⣿" ? 2 : 1), 16);
    expect(sp16.frame()).toBe("░░░░");
    const sp17 = busyAt(Array.from({ length: 17 }, () => false), (s: string) => (s === "⣿" ? 2 : 1), 17);
    expect(sp17.frame()).toBe("▒░░░");
  });

  it("a not-yet-ported style name constructs as typing frames (the normalize fallback): after 16 busy ticks it renders the same typing frames", () => {
    const sp = busyAt(Array.from({ length: 16 }, () => false), (s: string) => (s === "⣿" ? 2 : 1), 16);
    const unported = new BorderTypeSpinner(
      () => false,
      "wave-rows",
      (s: string) => (s === "⣿" ? 2 : 1),
    );
    for (let i = 0; i < 16; i++) unported.tick();
    expect(unported.frame()).toBe(sp.frame()); // same typing frames
  });
});
