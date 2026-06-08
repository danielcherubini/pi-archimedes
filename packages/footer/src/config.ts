import { loadConfig, saveConfig } from "@pi-archimedes/core/settings-io";
import type { SettingItem } from "@earendil-works/pi-tui";

export interface FooterConfig {
  splitThreshold: number;
}

export const DEFAULT_FOOTER_CONFIG: FooterConfig = {
  splitThreshold: 150,
};

const NAMESPACE = "archimedes.footer";

export function loadFooterConfig(): FooterConfig {
  return loadConfig(NAMESPACE, DEFAULT_FOOTER_CONFIG);
}

export function saveFooterConfig(config: FooterConfig): void {
  saveConfig(NAMESPACE, config);
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
