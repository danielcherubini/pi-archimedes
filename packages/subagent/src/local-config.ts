import {
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** Per-agent local overrides stored in agents.local.json */
export type LocalConfig = Record<string, { model?: string }>;

/** Returns the path to agents.local.json inside the agent directory. */
export function getLocalConfigPath(): string {
  return join(getAgentDir(), "agents.local.json");
}

/** Read the full agents.local.json, returning {} if missing or corrupt. */
function readLocalConfigRaw(): LocalConfig {
  const path = getLocalConfigPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

/** Read agents.local.json, returning {} if missing or corrupt. */
export function readLocalConfig(): LocalConfig {
  return readLocalConfigRaw();
}

/**
 * Write the full config atomically: write to .tmp then rename.
 * Falls back to a direct write if rename fails; cleans up .tmp on failure.
 * Follows the pattern in packages/core/src/settings-io.ts.
 */
function writeConfigAtomic(config: LocalConfig): void {
  const path = getLocalConfigPath();
  const tmpPath = path + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(config, null, 2), "utf-8");
  try {
    renameSync(tmpPath, path);
  } catch {
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore — tmp file may not exist
    }
    writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
  }
}

/** Set the local model override for a given agent, preserving existing entries. */
export function writeLocalModel(agentName: string, model: string): void {
  const config = readLocalConfig();
  config[agentName] = { ...config[agentName], model };
  writeConfigAtomic(config);
}

/** Delete the local model override for a given agent (no-op if absent). */
export function deleteLocalModel(agentName: string): void {
  const config = readLocalConfig();
  delete config[agentName];
  writeConfigAtomic(config);
}
