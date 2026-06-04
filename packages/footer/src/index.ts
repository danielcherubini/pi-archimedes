/**
 * dir | model | ◐thinking | branch [+status] | worktree | ↑↓R W $cost | ━━━━━ context%
 * Splits into two lines when terminal width < splitThreshold (default 150):
 *   Line 1: system info (dir, branch, model, thinking, worktree)
 *   Line 2: usage stats (↑↓R W $cost + context progress bar)
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { clampLine } from "@pi-archimedes/core/text";
import { loadFooterConfig } from "./config.js";
import { CostAccumulator } from "./cost-accumulator.js";
import { getGitStatus, getWorktreeBranch } from "./utils/git.js";
import { getContextWindowInfo, getTokenUsageStats, type TokenUsageStats } from "./utils/stats.js";
import { formatContextBar, formatGitStatusIndicators, formatThinkingIndicator, formatTokenCount } from "./utils/format.js";
import { footerIcons } from "./utils/icons.js";

export default function registerFooter(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    const splitThreshold = loadFooterConfig().splitThreshold;

    // Create cost accumulator for subagent costs
    const accumulator = new CostAccumulator();
    accumulator.subscribe();

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsubscribe,
        invalidate() { },
        render(width: number): string[] {
          try {
            const colorize = (token: string, s: string) => theme.fg(token as any, s);
            const activeModel = ctx.model?.id || "no-model";
            const currentBranch = footerData.getGitBranch();
            const currentDirectory = process.cwd().split("/").pop() || process.cwd();
            const gitStatus = getGitStatus();
            const worktreeBranch = getWorktreeBranch();
            const thinkingLevel = pi.getThinkingLevel();

            // Merge main agent stats with subagent stats from accumulator
            const mainStats = getTokenUsageStats(ctx);
            const mergedStats: TokenUsageStats = {
              totalInput: mainStats.totalInput + accumulator.inputTokens,
              totalOutput: mainStats.totalOutput + accumulator.outputTokens,
              totalCacheRead: mainStats.totalCacheRead + accumulator.cacheReadTokens,
              totalCacheWrite: mainStats.totalCacheWrite + accumulator.cacheWriteTokens,
              totalCost: mainStats.totalCost + accumulator.cost,
            };

            const { totalInput, totalOutput, totalCacheRead, totalCacheWrite, totalCost } = mergedStats;
            const { percent: contextPercent, percentValue: contextPercentValue, windowSize: contextWindowSize } = getContextWindowInfo(ctx);

            // ── Two-line split for narrow terminals ────────────────────────────

            const shouldSplit = width < splitThreshold;

            // Thinking display
            const thinkingIndicatorStr = formatThinkingIndicator(thinkingLevel, colorize);

            // Git status indicators
            const gitStatusStr = formatGitStatusIndicators(gitStatus, colorize);

            // Left section: dir | branch [+status] | model | thinking | worktree
            const leftSections = [
              colorize("syntaxFunction", " " + footerIcons.directory + currentDirectory),
              currentBranch ? colorize("success", footerIcons.branch + " " + currentBranch + (gitStatusStr ? " " + gitStatusStr : "")) : "",
              colorize("syntaxType", footerIcons.model + " " + activeModel),
              thinkingIndicatorStr,
              worktreeBranch ? colorize("syntaxNumber", footerIcons.worktree + " " + worktreeBranch) : "",
            ].filter(Boolean);

            const separator = theme.fg("dim", " | ");
            const leftSectionStr = leftSections.join(separator);

            // Token stats with context percentage
            const statsParts: string[] = [];
            if (totalInput) statsParts.push("↑" + formatTokenCount(totalInput));
            if (totalOutput) statsParts.push("↓" + formatTokenCount(totalOutput));
            if (totalCacheRead) statsParts.push("R" + formatTokenCount(totalCacheRead));
            if (totalCacheWrite) statsParts.push("W" + formatTokenCount(totalCacheWrite));
            if (totalCost) statsParts.push("$" + totalCost.toFixed(2));

            const contextUsed = contextWindowSize * (contextPercentValue / 100);
            const contextDisplay =
              contextPercent === "?"
                ? "?"
                : formatTokenCount(contextUsed) + "/" + formatTokenCount(contextWindowSize);
            const contextColored =
              contextPercentValue > 95
                ? theme.fg("error", contextDisplay)
                : contextPercentValue > 80
                  ? theme.fg("warning", contextDisplay)
                  : contextDisplay;
            statsParts.push(contextColored);

            const rawStatsSectionStr = statsParts.join(" ");
            const statsSectionStr = theme.fg("dim", rawStatsSectionStr);

            if (shouldSplit) {
              // ── Two-line mode ──────────────────────────────────────────────

              // Calculate available space for the context progress bar on line 2
              const availableBarSpace = Math.max(2, width - visibleWidth(statsSectionStr) - 13);

              // Context progress bar (expands to fill remaining space)
              const contextBarStr = formatContextBar(colorize as (token: string, s: string) => string, contextPercentValue, availableBarSpace);

              // Assemble line 2: stats | bar
              const rightSections: string[] = [];
              if (statsSectionStr) rightSections.push(statsSectionStr);
              if (contextBarStr) rightSections.push(contextBarStr);
              const rightSectionStr = rightSections.join(theme.fg("dim", " | "));

              // Edge case: if both stats and bar are empty, return only line 1
              if (!rightSectionStr) {
                return [clampLine(leftSectionStr, width)];
              }

              return [
                clampLine(leftSectionStr, width),
                clampLine(rightSectionStr, width),
              ];
            }

            // ── Single-line mode ───────────────────────────────────────────────

            // Separator between left and right sections
            const sectionSeparator = theme.fg("dim", " | ");

            // Calculate available space for the context progress bar (after stats)
            const availableBarSpace = Math.max(
              2,
              width - visibleWidth(leftSectionStr) - 1 - visibleWidth(sectionSeparator) - visibleWidth(statsSectionStr) - 10,
            );

            // Context progress bar (expands to fill remaining space)
            const contextBarStr = formatContextBar(colorize as (token: string, s: string) => string, contextPercentValue, availableBarSpace);

            // Assemble: left | stats | bar
            const rightSections: string[] = [];
            if (statsSectionStr) rightSections.push(statsSectionStr);
            if (contextBarStr) rightSections.push(contextBarStr);
            const rightSectionStr = rightSections.join(theme.fg("dim", " | "));

            return [clampLine(leftSectionStr + sectionSeparator + rightSectionStr, width)];
          } catch (e) {
            return [];
          }
        },
      };
    });

    pi.on("session_shutdown", (_event, _ctx) => {
      accumulator.dispose();
      accumulator.reset();
    });
  });
}
