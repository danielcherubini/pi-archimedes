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
  editorSpinBorder: boolean;
  editorSpinSpeed: "slow" | "normal" | "fast";
  editorSpinLabel: string;
}

export const DEFAULT_CORE_CONFIG: CoreConfig = {
  mutedTheme: false,
  codeUnindent: true,
  labelText: "Thinking...",
  labelColor: "255,215,0",
  animationStyle: "vertical-up",
  editorSpinBorder: true,
  editorSpinSpeed: "normal",
  editorSpinLabel: "Working",
};

/** Border-spinner tick period per speed setting (ms) — the `editorSpinSpeed` setting maps onto the editor's `spinTickMs` ctor param (`SPIN_TICK_MS` is the "normal" default). */
export const SPIN_SPEED_MS: Record<CoreConfig["editorSpinSpeed"], number> = {
  slow: 160,
  normal: 80,
  fast: 48,
};

const NAMESPACE = "archimedes.core";

export function loadCoreConfig(): CoreConfig {
  return loadConfig(NAMESPACE, DEFAULT_CORE_CONFIG);
}

export function saveCoreConfig(config: CoreConfig): void {
  saveConfig(NAMESPACE, config);
}
