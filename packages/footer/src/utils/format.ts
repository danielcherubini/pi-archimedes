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
