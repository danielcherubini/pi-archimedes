// Nerd Font icons
export const footerIcons = {
  model: "\udb81\udea9 ",
  directory: "\uf4d3 ",
  branch: "\uf126",
  worktree: "\u{f0405}",
  contextWindow: "\uee9c",
} as const;

// Git status display icons
export const gitDisplayIcons = {
  staged: "●",
  unstaged: "~",
  untracked: "U",
  ahead: "↑",
  behind: "↓",
} as const;

export const gitStatusColors: Record<keyof typeof gitDisplayIcons, "success" | "warning" | "dim" | "info"> = {
  staged: "success",
  unstaged: "warning",
  untracked: "dim",
  ahead: "info",
  behind: "warning",
};

export const thinkingLevelColors: Record<string, string> = {
  off: "dim",
  minimal: "thinkingMinimal",
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  xhigh: "thinkingXhigh",
  max: "thinkingMax",
};

// Thinking level glyphs — fill ramp: off/minimal open ○, low 25% ◔,
// medium 50% ◐, high and above fully filled ● (level still labeled by text)
export const thinkingLevelIcons: Record<string, string> = {
  off: "○",
  minimal: "○",
  low: "◔",
  medium: "◐",
  high: "●",
  xhigh: "●",
  max: "●",
};

// Color function type used by formatting functions
export type ColorFn = (token: string, s: string) => string;
