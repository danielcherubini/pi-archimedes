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

const DOUBLE_PRESS_WINDOW_MS = 500;

export const SPIN_TICK_MS = 80;
/** The 4-cell window inside the `┌───┐` border row — both stage sets are 1 wide per stage char, so the window stays 4 chars wide. */
export const SPIN_TYPE_CELLS = 4;
/** Growth stages of the 2×4 braille dot block the window shows (⠁ → ⣿). */
export const SPIN_TYPE_STAGES = 8;
export const SPIN_TYPE_HOLD = 6;
export const SPIN_TYPE_CYCLE = SPIN_TYPE_STAGES + SPIN_TYPE_HOLD; // 14
/** Window start (in cells) inside the `┌───┐` border row, after `┌`. */
export const SPIN_TYPE_START = 6;

/** Growing 2×4 braille dot block, Unicode braille-chart dot order (U+2801 → U+28FF). */
const STAGE_BRAILLE = ["⠁", "⠉", "⠋", "⠛", "⠟", "⠿", "⡿", "⣿"];
/** Width-1 shading fallback for EAW terminals (⣿ reports visible width 2) — the same 8 stages. */
const STAGE_SHADE = ["░", "░", "░", "░", "▒", "▒", "▓", "█"];

export class HephaestusEditor extends CustomEditor {
  private readonly piKeybindings: KeybindingsManager;
  private readonly getTheme: () => Theme;
  private readonly isIdle: () => boolean;
  private readonly shutdown: () => void;
  private hintTimer: ReturnType<typeof setTimeout> | undefined;
  private hintMessage: string | undefined;
  private pendingQuitUntil = 0;

  private readonly spinEnabled: boolean;
  /** Stage set: growing 2×4 braille dot block (Unicode chart order); EAW terminals (⣿ width 2) fall back to the width-1 shading set ░→█. */
  private readonly spinStageSet: readonly string[];
  private readonly onSpinInterval:
    | ((interval: ReturnType<typeof setInterval> | undefined) => void)
    | undefined;
  private typeStep = 0;
  private wasBusy = false;
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
      /** Type a 4-cell spinner window into the editor's top border while the agent is busy: the window grows a 2×4 braille dot block (⠁ → ⣿, Unicode chart order) over 8 stages, cloned across the 4 cells, holds, clears, repeats (in EAW terminals the stage set falls back to the width-1 shading ░ → █). */
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
    this.spinStageSet = visibleWidth("⣿") === 1 ? STAGE_BRAILLE : STAGE_SHADE;
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
    const busy = !this.isIdle();
    if (busy) {
      this.typeStep = (this.typeStep + 1) % SPIN_TYPE_CYCLE;
      this.tui.requestRender();
    } else if (this.wasBusy) {
      this.typeStep = 0;
      this.tui.requestRender();
    }
    this.wasBusy = busy;
  }

  /** The 4-cell window that replaces a segment of the border: every cell clones the current stage of the growing 2×4 braille dot block (Unicode chart order; EAW: width-1 shading ░→█) via the spin (accent) palette, the empty clear stage is plain spaces (the border line breaks) — plain " " (U+0020). */
  private typeStrip(): string {
    const p = resolvePalette(this.getTheme());
    const n = Math.min(this.typeStep, SPIN_TYPE_STAGES);
    const ch = n > 0 ? this.spinStageSet[n - 1]! : " ";
    return Array.from({ length: SPIN_TYPE_CELLS }, () =>
      ch === " " ? " " : p.spin(ch),
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
      // the `─` border — 6 dashes in, shifted left on narrow boxes, plain
      // when too narrow to fit. The window grows a 2×4 braille dot block
      // (⠁ → ⣿, Unicode chart order; EAW: shading ░ → █) over 8 stages,
      // cloned across the 4 cells, then holds — on the empty clear stage
      // the window cells are spaces (the border line breaks there).
      const borderRun = (() => {
        if (this.spinEnabled && !this.isIdle()) {
          let start = SPIN_TYPE_START; // 6
          if (inner < start + SPIN_TYPE_CELLS + 2) { // inner < 12 → shift
            start = Math.max(2, inner - SPIN_TYPE_CELLS - 2); // shrink window left for narrow boxes
            if (inner < SPIN_TYPE_CELLS + 4) { // inner < 8 → plain
              return p.frame("─".repeat(inner)); // too narrow → plain
            }
          }
          return (
            p.frame("─".repeat(start)) +
            this.typeStrip() +
            p.frame("─".repeat(inner - start - SPIN_TYPE_CELLS))
          );
        }
        return p.frame("─".repeat(inner));
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
