import { footerIcons, gitDisplayIcons, gitStatusColors, thinkingLevelColors, type ColorFn } from "./icons.js";

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

export function formatContextBar(colorize: ColorFn, percentValue: number, availableSpace: number): string {
  if (availableSpace <= 2) return "";

  const pct = Math.min(1, percentValue / 100);
  const filledLength = percentValue > 0 ? Math.max(1, Math.round(pct * availableSpace)) : 0;
  const emptyLength = availableSpace - filledLength;

  const barToken = pct >= 0.9 ? "error" : pct >= 0.7 ? "warning" : "syntaxString";

  const filledBar = filledLength > 0 ? colorize(barToken, "━".repeat(filledLength)) : "";
  const emptyBar = emptyLength > 0 ? colorize("dim", "━".repeat(emptyLength)) : "";
  const bar = filledBar + emptyBar;

  return colorize(barToken, footerIcons.contextWindow) + "  " + bar + " " + colorize(barToken, Math.round(percentValue) + "%");
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
  return thinkingLevel !== "off" ? colorize(thinkingLevelColors[thinkingLevel] || "dim", "◐ " + thinkingLevel) : "";
}
