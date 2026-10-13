import { execFile, execSync } from "child_process";
import { realpathSync } from "fs";
import { notifyVcsChange } from "./vcs-change-events.js";

export interface GitStatus {
  staged: number;
  unstaged: number;
  untracked: number;
  ahead: number;
  behind: number;
}

const STAGED_INDEX_STATES = ["A", "M", "D", "R", "C", "U", "T"] as const;
// "A" = intent-to-add (`git add -N`); jj marks every new file this way in colocated repos
const UNSTAGED_WORKTREE_STATES = ["M", "D", "U", "A"] as const;

const GIT_STATUS_CMD = "git status --porcelain=v2 --branch -uall";

// Cache TTL: 2 seconds — git status doesn't change on every render
const GIT_CACHE_TTL_MS = 2_000;

interface GitCacheEntry {
  value: GitStatus;
  timestamp: number;
}

interface WorktreeCacheEntry {
  value: boolean;
  timestamp: number;
}

let gitStatusCache: GitCacheEntry | undefined;
let worktreeCache: WorktreeCacheEntry | undefined;
let gitRefreshInFlight = false;
let worktreeRefreshInFlight = false;

interface FileStates {
  indexField: string;
  workTreeField: string;
}

function parseGitStatusLine(line: string): FileStates | null {
  // Scored format: "<score> XY..."
  const scoredMatch = line.match(/^\d+ (..) /);
  if (scoredMatch) return { indexField: scoredMatch[1]![0]!, workTreeField: scoredMatch[1]![1]! };

  // Unscored format: "XY..."
  const noScoreMatch = line.match(/^(..) /);
  if (noScoreMatch) return { indexField: noScoreMatch[1]![0]!, workTreeField: noScoreMatch[1]![1]! };

  // Untracked format: "? ..."
  const untrackedMatch = line.match(/^(.) (.)/);
  if (!untrackedMatch) return null;
  return { indexField: untrackedMatch[1]!, workTreeField: untrackedMatch[2]! };
}

function parseGitOutput(output: string): GitStatus {
  const status: GitStatus = { staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0 };

  for (const line of output.trim().split("\n")) {
    // Branch headers: "# branch.ab +<ahead> -<behind>" (only when an upstream is set)
    if (line.startsWith("# ")) {
      const ab = line.match(/^# branch\.ab \+(\d+) -(\d+)/);
      if (ab) {
        status.ahead = Number(ab[1]);
        status.behind = Number(ab[2]);
      }
      continue;
    }

    const fileStates = parseGitStatusLine(line);
    if (!fileStates) continue;

    if (STAGED_INDEX_STATES.includes(fileStates.indexField as unknown as typeof STAGED_INDEX_STATES[number])) {
      status.staged++;
    }
    if (fileStates.indexField === "?") {
      status.untracked++;
    } else if (UNSTAGED_WORKTREE_STATES.includes(fileStates.workTreeField as unknown as typeof UNSTAGED_WORKTREE_STATES[number])) {
      status.unstaged++;
    }
  }
  return status;
}

function gitStatusEquals(a: GitStatus, b: GitStatus): boolean {
  return (
    a.staged === b.staged &&
    a.unstaged === b.unstaged &&
    a.untracked === b.untracked &&
    a.ahead === b.ahead &&
    a.behind === b.behind
  );
}

/** Refresh git status without blocking the render loop. */
function scheduleGitRefresh(): void {
  if (gitRefreshInFlight || !gitStatusCache) return;
  gitRefreshInFlight = true;
  const staleValue = gitStatusCache.value;
  execFile(
    "git",
    ["status", "--porcelain=v2", "--branch", "-uall"],
    { cwd: process.cwd(), encoding: "utf8", timeout: 2_000 },
    (error, stdout) => {
      gitRefreshInFlight = false;
      const next = error ? staleValue : parseGitOutput(stdout);
      gitStatusCache = { value: next, timestamp: Date.now() };
      // Ask for a frame only when a displayed count actually moved: the footer
      // painted the stale value, and pi draws no frame unless one is requested.
      // An unchanged reply must stay silent, or the TTL drives a render forever.
      if (!gitStatusEquals(next, staleValue)) notifyVcsChange();
    },
  );
}

export function getGitStatus(): GitStatus {
  // Return cached result if still fresh
  if (gitStatusCache && Date.now() - gitStatusCache.timestamp < GIT_CACHE_TTL_MS) {
    return gitStatusCache.value;
  }

  // Return stale cache while background refresh kicks in
  if (gitStatusCache) {
    scheduleGitRefresh();
    return gitStatusCache.value;
  }

  // First call — sync fetch so the first render is correct
  const emptyStatus: GitStatus = { staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0 };
  try {
    const output = execSync(GIT_STATUS_CMD, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 2_000,
    });
    gitStatusCache = { value: parseGitOutput(output), timestamp: Date.now() };
  } catch {
    /* not a git repo or command failed */
    gitStatusCache = { value: emptyStatus, timestamp: Date.now() };
  }
  return gitStatusCache.value;
}

function parseWorktreeOutput(output: string, realCwd: string): boolean {
  const worktreeEntries = output.trim().split("\n\n").filter(Boolean);
  if (worktreeEntries.length <= 1) return false;

  // The first porcelain entry is always the main worktree: only linked ones
  // can match.
  for (let i = 1; i < worktreeEntries.length; i++) {
    const pathLine = worktreeEntries[i]!.split("\n").find((line) => line.startsWith("worktree "));
    const worktreePath = pathLine?.replace("worktree ", "");
    if (worktreePath && (realCwd === worktreePath || realCwd.startsWith(worktreePath + "/"))) return true;
  }
  return false;
}

function scheduleWorktreeRefresh(): void {
  if (worktreeRefreshInFlight || !worktreeCache) return;
  worktreeRefreshInFlight = true;
  const staleValue = worktreeCache.value;
  execFile(
    "git",
    ["worktree", "list", "--porcelain"],
    { cwd: process.cwd(), encoding: "utf8", timeout: 2_000 },
    (error, stdout) => {
      worktreeRefreshInFlight = false;
      let value = staleValue;
      if (!error) {
        try {
          value = parseWorktreeOutput(stdout, realpathSync(process.cwd()));
        } catch {
          /* keep stale value */
        }
      }
      worktreeCache = { value, timestamp: Date.now() };
      // Same rule as git status: repaint only when the answer changed.
      if (value !== staleValue) notifyVcsChange();
    },
  );
}

/**
 * Returns true when cwd is inside a linked worktree (not the main clone).
 * Returns false when cwd is the main clone or not a git repo.
 */
export function isInsideLinkedWorktree(): boolean {
  // Return cached result if still fresh
  if (worktreeCache && Date.now() - worktreeCache.timestamp < GIT_CACHE_TTL_MS) {
    return worktreeCache.value;
  }

  if (worktreeCache) {
    scheduleWorktreeRefresh();
    return worktreeCache.value;
  }

  try {
    const worktreeOutput = execSync("git worktree list --porcelain", {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 2_000,
    });
    const result = parseWorktreeOutput(worktreeOutput, realpathSync(process.cwd()));
    worktreeCache = { value: result, timestamp: Date.now() };
    return result;
  } catch {
    /* not a git repo */
    worktreeCache = { value: false, timestamp: Date.now() };
    return false;
  }
}
