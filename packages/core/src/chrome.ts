import type { Theme, ThemeAppearance, ThemeColor } from "@earendil-works/pi-coding-agent";
// A namespace import, deliberately: `foregroundAnsi` is pi-tui 1.x, and a named
// import of a name an older host never exported fails when the module *links* —
// before any of this package runs, taking the palette and everyone who imports it
// down. ADR 0026's rule is to warn about an old host, never break it.
import * as piTui from "@earendil-works/pi-tui";
import type { Color, TerminalColorMode } from "@earendil-works/pi-tui";

// ── ANSI constants ───────────────────────────────────────────────────────────

export const RESET = "\x1b[0m";

// ── Editor chrome ────────────────────────────────────────────────────────────

export const PI_STR = "> ";
export const PI_WIDTH = PI_STR.length;
export const PI_SYMBOL_COL = 2;

export const AUTOCOMPLETE_CURSOR = "›";
export const HINT_MARGIN_RIGHT = 3;
export const PAD_X = 1;

// ── Fallback ANSI codes (no-theme-object path only) ─────────────────────────

// A palette is only ever built without a theme in tests and headless runs, so
// these constants stay hardcoded — but they still respect a light appearance
// when one can be read, because a near-black slab on a light terminal is the
// bug this file used to ship.
const PANEL_FALLBACK: Readonly<Record<ThemeAppearance, PanelColor>> = {
  dark: { panelBg: "\x1b[48;2;16;16;16m", panelEdge: "\x1b[38;2;16;16;16m" },
  light: { panelBg: "\x1b[48;2;238;238;238m", panelEdge: "\x1b[38;2;238;238;238m" },
};

const FALLBACK_FG = "\x1b[38;2;74;74;74m"; // #4a4a4a structural gray

// ── Palette ──────────────────────────────────────────────────────────────────

export type ThemeBg = "selectedBg" | "userMessageBg" | "customMessageBg" | "toolPendingBg" | "toolSuccessBg" | "toolErrorBg";

export interface PanePalette {
  panelBg: string;
  panelEdge: string;
  frame(text: string): string;
  prefix(text: string): string;
  spin(text: string): string;
  time(text: string): string;
  hint(text: string): string;
}

function tryGetBgAnsi(theme: Theme, key: ThemeBg): string | undefined {
  try {
    return theme.getBgAnsi(key);
  } catch {
    // Unknown token (`tokenAnsi` throws in 1.x), or no theme object at all.
    return undefined;
  }
}

/** `Theme.appearance` exists from pi 0.99.0; older hosts report nothing. */
function themeAppearance(theme: Theme | undefined): ThemeAppearance | undefined {
  return (theme as { appearance?: ThemeAppearance } | undefined)?.appearance;
}

function tryFg(theme: Theme, key: ThemeColor, text: string): string | undefined {
  try {
    return theme.fg(key, text);
  } catch {
    return undefined;
  }
}

function safeThemeColor(theme: Theme, keys: ThemeColor[], text: string): string {
  for (const k of keys) {
    const res = tryFg(theme, k, text);
    if (res !== undefined) return res;
  }
  return fgWrap(FALLBACK_FG, text);
}

// ── Terminal-default tokens: "no color", not "some color" ──────────────────

/**
 * The escape sequences that mean *paint nothing, use the terminal's own
 * color*. Since pi 0.99.0 a theme token is allowed to be `""` (terminal
 * default), and `Theme.getBgAnsi()` / `getFgAnsi()` render that as `\x1b[49m` /
 * `\x1b[39m` — **truthy** strings, so a `getBgAnsi(…) ?? FALLBACK` chain never
 * reaches the fallback and a `… || HARD_COLOR` chain never fires. Measured on
 * pi 1.2.0: a theme with `userMessageBg: ""` answers `"\x1b[49m"`, and one with
 * `borderMuted: ""` answers `"\x1b[39m"`.
 *
 * Membership here is a *comparison*, never a decode: nothing in this file reads
 * the color an escape happens to encode. Suite rule — decide color from the
 * theme, never by parsing an escape sequence.
 */
const TERMINAL_DEFAULT_SEQUENCES: ReadonlySet<string> = new Set([
  "", // the answer itself, pre-0.99.0
  RESET, // "\x1b[0m": a full reset leaves no colour set
  "\x1b[m", // …and its parameter-less form
  "\x1b[39m", // a foreground token set to ""
  "\x1b[49m", // a background token set to ""
]);

