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
