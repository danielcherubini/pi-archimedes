import { execSync, spawnSync } from "child_process";
import { existsSync, realpathSync } from "fs";
import { dirname } from "path";

export interface GitStatus {
  staged: number;
  unstaged: number;
  untracked: number;
  ahead: number;
  behind: number;
}

const STAGED_INDEX_STATES = ["A", "M", "D", "R", "C", "U", "T"] as const;
const UNSTAGED_WORKTREE_STATES = ["M", "D", "U"] as const;

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

interface BranchCacheEntry {
  value: string | null;
  timestamp: number;
}

let gitStatusCache: GitCacheEntry | undefined;
let worktreeCache: WorktreeCacheEntry | undefined;
let gitBranchCache: BranchCacheEntry | undefined;
let gitRefreshTimer: ReturnType<typeof setTimeout> | undefined;

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
  return status;
}

/** Schedule a background git status refresh (debounced). */
function scheduleGitRefresh(): void {
  if (gitRefreshTimer) return; // Already scheduled
  gitRefreshTimer = setTimeout(() => {
    gitRefreshTimer = undefined;
    try {
      const output = execSync("git status --porcelain=v2 -uall", {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 2_000,
      });
      gitStatusCache = { value: parseGitOutput(output), timestamp: Date.now() };
    } catch {
      /* not a git repo or command failed — keep stale cache */
    }
  }, 0);
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

  // First call — sync fetch + schedule background refresh
  const emptyStatus: GitStatus = { staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0 };
  try {
    const output = execSync("git status --porcelain=v2 -uall", {
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
  scheduleGitRefresh();
  return gitStatusCache.value;
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

  try {
    const worktreeOutput = execSync("git worktree list --porcelain", {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 2_000,
    });

    const worktreeEntries = worktreeOutput.trim().split("\n\n").filter(Boolean);
    if (worktreeEntries.length <= 1) {
      worktreeCache = { value: false, timestamp: Date.now() };
      return false;
    }

    const currentDirectoryPath = realpathSync(process.cwd());
    let result = false;
    // The first porcelain entry is always the main worktree: being in the
    // main clone isn't "being in a worktree", so only linked ones (index >= 1)
    // can match.
    for (let i = 1; i < worktreeEntries.length; i++) {
      const entry = worktreeEntries[i]!;
      const entryLines = entry.split("\n");
      const pathLine = entryLines.find((l) => l.startsWith("worktree "));
      const worktreePath = pathLine?.replace("worktree ", "");

      if (worktreePath && (currentDirectoryPath === worktreePath || currentDirectoryPath.startsWith(worktreePath + "/"))) {
        result = true;
        break;
      }
    }
    worktreeCache = { value: result, timestamp: Date.now() };
    return result;
  } catch {
    /* not a git repo */
    worktreeCache = { value: false, timestamp: Date.now() };
    return false;
  }
}

// ── Branch resolution (git, with jj fallback) ────────────────────────────

/**
 * True when `dir` is inside a jj workspace (a `.jj` directory sits at the
 * workspace root). jj's workspaces are what show as `detached` in git: a
 * colocated workspace's `.git/HEAD` points at a raw commit (the working-copy
 * commit's parent) rather than a `ref:`, and a non-colocated workspace has
 * no `.git` at all. The authoritative branch name is a jj bookmark.
 */
export function isJjWorkspace(dir: string = process.cwd()): boolean {
  try {
    // Walk up to the nearest ancestor containing a `.jj` directory, matching
    // jj's own workspace-root resolution (the closest ancestor with `.jj`).
    let current = dir;
    while (true) {
      if (existsSync(`${current}/.jj`)) return true;
      const parent = dirname(current);
      if (parent === current) return false; // reached filesystem root
      current = parent;
    }
  } catch {
    return false;
  }
}

/**
 * Ask git for the current branch. Mirrors pi's FooterDataProvider semantics:
 * a symbolic branch name, `"detached"` for a detached HEAD, or `null` when
 * the cwd is not inside a git repository (or git is unavailable).
 */
function getGitBranchNative(): string | null {
  const result = spawnSync(
    "git",
    ["--no-optional-locks", "symbolic-ref", "--quiet", "--short", "HEAD"],
    { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2_000 },
  );
  if (result.status === 0) {
    const branch = result.stdout.trim();
    if (branch) return branch;
    // git exited 0 but printed nothing — treat as not-a-repo (null)
    return null;
  }
  const err = (result.stderr ?? "").trim();
  if (/not a (git )?repository|fatal/i.test(err)) {
    // Not a git repo at all (e.g. a non-colocated jj workspace).
    return null;
  }
  // A repo exists but HEAD is detached (raw commit).
  return "detached";
}

/**
 * Ask jj for the working-copy bookmark. Returns the local bookmark name,
 * or the short change id when the working copy is not on any bookmark.
 * `null` when the cwd is not a jj workspace or jj is unavailable.
 */
function getJjBranch(): string | null {
  if (!isJjWorkspace()) return null;
  const result = spawnSync(
    "jj",
    ["log", "--no-color", "-r", "@", "-T", "try(local_bookmarks.first().name(), change_id.shortest(8))"],
    { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2_000 },
  );
  const bookmark = result.status === 0 ? result.stdout.trim() : "";
  return bookmark || null;
}

/**
 * The branch to show in the footer. In a jj workspace, git reports the
 * working copy as `detached` (colocated) or as no repo at all (non-colocated);
 * the jj bookmark is the authoritative branch name, so it wins. In a plain git
 * repo the git result is returned unchanged.
 */
export function getGitBranch(): string | null {
  // Return cached result if still fresh
  if (gitBranchCache && Date.now() - gitBranchCache.timestamp < GIT_CACHE_TTL_MS) {
    return gitBranchCache.value;
  }

  let value: string | null;
  try {
    if (isJjWorkspace()) {
      value = getJjBranch() ?? getGitBranchNative();
    } else {
      value = getGitBranchNative();
    }
  } catch {
    value = null;
  }
  gitBranchCache = { value, timestamp: Date.now() };
  return value;
}
