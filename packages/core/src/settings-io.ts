import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync, lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const SETTINGS_PATH = join(getAgentDir(), "settings.json");

/**
 * Read settings.json as a raw string. Returns null when the file is absent or
 * unreadable (EISDIR, EACCES, etc.) — callers treat null the same as an empty
 * file (i.e. no prior settings).
 */
function readRawSettings(): string | null {
  if (!existsSync(SETTINGS_PATH)) return null;
  try {
    return readFileSync(SETTINGS_PATH, "utf-8");
  } catch {
    return null;
  }
}

/** Parse a raw settings string, returning empty object on null/corrupt input. */
function parseSettings(raw: string | null): Record<string, unknown> {
  if (raw === null) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Read the full settings.json, returning empty object if missing/corrupt. */
function readSettings(): Record<string, unknown> {
  return parseSettings(readRawSettings());
}

/**
 * Load a config section from settings.json, merged with defaults.
 */
export function loadConfig<T>(
  namespace: string,
  defaults: T,
): T {
  const full = readSettings();
  return { ...defaults, ...(full[namespace] ?? {}) } as T;
}

/**
 * Atomic write that preserves symlinks: if `path` is a symlink to an
 * existing file, the temp file is created beside the resolved destination
 * and the rename targets the destination — leaving the link intact.
 * Regular files and missing files behave exactly as a plain tmp-then-rename
 * would (temp beside `path`, rename onto `path`).
 *
 * Dangling symlink: `realpathSync` throws (ENOENT) — the fallback writes
 * directly through the link, recreating the destination so the link is
 * live again.
 *
 * Failure-mode note (deliberate, differs from the old clobber behavior):
 * a failed temp write (e.g. ENOSPC) cleans up the temp file and re-throws —
 * the live file is left untouched, so no data loss. A failed rename falls
 * back to a direct write-through, since the temp already holds the full
 * content; writeFileSync follows links, so even that non-atomic path never
 * clobbers a link to an existing file. A symlink loop (ELOOP) or an
 * unwritable destination (EACCES) still throw out of this function, where
 * the old code would have "succeeded" by replacing the link with a regular
 * file in the writable agent dir.
 */
export function writeAtomicPreservingSymlinks(path: string, data: string): void {
  let isLink = false;
  try { isLink = lstatSync(path).isSymbolicLink(); } catch { /* missing → plain path */ }
  let target = path;
  if (isLink) {
    try {
      target = realpathSync(path);
    } catch {
      // Dangling symlink: write through the link, recreating the destination.
      writeFileSync(path, data, "utf-8");
      return;
    }
  }
  const tmpPath = target + ".tmp";
  try {
    writeFileSync(tmpPath, data, "utf-8");
  } catch (err) {
    // Temp write failed (e.g. ENOSPC) — the live file must survive untouched.
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
  try {
    renameSync(tmpPath, target);
  } catch {
    // Rename failed — the temp already holds the full content, so a direct
    // write-through (which follows symlinks) is the fallback.
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    writeFileSync(target, data, "utf-8");
  }
}

/**
 * Save a config section to settings.json (atomic, symlink-preserving — delegates to writeAtomicPreservingSymlinks).
 */
export function saveConfig(namespace: string, config: object): void {
  const full = readSettings();
  full[namespace] = config;
  writeAtomicPreservingSymlinks(SETTINGS_PATH, JSON.stringify(full, null, 2));
}

/**
 * Delete a namespace section from settings.json entirely.
 * No-op if the key is absent (including when the file doesn't exist — the file
 * is never created). Atomic write, same pattern as saveConfig.
 */
export function removeConfig(namespace: string): void {
  const full = readSettings();
  // No file at all (readSettings returns {} for missing AND for corrupt,
  // but only for missing is existsSync false) and no key → never create the file.
  if (!existsSync(SETTINGS_PATH)) return;
  if (!(namespace in full)) return;
  delete full[namespace];
  writeAtomicPreservingSymlinks(SETTINGS_PATH, JSON.stringify(full, null, 2));
}

/**
 * True unless settings[namespace].enabled === false (strict comparison — a
 * string "false" or 0 does NOT disable). Missing file/namespace/key ⇒ true.
 */
export function isConfigEnabled(namespace: string): boolean {
  const cfg = loadConfig(namespace, {}) as { enabled?: boolean };
  return cfg.enabled !== false;
}

/**
 * Turn a namespace's `enabled` gate on or off without touching the
 * namespace's other keys or sibling namespaces.
 *
 * off: write settings[ns].enabled = false (merged — other keys survive).
 * on: delete the `enabled` key; if that leaves the namespace with zero keys,
 * remove the whole namespace key from the file.
 *
 * A namespace omitted from settings.json counts as enabled.
 */
export function setConfigEnabled(namespace: string, enabled: boolean): void {
  if (enabled) {
    const cfg = loadConfig(namespace, {}) as Record<string, unknown>;
    delete cfg.enabled;
    if (Object.keys(cfg).length === 0) {
      removeConfig(namespace);
    } else {
      saveConfig(namespace, cfg);
    }
  } else {
    const cfg = loadConfig(namespace, {}) as Record<string, unknown>;
    cfg.enabled = false;
    saveConfig(namespace, cfg);
  }
}

/**
 * Concurrency-safe read-modify-write for one settings namespace.
 *
 * Uses an optimistic re-read check: the settings file is read before and after
 * the `mutate` callback runs. If the file changed during that window (indicating
 * a concurrent writer, e.g. another TUI session running /plugins toggle), the
 * attempt is discarded and the loop restarts from a fresh read — up to
 * `maxAttempts` times.
 *
 * Sibling namespaces always benefit from `saveConfig`’s own fresh read inside
 * the atomic write, so they are never clobbered regardless of retries.
 *
 * The residual window between the final `after` check and `saveConfig`’s
 * internal read is last-writer-wins; the optimistic check handles all
 * detectable races (changes that happen during the `mutate` call itself).
 *
 * When the maximum attempt count is reached without a clean window (persistent
 * concurrent writer), the last computed value is still written — no crash, no
 * unbounded loop.
 */
export function updateConfig<T extends object>(
  namespace: string,
  defaults: T,
  mutate: (cfg: T) => T,
  maxAttempts = 3,
): T {
  let last = { ...defaults } as T;
  for (let attempt = 1; ; attempt++) {
    const before = readRawSettings();
    const parsed = parseSettings(before);
    const current = { ...defaults, ...(parsed[namespace] ?? {}) } as T;
    const next = mutate(current);
    const after = readRawSettings();
    if (before !== after && attempt < maxAttempts) {
      // Settings file changed during our update window (concurrent writer) —
      // recompute from the fresh state on the next iteration.
      continue;
    }
    last = next;
    saveConfig(namespace, next);
    return last;
  }
}
