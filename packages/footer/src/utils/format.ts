import { visibleWidth } from "@earendil-works/pi-tui";
import { footerIcons, gitDisplayIcons, gitStatusColors, thinkingLevelColors, thinkingLevelIcons, type ColorFn } from "./icons.js";

// Token counts use binary units (1K = 1024)
const TOKEN_K = 1_024;
const TOKEN_M = 1_048_576;

export function formatTokenCount(count: number): string {
  if (count < TOKEN_K) return count.toString();
  if (count < TOKEN_K * 10) return (count / TOKEN_K).toFixed(1) + "k";
  if (count < TOKEN_M) return Math.round(count / TOKEN_K) + "k";
  if (count < TOKEN_M * 10) return (count / TOKEN_M).toFixed(1) + "M";
  return Math.round(count / TOKEN_M) + "M";
}

/**
 * Context progress bar, sized to occupy EXACTLY `totalSpace` visible columns
 * (icon + gaps + bar + percentage label). Returns "" when there isn't room
 * for the icon, label and at least one bar segment.
 */
export function formatContextBar(colorize: ColorFn, percentValue: number, totalSpace: number): string {
  const pct = Math.min(1, Math.max(0, percentValue / 100));
  const pctLabel = Math.round(Math.max(0, percentValue)) + "%";
  // Fixed overhead: icon (1) + "  " (2) + " " (1) + percentage label
  const barLength = totalSpace - 4 - pctLabel.length;
  if (barLength < 1) return "";

  const filledLength = percentValue > 0 ? Math.max(1, Math.round(pct * barLength)) : 0;
  const emptyLength = barLength - filledLength;

  const barToken = pct >= 0.9 ? "error" : pct >= 0.7 ? "warning" : "syntaxString";

  const filledBar = filledLength > 0 ? colorize(barToken, "━".repeat(filledLength)) : "";
  const emptyBar = emptyLength > 0 ? colorize("dim", "━".repeat(emptyLength)) : "";
  const bar = filledBar + emptyBar;

  return colorize(barToken, footerIcons.contextWindow) + "  " + bar + " " + colorize(barToken, pctLabel);
}

export function formatGitStatusIndicators(
  gitStatus: { staged: number; unstaged: number; untracked: number; ahead: number; behind: number },
  colorize: ColorFn,
): string {
  const statusParts: string[] = [];
  if (gitStatus.staged > 0) statusParts.push(colorize(gitStatusColors.staged, gitDisplayIcons.staged + gitStatus.staged));
  if (gitStatus.unstaged > 0) statusParts.push(colorize(gitStatusColors.unstaged, gitDisplayIcons.unstaged + gitStatus.unstaged));
  if (gitStatus.untracked > 0) statusParts.push(colorize(gitStatusColors.untracked, gitDisplayIcons.untracked + gitStatus.untracked));
  if (gitStatus.ahead > 0) statusParts.push(colorize(gitStatusColors.ahead, gitDisplayIcons.ahead + gitStatus.ahead));
  if (gitStatus.behind > 0) statusParts.push(colorize(gitStatusColors.behind, gitDisplayIcons.behind + gitStatus.behind));
  return statusParts.join("");
}

export function formatThinkingIndicator(thinkingLevel: string, colorize: ColorFn): string {
  return colorize(thinkingLevelColors[thinkingLevel] || "dim", `${thinkingLevelIcons[thinkingLevel] || "◑"} ${thinkingLevel}`);
}

/**
 * Wrap an extension status into chunks that fit the terminal.
 * - fits (visibleWidth ≤ width) → [status] (unchanged, including ANSI)
 * - oversized → greedy word-wrap: whole words packed per chunk; a single word
 *   wider than `width` is split at character level on the raw string (ANSI
 *   sequences stay attached to the chars they prefix because we split on plain
 *   whitespace only — never mid-escape).
 * No content is ever dropped; every returned chunk has visibleWidth ≤ width.
 */
export function wrapStatusToChunks(status: string, width: number): string[] {
  // Edge cases: empty/whitespace or non-positive width → return as-is
  if (width <= 0 || !status.trim()) return [status];
  // Already fits → return unchanged (preserves ANSI)
  if (visibleWidth(status) <= width) return [status];

  // Split on whitespace boundaries only — never inside ANSI escapes
  // (ANSI escapes contain no plain whitespace, so splitting on /\s+/ is safe)
  const words = status.split(/(\s+)/);
  // words alternates: [word, sep, word, sep, ...]
  // We reassemble non-sep tokens and carry sep tokens to preserve spacing context
  // Simpler: collect [token, isSep] pairs
  const tokens: Array<{ text: string; isSep: boolean }> = [];
  for (const w of words) {
    if (w === "") continue;
    tokens.push({ text: w, isSep: /^\s+$/.test(w) });
  }

  const chunks: string[] = [];
  let current = "";
  let currentW = 0;

  /**
   * Split a single word (no whitespace) that is wider than `width` into
   * sub-chunks of at most `width` visible columns, character by character.
   * ANSI escapes are kept intact (we only split printable characters;
   * the regex /\x1b\[[^m]*m/ never contains whitespace, so they were
   * never split by the outer word-split, and here we advance char by char
   * through the raw string, which keeps escape bytes together with their
   * surrounding characters as long as we don't split inside an escape).
   *
   * Implementation: iterate character-by-character through the raw string,
   * accumulating into a sub-chunk until adding the next char would exceed width.
   */
  function splitWideWord(word: string): string[] {
    const result: string[] = [];
    let sub = "";
    let subW = 0;
    let i = 0;
    while (i < word.length) {
      // Detect ANSI escape sequence starting at i (\x1b[...m)
      // An escape contributes 0 visible width, so we append it whole.
      if (word[i] === "\x1b") {
        const end = word.indexOf("m", i + 1);
        if (end !== -1) {
          sub += word.slice(i, end + 1);
          i = end + 1;
          continue;
        }
      }
      // Regular character (may be multi-byte Unicode)
      const char = word[i]!;
      const charW = visibleWidth(char);
      if (subW + charW > width && sub !== "") {
        result.push(sub);
        sub = char;
        subW = charW;
      } else {
        sub += char;
        subW += charW;
      }
      i++;
    }
    if (sub !== "") result.push(sub);
    return result.length > 0 ? result : [word];
  }

  function flushCurrent() {
    if (current !== "") {
      chunks.push(current);
      current = "";
      currentW = 0;
    }
  }

  for (const token of tokens) {
    if (token.isSep) {
      // Separator — skip (we rebuild spacing implicitly via chunks)
      continue;
    }
    const word = token.text;
    const wordW = visibleWidth(word);

    if (wordW > width) {
      // Word is wider than the entire terminal — flush then char-split it
      flushCurrent();
      const subChunks = splitWideWord(word);
      for (let j = 0; j < subChunks.length - 1; j++) {
        chunks.push(subChunks[j]!);
      }
      // Last sub-chunk becomes the start of the next current
      const last = subChunks[subChunks.length - 1]!;
      current = last;
      currentW = visibleWidth(last);
    } else if (currentW === 0) {
      // Starting a new chunk
      current = word;
      currentW = wordW;
    } else if (currentW + 1 + wordW <= width) {
      // Append with a single space
      current += " " + word;
      currentW += 1 + wordW;
    } else {
      // Doesn't fit — flush and start new chunk
      flushCurrent();
      current = word;
      currentW = wordW;
    }
  }
  flushCurrent();

  return chunks.length > 0 ? chunks : [status];
}
