/**
 * ANSI + grapheme-aware width utilities.
 *
 * Mirrors pi-tui's own `visibleWidth()` semantics (east-asian-width + emoji
 * heuristics) so diff rendering never emits rows that violate the TUI's
 * "line must not exceed terminal width" invariant. Plain `.length` on a JS
 * string undercounts wide/emoji graphemes (e.g. "✅" is 1 UTF-16 code unit
 * but occupies 2 terminal columns), which silently produces over-wide lines.
 */

import { eastAsianWidth } from "get-east-asian-width";

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const zeroWidthRegex = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark}|\p{Surrogate})+$/u;
const leadingNonPrintingRegex = /^[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Mark}\p{Surrogate}]+/u;
// RGI_Emoji requires the `v` flag (set notation); fall back to a broad
// Extended_Pictographic + presentation-selector heuristic under `u`, which
// is good enough here since couldBeEmoji() already pre-filters candidates.
const rgiEmojiRegex = /^[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/u;

function couldBeEmoji(segment: string): boolean {
  const cp = segment.codePointAt(0);
  if (cp === undefined) return false;
  return (
    (cp >= 0x1f000 && cp <= 0x1fbff) ||
    (cp >= 0x2300 && cp <= 0x23ff) ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x2b50 && cp <= 0x2b55) ||
    segment.includes("\uFE0F") ||
    segment.length > 2
  );
}

/** Terminal column width of a single grapheme cluster. */
export function graphemeWidth(segment: string): number {
  // Tabs are normally expanded to 2 spaces upstream via Ansi.tabs(), but
  // guard here too so these utilities are robust to raw tab input.
  if (segment === "\t") return 2;
  if (zeroWidthRegex.test(segment)) return 0;
  if (couldBeEmoji(segment) && rgiEmojiRegex.test(segment)) return 2;
  const base = segment.replace(leadingNonPrintingRegex, "");
  const cp = base.codePointAt(0);
  if (cp === undefined) return 0;
  if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return 2;
  let width = eastAsianWidth(cp);
  if (segment.length > 1) {
    for (const char of segment.slice(1)) {
      const c = char.codePointAt(0);
      if (c === undefined) continue;
      if (c >= 0xff00 && c <= 0xffef) width += eastAsianWidth(c);
      else if (c === 0x0e33 || c === 0x0eb3) width += 1;
    }
  }
  return width;
}

/** One grapheme cluster, plus any ANSI SGR codes immediately preceding it. */
export interface WidthToken {
  ansi: string;
  text: string;
  width: number;
}

/**
 * Tokenize an ANSI-encoded string into (ansi-prefix, grapheme, width) triples.
 * Only SGR (`ESC[...m`) sequences are recognized as ANSI — matches the rest
 * of this package's ANSI handling, which never emits other CSI/OSC codes.
 */
export function tokenize(s: string): WidthToken[] {
  const tokens: WidthToken[] = [];
  let pendingAnsi = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\x1b") {
      const end = s.indexOf("m", i);
      if (end !== -1) {
        pendingAnsi += s.slice(i, end + 1);
        i = end + 1;
        continue;
      }
      // Bare ESC with no "m" terminator anywhere after it — not a valid
      // SGR sequence. Treat it as a zero-width literal char so `i` always
      // advances (otherwise this would loop forever).
      tokens.push({ ansi: pendingAnsi, text: "", width: 0 });
      pendingAnsi = "";
      i++;
      continue;
    }
    let end = i;
    while (end < s.length && s[end] !== "\x1b") end++;
    for (const { segment } of graphemeSegmenter.segment(s.slice(i, end))) {
      tokens.push({ ansi: pendingAnsi, text: segment, width: graphemeWidth(segment) });
      pendingAnsi = "";
    }
    i = end;
  }
  if (pendingAnsi) tokens.push({ ansi: pendingAnsi, text: "", width: 0 });
  return tokens;
}

/** Visible terminal-column width of an ANSI-encoded string. */
export function visibleWidth(s: string): number {
  let total = 0;
  for (const tok of tokenize(s)) total += tok.width;
  return total;
}
