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

export type ThinkingStyle = "Full" | "Compact";
export const THINKING_STYLE_VALUES: readonly ThinkingStyle[] = [
  "Full",
  "Compact",
] as const;

/**
 * How tool rendering is handled. `Minimal` = the archimedes-styled tools
 * (bash/codemode overrides, minimal collapsed view); `Native` = no archimedes
 * styling at all — the overrides are not registered, so pi's native tool
 * rendering stands (and no built-in-takeover startup notice).
 */
export type ToolStyle = "Native" | "Minimal";
export const TOOL_STYLE_VALUES: readonly ToolStyle[] = [
  "Native",
  "Minimal",
] as const;

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

export function normalizeThinkingStyle(value: unknown): ThinkingStyle {
  if (value === "Full" || value === "Compact") return value;
  if (value === "Off") return "Full";
  if (value === "1 line" || value === "3 lines" || value === "5 lines") return "Compact";
  return "Full";
}

/**
 * Legacy mappings: `Full` (auto-expand, dropped) → `Minimal` (the user opted
 * into archimedes styling); `Compact` (the old native-collapsed label) →
 * `Native` (its new name).
 */
export function normalizeToolStyle(value: unknown): ToolStyle {
  if (value === "Native" || value === "Minimal") return value;
  if (value === "Full") return "Minimal";
  if (value === "Compact") return "Native";
  return "Minimal";
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
  codemodeToolStyling: boolean;
  mutedTheme: boolean;
  autoCollapseThinking: boolean;
  thinkingStyle: ThinkingStyle;
  toolStyle: ToolStyle;
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
  codemodeToolStyling: true,
  mutedTheme: false,
  autoCollapseThinking: false,
  thinkingStyle: "Full",
  toolStyle: "Minimal",
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
