import { visibleWidth } from "@earendil-works/pi-tui";
import type { SpinnerStyle } from "../config.js";

/** Growing 2×4 braille dot block, Unicode braille-chart dot order (U+2801 → U+28FF) — its 8 stages run through the 4-cell window in 2-step line pairs (⠁⠉ / ⠋⠛ / ⠟⠿ / ⡿⣿). */
const STAGE_BRAILLE = ["⠁", "⠉", "⠋", "⠛", "⠟", "⠿", "⡿", "⣿"];
/** Width-1 shading fallback for EAW terminals (⣿ reports visible width 2) — the same 8 stages. */
const STAGE_SHADE = ["░", "░", "░", "░", "▒", "▒", "▓", "█"];

/** Native per-tick tempo (ms) per gallery style, taken from the source library. The 32 ms tick floor (and the `editorSpinSpeed` × mult) is applied at the editor / editor factory — not here. (The 32 ms floor also caps a 30 ms native style under `fast` at 32.) */
export const SPIN_INTERVALS: Record<SpinnerStyle, number> = {
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
};

/** The 8 chart-order dot masks of the 2×4 braille block; char k = `String.fromCharCode(0x2800 + mask)` MUST exactly reproduce the STAGE_BRAILLE / STAGE_SHADE chars (⠁ ⠉ ⠋ ⠛ ⠟ ⠿ ⡿ ⣿). */
export const STAGE_MASKS = [0x01, 0x09, 0x0B, 0x1B, 0x1F, 0x3F, 0x7F, 0xFF];

/** One gallery-derived spin style: `steps` (tick cycle incl. hold — typing: 32 + 6 = 38), `hold` (the clamp tail after the fill walk), and `compute(step)`, which returns the 4 braille dot-masks (8-bit each) for the 4-cell window at `step` (0-based: 0 = the first fill tick after the clear beat; beyond `steps - hold` the frames clamp to the last one). */
export interface SpinStyleConfig {
  steps: number;
  hold: number;
  compute: (step: number) => number[];
}

/** The gallery-derived variants. Batch 1 defines ONLY `typing` — the other nine styles (wave-rows, columns, pulse, marquee, pendulum, rain, cascade, diagonal-swipe, sparkle) land in batches 2–4; a unknown / not-yet-ported name normalizes to typing in the meantime (`normalizeSpinnerStyle`). */
export const SPIN_VARIANTS: Partial<Record<SpinnerStyle, SpinStyleConfig>> = {
  typing: {
    steps: 38,
    hold: 6,
    /** The exact current cell-by-cell math: line = floor(step/8), pair = floor((step%8)/2), s = step%2; cells: stage(2k+1) for j<i, stage(2k+s) for j=i, the previous line's full stage (or blank on line 1, where "not yet reached" is the 0-mask = the clear) for j>i. */
    compute(step: number): number[] {
      const k = Math.floor(step / 8);
      const i = Math.floor((step % 8) / 2);
      const s = step % 2;
      const cells = [0, 0, 0, 0];
      for (let j = 0; j < 4; j++) {
        if (j < i) cells[j] = STAGE_MASKS[2 * k + 1]!;
        else if (j === i) cells[j] = STAGE_MASKS[2 * k + s]!;
        else cells[j] = k === 0 ? 0 : STAGE_MASKS[2 * k - 1]!;
      }
      return cells;
    },
  },
};

/** The normalizeVariant fallback: a registered variant name maps to itself, everything else (not-yet-ported gallery styles, unknown strings) falls back to `typing`. */
export function normalizeSpinnerStyle(s: string): SpinnerStyle {
  return SPIN_VARIANTS[s as SpinnerStyle] ? (s as SpinnerStyle) : "typing";
}

/** The density tier of an 8-bit dot mask by popcount (the width-1 EAW path for non-typing styles): 0 → space, 1–2 → ░, 3–4 → ▒, 5–6 → ▓, 7–8 → █. */
export function shadeForMask(mask: number): string {
  let dots = 0;
  for (let b = 0; b < 8; b++) dots += (mask >> b) & 1;
  if (dots === 0) return " ";
  if (dots <= 2) return "░";
  if (dots <= 4) return "▒";
  if (dots <= 6) return "▓";
  return "█";
}

