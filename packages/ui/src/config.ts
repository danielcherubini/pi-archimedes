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

export type OutputStyle = "Full" | "Compact";
export const OUTPUT_STYLE_VALUES: readonly OutputStyle[] = ["Full", "Compact"] as const;

export const SPINNER_STYLES: readonly SpinnerStyle[] = [
  "typing",
  "pulse",
  "rain",
  "cascade",
  "columns",
  "wave-rows",
  "diagonal-swipe",
  "sparkle",
  "pendulum",
  "marquee",
];

export function normalizeOutputStyle(value: unknown): OutputStyle {
  if (value === "Full" || value === "Compact") return value;
  if (value === "Off") return "Full";
  if (value === "1 line" || value === "3 lines" || value === "5 lines") return "Compact";
  return "Full";
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
  thinkingStyle: OutputStyle;
  toolStyle: OutputStyle;
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
  thinkingStyle: "Full",
  toolStyle: "Compact",
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
