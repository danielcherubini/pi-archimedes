import { loadConfig, saveConfig } from "./settings-io.js";

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

export const DEFAULT_CORE_CONFIG: CoreConfig = {
  mutedTheme: false,
  codeUnindent: true,
  labelText: "Thinking...",
  labelColor: "255,215,0",
  animationStyle: "vertical-up",
};

const NAMESPACE = "archimedes.core";

export function loadCoreConfig(): CoreConfig {
  return loadConfig(NAMESPACE, DEFAULT_CORE_CONFIG);
}

export function saveCoreConfig(config: CoreConfig): void {
  saveConfig(NAMESPACE, config);
}
