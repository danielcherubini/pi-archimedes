import { execFile, execFileSync } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { notifyVcsChange } from "./vcs-change-events.js";

// Same TTL as git status: bookmarks (and repo markers) don't change on every render
const JJ_CACHE_TTL_MS = 2_000;

// Nearest bookmarked commit at or below @, plus @ itself as a change-id fallback.
// --ignore-working-copy: never snapshot (no op-log writes, no repo lock) from a render.
const JJ_ARGS = [
  "log",
  "-r", "heads(::@ & bookmarks()) | @",
  "--no-graph",
  "--ignore-working-copy",
  "--color", "never",
  // Count line is tab-tagged (git refs can't contain tabs); it comes from the last snapshot, so it lags until jj snapshots.
  "-T", 'if(local_bookmarks, local_bookmarks.map(|b| b.name()).join(" "), "@" ++ change_id.shortest(8)) ++ "\\n" ++ if(current_working_copy, "\\t" ++ self.diff().files().len() ++ "\\n")',
];

let jjRepoCache: { cwd: string; isJj: boolean; timestamp: number } | undefined;
let bookmarkCache: { cwd: string; value: string | null; changedFiles: number; timestamp: number } | undefined;
let refreshInFlight = false;

function isJjRepo(cwd: string): boolean {
  // Expires so a mid-session `jj git init` (or a removed .jj) is picked up
  if (jjRepoCache?.cwd === cwd && Date.now() - jjRepoCache.timestamp < JJ_CACHE_TTL_MS) return jjRepoCache.isJj;
  let dir = cwd;
  let isJj = false;
  while (true) {
    // Stop at the nearest repo root of either kind: a git repo nested in a jj
    // tree must keep showing its own git branch (colocated has both here).
    isJj = existsSync(join(dir, ".jj"));
    if (isJj || existsSync(join(dir, ".git"))) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  jjRepoCache = { cwd, isJj, timestamp: Date.now() };
  return isJj;
}

/**
 * First bookmark line wins; otherwise the `@<change-id>` line without its marker.
 * Several bookmarks on one commit collapse to `first +N` — footer chunks are
 * atomic, so an unbounded list could push other sections onto their own lines.
 */
function parseJjOutput(output: string): { value: string | null; changedFiles: number } {
  const outputLines = output.split("\n").filter(Boolean);
  const changedFilesLine = outputLines.find((line) => line.startsWith("\t"));
  const changedFiles = Number(changedFilesLine?.slice(1)) || 0;
  const revisionLines = outputLines.filter((line) => !line.startsWith("\t"));
  const bookmarks = revisionLines.find((line) => !line.startsWith("@"));
  if (!bookmarks) return { value: revisionLines[0]?.slice(1) || null, changedFiles };
  // Space-joined by the template: git ref names can't contain spaces
  const [firstBookmark, ...remainingBookmarks] = bookmarks.split(" ");
  return {
    value: remainingBookmarks.length ? `${firstBookmark} +${remainingBookmarks.length}` : firstBookmark!,
    changedFiles,
  };
}

function refreshInBackground(cwd: string): void {
  if (refreshInFlight) return;
  refreshInFlight = true;
  execFile("jj", JJ_ARGS, { cwd, encoding: "utf8", timeout: 2_000 }, (error, stdout) => {
    refreshInFlight = false;
    const previous = bookmarkCache;
    if (!previous || previous.cwd !== cwd) return; // cwd moved on; don't clobber the new entry
    // On failure keep stale values (transient lock/timeout shouldn't flash "detached")
    if (error) {
      bookmarkCache = { ...previous, timestamp: Date.now() };
      return;
    }
    const parsedOutput = parseJjOutput(stdout);
    bookmarkCache = { cwd, ...parsedOutput, timestamp: Date.now() };
    // The footer painted the stale bookmark/count and pi draws no frame unless
    // one is requested, so a reply that moved either has to ask for a repaint.
    if (previous.value !== parsedOutput.value || previous.changedFiles !== parsedOutput.changedFiles) {
      notifyVcsChange();
    }
  });
}

/** @'s changed-file count; only meaningful when getJjBookmark() returned non-null this render. */
export function getJjChangedFiles(): number {
  return bookmarkCache?.cwd === process.cwd() ? bookmarkCache.changedFiles : 0;
}

/**
 * Current jj bookmark for the footer branch section, or null when cwd isn't in
 * a jj repo or jj can't be run (caller falls back to pi's git branch).
 */
export function getJjBookmark(): string | null {
  const cwd = process.cwd();
  if (!isJjRepo(cwd)) return null;

  if (bookmarkCache?.cwd === cwd) {
    if (Date.now() - bookmarkCache.timestamp >= JJ_CACHE_TTL_MS) refreshInBackground(cwd);
    return bookmarkCache.value;
  }

  let value: string | null = null;
  let changedFiles = 0;
  try {
    const output = execFileSync("jj", JJ_ARGS, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    });
    const parsedOutput = parseJjOutput(output);
    value = parsedOutput.value;
    changedFiles = parsedOutput.changedFiles;
  } catch {
    /* jj missing or failed */
  }
  bookmarkCache = { cwd, value, changedFiles, timestamp: Date.now() };
  return value;
}
