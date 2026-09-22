import type { SettingItem } from "@earendil-works/pi-tui";
import {
  ANIMATION_STYLES,
  normalizeCompactThinking,
  type UIConfig,
} from "./config.js";

export function getUISettingsItems(config: UIConfig): SettingItem[] {
  return [
    {
      id: "bashToolStyling",
      label: "Bash Tool Styling",
      description: "Custom styling for bash tool execution with collapsible output and duration",
      currentValue: config.bashToolStyling ? "On" : "Off",
      values: ["On", "Off"],
    },
    {
      id: "mutedTheme",
      label: "Muted Theme",
      description: "Use muted colors for thinking blocks",
      currentValue: config.mutedTheme ? "On" : "Off",
      values: ["On", "Off"],
    },
    {
      id: "autoCollapseThinking",
      label: "Auto-Collapse Thinking",
      description: "Collapse thinking blocks after thinking completes",
      currentValue: config.autoCollapseThinking ? "On" : "Off",
      values: ["On", "Off"],
    },
    {
      id: "compactThinking",
      label: "Compact thinking",
      currentValue: normalizeCompactThinking(config.compactThinking),
      values: ["Off", "1 line", "3 lines", "5 lines"],
      description: "Display only the last N lines of thinking (expands to full on click)",
    },
    {
      id: "codeUnindent",
      label: "Code Unindent",
      description: "Remove 2-space indent from code blocks",
      currentValue: config.codeUnindent ? "On" : "Off",
      values: ["On", "Off"],
    },
    {
      id: "labelText",
      label: "Label Text",
      description: "Text shown before thinking blocks",
      currentValue: config.labelText,
    },
    {
      id: "labelColor",
      label: "Label Color",
      description: "RGB color for thinking label (e.g. 255,215,0)",
      currentValue: config.labelColor,
    },
    {
      id: "animationStyle",
      label: "Logo Animation",
      description: "Splashscreen logo reveal style",
      currentValue: config.animationStyle,
      values: [...ANIMATION_STYLES],
    },
    {
      id: "editorSpinBorder",
      label: "Editor Spin Border",
      description: "Type across the editor's top border while the agent is working (hides the “Working” line)",
      currentValue: config.editorSpinBorder ? "On" : "Off",
      values: ["On", "Off"],
    },
    {
      id: "editorSpinSpeed",
      label: "Spin Speed",
      description: "Border spinner speed (slow / normal / fast — the × 1.5 / × 1 / × 0.6 of the style's native tempo)",
      currentValue: (() => {
        // Hand-edited (corrupt) values — non-strings (null/number/boolean) or an
        // empty string — fall back to `normal` (the `typeof` guard keeps the
        // settings panel from TypeError-ing on a non-string setting; the
        // falsy check keeps an empty string from projecting as a `NaN` label).
        const s =
          typeof config.editorSpinSpeed === "string" && config.editorSpinSpeed
            ? config.editorSpinSpeed
            : "normal";
        return s[0]!.toUpperCase() + s.slice(1);
      })(),
      values: ["Slow", "Normal", "Fast"],
    },
    {
      id: "editorSpinStyle",
      label: "Spin Style",
      description: "Which animation the editor border runs while working",
      currentValue:
        typeof config.editorSpinStyle === "string"
          ? config.editorSpinStyle
              .split("-")
              .filter(Boolean)
              .map((w) => w[0]!.toUpperCase() + w.slice(1))
              .join(" ")
          : "Typing",
      values: [
        "Typing",
        "Wave Rows",
        "Columns",
        "Pulse",
        "Marquee",
        "Pendulum",
        "Rain",
        "Cascade",
        "Diagonal Swipe",
        "Sparkle",
      ],
    },
    {
      id: "editorSpinLabel",
      label: "Spinner Label",
      description: "Label typed after the spin window (empty hides it)",
      currentValue: config.editorSpinLabel,
    },
  ];
}
