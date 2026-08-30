import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  highlightCode as piHighlightCode,
  initTheme as piInitTheme,
} from "@earendil-works/pi-coding-agent";
import type { MarkdownTheme } from "@earendil-works/pi-tui";
import {
  deriveDimColor,
  hslToRgb,
  parseAnsiFgToRgb,
  rgbToHsl,
  rgbToTruecolorFg,
  hexToRgb,
} from "../color.js";

export interface MutedThemeOptions {
  saturationFactor?: number; // default 0.5
  codeDefaultLightness?: number; // default 0.85 — lighter than the token dim floor
}

const DEFAULT_ANCHOR_L = 0.4;
const DEFAULT_CODE_DEFAULT_L = 0.85;

// Matches any foreground-color SGR escape: truecolor (38;2;r;g;b) or 256-palette (38;5;n).
// We intentionally only target fg color escapes; bg (48;...) and style escapes
// (bold/italic/reset/etc.) are left untouched.
const FG_COLOR_ESCAPE_RE = /\x1b\[38;(?:2;\d{1,3};\d{1,3};\d{1,3}|5;\d{1,3})m/g;

// pi 0.84.4's module-level `highlightCode` reads a *global* Theme
// singleton that throws until `initTheme()` runs. pi's interactive
// mode initializes it at startup, but contexts that build the muted
// theme without going through that initialization (e.g. unit tests)
// would otherwise get "Theme not initialized. Call initTheme() first."
// We probe on first use and, only when the global is not set, call
// `initTheme("dark")` — built-in theme, no file watcher attached.
let piThemeReady = false;
function ensurePiHighlightable(): void {
  if (piThemeReady) return;
  piThemeReady = true;
  try {
    piHighlightCode(""); // probe: throws when the global is unset
  } catch (err) {
    // Only fall back when the probe failed for the known reason, so an
    // already-established pi theme is never clobbered by a surprise. 
    if (String(err).includes("Theme not initialized")) piInitTheme("dark");
  }
}

/**
 * Rewrite every foreground-color SGR escape in `line` to its dimmed truecolor
 * variant, preserving all other content (text, non-color escapes, resets).
 *
 * The cache memoizes raw→dim escape strings; callers should share a single
 * cache across all lines in one theme-build invocation — highlightCode runs
 * on every streaming chunk so the rewrite must be cheap.
 */
export function dimAnsiLine(
  line: string,
  anchorL: number,
  saturationFactor: number,
  cache: Map<string, string>,
): string {
  return line.replace(FG_COLOR_ESCAPE_RE, (match) => {
    const cached = cache.get(match);
    if (cached !== undefined) return cached;
    const rgb = parseAnsiFgToRgb(match);
    if (!rgb) {
      cache.set(match, match);
      return match;
    }
    // deriveDimColor takes hex; we already have rgb, so build a hex string.
    const hex =
      "#" +
      [rgb.r, rgb.g, rgb.b]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
    const dimHex = deriveDimColor(hex, anchorL, saturationFactor);
    const dimmed = rgbToTruecolorFg(hexToRgb(dimHex));
    cache.set(match, dimmed);
    return dimmed;
  });
}

export function buildMutedMarkdownTheme(
  piTheme: Theme,
  opts: MutedThemeOptions = {},
): MarkdownTheme {
  const saturationFactor = opts.saturationFactor ?? 0.5;
  const codeDefaultL = opts.codeDefaultLightness ?? DEFAULT_CODE_DEFAULT_L;

  // Anchor lightness: derived from the theme's thinkingText foreground color.
  const thinkingAnsi = piTheme.getFgAnsi("thinkingText");
  const anchorRgb = parseAnsiFgToRgb(thinkingAnsi);
  const anchorHsl = anchorRgb ? rgbToHsl(anchorRgb) : null;
  const anchorL = anchorHsl ? anchorHsl.l : DEFAULT_ANCHOR_L;

  // Default fg color used for UN-highlighted chars inside code blocks.
  // cli-highlight only emits color escapes for recognized tokens — the gaps
  // between them (operators, whitespace, unrecognized identifiers) render in
  // the terminal's default color (often bright white on dark themes).
  //
  // We build a color that harmonizes with thinkingText (same hue/saturation)
  // but sits at a BRIGHTER lightness than the token dim floor (anchorL),
  // so white text is dimmed noticeably less than the colored tokens. Prepend
  // this escape per line and re-emit it after every `\x1b[39m` fg reset so
  // the gaps inherit this color instead of the terminal default.
  const codeDefaultFg = anchorHsl
    ? rgbToTruecolorFg(
      hslToRgb({
        h: anchorHsl.h,
        s: anchorHsl.s,
        l: codeDefaultL,
      }),
    )
    : "";

  // Shared memoization cache for the entire theme lifetime.
  const dimCache = new Map<string, string>();

  const fg = (token: string, text: string) =>
    piTheme.fg(token as Parameters<Theme["fg"]>[0], text);

  return {
    codeBlockIndent: "",
    heading: (text) => `\x1b[1m${rgbToTruecolorFg(hexToRgb("#FFD700"))}${text}\x1b[39m\x1b[22m`,
    link: (text) => `\x1b[4m${fg("thinkingText", text)}\x1b[24m`,
    linkUrl: (text) => fg("dim", text),
    code: (text) => fg("dim", text),
    codeBlock: (text) => fg("thinkingText", text),
    codeBlockBorder: (text) => fg("dim", text),
    quote: (text) => fg("thinkingText", text),
    quoteBorder: (text) => fg("dim", text),
    hr: (text) => fg("dim", text),
    listBullet: (text) => fg("dim", text),
    bold: (text) => `\x1b[1m${rgbToTruecolorFg(hexToRgb("#FFD700"))}${text}\x1b[39m\x1b[22m`,
    italic: (text) => `\x1b[3m${text}\x1b[23m`,
    strikethrough: (text) => `\x1b[9m${fg("dim", text)}\x1b[29m`,
    underline: (text) => `\x1b[4m${fg("thinkingText", text)}\x1b[24m`,
    highlightCode: (code, lang) => {
      ensurePiHighlightable();
      const lines = piHighlightCode(code, lang);
      return lines.map((l) => {
        const dimmed = dimAnsiLine(l, anchorL, saturationFactor, dimCache);
        if (!codeDefaultFg) return dimmed;
        // Blanket the line in the code-default color; after every fg reset
        // (emitted by cli-highlight between colored tokens) re-open the
        // default so un-tokenized chars inherit it.
        const withDefault = dimmed.replace(
          /\x1b\[39m/g,
          `\x1b[39m${codeDefaultFg}`,
        );
        return `${codeDefaultFg}${withDefault}\x1b[39m`;
      });
    },
  };
}
