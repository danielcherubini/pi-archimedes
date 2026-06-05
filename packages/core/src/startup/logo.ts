import { gray, rgb, extractRgb, lerp } from "../color.js";
import type { AnimationStyle } from "../config.js";

// ── Truecolor detection ────────────────────────────────────────

export const TRUECOLOR = /truecolor|24bit/i.test(process.env.COLORTERM ?? "")
  || (process.env.TERM ?? "").includes("256color")
  || process.env.TERM_PROGRAM === "iTerm.app"
  || process.env.TERM_PROGRAM === "WezTerm"
  || process.env.TERM_PROGRAM === "vscode"
  || process.env.WT_SESSION !== undefined;

// ── Logo ───────────────────────────────────────────────────────

export const LOGO = [
  "████████████    ",
  "████████████    ",
  "████    ████    ",
  "████    ████    ",
  "████████    ████",
  "████████    ████",
  "████        ████",
  "████        ████",
];

export const CHAR_FADE_FRAMES = 22;
export const LOGO_SETTLE_FRAME = 90;
export const LOGO_PAD = 0;
export const LOGO_GAP = 4;

const LOGO_COLS = 14;
const LOGO_ROWS = 8;
const CENTER_X = (LOGO_COLS - 1) / 2;
const CENTER_Y = (LOGO_ROWS - 1) / 2;

function computeRevealAt(x: number, y: number, style: AnimationStyle): number {
  switch (style) {
    case "diagonal":
      return ((x / 2) * 1.2 + (y / 2) * 3.5) * 1.4;
    case "top-right":
      return (((LOGO_COLS - 1 - x) / 2) * 1.2 + (y / 2) * 3.5) * 1.4;
    case "bottom-left":
      return ((x / 2) * 1.2 + ((LOGO_ROWS - 1 - y) / 2) * 3.5) * 1.4;
    case "bottom-right":
      return (((LOGO_COLS - 1 - x) / 2) * 1.2 + ((LOGO_ROWS - 1 - y) / 2) * 3.5) * 1.4;
    case "center-out": {
      const dist = Math.sqrt((x - CENTER_X) ** 2 + (y - CENTER_Y) ** 2);
      return dist * 4.5;
    }
    case "wave": {
      const base = ((x / 2) * 1.2 + (y / 2) * 3.5) * 1.4;
      const wave = Math.sin((x * 0.8 + y * 0.5) * 1.2) * 8;
      return base + wave;
    }
    case "horizontal":
      return x * 3.5;
    case "vertical":
      return y * 5.5;
    case "vertical-up":
      return (LOGO_ROWS - 1 - y) * 5.5;
  }
}

export function getShinedLogo(frame: number, style: AnimationStyle = "wave"): string[] {
  if (!TRUECOLOR) return LOGO;

  return LOGO.map((line, y) => {
    let result = "";
    for (let x = 0; x < line.length; x++) {
      const char = line[x]!;
      if (char === " ") { result += " "; continue; }

      const revealAt = computeRevealAt(x, y, style);
      const age = frame - revealAt;

      if (age <= 0) { result += " "; continue; }

      const t = Math.min(1, age / CHAR_FADE_FRAMES);
      const eased = 1 - (1 - t) * (1 - t);
      const brightness = Math.floor(lerp(50, 255, eased));
      result += gray(brightness, char);
    }
    return result;
  });
}
