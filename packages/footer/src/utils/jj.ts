import { execFile, execFileSync } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";

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
  "-T", 'if(local_bookmarks, local_bookmarks.map(|b| b.name()).join(","), "@" ++ change_id.shortest(8)) ++ "\\n"',
];

let jjRepoCache: { cwd: string; isJj: boolean; timestamp: number } | undefined;
let bookmarkCache: { cwd: string; value: string | null; timestamp: number } | undefined;
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

/** First bookmark line wins; otherwise the `@<change-id>` line without its marker. */
function parseJjOutput(output: string): string | null {
  const lines = output.split("\n").filter(Boolean);
  return lines.find((l) => !l.startsWith("@")) ?? (lines[0]?.slice(1) || null);
}

function refreshInBackground(cwd: string): void {
  if (refreshInFlight) return;
  refreshInFlight = true;
  execFile("jj", JJ_ARGS, { cwd, encoding: "utf8", timeout: 2_000 }, (error, stdout) => {
    refreshInFlight = false;
    if (bookmarkCache?.cwd !== cwd) return; // cwd moved on; don't clobber the new entry
    // On failure keep the stale value (transient lock/timeout shouldn't flash "detached")
    bookmarkCache = { cwd, value: error ? bookmarkCache.value : parseJjOutput(stdout), timestamp: Date.now() };
  });
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
  try {
    const output = execFileSync("jj", JJ_ARGS, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    });
    value = parseJjOutput(output);
  } catch {
    /* jj missing or failed */
  }
  bookmarkCache = { cwd, value, timestamp: Date.now() };
  return value;
}
