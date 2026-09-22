import { loadConfig, saveConfig } from "@pi-archimedes/core/settings-io";

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

export type CompactThinking = "Off" | "1 line" | "3 lines" | "5 lines";
export const COMPACT_THINKING_VALUES: readonly CompactThinking[] = [
  "Off",
  "1 line",
  "3 lines",
  "5 lines",
] as const;

export function normalizeCompactThinking(value: unknown): CompactThinking {
  if (typeof value === "string" && (COMPACT_THINKING_VALUES as readonly string[]).includes(value)) {
    return value as CompactThinking;
  }
  return "Off";
}

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

export interface UIConfig {
  bashToolStyling: boolean;
  mutedTheme: boolean;
  autoCollapseThinking: boolean;
  compactThinking: CompactThinking;
  codeUnindent: boolean;
  labelText: string;
  labelColor: string;
  animationStyle: AnimationStyle;
  editorSpinBorder: boolean;
  editorSpinSpeed: "slow" | "normal" | "fast";
  editorSpinLabel: string;
  editorSpinStyle: SpinnerStyle;
}

export type CoreConfig = UIConfig;

export const DEFAULT_UI_CONFIG: UIConfig = {
  bashToolStyling: true,
  mutedTheme: false,
  autoCollapseThinking: false,
  compactThinking: "Off",
  codeUnindent: true,
  labelText: "Thinking...",
  labelColor: "255,215,0",
  animationStyle: "vertical-up",
  editorSpinBorder: true,
  editorSpinSpeed: "normal",
  editorSpinLabel: "Working",
  editorSpinStyle: "pendulum",
};

export const SPIN_SPEED_MULT: Record<UIConfig["editorSpinSpeed"], number> = {
  slow: 1.5,
  normal: 1,
  fast: 0.6,
};

const NAMESPACE = "archimedes.ui";

export function loadUIConfig(): UIConfig {
  return loadConfig(NAMESPACE, DEFAULT_UI_CONFIG);
}

export function saveUIConfig(config: UIConfig): void {
  saveConfig(NAMESPACE, config);
}
