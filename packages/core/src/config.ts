import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const ANIMATION_STYLES = [
  "diagonal",
  "top-right",
  "bottom-left",
  "bottom-right",
  "center-out",
  "wave",
  "horizontal",
  "vertical",
  "vertical-up",
] as const;
export type AnimationStyle = (typeof ANIMATION_STYLES)[number];

export interface CoreConfig {
  mutedTheme: boolean;
  codeUnindent: boolean;
  labelText: string;
  labelColor: string;
  animationStyle: AnimationStyle;
}

const SETTINGS_PATH = join(getAgentDir(), "settings.json");

export const DEFAULT_CORE_CONFIG: CoreConfig = {
  mutedTheme: false,
  codeUnindent: true,
  labelText: "Thinking...",
  labelColor: "255,215,0",
  animationStyle: "vertical-up",
};

export function loadCoreConfig(): CoreConfig {
  if (existsSync(SETTINGS_PATH)) {
    try {
      const full = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
      return { ...DEFAULT_CORE_CONFIG, ...(full["archimedes.core"] ?? {}) };
    } catch {
      /* ignore corrupt file */
    }
  }
  return DEFAULT_CORE_CONFIG;
}

export function saveCoreConfig(config: CoreConfig): void {
  let full: Record<string, unknown> = {};
  if (existsSync(SETTINGS_PATH)) {
    try {
      full = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
    } catch {
      /* ignore corrupt file */
    }
  }
  full["archimedes.core"] = config;
  writeFileSync(SETTINGS_PATH, JSON.stringify(full, null, 2), "utf-8");
}