/** Does this theme answer mean "the terminal's own color", i.e. no color? */
export function isTerminalDefault(ansi: string | undefined): boolean {
  return ansi === undefined || TERMINAL_DEFAULT_SEQUENCES.has(ansi);
}

// ── Panel tint and edge ─────────────────────────────────────────────────────

interface PanelColor {
  /** Opening background escape for the panel body, or "" for no tint. */
  panelBg: string;
  /** Opening foreground escape for the edge slabs, or "" for no edge. */
  panelEdge: string;
}

/** No color at all: panel and edges render in the terminal's own. */
const NO_PANEL_COLOR: PanelColor = { panelBg: "", panelEdge: "" };

/** Queried in order; the first answer wins — a terminal default included. */
const PANEL_BG_TOKENS: readonly ThemeBg[] = ["userMessageBg", "customMessageBg"];

/** The token the panel is tinted with, and the escape it answers with. */
interface PanelTint {
  token: ThemeBg;
  ansi: string;
}

function panelTint(theme: Theme): PanelTint | undefined {
  for (const token of PANEL_BG_TOKENS) {
    const ansi = tryGetBgAnsi(theme, token);
    if (ansi !== undefined) return { token, ansi };
  }
  return undefined;
}

/** pi-tui's own "colour → foreground escape" emitter, if this host has one. */
type ForegroundAnsi = (color: Color, mode: TerminalColorMode) => string;
const emitForeground = (
  piTui as Partial<Record<string, unknown>>
).foregroundAnsi as ForegroundAnsi | undefined;

/**
 * The edge slabs are the **panel's own colour, asked for as a foreground**.
 *
 * A slab sits hard against the panel body, so it is a cushion rather than a
 * border: in the panel's own tint it is invisible by construction, and in any
 * other token — a border, for instance — it is a visible rule hugging the text
 * area. pi accepts a token only in its own slot (asking the foreground for
 * `userMessageBg` throws; measured on 1.2.0) and documents `theme.colors[token]`
 * as the way to use a token's color in the other slot, so that is what we ask:
 * the theme hands back its own `Color`, and the host's own emitter renders it as
 * a foreground escape. The value is still *asked for*, never read out of a
 * string, so the suite's colour rule stands — and reaching for a different
 * token because it looks similar is the same mistake in a different costume.
 *
 * A theme that cannot answer — no `colors`, nothing for the winning token, an
 * old host without the emitter — means **no colour**, and the editor blanks the
 * rows. Never a substitute token.
 */
function panelEdgeAnsi(theme: Theme, token: ThemeBg): string {
  try {
    const colors = (theme as { colors?: Partial<Record<ThemeBg, Color | undefined>> })
      .colors;
    const color = colors?.[token];
    if (!color || !emitForeground) return "";
    return emitForeground(color, theme.getColorMode());
  } catch {
    return "";
  }
}

/**
 * Panel tint and edge, decided by theme tokens alone: the panel is painted with
 * whatever the theme's own panel background token says (passed through, not
 * re-emitted), and the edge slabs with that *same* token asked for as a
 * foreground, so the cushion matches the surface it extends.
 *
 * Nothing is derived *from* an escape sequence. The old
 * background-to-foreground helper matched `48;2;`/`48;5;` inside the background
 * string and answered everything else — notably the `\x1b[49m` a
 * terminal-default token produces — with near-black `#101010`, which is how an
 * untinted panel ended up with black borders on a light terminal.
 */
function resolvePanelColor(theme: Theme): PanelColor {
  const tint = panelTint(theme);
  if (tint === undefined) {
    // Nothing to ask: no theme object, or one with no panel token at all.
    return PANEL_FALLBACK[themeAppearance(theme) ?? "dark"];
  }
  if (isTerminalDefault(tint.ansi)) return NO_PANEL_COLOR;
  return { panelBg: tint.ansi, panelEdge: panelEdgeAnsi(theme, tint.token) };
}

function fgWrap(ansi: string, text: string): string {
  return `${ansi}${text}${RESET}`;
}

export function resolvePalette(theme: Theme): PanePalette {
  const { panelBg, panelEdge } = resolvePanelColor(theme);

  return {
    panelBg,
    panelEdge,
    frame: (t) => safeThemeColor(theme, ["borderMuted", "border"], t),
    prefix: (t) => safeThemeColor(theme, ["borderMuted", "border"], t),
    spin: (t) => safeThemeColor(theme, ["accent", "borderMuted"], t),
    time: (t) => safeThemeColor(theme, ["muted", "accent"], t),
    hint: (t) => safeThemeColor(theme, ["dim", "muted"], t),
  };
}
