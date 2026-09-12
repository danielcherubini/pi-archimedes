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
import { SPIN_INTERVALS, BorderTypeSpinner } from "./spin.js";
import { pickQuip } from "./spin-quips.js";
import { SPIN_SPEED_MULT, type CoreConfig, type SpinnerStyle } from "../config.js";

const DOUBLE_PRESS_WINDOW_MS = 500;

/** The 4-cell window inside the `┌───┐` border row — both stage sets are 1 wide per stage char, so the window stays 4 chars wide. */
export const SPIN_TYPE_CELLS = BorderTypeSpinner.CELLS;
/** Window start (in cells) inside the `┌───┐` border row, after `┌` — position 0, the block sits directly after the corner; the window's leading padding space is the first cell after it (`┌␠⠛⠛⠛⠛ …`). */
export const SPIN_TYPE_START = 0;

export class HephaestusEditor extends CustomEditor {
  private readonly piKeybindings: KeybindingsManager;
  private readonly getTheme: () => Theme;
  private readonly isIdle: () => boolean;
  private readonly shutdown: () => void;
  private hintTimer: ReturnType<typeof setTimeout> | undefined;
  private hintMessage: string | undefined;
  private pendingQuitUntil = 0;

  private readonly spinEnabled: boolean;
  /** Label typed after the 4-cell window while busy (the `editorSpinLabel` setting): an empty string hides it. */
  private readonly spinLabel: string;
  /** Immutable label mode, derived in the ctor from the RAW `spinLabel`: `""` (a string) → `"hidden"` (no quip; legacy precedence); non-string (corrupt config — `safeSpinLabel` fell back to `"Working"`) → `"quip"`; `safeSpinLabel === "Working"` (default or hand-typed, indistinguishable) → `"quip"`; any other non-empty string → `"verbatim"` (the config label wins). */
  private readonly labelMode: "hidden" | "quip" | "verbatim";
  /** The current busy episode's quip: `undefined` until the first idle→busy tick (the default `"Working"` then shows for at most one tick — approved), survives idle ticks, and is re-picked on the next busy transition with the previous quip excluded. */
  private spinQuip: string | undefined;
  /** Quip-mode busy-episode tracker — deliberately starts `false`, never reads `isIdle()` at construction, so an already-busy agent gets a quip on its first tick (transition detection needs `false` beforehand). */
  private wasBusy = false;
  /** The border-row spin spinner (mechanism in `BorderTypeSpinner`): the `spinStyle` (raw setting strings normalize — unknown names fall back to typing frames) — created only when `spin` is on, so the off path stays fully inert. The tick period is the style's native tempo × the `spinSpeed` multiplier, 32 ms floor. */
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
      spinSpeed = "normal",
      spinStyle = "pendulum",
      spinLabel = "Working",
      onSpinInterval,
    }: {
      getTheme: () => Theme;
      isIdle: () => boolean;
      shutdown: () => void;
      /** Type a 4-cell spinner window into the editor's top border while the agent is busy (the animation mechanism lives in `BorderTypeSpinner`, `./spin.js`): the style-configured 4-cell window (the gallery-derived styles in `SPIN_VARIANTS` — the 2×4 braille dot block (⠁ → ⣿, Unicode chart order, `typing`) grows cell-by-cell left→right — each cell walking the 8 stages in 2-step line pairs (⠁⠉/⠋⠛/⠟⠿/⡿⣿) — then holds, clears, repeats (in EAW terminals the stage set falls back to the width-1 shading ░ → █; raw setting strings are tolerated — unknown names normalize to typing frames). */
      spin?: boolean;
      /** Tick period = the style's native per-tick tempo (`SPIN_INTERVALS[normalizeSpinnerStyle(spinStyle)]`) × the `editorSpinSpeed` multiplier (1.5 / 1 / 0.6), clamped at the 32 ms tick floor (the floor also caps a 30 ms native style under `fast` at 32). */
      spinSpeed?: CoreConfig["editorSpinSpeed"];
      /** The `editorSpinStyle` setting — the default style, from the config default (pendulum); raw setting strings are tolerated, but unknown names still normalize to typing frames (the normalizer's fallback, kept distinct from the default). */
      spinStyle?: SpinnerStyle | string;
      /** Label typed after the window while busy (the `editorSpinLabel` setting): an empty string hides it. The default `"Working"` (and a hand-typed `"Working"`, indistinguishable from it) is replaced by a random quip picked once per busy episode; any other non-empty string is shown verbatim. Non-string values (corrupt config) fall back to `"Working"` — i.e. quip mode. */
      spinLabel?: string;
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
    // Non-string values (corrupt config) fall back to "Working" before `spinLabel` reaches `visibleWidth(label)`.
    const safeSpinLabel =
      typeof spinLabel === "string" ? spinLabel : "Working";
    this.spinLabel = safeSpinLabel;
    // Immutable label mode from the RAW option (the `typeof` check reads the raw value, so it also distinguishes a corrupt non-string from a hand-typed "Working").
    this.labelMode =
      typeof spinLabel === "string" && spinLabel === ""
        ? "hidden"
        : safeSpinLabel === "Working"
          ? "quip"
          : "verbatim";
    this.borderSpinner = spin ? new BorderTypeSpinner(this.isIdle, spinStyle) : undefined;
    if (spin) {
      // The style's native per-tick tempo × the `editorSpinSpeed` multiplier, 32 ms tick floor (the floor also caps a 30 ms native style under `fast` at 32); unknown raw strings fall back to the typing native (the normalize fallback).
      const nativeMs = SPIN_INTERVALS[spinStyle as SpinnerStyle];
      const spinTickMs = Math.max(
        32,
        (nativeMs ?? SPIN_INTERVALS["typing"]) * (SPIN_SPEED_MULT[spinSpeed] ?? 1),
      );
      this.spinTimer = setInterval(() => this.tickSpin(), spinTickMs);
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

  /** Advances the spin; in quip mode the per-episode selection lands BEFORE the border-spinner repaint. */
  private tickSpin(): void {
    if (this.labelMode === "quip") {
      const busy = this.spinEnabled && !this.isIdle();
      if (busy && !this.wasBusy) this.spinQuip = pickQuip(this.spinQuip);
      this.wasBusy = busy;
    }
    if (this.borderSpinner && this.borderSpinner.tick()) {
      this.tui.requestRender();
    }
  }

  /** The 4-cell window that replaces a segment of the border (mechanism in `BorderTypeSpinner`): cells fill cell-by-cell left→right, the current step's stage chars rendered in the spin (accent) palette (⠁⠉ / ⠋⠛ / ⠟⠿ / ⡿⣿; EAW: the width-1 shading ░ → █) — the 2×4 dot block grows across the window — the not-yet-reached cells are plain spaces (the border line breaks) — plain " " (U+0020). The empty clear step (step 0) is all spaces; hold steps clamp to the last (fully grown) frame. The window sits one leading space after `┌` at start 0 (right at the corner), and the label follows it typed as `" " + spinLabel + " "` — its own leading and trailing spaces, with the trailing one providing the margin to the trailing dashes. */
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

      // Top border row: while busy, a 4-cell window at start 0 replaces a
      // segment of the `─` border and the block sits directly after `┌` —
      // the window's leading padding space is the first cell after the
      // corner, then the window; the config label (`editorSpinLabel`,
      // default "Working") follows the window typed as `Working ` — one
      // space before AND after the label — when the box is wide enough
      // (inner >= 0 + 1 + 4 + 1 + labelW + 1 + 2 = labelW + 9, where
      // labelW = visibleWidth(label) — 9 for the default label; a CJK
      // label's visible width exceeds its char length — a margin of 2
      // after the trailing space; empty label or too-narrow
      // box → window only, not standalone), plain when too narrow to fit
      // (inner < 7, the minimum busy row is start 0 + 1 leading space +
      // 4 cells + 2 trailing margin). The window fills cell-by-cell
      // left→right, each cell walking the 8 chart-order stages in 2-step
      // line pairs (⠁⠉ / ⠋⠛ / ⠟⠿ / ⡿⣿; EAW: the width-1 shading ░ → █), so
      // the 2×4 dot block grows across the window line by line, followed
      // by the label (shown when the box hosts it; over-long labels never
      // sink the row — Math.max keeps the trailing ≥ 0 and the
      // window-only tier handles them), then holds — on the empty clear
      // step (step 38) the window cells are spaces and the label stays
      // up (the border line breaks there); the leading space + window +
      // label's columns replace trailing dashes, so the row width stays
      // constant (the trailing run shortens accordingly: inner − 0 − 1 −
      // 4 − (1 + labelW + 1) when the label shows, inner − 1 − 4
      // otherwise).
      const borderRun = (() => {
        const busy = this.spinEnabled && !this.isIdle();
        // Quip mode: the current episode's quip replaces the default label (`spinQuip` is `undefined` before the first busy tick, so at most one tick shows the default `"Working"` — approved); `hidden` / `verbatim` render the config label as-is.
        const label = this.labelMode === "quip" ? (this.spinQuip ?? this.spinLabel) : this.spinLabel;
        // Visible width (not `.length`): a 4-char CJK label is 8 cells wide — `label.length` would short the row.
        const labelW = visibleWidth(label);
        const labelShown =
          busy &&
          label !== "" &&
          inner >=
            SPIN_TYPE_START + 1 + SPIN_TYPE_CELLS + 1 + labelW + 1 + 2; // labelFit = 0 + 1 (left padding) + 4 (window) + (" " + label + " " = 1 + labelW + 1) + 2 (trailing margin) = labelW + 9
        if (!busy || inner < SPIN_TYPE_START + 1 + SPIN_TYPE_CELLS + 2) { // inner < 7 → plain (no window, no label)
          return p.frame("─".repeat(inner));
        }
        const start = SPIN_TYPE_START; // 0 — the block sits directly after `┌` whenever it shows
        // Label cost = its own leading space + the label + its own trailing
        // space; the Math.max floor means an over-long label can never
        // sink the trailing below zero (those boxes degraded to
        // window-only above).
        const labelCost = labelShown ? 1 + labelW + 1 : 0;
        return (
          p.frame("─".repeat(start)) +
          " " +
          this.typeStrip() +
          (labelShown ? p.time(" " + label + " ") : "") +
          p.frame(
            "─".repeat(
              Math.max(0, inner - start - 1 - SPIN_TYPE_CELLS - labelCost),
            ),
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
