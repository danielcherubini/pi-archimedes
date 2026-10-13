/**
 * dir | branch [+status] | worktree | model | ◕thinking · ⚠ext-status | ↑↓R W $cost ━ context%
 *
 * Adaptive layout — wraps to additional lines instead of truncating:
 * - fits width → single line (system info · stats · context bar)
 * - doesn't fit → two lines (system info above, stats + bar below)
 * - left sections alone overflow → three or more lines
 * - below splitThreshold (default 150) → at least two lines, as configured
 * - oversized extension statuses are word-wrapped into multiple chunks so no
 *   content is ever truncated by truncateToWidth
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { diag, describeError } from "@pi-archimedes/core/log";
import { loadFooterConfig } from "./config.js";
import { getGitStatus, isInsideLinkedWorktree } from "./utils/git.js";
import { getJjBookmark, getJjChangedFiles } from "./utils/jj.js";
import { onVcsChange } from "./utils/vcs-change-events.js";
import { getContextWindowInfo, getTokenUsageStats } from "./utils/stats.js";
import { formatContextBar, formatGitStatusIndicators, formatThinkingIndicator, formatTokenCount, truncateBranch, wrapStatusToChunks } from "./utils/format.js";
import { footerIcons } from "./utils/icons.js";
import { packFooterLines, SEP_W, SEPARATOR } from "./utils/layout.js";

export function registerFooter(pi: ExtensionAPI): void {
  // Subscription for the footer's lifetime; module-level so a footer rebuilt
  // without an explicit dispose cannot leave a second listener behind.
  let unsubscribeVcsChange: (() => void) | undefined;

  // session_shutdown handler (top-level to prevent accumulation on /reload)
  pi.on("session_shutdown", (_event, _ctx) => {
    unsubscribeVcsChange?.();
    unsubscribeVcsChange = undefined;
  });

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    const { splitThreshold, branchMaxLength } = loadFooterConfig();
    // A render failure is reported once per session, not once per frame: the
    // footer paints on every frame, so an unguarded notice would spam.
    let renderFailureReported = false;

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

      // Git/jj facts are refreshed in the background so a render never blocks;
      // when a reply changes what this footer shows, ask for a frame — pi draws
      // one only on request, so otherwise the stale value stays on screen.
      unsubscribeVcsChange?.();
      const stopVcsChange = onVcsChange(() => tui.requestRender());
      unsubscribeVcsChange = stopVcsChange;

      return {
        dispose: () => {
          unsubscribe();
          stopVcsChange();
          if (unsubscribeVcsChange === stopVcsChange) unsubscribeVcsChange = undefined;
        },
        invalidate() { },
        render(width: number): string[] {
          try {
            const colorize = (token: string, s: string) => theme.fg(token as any, s);
            const activeModel = ctx.model?.id || "no-model";
            const jjBookmark = getJjBookmark();
            const currentBranch = jjBookmark ?? footerData.getGitBranch();
            const currentDirectory = process.cwd().split("/").pop() || process.cwd();
            // jj repos never run git: jj's changed-file count fills the "unstaged" (~N) slot
            const gitStatus = jjBookmark !== null
              ? { staged: 0, unstaged: getJjChangedFiles(), untracked: 0, ahead: 0, behind: 0 }
              : getGitStatus();
            const inWorktree = jjBookmark === null && isInsideLinkedWorktree();
            const thinkingLevel = pi.getThinkingLevel();

            // One source of truth for usage: the session entries. They carry the
            // main agent's assistant usage AND any tool result that reported
            // usage — which is how a subagent's cost arrives now that the tool
            // returns native `usage` (ADR 0028). There used to be a second,
            // additive source here (a `COST_UPDATE` listener accumulating what
            // subagents published); keeping it would have counted that money
            // twice — see `packages/subagent/src/usage.ts`.
            const {
              totalInput,
              totalOutput,
              totalCacheRead,
              totalCacheWrite,
              totalCost,
            } = getTokenUsageStats(ctx);
            const { percent: contextPercent, percentValue: contextPercentValue, windowSize: contextWindowSize } = getContextWindowInfo(ctx);

            // ── Sections ──────────────────────────────────────────────────

            const thinkingIndicatorStr = formatThinkingIndicator(thinkingLevel, colorize);
            const gitStatusStr = formatGitStatusIndicators(gitStatus, colorize);

            const branchIcon = inWorktree ? footerIcons.worktree : footerIcons.branch;

            // Extension status texts (pi setStatus) — may contain ANSI; oversized statuses wrap
            const extensionStatusChunks = [...footerData.getExtensionStatuses().values()]
              .filter(Boolean)
              .flatMap((s) => wrapStatusToChunks(s, width));

            // System info sections: dir | branch [+status] | model | thinking | ext-statuses
            const leftSections = [
              colorize("syntaxFunction", " " + footerIcons.directory + currentDirectory),
              currentBranch ? colorize("success", branchIcon + " " + truncateBranch(currentBranch, branchMaxLength) + (gitStatusStr ? " " + gitStatusStr : "")) : "",
              colorize("syntaxType", footerIcons.model + " " + activeModel),
              thinkingIndicatorStr,
              ...extensionStatusChunks,
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
                return truncateToWidth(line, width);
              })
              .filter((line) => line.length > 0);
          } catch (e) {
            // The user has to learn the status bar went blank, but never from a
            // console write: detail to the log on every frame, one line to the
            // user, and only if there is a UI that can take it.
            diag("footer", `[archimedes:footer] Render error: ${describeError(e)}`);
            if (!renderFailureReported) {
              renderFailureReported = true;
              try {
                if (ctx.hasUI) {
                  ctx.ui.notify("Archimedes footer failed to render, so the status bar is empty.", "warning");
                }
              } catch {
                // A context too stale to notify must not fail the render twice.
              }
            }
            return [];
          }
        },
      };
    });
  });
}

export default registerFooter;