/** The border-row spin spinner: a style-configured 4-cell window (the gallery-derived styles in `SPIN_VARIANTS` — batch 1: `typing` — the 8 chart-order stages in 2-step line pairs, then holds, clears, repeats) that fills frame by frame per the style's `compute`; repainted exactly once on the busy→idle transition. Owns the busy/idle tick machine and the precomputed frame table; the editor keeps the timer (style's native tempo × speed mult, 32 ms floor), the guards, and the border-row assembly. Grabbiness is chosen via the same probe as today: `visibleWidth("⣿") === 1` → braille path, otherwise the EAW path — for the typed style that is the existing stage-index shade lookup (byte-identical to the old frames), for other (port) styles the density tier via `shadeForMask`. */
export class BorderTypeSpinner {
  /** The 4-cell window width inside the border row — both stage sets are 1 wide per stage char. */
  static readonly CELLS = 4;

  /** Precomputed frame table (computed once in the ctor): covers the `steps − hold` frames `frame()` can address (typing: 32) — the hold tail clamps to the last (fully grown) frame. Deterministic per instance. */
  private readonly frames: string[];
  /** The resolved style config (`SPIN_VARIANTS[normalizeSpinnerStyle(style)]` — unknown names normalize to typing in the meantime batches 2–4 land). */
  private readonly cfg: SpinStyleConfig;
  private step = 0;
  private wasBusy = false;

  constructor(
    private readonly isIdle: () => boolean,
    /** The style (config-side typed `SpinnerStyle`, raw setting strings tolerated) — normalized: a not-yet-ported style renders as typing in the meantime its entry lands in batches 2–4. */
    style: SpinnerStyle | string = "typing",
    /** The stage-set grabbiness probe — same as today: `visibleWidth("⣿") === 1` → braille chars, otherwise the EAW width-1 path. */
    probe: (s: string) => number = visibleWidth,
  ) {
    const resolved = normalizeSpinnerStyle(style);
    this.cfg = SPIN_VARIANTS[resolved]!;
    const braille = probe("⣿") === 1;
    const frames: string[] = [];
    for (
      let i = 0;
      i < this.cfg.steps - this.cfg.hold;
      i++
    ) {
      frames.push(
        this.cfg
          .compute(i)
          .map((m) => {
            if (m === 0) return " ";
            if (braille) return String.fromCharCode(0x2800 + m);
            // EAW path: the typed style keeps the existing stage-index shade lookup (byte-identical to the old stage set sequence); other (port) styles take the density tier by their port-masks' popcount.
            return resolved === "typing"
              ? STAGE_SHADE[STAGE_MASKS.indexOf(m)]!
              : shadeForMask(m);
          })
          .join(""),
      );
    }
    this.frames = frames;
  }

  /** Advances the busy/idle machine; returns true when the caller should repaint (busy tick, or the busy→idle reset — idle→idle is a full no-op). Resets to the empty clear frame on the busy→idle transition; the step wraps at the style's cycle (typing: 38). */
  tick(): boolean {
    const wasBusy = this.wasBusy;
    const busy = !this.isIdle();
    if (busy) this.step = (this.step + 1) % this.cfg.steps;
    else if (wasBusy) this.step = 0;
    this.wasBusy = busy;
    return busy || wasBusy;
  }

  /** The 4-cell window for the current step: step 0 is 4 spaces (the empty clear beat); the `steps − hold` fill steps walk the precomputed table; the hold tail clamps to the last (fully grown) frame. */
  frame(): string {
    const idx = Math.min(this.step, this.cfg.steps - this.cfg.hold) - 1;
    if (idx < 0) return " ".repeat(BorderTypeSpinner.CELLS);
    return this.frames[idx]!;
  }
}

/** Kept for the EAW path's byte-identical typing lookup — the character sets derived from `STAGE_MASKS` (documented for anyone re-porting the stages). */
export { STAGE_BRAILLE, STAGE_SHADE };
