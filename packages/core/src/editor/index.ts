import {
  CustomEditor,
  type Theme,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  type TUI,
  type EditorTheme,
  truncateToWidth,
  isKeyRelease,
  visibleWidth,
} from "@earendil-works/pi-tui";

import {
  RESET,
  PAD_X,
  PI_STR,
  PI_WIDTH,
  PI_SYMBOL_COL,
  AUTOCOMPLETE_CURSOR,
  HINT_MARGIN_RIGHT,
  resolvePalette,
} from "../chrome.js";
import { isParentBorder, formatKey } from "../text.js";
import { BorderTypeSpinner } from "./spin.js";

const DOUBLE_PRESS_WINDOW_MS = 500;

export const SPIN_TICK_MS = 80;
/** The 4-cell window inside the `┌───┐` border row — both stage sets are 1 wide per stage char, so the window stays 4 chars wide. */
export const SPIN_TYPE_CELLS = BorderTypeSpinner.CELLS;
/** Window start (in cells) inside the `┌───┐` border row, after `┌`. */
export const SPIN_TYPE_START = 6;
/** Literal label rendered straight after the 4-cell window in every busy state (typing steps 1–32, hold, and the step-38 clear beat) — 1 leading space + the word; present from `inner >= 20`, omitted (not standalone) on narrower boxes, gone when idle. */
export const SPIN_TYPE_LABEL = " Working";

export class HephaestusEditor extends CustomEditor {
  private readonly piKeybindings: KeybindingsManager;
  private readonly getTheme: () => Theme;
  private readonly isIdle: () => boolean;
  private readonly shutdown: () => void;
  private hintTimer: ReturnType<typeof setTimeout> | undefined;
  private hintMessage: string | undefined;
  private pendingQuitUntil = 0;

