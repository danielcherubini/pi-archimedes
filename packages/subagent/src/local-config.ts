import {
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** Fields that can be overridden per agent in agents.local.json. */
export type LocalField = "model" | "thinking";

/** Per-agent local overrides stored in agents.local.json */
export type LocalConfig = Record<string, Partial<Record<LocalField, string>>>;

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

/** Set the local override for a field on a given agent, preserving existing entries. */
export function writeLocalField(agentName: string, field: LocalField, value: string): void {
  const config = readLocalConfig();
  config[agentName] = { ...config[agentName], [field]: value };
  writeConfigAtomic(config);
}

/**
 * Delete the local override for a field on a given agent (no-op if absent).
 * Removes ONLY the given field — other fields in the same entry are
 * preserved. If no fields remain, the entry itself is removed.
 *
 * Note: deletion is field-level. An entry lacking the given field is left
 * untouched (a degenerate empty entry `{ codex: {} }` is not removed),
 * unlike the old entry-level delete. Entries are always written with at
 * least one field in practice, so this is acceptable.
 */
export function deleteLocalField(agentName: string, field: LocalField): void {
  const config = readLocalConfig();
  const entry = config[agentName];
  if (!entry || !(field in entry)) return;
  delete entry[field];
  if (Object.keys(entry).length === 0) {
    delete config[agentName];
  }
  writeConfigAtomic(config);
}

/** Delete the entire local override entry for an agent (no-op if absent). Used on rename. */
export function deleteLocalAgent(agentName: string): void {
  const config = readLocalConfig();
  if (!(agentName in config)) return;
  delete config[agentName];
  writeConfigAtomic(config);
}

/** Set the local model override for a given agent, preserving existing entries. */
export function writeLocalModel(agentName: string, model: string): void {
  writeLocalField(agentName, "model", model);
}

/** Delete the local model override for a given agent (no-op if absent). */
export function deleteLocalModel(agentName: string): void {
  deleteLocalField(agentName, "model");
}

/** Set the local thinking-level override for a given agent, preserving existing entries. */
export function writeLocalThinking(agentName: string, thinking: string): void {
  writeLocalField(agentName, "thinking", thinking);
}

/** Delete the local thinking-level override for a given agent (no-op if absent). */
export function deleteLocalThinking(agentName: string): void {
  deleteLocalField(agentName, "thinking");
}

/** Write the full local config atomically (backup+restore safe). */
export function setLocalConfig(config: LocalConfig): void {
  writeConfigAtomic(config);
}
