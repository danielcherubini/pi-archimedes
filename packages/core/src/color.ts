// HSL / RGB / ANSI color utilities. Pure: no external imports.

export interface RGB {
  r: number;
  g: number;
  b: number;
} // each 0..255 integer

export interface HSL {
  h: number;
  s: number;
  l: number;
} // h: 0..360, s/l: 0..1

// xterm standard 16-color palette (ANSI codes 0..15).
// Source: https://en.wikipedia.org/wiki/ANSI_escape_code#3-bit_and_4-bit
const XTERM_16: readonly RGB[] = [
  { r: 0x00, g: 0x00, b: 0x00 }, // 0  black
  { r: 0x80, g: 0x00, b: 0x00 }, // 1  maroon
  { r: 0x00, g: 0x80, b: 0x00 }, // 2  green
  { r: 0x80, g: 0x80, b: 0x00 }, // 3  olive
  { r: 0x00, g: 0x00, b: 0x80 }, // 4  navy
  { r: 0x80, g: 0x80, b: 0x80 }, // 5  purple
  { r: 0x00, g: 0x80, b: 0x80 }, // 6  teal
  { r: 0xc0, g: 0xc0, b: 0xc0 }, // 7  silver
  { r: 0x80, g: 0x80, b: 0x80 }, // 8  grey
  { r: 0xff, g: 0x00, b: 0x00 }, // 9  red
  { r: 0x00, g: 0xff, b: 0x00 }, // 10 lime
  { r: 0xff, g: 0xff, b: 0x00 }, // 11 yellow
  { r: 0x00, g: 0x00, b: 0xff }, // 12 blue
  { r: 0xff, g: 0x00, b: 0xff }, // 13 fuchsia
  { r: 0x00, g: 0xff, b: 0xff }, // 14 aqua
  { r: 0xff, g: 0xff, b: 0xff }, // 15 white
];

// 6x6x6 cube levels for ANSI 16..231.
const CUBE_LEVELS: readonly number[] = [0, 95, 135, 175, 215, 255];

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

const toByte = (v: number): number => clamp(Math.round(v), 0, 255);

export function hexToRgb(hex: string): RGB {
  let s = hex.trim();
  if (s.startsWith("#")) s = s.slice(1);
  if (s.length === 3) {
    s = s[0]! + s[0]! + s[1]! + s[1]! + s[2]! + s[2]!;
  }
  if (s.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(s)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  const n = parseInt(s, 16);
  return {
    r: (n >> 16) & 0xff,
    g: (n >> 8) & 0xff,
    b: n & 0xff,
  };
}

export function rgbToHex(rgb: RGB): string {
  const hex = (v: number) => toByte(v).toString(16).padStart(2, "0");
  return `#${hex(rgb.r)}${hex(rgb.g)}${hex(rgb.b)}`;
}

export function rgbToHsl(rgb: RGB): HSL {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        break;
      case g:
        h = ((b - r) / d + 2) * 60;
        break;
      default:
        h = ((r - g) / d + 4) * 60;
        break;
    }
  }
  return { h, s, l };
}

export function hslToRgb(hsl: HSL): RGB {
  const { h, s, l } = hsl;
  if (s === 0) {
    const v = toByte(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = (((h % 360) + 360) % 360) / 360;
  const hue2rgb = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: toByte(hue2rgb(hk + 1 / 3) * 255),
    g: toByte(hue2rgb(hk) * 255),
    b: toByte(hue2rgb(hk - 1 / 3) * 255),
  };
}

export function ansi256ToRgb(code: number): RGB {
  const c = Math.floor(code);
  if (c < 0 || c > 255) {
    throw new Error(`ANSI 256 code out of range: ${code}`);
  }
  if (c < 16) {
    return { ...XTERM_16[c]! };
  }
  if (c < 232) {
    const idx = c - 16;
    const r = CUBE_LEVELS[Math.floor(idx / 36) % 6]!;
    const g = CUBE_LEVELS[Math.floor(idx / 6) % 6]!;
    const b = CUBE_LEVELS[idx % 6]!;
    return { r, g, b };
  }
  const v = 8 + (c - 232) * 10;
  return { r: v, g: v, b: v };
}

export function parseAnsiFgToRgb(ansi: string): RGB | null {
  if (!ansi) return null;
  // Match a leading CSI SGR sequence: ESC [ params m
  const tc = /^\x1b\[38;2;(\d{1,3});(\d{1,3});(\d{1,3})m/.exec(ansi);
  if (tc) {
    return {
      r: clamp(parseInt(tc[1]!, 10), 0, 255),
      g: clamp(parseInt(tc[2]!, 10), 0, 255),
      b: clamp(parseInt(tc[3]!, 10), 0, 255),
    };
  }
  const palette = /^\x1b\[38;5;(\d{1,3})m/.exec(ansi);
  if (palette) {
    const code = parseInt(palette[1]!, 10);
    if (code < 0 || code > 255) return null;
    return ansi256ToRgb(code);
  }
  return null;
}

export function deriveDimColor(
  input: string | number,
  anchorLightness: number,
  saturationFactor?: number,
): string {
  const rgb = typeof input === "number" ? ansi256ToRgb(input) : hexToRgb(input);
  const hsl = rgbToHsl(rgb);
  const factor = saturationFactor ?? 0.5;
  const target: HSL = {
    h: hsl.h,
    s: hsl.s * factor,
    l: Math.min(hsl.l, anchorLightness),
  };
  return rgbToHex(hslToRgb(target));
}

export function rgbToTruecolorFg(rgb: RGB): string {
  return `\x1b[38;2;${toByte(rgb.r)};${toByte(rgb.g)};${toByte(rgb.b)}m`;
}

// ── Color helpers (from utils/ansi.ts) ───────────────────────────────────────

export function gray(level: number, text: string): string {
  const l = Math.max(0, Math.min(255, Math.floor(level)));
  return `\x1b[38;2;${l};${l};${l}m${text}\x1b[0m`;
}

export function rgb(r: number, g: number, b: number, text: string): string {
  return `\x1b[38;2;${Math.floor(r)};${Math.floor(g)};${Math.floor(b)}m${text}\x1b[0m`;
}

export function extractRgb(themed: string): [number, number, number] {
  const m = themed.match(/\x1b\[38;2;(\d+);(\d+);(\d+)m/);
  return m ? [+m[1]!, +m[2]!, +m[3]!] : [100, 100, 100];
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
