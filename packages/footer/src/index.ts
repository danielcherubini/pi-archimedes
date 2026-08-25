/**
 * dir | branch [+status] | worktree | model | ◐thinking | ↑↓R W $cost ━ context%
 *
 * Adaptive layout — wraps to additional lines instead of truncating:
 * - fits width → single line (system info · stats · context bar)
 * - doesn't fit → two lines (system info above, stats + bar below)
 * - left sections alone overflow → three or more lines
 * - below splitThreshold (default 150) → at least two lines, as configured
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { clampLine } from "@pi-archimedes/core/text";
import { loadFooterConfig } from "./config.js";
import { CostAccumulator } from "./cost-accumulator.js";
import { getGitStatus, isInsideLinkedWorktree } from "./utils/git.js";
import { getContextWindowInfo, getTokenUsageStats, type TokenUsageStats } from "./utils/stats.js";
import { formatContextBar, formatGitStatusIndicators, formatThinkingIndicator, formatTokenCount } from "./utils/format.js";
import { footerIcons } from "./utils/icons.js";
import { packFooterLines, SEP_W, SEPARATOR } from "./utils/layout.js";

export function registerFooter(pi: ExtensionAPI): void {
  // Module-level state for session lifecycle (shared between session_start and session_shutdown)
  let footerAccumulator: CostAccumulator | undefined;

  // session_shutdown handler (top-level to prevent accumulation on /reload)
  pi.on("session_shutdown", (_event, _ctx) => {
    if (footerAccumulator) {
      footerAccumulator.dispose();
      footerAccumulator.reset();
      footerAccumulator = undefined;
    }
  });

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    const splitThreshold = loadFooterConfig().splitThreshold;

    // Create cost accumulator for subagent costs
    footerAccumulator = new CostAccumulator();
    footerAccumulator.subscribe();

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
            const inWorktree = isInsideLinkedWorktree();
            const thinkingLevel = pi.getThinkingLevel();

            // Merge main agent stats with subagent stats from accumulator
            const mainStats = getTokenUsageStats(ctx);
            const acc = footerAccumulator;
            const mergedStats: TokenUsageStats = {
              totalInput: mainStats.totalInput + (acc?.inputTokens ?? 0),
              totalOutput: mainStats.totalOutput + (acc?.outputTokens ?? 0),
              totalCacheRead: mainStats.totalCacheRead + (acc?.cacheReadTokens ?? 0),
              totalCacheWrite: mainStats.totalCacheWrite + (acc?.cacheWriteTokens ?? 0),
              totalCost: mainStats.totalCost + (acc?.cost ?? 0),
            };

            const { totalInput, totalOutput, totalCacheRead, totalCacheWrite, totalCost } = mergedStats;
            const { percent: contextPercent, percentValue: contextPercentValue, windowSize: contextWindowSize } = getContextWindowInfo(ctx);

            // ── Sections ──────────────────────────────────────────────────

            const thinkingIndicatorStr = formatThinkingIndicator(thinkingLevel, colorize);
            const gitStatusStr = formatGitStatusIndicators(gitStatus, colorize);

            const branchIcon = inWorktree ? footerIcons.worktree : footerIcons.branch;

            // System info sections: dir | branch [+status] | model | thinking
            const leftSections = [
              colorize("syntaxFunction", " " + footerIcons.directory + currentDirectory),
              currentBranch ? colorize("success", branchIcon + " " + currentBranch + (gitStatusStr ? " " + gitStatusStr : "")) : "",
              colorize("syntaxType", footerIcons.model + " " + activeModel),
              thinkingIndicatorStr,
            ].filter(Boolean);

            // Usage stats: ↑in ↓out RcacheRead WcacheWrite $cost contextWindow
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

            const statsSectionStr = theme.fg("dim", statsParts.join(" "));

            // ── Adaptive multi-line layout ──────────────────────────────
            // Pack sections left-to-right; whatever doesn't fit wraps to the
            // next line. Below the splitThreshold setting, force at least the
            // two-line split (system info above, stats below) even when one
            // line would fit. The context bar expands into the remainder of
            // the last line and is dropped only if no reasonable space is left.
            const separator = theme.fg("dim", SEPARATOR);
            let groups = packFooterLines([...leftSections, statsSectionStr], width, SEP_W);
            if (groups.length < 2 && width < splitThreshold && leftSections.length > 0) {
              groups = [leftSections, [statsSectionStr]];
            }

            return groups
              .map((group, idx) => {
                let line = group.join(separator);
                if (idx === groups.length - 1) {
                  const remaining = width - visibleWidth(line) - (line ? SEP_W : 0);
                  const contextBarStr = formatContextBar(colorize, contextPercentValue, remaining);
                  if (contextBarStr) {
                    line = line ? line + separator + contextBarStr : contextBarStr;
                  }
                }
                return clampLine(line, width);
              })
              .filter((line) => line.length > 0);
          } catch (e) {
            console.error("[archimedes:footer] Render error:", e);
            return [];
          }
        },
      };
    });
  });
}

export default registerFooter;
