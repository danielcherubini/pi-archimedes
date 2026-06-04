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

export class HephaestusEditor extends CustomEditor {
  private readonly piKeybindings: KeybindingsManager;
  private readonly getTheme: () => Theme;
  private readonly isIdle: () => boolean;
  private readonly shutdown: () => void;
  private hintTimer: ReturnType<typeof setTimeout> | undefined;
  private hintMessage: string | undefined;
  private pendingQuitUntil = 0;

  constructor(
    tui: TUI,
    editorTheme: EditorTheme,
    keybindings: KeybindingsManager,
    {
      getTheme,
      isIdle,
      shutdown,
    }: {
      getTheme: () => Theme;
      isIdle: () => boolean;
      shutdown: () => void;
    },
  ) {
    super(tui, editorTheme, keybindings);
    this.piKeybindings = keybindings;
    this.getTheme = getTheme;
    this.isIdle = isIdle;
    this.shutdown = shutdown;
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

      const topLine =
        p.frame("┌") + p.frame("─".repeat(inner)) + p.frame("┐");
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
