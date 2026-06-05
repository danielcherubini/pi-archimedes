import { execSync } from "child_process";
import { realpathSync } from "fs";

export interface GitStatus {
  staged: number;
  unstaged: number;
  untracked: number;
  ahead: number;
  behind: number;
}

const STAGED_INDEX_STATES = ["A", "M", "D", "R", "C", "U", "T"] as const;
const UNSTAGED_WORKTREE_STATES = ["M", "D", "U"] as const;

// Cache TTL: 1 second — git status doesn't change on every render
const GIT_CACHE_TTL_MS = 1_000;

interface GitCacheEntry {
  value: GitStatus;
  timestamp: number;
}

interface WorktreeCacheEntry {
  value: string | null;
  timestamp: number;
}

let gitStatusCache: GitCacheEntry | undefined;
let worktreeCache: WorktreeCacheEntry | undefined;

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

export function getGitStatus(): GitStatus {
  // Return cached result if still fresh
  if (gitStatusCache && Date.now() - gitStatusCache.timestamp < GIT_CACHE_TTL_MS) {
    return gitStatusCache.value;
  }

  const status: GitStatus = { staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0 };

  try {
    const gitOutput = execSync("git status --porcelain=v2 -uall", {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 2_000, // Kill hung git processes after 2s
    });

    for (const line of gitOutput.trim().split("\n")) {
      // Branch summary: "## branch_name ... upstream ahead behind"
      if (/^## /.test(line)) {
        const branchParts = line.slice(3).trim().split(/\s+/);
        if (branchParts.length >= 3) {
          const commitsAhead = Number(branchParts[branchParts.length - 2]);
          const commitsBehind = Number(branchParts[branchParts.length - 1]);
          if (!isNaN(commitsAhead) && !isNaN(commitsBehind) && branchParts[branchParts.length - 3]) {
            status.ahead = Math.max(0, commitsAhead);
            status.behind = Math.max(0, commitsBehind);
          }
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
  } catch {
    /* not a git repo or command failed */
  }

  gitStatusCache = { value: status, timestamp: Date.now() };
  return status;
}

export function getWorktreeBranch(): string | null {
  // Return cached result if still fresh
  if (worktreeCache && Date.now() - worktreeCache.timestamp < GIT_CACHE_TTL_MS) {
    return worktreeCache.value;
  }

  try {
    const worktreeOutput = execSync("git worktree list --porcelain", {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 2_000,
    });

    const worktreeEntries = worktreeOutput.trim().split("\n\n").filter(Boolean);
    if (worktreeEntries.length <= 1) {
      worktreeCache = { value: null, timestamp: Date.now() };
      return null;
    }

    const currentDirectoryPath = realpathSync(process.cwd());
    let result: string | null = null;
    for (const entry of worktreeEntries) {
      const entryLines = entry.split("\n");
      const pathLine = entryLines.find((l) => l.startsWith("worktree "));
      const branchLine = entryLines.find((l) => l.startsWith("branch "));
      const worktreePath = pathLine?.replace("worktree ", "");

      if (worktreePath && (currentDirectoryPath === worktreePath || currentDirectoryPath.startsWith(worktreePath + "/"))) {
        result = branchLine?.replace("branch refs/heads/", "") ?? null;
        break;
      }
    }
    worktreeCache = { value: result, timestamp: Date.now() };
    return result;
  } catch {
    /* not a git repo */
    worktreeCache = { value: null, timestamp: Date.now() };
    return null;
  }
}
