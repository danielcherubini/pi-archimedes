/**
 * Shared overlay chrome — border wrapping, text width math, header/footer
 * rendering. Used by the /agents manager (subagent) and the /archimedes
 * settings overlay (meta) so both screens look identical.
 */

/** Minimal structural theme — anything with `fg` satisfies it (the real pi-coding-agent Theme, agent-manager's local interface, or a test mock). */
export interface OverlayTheme {
  fg(token: string, text: string): string;
}

export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [];
  const lines: string[] = [];
  const paragraphs = text.split("\n");
  for (const para of paragraphs) {
    if (para.length === 0) {
      lines.push("");
      continue;
    }
    const words = para.split(/(\s+)/).filter(Boolean);
    let current = "";
    for (const word of words) {
      const test = current === "" ? word : current + word;
      if (test.length > width && current.length > 0) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

export function padEnd(text: string, width: number): string {
  if (width <= 0) return "";
  const vw = visibleWidth(text);
  if (vw >= width) return text;
  return text + " ".repeat(width - vw);
}

export function visibleWidth(text: string): number {
  // Strip ANSI escape sequences for width calculation
  return text.replace(/\x1b\[[0-9;]*m/g, "").length;
}

export function renderHeader(text: string, width: number, theme: OverlayTheme): string {
  return theme.fg("accent", padEnd(text, width));
}

export function renderFooter(text: string, width: number, theme: OverlayTheme): string {
  return theme.fg("dim", padEnd(text, width));
}

/** Content width available inside wrapWithBorder at a given outer width.
 *  inner = max(1, width - 2); content = max(1, inner - 2). */
export function borderContentWidth(width: number): number {
  const innerWidth = Math.max(1, width - 2);
  return Math.max(1, innerWidth - 2);
}

/** Shared overlay options so /agents and /archimedes never drift. */
export const OVERLAY_CHROME = { anchor: "center", width: 84, maxHeight: "80%" } as const;

// ── Border wrapper ────────────────────────────────────────────────────────────

/** Hard-truncate by visible width — no "..." suffix. Strips ANSI, truncates, rebuilds. */
export function hardTruncate(text: string, maxVisible: number): string {
  if (visibleWidth(text) <= maxVisible) return text;
  // Walk the string, skipping ANSI escape sequences, and stop after
  // maxVisible visible characters; copy SGR codes through so styling survives,
  // and append a reset at the end so styling doesn't bleed.
  let result = "";
  let plainPos = 0;
  let i = 0;
  let copiedSgr = false;
  while (i < text.length && plainPos < maxVisible) {
    if (text[i] === "\x1b" && text[i + 1] === "[") {
      // Copy the escape sequence
      let j = i;
      while (j < text.length && text[j] !== "m") j++;
      result += text.slice(i, j + 1);
      copiedSgr = true;
      i = j + 1;
    } else {
      result += text[i];
      plainPos++;
      i++;
    }
  }
  // Ensure styling doesn't bleed: append reset if we copied SGR and result doesn't end with one
  if (copiedSgr && !/\x1b\[0?m$/.test(result)) {
    result += "\x1b[0m";
  }
  return result;
}

export function wrapWithBorder(lines: string[], width: number, theme: OverlayTheme): string[] {
  const innerWidth = Math.max(1, width - 2);
  const contentWidth = Math.max(1, innerWidth - 2); // minus 1 space padding each side
  const left = theme.fg("dim", "│");
  const right = theme.fg("dim", "│");
  const top = theme.fg("dim", `┌${"─".repeat(innerWidth)}┐`);
  const bottom = theme.fg("dim", `└${"─".repeat(innerWidth)}┘`);
  const result: string[] = [top];
  for (const line of lines) {
    const clamped = hardTruncate(line, contentWidth);
    const padded = " " + padEnd(clamped, contentWidth) + " ";
    result.push(left + padded + right);
  }
  result.push(bottom);
  return result;
}
