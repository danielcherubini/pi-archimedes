import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";

export interface FooterConfig {
  splitThreshold: number;
}

const SETTINGS_PATH = join(getAgentDir(), "settings.json");

export const DEFAULT_FOOTER_CONFIG: FooterConfig = {
  splitThreshold: 150,
};

export function loadFooterConfig(): FooterConfig {
  if (existsSync(SETTINGS_PATH)) {
    try {
      const full = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
      return { ...DEFAULT_FOOTER_CONFIG, ...(full["archimedes.footer"] ?? {}) };
    } catch {
      /* ignore corrupt file */
    }
  }
  return DEFAULT_FOOTER_CONFIG;
}

export function saveFooterConfig(config: FooterConfig): void {
  let full: Record<string, unknown> = {};
  if (existsSync(SETTINGS_PATH)) {
    try {
      full = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
    } catch {
      /* ignore corrupt file */
    }
  }
  full["archimedes.footer"] = config;
  writeFileSync(SETTINGS_PATH, JSON.stringify(full, null, 2), "utf-8");
}

export function getFooterSettingsItems(): SettingItem[] {
  return [
    {
      id: "splitThreshold",
      label: "Split Threshold",
      description: "Terminal width threshold for two-line footer split",
      currentValue: String(loadFooterConfig().splitThreshold),
    },
  ];
}
