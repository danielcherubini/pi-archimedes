import { truncateToWidth } from "@earendil-works/pi-tui";

// Inline stripSgr — narrow SGR-only strip (no trim) for char-level checks
const stripSgr = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

/**
 * Strip ALL ANSI escape sequences. Covers:
 * - CSI: ESC [ ... letter (SGR, cursor movement, etc.)
 * - OSC: ESC ] ... ST (operating system commands)
 * - DCS: ESC P ... ST (device control strings)
 * - APC: ESC _ ... ST (application program commands)
 * - SOS: ESC ^ ... ST (start of string)
 * - PM:  ESC \x5c ... ST (privacy message)
 * - Character set: ESC ( or ESC ) (DECSET/DECRST)
 * Trims whitespace. Use for text extraction.
 */
export function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")   // CSI
    .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, "")  // OSC
    .replace(/\x1b[P^_\x5c].*?(?:\x07|\x1b\\)/g, "") // DCS, SOS, APC, PM
    .replace(/\x1b[()]/g, "")                   // character set
    .trim();
}

/** Clamp a line to maxW visible characters, preserving ANSI escapes. */
export function clampLine(line: string, maxW: number): string {
  return truncateToWidth(line, maxW);
}

/** Clamp an array of lines to maxW visible characters each. */
function clampLines(lines: string[], maxW: number): string[] {
  return lines.map((l) => clampLine(l, maxW));
}

// isParentBorder uses the narrow SGR-only strip (no trim) for char-level checks
export const isParentBorder = (s: string) => {
  const clean = stripSgr(s);
  return clean.length > 0 && clean[0] === "─";
};

export function formatKey(key: string | undefined): string {
  if (!key) return "that key";
  return key
    .split("+")
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "ctrl") return "Ctrl";
      if (lower === "alt") return "Alt";
      if (lower === "shift") return "Shift";
      if (lower === "cmd" || lower === "meta") return "Cmd";
      return part.length === 1
        ? part.toUpperCase()
        : part[0]!.toUpperCase() + part.slice(1);
    })
    .join("+");
}