  private readonly spinEnabled: boolean;
  /** The border-row typing spinner (mechanism in `BorderTypeSpinner`): created only when `spin` is on — never when it is off, so the off path stays fully inert. */
  private readonly borderSpinner: BorderTypeSpinner | undefined;
  private readonly onSpinInterval:
    | ((interval: ReturnType<typeof setInterval> | undefined) => void)
    | undefined;
  private spinTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    tui: TUI,
    editorTheme: EditorTheme,
    keybindings: KeybindingsManager,
    {
      getTheme,
      isIdle,
      shutdown,
      spin = false,
      onSpinInterval,
    }: {
      getTheme: () => Theme;
      isIdle: () => boolean;
      shutdown: () => void;
      /** Type a 4-cell spinner window into the editor's top border while the agent is busy (the animation mechanism lives in `BorderTypeSpinner`, `./spin.js`): the 2×4 braille dot block (⠁ → ⣿, Unicode chart order) grows cell-by-cell left→right — each cell walking the 8 stages in 2-step line pairs (⠁⠉/⠋⠛/⠟⠿/⡿⣿) — then holds, clears, repeats (in EAW terminals the stage set falls back to the width-1 shading ░ → █). */
      spin?: boolean;
      /** Lets an out-of-editor scope (core index.ts session hooks) clear the timer. */
      onSpinInterval?: (
        interval: ReturnType<typeof setInterval> | undefined,
      ) => void;
    },
  ) {
    super(tui, editorTheme, keybindings);
    this.piKeybindings = keybindings;
    this.getTheme = getTheme;
    this.isIdle = isIdle;
    this.shutdown = shutdown;
    this.onSpinInterval = onSpinInterval;
    this.spinEnabled = spin;
    this.borderSpinner = spin ? new BorderTypeSpinner(this.isIdle) : undefined;
    if (spin) {
      this.spinTimer = setInterval(() => this.tickSpin(), SPIN_TICK_MS);
      this.onSpinInterval?.(this.spinTimer);
    }
  }

  /** Clears the spinner timer and drops the module handle; idempotent. Pi 0.85.1 never calls dispose on a replaced editor — module-scope reaping is the operative safety net. */
  dispose(): void {
    if (this.spinTimer) {
      clearInterval(this.spinTimer);
      this.spinTimer = undefined;
      this.onSpinInterval?.(undefined);
    }
  }

  // ── Prompt spin ───────────────────────────────────────

  private tickSpin(): void {
    if (this.borderSpinner && this.borderSpinner.tick()) {
      this.tui.requestRender();
    }
  }

  /** The 4-cell window that replaces a segment of the border (mechanism in `BorderTypeSpinner`): cells fill cell-by-cell left→right, the current step's stage chars rendered in the spin (accent) palette (⠁⠉ / ⠋⠛ / ⠟⠿ / ⡿⣿; EAW: the width-1 shading ░ → █) — the 2×4 dot block grows across the window — the not-yet-reached cells are plain spaces (the border line breaks) — plain " " (U+0020). The empty clear step (step 0) is all spaces; hold steps clamp to the last (fully grown) frame. */
  private typeStrip(): string {
    const p = resolvePalette(this.getTheme());
    if (!this.borderSpinner) return " ".repeat(SPIN_TYPE_CELLS);
    return this.borderSpinner.frame().split("").map(
      (c) => (c === " " ? " " : p.spin(c)),
    ).join("");
  }

  // ── Quit hint ─────────────────────────────────────────────

  private clearHint(resetWindow = true): void {
    clearTimeout(this.hintTimer);
    this.hintTimer = undefined;
    this.hintMessage = undefined;
    if (resetWindow) this.pendingQuitUntil = 0;
    this.tui.requestRender();
  }

  private showHint(message: string): void {
    this.clearHint(false);
    this.hintMessage = message;
    this.tui.requestRender();
    this.hintTimer = setTimeout(() => {
      this.hintMessage = undefined;
      this.hintTimer = undefined;
      this.pendingQuitUntil = 0;
      this.tui.requestRender();
    }, DOUBLE_PRESS_WINDOW_MS);
  }

  // ── Input ─────────────────────────────────────────────────

  override handleInput(data: string): void {
    if (isKeyRelease(data)) {
      super.handleInput(data);
      return;
    }

    if (!this.piKeybindings.matches(data, "app.clear")) {
      this.clearHint();
      super.handleInput(data);
      return;
    }

    const now = Date.now();

    if (this.getText().length > 0) {
      this.clearHint();
      this.pendingQuitUntil = now + DOUBLE_PRESS_WINDOW_MS;
      this.setText("");
      return;
    }

    if (!this.isIdle()) {
      this.clearHint();
      super.handleInput(data);
      return;
    }

    if (this.pendingQuitUntil > 0 && now <= this.pendingQuitUntil) {
      this.clearHint();
      this.shutdown();
      return;
    }

    this.pendingQuitUntil = now + DOUBLE_PRESS_WINDOW_MS;
    this.showHint(
      `${formatKey(this.piKeybindings.getKeys("app.clear")[0])} to quit`,
    );
  }

  // ── Render ────────────────────────────────────────────────

  override render(width: number): string[] {
    try {
      const p = resolvePalette(this.getTheme());
      const cw = width - PAD_X * 2;
      const inner = cw - 2;
      const rightPad = 1;
      const superLines = super.render(cw - PI_WIDTH - rightPad);

      let bottomIdx = superLines.length - 1;
      for (let i = superLines.length - 1; i >= 1; i--) {
        if (isParentBorder(superLines[i]!)) {
          bottomIdx = i;
        }
      }
      const contentLines = superLines.slice(1, bottomIdx);
      const autoLines = superLines.slice(bottomIdx + 1).map(
        (line) =>
          " ".repeat(PI_SYMBOL_COL) +
          truncateToWidth(
            line.replace("→", AUTOCOMPLETE_CURSOR),
            cw - PI_SYMBOL_COL,
            "",
            true,
          ),
      );

      // Top border row: while busy, a 4-cell window replaces a segment of
      // the `─` border — 6 dashes in; the ` Working` label right after the
      // window when the box is wide enough (inner >= 20; omitted, not
      // standalone, in the 8 ≤ inner < 20 window-only tier), plain when too
      // narrow to fit. The window fills cell-by-cell left→right,
      // each cell walking the 8 chart-order stages in 2-step line pairs
      // (⠁⠉ / ⠋⠛ / ⠟⠿ / ⡿⣿; EAW: the width-1 shading ░ → █), so the 2×4
      // dot block grows across the window line by line, followed by a
      // " Working" label (label shown when the box is wide enough; omitted,
      // not standalone, on narrow boxes), then holds — on
      // the empty clear step (step 38) the window cells are spaces and the
      // label stays up (the border line breaks there); the label's 8
      // columns replace trailing dashes, so the row width stays constant.
      const borderRun = (() => {
        const busy = this.spinEnabled && !this.isIdle();
        const labelShown =
          busy &&
          inner >=
            SPIN_TYPE_START + SPIN_TYPE_CELLS + SPIN_TYPE_LABEL.length + 2;
        if (!busy || inner < SPIN_TYPE_CELLS + 4) { // inner < 8 → plain (no window, no label)
          return p.frame("─".repeat(inner));
        }
        let start = SPIN_TYPE_START; // 6
        if (!labelShown && inner < start + SPIN_TYPE_CELLS + 2) { // 8 ≤ inner < 12 → shift
          start = Math.max(2, inner - SPIN_TYPE_CELLS - 2); // shrink window left for narrow boxes
        }
        const labelLen = labelShown ? SPIN_TYPE_LABEL.length : 0;
        return (
          p.frame("─".repeat(start)) +
          this.typeStrip() +
          (labelShown ? p.time(SPIN_TYPE_LABEL) : "") +
          p.frame(
            "─".repeat(Math.max(0, inner - start - SPIN_TYPE_CELLS - labelLen)),
          )
        );
      })();
      const topLine = p.frame("┌") + borderRun + p.frame("┐");
      const botLine =
        p.frame("└") + p.frame("─".repeat(inner)) + p.frame("┘");

      const piPrefix = p.prefix(PI_STR);

      const midLines = contentLines.map((line, i) => {
        if (i !== 0) {
          return (
            " ".repeat(PI_WIDTH) +
            truncateToWidth(line, cw - PI_WIDTH, "", true)
          );
        }

        if (this.hintMessage) {
          const hint =
            p.hint(this.hintMessage) + " ".repeat(HINT_MARGIN_RIGHT);
          return (
            piPrefix +
            truncateToWidth(
              line,
              cw - PI_WIDTH - visibleWidth(hint),
              "",
              true,
            ) +
            hint
          );
        }
        return piPrefix + truncateToWidth(line, cw - PI_WIDTH, "", true);
      });

      const spacer = autoLines.length > 0 ? [" ".repeat(cw)] : [];
      const raw = [topLine, ...midLines, ...spacer, ...autoLines, botLine];

      const pad = " ".repeat(PAD_X);
      const wrap = (line: string): string => {
        const patched = line.replaceAll(RESET, RESET + p.panelBg);
        return p.panelBg + pad + patched + pad + RESET;
      };

      const topEdge = p.panelEdge + "▁".repeat(width) + RESET;
      const botEdge = p.panelEdge + "▔".repeat(width) + RESET;

      return [topEdge, ...raw.map(wrap), botEdge];
    } catch (e) {
      console.error("HephaestusEditor render error:", e);
      throw e;
    }
  }
}
