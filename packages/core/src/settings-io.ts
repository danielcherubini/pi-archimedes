import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const SETTINGS_PATH = join(getAgentDir(), "settings.json");

/** Read the full settings.json, returning empty object if missing/corrupt. */
function readSettings(): Record<string, unknown> {
  if (!existsSync(SETTINGS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  } catch {
    return {};
  }
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
 * Save a config section to settings.json (atomic: write to .tmp then rename).
 */
export function saveConfig(namespace: string, config: object): void {
  const full = readSettings();
  full[namespace] = config;
  const tmpPath = SETTINGS_PATH + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(full, null, 2), "utf-8");
  try {
    renameSync(tmpPath, SETTINGS_PATH);
  } catch {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    writeFileSync(SETTINGS_PATH, JSON.stringify(full, null, 2), "utf-8");
  }
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
  const tmpPath = SETTINGS_PATH + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(full, null, 2), "utf-8");
  try {
    renameSync(tmpPath, SETTINGS_PATH);
  } catch {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    writeFileSync(SETTINGS_PATH, JSON.stringify(full, null, 2), "utf-8");
  }
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
