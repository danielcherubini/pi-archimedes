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
  editorSpinStyle: SpinnerStyle;
}

/** Border-spinner style (the ten gallery-derived variants, all registered in `SPIN_VARIANTS` (`editor/spin.ts`); unknown values normalize to `typing` via `normalizeSpinnerStyle`). */
export type SpinnerStyle =
  | "typing"
  | "pulse"
  | "rain"
  | "cascade"
  | "columns"
  | "wave-rows"
  | "diagonal-swipe"
  | "sparkle"
  | "pendulum"
  | "marquee";

export const DEFAULT_CORE_CONFIG: CoreConfig = {
  mutedTheme: false,
  codeUnindent: true,
  labelText: "Thinking...",
  labelColor: "255,215,0",
  animationStyle: "vertical-up",
  editorSpinBorder: true,
  editorSpinSpeed: "normal",
  editorSpinLabel: "Working",
  editorSpinStyle: "typing",
};

/** Border-spinner speed setting → the multipliers the `editorSpinSpeed` setting applies to the style's native per-tick interval (SPIN_INTERVALS, `editor/spin.ts` — typing: 120 / 80 / 48 ms). */
export const SPIN_SPEED_MULT: Record<CoreConfig["editorSpinSpeed"], number> = {
  slow: 1.5,
  normal: 1,
  fast: 0.6,
};

const NAMESPACE = "archimedes.core";

export function loadCoreConfig(): CoreConfig {
  return loadConfig(NAMESPACE, DEFAULT_CORE_CONFIG);
}

export function saveCoreConfig(config: CoreConfig): void {
  saveConfig(NAMESPACE, config);
}
