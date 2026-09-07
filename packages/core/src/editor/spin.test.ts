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

/** Dot count of an 8-bit mask (EAW tier input). */
const popcount = (mask: number): number => {
  let n = 0;
  for (let b = 0; b < 8; b++) n += (mask >> b) & 1;
  return n;
};

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
  it("all ten registered style names (the full set) normalize to themselves", () => {
    for (const s of ["typing", "wave-rows", "columns", "pulse", "marquee", "pendulum", "cascade", "diagonal-swipe", "rain", "sparkle"]) {
      expect(normalizeSpinnerStyle(s)).toBe(s);
    }
  });

  it("rain / sparkle (batch 4) normalize to themselves", () => {
    expect(normalizeSpinnerStyle("rain")).toBe("rain");
    expect(normalizeSpinnerStyle("sparkle")).toBe("sparkle");
  });

  it("unknown / malformed strings normalize to typing", () => {
    for (const s of ["nope", "", "Typing"]) {
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

  it("SPIN_VARIANTS completeness: 10 entries — typing (batch 1) + wave-rows, columns, pulse, marquee (batch 2) + pendulum, cascade, diagonal-swipe (batch 3) + rain, sparkle (batch 4), in display order", () => {
    expect(Object.keys(SPIN_VARIANTS)).toEqual([
      "typing",
      "wave-rows",
      "columns",
      "pulse",
      "marquee",
      "pendulum",
      "cascade",
      "diagonal-swipe",
      "rain",
      "sparkle",
    ]);
  });

  it("the 9 batch 2–4 entries are registered with steps = the source's totalFrames and hold 0 (frames wrap, no clamp tail — the idx clamp is N/A)", () => {
    const expected = [
      ["wave-rows", 20],
      ["columns", 48],
      ["pulse", 23],
      ["marquee", 48],
      ["pendulum", 120],
      ["cascade", 60],
      ["diagonal-swipe", 60],
      ["rain", 90],
      ["sparkle", 60],
    ] as const;
    for (const [name, steps] of expected) {
      const cfg = SPIN_VARIANTS[name]!;
      expect(cfg.steps).toBe(steps);
      expect(cfg.hold).toBe(0);
      expect(normalizeSpinnerStyle(name)).toBe(name);
    }
  });

  it("an unregistered gallery name constructs as typing frames (the normalize fallback — e.g. the un-ported `sort`): after 16 busy ticks it renders the same typing frames", () => {
    const sp = busyAt(Array.from({ length: 16 }, () => false), (s: string) => (s === "⣿" ? 2 : 1), 16);
    const unported = new BorderTypeSpinner(
      () => false,
      "sort",
      (s: string) => (s === "⣿" ? 2 : 1),
    );
    for (let i = 0; i < 16; i++) unported.tick();
    expect(unported.frame()).toBe(sp.frame()); // same typing frames
  });

  // ── Batch 2: the 4 gallery ports (1×4 — 8 dot-columns × 4 rows; bit map: row 0 L 0x01 / R 0x08, row 1 0x02/0x10, row 2 0x04/0x20, row 3 0x40/0x80; cell = floor(pc/2), dot-column = pc%2) ──

  const brailleRender = (masks: number[]): string =>
    masks.map((m) => (m === 0 ? " " : String.fromCharCode(0x2800 + m))).join("");

  describe("wave-rows compute (source waveRows, totalFrames 20, interval 40; colPhaseStep 2π/8 = 45° per dot-column, band 0.9)", () => {
    const wave = SPIN_VARIANTS["wave-rows"]!;

    it("step 0 (basePhase 0): per-column sine centerRows 1.5 / 2.56 / 3.0 / 2.56 / 1.5 / 0.44 / 0 / 0.44 — bands land on rows (1,2) (2,3) (3) (2,3) (1,2) (0,1) (0) (0,1)", () => {
      expect(wave.compute(0)).toEqual([0xa6, 0xe0, 0x1e, 0x19]);
      expect(brailleRender(wave.compute(0))).toBe(
        ["⢦", "⣠", "⠞", "⠙"].join(""),
      );
    });

    it("mid (step 10, basePhase π — the mirror of 0): bands on (1,2) (0,1) (0) (0,1) (1,2) (2,3) (3) (2,3)", () => {
      expect(wave.compute(10)).toEqual([0x1e, 0x19, 0xa6, 0xe0]);
    });

    it("step 19 differs from step 0 in at least one cell (a full squelch does not re-create the frame; wrap is being squelced, not extrapolated)", () => {
      const c19 = wave.compute(19);
      const c0 = wave.compute(0);
      expect(c19.some((m, i) => m !== c0[i!])).toBe(true);
    });

    it("EAW: the live cell masks hit the density tiers (0x19 popcount 3 → ▒, 0x1E popcount 4 → ▒)", () => {
      expect(shadeForMask(0x19)).toBe("▒");
      expect(shadeForMask(0x1e)).toBe("▒");
    });
  });

  describe("columns compute (source columns, totalFrames 48, hold 0; stepsPerColumn height+1 = 5, totalSteps 8×5 = 40)", () => {
    const col = SPIN_VARIANTS.columns!;

    it("step 0: progress 0 → step 0, column 0 only unfilled (fill 0) — 4 blank cells", () => {
      expect(col.compute(0)).toEqual([0, 0, 0, 0]);
    });

    it("step 10: step floor(10/48×40) = 8 → activePc 1, activeFill 3 — pc 0 (cell 0 left dot-column) full (0x47), pc 1 (right) bottom-up to row 3 (0x80+0x20+0x10 = 0xB0) — cell 0 = 0xF7, cells 1–3 still blank", () => {
      expect(col.compute(10)).toEqual([0xf7, 0, 0, 0]);
    });

    it("step 24: step 20 → activePc 4, activeFill 0 — the first 4 dot-columns (cells 0 and 1, both dot-columns per cell) fully lit, the last 4 blank", () => {
      expect(col.compute(24)).toEqual([0xff, 0xff, 0, 0]);
    });

    it("EAW: the full bottom-up column mask 0x47 (popcount 4) renders ▒ via shadeForMask", () => {
      expect(shadeForMask(0x47)).toBe("▒");
    });
  });

  describe("pulse compute (source pulse, totalFrames 23, interval 60; t = frame×40, period 900, center (3.5, 1.5), maxDist √14.5 ≈ 3.808, ring width 0.8)", () => {
    const pulse = SPIN_VARIANTS.pulse!;

    it("step 0 (scale 1, ringPos 0.5×maxDist ≈ 1.904, band (1.104, 2.704)): dot-column x-offsets ±3.5 → nothing, ±2.5 → rows 1&2, ±1.5 → all 4 rows, ±0.5 → rows 0&3", () => {
      // cell 0 = L (dist −3.5: nothing) | R (−2.5: rows 1, 2 = 0x30); cell 1 = L (−1.5: full 0x47) | R (−0.5: rows 0, 3 = 0x88); cell 2 = L (+0.5: rows 0, 3 = 0x41) | R (+1.5: full 0xB8); cell 3 = L (+2.5: rows 1, 2 = 0x06) | R (+3.5: nothing).
      expect(pulse.compute(0)).toEqual([0x30, 0xcf, 0xf9, 0x06]);
    });

    it("mid (step 10): non-empty, 4 cells, no crash", () => {
      const m = pulse.compute(10);
      expect(m).toHaveLength(4);
      for (const x of m) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(0xff);
      }
      expect(m.some((x) => x > 0)).toBe(true);
    });

    it("the ring come-back: step 0 and step 22 (the last frame) both light — one cycle does not degenerate to narrow", () => {
      expect(pulse.compute(0).some((x) => x > 0)).toBe(true);
      expect(pulse.compute(22).some((x) => x > 0)).toBe(true);
    });

    it("EAW: the step-0 frame renders density tiers (0x30 popcount 2 → ░, 0xCF popcount 6 → ▓, 0xF9 popcount 6 → ▓, 0x06 popcount 2 → ░)", () => {
      expect(
        pulse
          .compute(0)
          .map((m) => shadeForMask(m))
          .join(""),
      ).toBe("░▓▓░");
    });
  });

  describe("marquee compute (source marquee, totalFrames 48, interval 55; offset floor(f/48×8), stripe (pc+row+offset)%4, lit < 2)", () => {
    const marquee = SPIN_VARIANTS.marquee!;

    it("step 0 (offset 0): light strips are on rows 0-1 (L 0x03), 0&3 (R 0x88), 2-3 (L 0x44), 1-2 (R 0x30) — cell 1 ≡ cells 2/3", () => {
      expect(marquee.compute(0)).toEqual([0x8b, 0x74, 0x8b, 0x74]);
    });

    it("mid (step 10, offset floor(10/48×8) = 1): strip +1 — rows 0&3 (L 0x41), 2-3 (R 0xA0), 1-2 (L 0x06), 0-1 (R 0x18)", () => {
      expect(marquee.compute(10)).toEqual([0xe1, 0x1e, 0xe1, 0x1e]);
    });

    it("EAW: the live cell masks render ▒ (0x8B and 0x74 are both popcount 4)", () => {
      expect(shadeForMask(0x8b)).toBe("▒");
      expect(shadeForMask(0x74)).toBe("▒");
    });
  });

  // ── Batch 3: the 3 gallery ports (pendulum, cascade, diagonal-swipe) — same 1×4 (8 dot-columns × 4 rows) adaptation; formulas and constants unchanged from the source ──

  describe("pendulum compute (source pendulum, totalFrames 120, interval 12; basePhase progress×8π, spread sin(progress×π)×1.1, threshold 0.7)", () => {
    const pend = SPIN_VARIANTS.pendulum!;

    it("step 0 (progress 0 → basePhase 0, spread 0 → swing 0 for every pc → center = (1−0)×3/2 = 1.5): |r−1.5| < 0.7 lights rows 1 and 2 for all 8 dot-columns → cell = 0x36 × 4", () => {
      expect(pend.compute(0)).toEqual([0x36, 0x36, 0x36, 0x36]);
      expect(brailleRender(pend.compute(0))).toBe("⠶⠶⠶⠶");
    });

    it("mid (step 60, progress 0.5 → basePhase 4π, spread 1.1): non-empty, 4 cells, no crash", () => {
      const m = pend.compute(60);
      expect(m).toHaveLength(4);
      for (const x of m) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(0xff);
      }
      expect(m.some((x) => x > 0)).toBe(true);
    });

    it("EAW: the step-0 masks (0x36, popcount 4) render ▒ at the density tier", () => {
      expect(
        pend
          .compute(0)
          .map((m) => shadeForMask(m))
          .join(""),
      ).toBe("▒▒▒▒");
    });
  });

  describe("cascade compute (source cascade, totalFrames 60, interval 40; leadingEdge progress×2, lit |nx + ny − edge| < 0.2)", () => {
    const cas = SPIN_VARIANTS.cascade!;

    it("step 0 (leadingEdge 0, lit where nx + ny < 0.2): pc0 row 0 (delta 0) and pc1 row 0 (delta 0.125 < 0.2) → cell 0 row 0 L+R (0x09), rest blank", () => {
      expect(cas.compute(0)).toEqual([0x09, 0, 0, 0]);
      expect(brailleRender(cas.compute(0))).toBe("⠉   ");
    });

    it("step 30 (leadingEdge 1, the anti-diagonal nx+ny=1): pc1 r3 / pc2 r3 / pc3 r2+r3 / pc4 r2 / pc5 r1+r2 / pc6 r1 / pc7 r0+r1 → cells 0x80, 0xE0, 0x34, 0x1A", () => {
      expect(cas.compute(30)).toEqual([0x80, 0xe0, 0x34, 0x1a]);
    });

    it("EAW: the live cell masks hit the density tiers (step 0: 0x09 popcount 2 → ░; step 30: 0x80 popcount 1 → ░, 0xE0 popcount 3 → ▒, 0x34 popcount 3 → ▒, 0x1A popcount 3 → ▒)", () => {
      expect(
        cas
          .compute(0)
          .map((m) => shadeForMask(m))
          .join(""),
      ).toBe("░   ");
      expect(
        cas
          .compute(30)
          .map((m) => shadeForMask(m))
          .join(""),
      ).toBe("░▒▒▒");
    });
  });

  describe("diagonal-swipe compute (source diagonalSwipe, totalFrames 60, interval 30; maxDiag 7+3 = 10, clearFrames = fillFrames = 30, localTotal 29, sweepFront progress×11; lit clearPhase ? diag ≥ front : diag < front)", () => {
    const sw = SPIN_VARIANTS["diagonal-swipe"]!;

    it("step 0 (clear phase, sweepFront 0): lit where diag ≥ 0 — every one of the 32 dots → all 4 cells full (0xFF)", () => {
      expect(sw.compute(0)).toEqual([0xff, 0xff, 0xff, 0xff]);
      expect(brailleRender(sw.compute(0))).toBe("⣿⣿⣿⣿");
    });

    it("step 29 (clear phase, sweepFront 11 = a full sweep): lit where diag ≥ 11 — nothing — the 4 cells blank, ready for the fill to start", () => {
      expect(sw.compute(29)).toEqual([0, 0, 0, 0]);
    });

    it("step 50 (fill phase, the inverted `diag < sweepFront` branch — front 20/29×11 ≈ 7.586, lit where diag < 7.586): pc 0–4 full, pc 5 rows 0–2, pc 6 rows 0–1, pc 7 row 0 → cells 0xFF, 0xFF, 0x7F, 0x0B; EAW ██▒", () => {
      expect(sw.compute(50)).toEqual([0xff, 0xff, 0x7f, 0x0b]);
      expect(
        sw
          .compute(50)
          .map((m) => shadeForMask(m))
          .join(""),
      ).toBe("███▒");
    });
  });

  // ── Batch 4: the final 2 gallery ports (rain, sparkle) — same 1×4 (8 dot-columns × 4 rows) adaptation; formulas and constants unchanged from the source (dot column = pc % 2) ──

  describe("rain compute (source rain, totalFrames 90, interval 40; t = step×40; period 1200 + rand×1000 with cyclePos t/period + rand×0.91 + pc×0.07 per dot-column, miss-chance skip, rollB spawn delay, gravity-fall + mid-wobble; colRandom = seededRandom(123), 8 draws in order pc 0..7, precomputed once at module scope like the source's contextCache)", () => {
    const rain = SPIN_VARIANTS.rain!;

    it("registers with steps 90 (the source's totalFrames) and hold 0", () => {
      expect(rain.steps).toBe(90);
      expect(rain.hold).toBe(0);
      expect(normalizeSpinnerStyle("rain")).toBe("rain");
    });

    it("step 0 (t = 0, no fallback: the rand×0.91 + pc×0.07 phase offsets put 3 dot-columns in their windows — live-computed): cells 0x00, 0x08, 0x20, 0x20; braille ⠈⠠⠠, EAW ░░░ with cell 0 blank", () => {
      expect(rain.compute(0)).toEqual([0, 0x08, 0x20, 0x20]);
      expect(brailleRender(rain.compute(0))).toBe(" ⠈⠠⠠");
      expect(
        rain
          .compute(0)
          .map((m) => shadeForMask(m))
          .join(""),
      ).toBe(" ░░░");
    });

    it("mid-step (step 45, t = 1800): plausible non-zero — 5 active drops, 5 dots of a 1..32 dot count, 3 non-zero cells — live-verified mask", () => {
      const m = rain.compute(45);
      expect(m).toEqual([0x82, 0x24, 0x04, 0x00]);
      const totalDots = m.reduce((s, x) => s + popcount(x), 0);
      expect(totalDots).toBe(5);
      expect(totalDots).toBeGreaterThanOrEqual(1);
      expect(totalDots).toBeLessThanOrEqual(32);
      expect(m).toHaveLength(4);
      expect(m.filter((x) => x > 0).length).toBeGreaterThanOrEqual(2);
    });

    it("step 20 (t = 800, activeDrops 0 — no dot-column is in its window): the guarantee fallback draws a dot — pos 800/1600 = 0.5 → pc floor(0.5×8) = 4 (cell 2), y clamp(floor(0.5×5), 0, 3) = 2 → 0x04 (EAW ░)", () => {
      expect(rain.compute(20)).toEqual([0, 0, 0x04, 0]);
      expect(shadeForMask(0x04)).toBe("░");
    });
  });

  describe("sparkle compute (source sparkle, totalFrames 60, interval 40; the verbatim hash — constants 374761393 / 668265263 / 1442695041, × 1274126177, / 4294967295 in 32-bit ops; density 0.095, lifetime 4, phase floor(step/2), 2×2 region competition with edge compensation 0.12 × (col-edges 0/7 + row-edges 0/3), 4-frame lifecycle, one-frame 8-direction jitter)", () => {
    const spkl = SPIN_VARIANTS.sparkle!;

    it("registers with steps 60 (the source's totalFrames) and hold 0; the age gate (skip age > 3) lets dots through — step 0 has 6 dots, within a 1..32 dot count", () => {
      expect(spkl.steps).toBe(60);
      expect(spkl.hold).toBe(0);
      expect(normalizeSpinnerStyle("sparkle")).toBe("sparkle");
      expect(spkl.compute(0).reduce((s, x) => s + popcount(x), 0)).toBe(6);
    });

    it("step 0 (phase 0): deterministic — the live-computed full 4-mask, 6 dots, all 4 cells lit", () => {
      expect(spkl.compute(0)).toEqual([0x01, 0x21, 0x0c, 0x10]);
      expect(brailleRender(spkl.compute(0))).toBe("⠁⠡⠌⠐");
    });

    it("phase advance (steps 0 → 3, phase 0 → 1): masks re-sample — cell 0 flips 0x01 → 0x81 in particular (all 4 cells re-sample); same-phase frames 2 vs 3 (phase 1) are bit-identical under the 4-frame lifecycle", () => {
      expect(spkl.compute(3)).toEqual([0x81, 0x08, 0x81, 0x02]);
      expect(spkl.compute(3)[0]!).not.toBe(spkl.compute(0)[0]!);
      expect(spkl.compute(2)).toEqual(spkl.compute(3));
    });

    it("EAW: the step-0 masks are all low popcount (1, 2, 2, 1 dots — every tier ░) → ░░░░", () => {
      expect(
        spkl
          .compute(0)
          .map((m) => shadeForMask(m))
          .join(""),
      ).toBe("░░░░");
    });
  });
});
