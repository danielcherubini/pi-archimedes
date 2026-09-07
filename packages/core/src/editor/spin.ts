import { visibleWidth } from "@earendil-works/pi-tui";

/** Growing 2×4 braille dot block, Unicode braille-chart dot order (U+2801 → U+28FF) — its 8 stages run through the 4-cell window in 2-step line pairs (⠁⠉ / ⠋⠛ / ⠟⠿ / ⡿⣿). */
const STAGE_BRAILLE = ["⠁", "⠉", "⠋", "⠛", "⠟", "⠿", "⡿", "⣿"];
/** Width-1 shading fallback for EAW terminals (⣿ reports visible width 2) — the same 8 stages. */
const STAGE_SHADE = ["░", "░", "░", "░", "▒", "▒", "▓", "█"];

/** Fill-sweep step count: each of the 4 lines walks the 8-stage chart order, 2 stage steps per cell (32 = CELLS × 8). */
const SPIN_TYPE_STEPS = 4 * 8; // 32
const SPIN_TYPE_HOLD = 6;
const SPIN_TYPE_CYCLE = SPIN_TYPE_STEPS + SPIN_TYPE_HOLD; // 38

/** The border-row typing spinner: a 4-cell window that fills cell-by-cell left→right, each cell walking the 8 chart-order stages in 2-step line pairs (⠁⠉ / ⠋⠛ / ⠟⠿ / ⡿⣿), then holds, clears, repeats; repaints exactly once on the busy→idle transition. Owns the busy/idle tick machine and the precomputed frame table; the editor keeps the timer, the guards, and the border-row assembly. */
export class BorderTypeSpinner {
  /** The 4-cell window width inside the border row — both stage sets are 1 wide per stage char. */
  static readonly CELLS = 4;

  /** Stage set: growing 2×4 braille dot block (Unicode chart order); EAW terminals (⣿ width 2) fall back to the width-1 shading set ░→█. */
  private readonly stageSet: readonly string[];
  /** Precomputed 32-frame fill sequence (deterministic per instance, computed in the ctor): cells fill cell-by-cell left→right, each cell walking the 8 chart-order stages in 2-step line pairs (⠁⠉/⠋⠛/⠟⠿/⡿⣿). */
  private readonly stageSeq: string[];
  private step = 0;
  private wasBusy = false;

  constructor(
    private readonly isIdle: () => boolean,
    probe: (s: string) => number = visibleWidth,
  ) {
    this.stageSet = probe("⣿") === 1 ? STAGE_BRAILLE : STAGE_SHADE;
    const cells: string[] = [];
    for (let i = 0; i < BorderTypeSpinner.CELLS; i++) cells.push(" ");
    const seq: string[] = [];
    for (let k = 0; k < 4; k++) {
      for (let i = 0; i < BorderTypeSpinner.CELLS; i++) {
        cells[i] = this.stageSet[2 * k]!;
        seq.push(cells.join(""));
        cells[i] = this.stageSet[2 * k + 1]!;
        seq.push(cells.join(""));
      }
    }
    this.stageSeq = seq;
  }

  /** Advances the busy/idle machine; returns true when the caller should repaint (busy tick, or the busy→idle reset — idle→idle is a full no-op). Resets to the empty clear frame on the busy→idle transition; the step wraps at the 38-step cycle. */
  tick(): boolean {
    const wasBusy = this.wasBusy;
    const busy = !this.isIdle();
    if (busy) this.step = (this.step + 1) % SPIN_TYPE_CYCLE;
    else if (wasBusy) this.step = 0;
    this.wasBusy = busy;
    return busy || wasBusy;
  }

  /** The 4-cell window for the current step: step 0 is 4 spaces (the empty clear beat); steps 1–32 walk the precomputed table; hold steps 33–38 clamp to the last (fully grown) frame. */
  frame(): string {
    const idx = Math.min(this.step, SPIN_TYPE_STEPS) - 1;
    if (idx < 0) return " ".repeat(BorderTypeSpinner.CELLS);
    return this.stageSeq[idx]!;
  }
}
