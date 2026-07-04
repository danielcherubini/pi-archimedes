import { describe, it, expect } from "vitest";
import {
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
  ansi256ToRgb,
  parseAnsiFgToRgb,
  deriveDimColor,
  rgbToTruecolorFg,
  gray,
  rgb,
  extractRgb,
  lerp,
} from "./color.js";

// ── hexToRgb ────────────────────────────────────────────────────────────────

describe("hexToRgb", () => {
  it("parses valid 6-char hex", () => {
    expect(hexToRgb("#ff00aa")).toEqual({ r: 255, g: 0, b: 170 });
  });

  it("parses 3-char shorthand", () => {
    expect(hexToRgb("#f0a")).toEqual({ r: 255, g: 0, b: 170 });
  });

  it("parses without hash prefix", () => {
    expect(hexToRgb("ff00aa")).toEqual({ r: 255, g: 0, b: 170 });
  });

  it("parses with hash prefix", () => {
    expect(hexToRgb("#ff00aa")).toEqual({ r: 255, g: 0, b: 170 });
  });

  it("handles mixed case", () => {
    expect(hexToRgb("#Ff00Aa")).toEqual({ r: 255, g: 0, b: 170 });
  });

  it("throws on invalid input", () => {
    expect(() => hexToRgb("#gggggg")).toThrow("Invalid hex color");
    expect(() => hexToRgb("#ff")).toThrow("Invalid hex color");
    expect(() => hexToRgb("#ffffffg")).toThrow("Invalid hex color");
    expect(() => hexToRgb("")).toThrow("Invalid hex color");
  });
});

// ── rgbToHex ────────────────────────────────────────────────────────────────

describe("rgbToHex", () => {
  it("round-trips with hexToRgb", () => {
    const hex = "#ff00aa";
    expect(rgbToHex(hexToRgb(hex))).toBe(hex.toLowerCase());
  });

  it("round-trips shorthand hex", () => {
    const hex = "#f0a";
    // Shorthand expands to 6-char, so round-trip is 6-char form
    expect(rgbToHex(hexToRgb(hex))).toBe("#ff00aa");
  });

  it("clamps values to 0-255", () => {
    expect(rgbToHex({ r: -10, g: 0, b: 0 })).toBe("#000000");
    expect(rgbToHex({ r: 255, g: 300, b: 0 })).toBe("#ffff00");
    expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe("#ffffff");
  });

  it("pads single-digit hex values", () => {
    expect(rgbToHex({ r: 0, g: 0, b: 10 })).toBe("#00000a");
  });
});

// ── rgbToHsl ────────────────────────────────────────────────────────────────

describe("rgbToHsl", () => {
  it("grayscale r=g=b returns s=0", () => {
    const hsl = rgbToHsl({ r: 128, g: 128, b: 128 });
    expect(hsl.s).toBe(0);
    expect(hsl.h).toBe(0);
    expect(hsl.l).toBeCloseTo(128 / 255);
  });

  it("pure red", () => {
    const hsl = rgbToHsl({ r: 255, g: 0, b: 0 });
    expect(hsl.h).toBe(0);
    expect(hsl.s).toBe(1);
    expect(hsl.l).toBe(0.5);
  });

  it("pure green", () => {
    const hsl = rgbToHsl({ r: 0, g: 255, b: 0 });
    expect(hsl.h).toBe(120);
    expect(hsl.s).toBe(1);
    expect(hsl.l).toBe(0.5);
  });

  it("pure blue", () => {
    const hsl = rgbToHsl({ r: 0, g: 0, b: 255 });
    expect(hsl.h).toBe(240);
    expect(hsl.s).toBe(1);
    expect(hsl.l).toBe(0.5);
  });

  it("white returns h=0, s=0, l=1", () => {
    const hsl = rgbToHsl({ r: 255, g: 255, b: 255 });
    expect(hsl.h).toBe(0);
    expect(hsl.s).toBe(0);
    expect(hsl.l).toBe(1);
  });

  it("black returns h=0, s=0, l=0", () => {
    const hsl = rgbToHsl({ r: 0, g: 0, b: 0 });
    expect(hsl.h).toBe(0);
    expect(hsl.s).toBe(0);
    expect(hsl.l).toBe(0);
  });
});

// ── hslToRgb ────────────────────────────────────────────────────────────────

describe("hslToRgb", () => {
  it("round-trips with rgbToHsl for pure red", () => {
    const hsl = rgbToHsl({ r: 255, g: 0, b: 0 });
    expect(hslToRgb(hsl)).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("round-trips with rgbToHsl for pure green", () => {
    const hsl = rgbToHsl({ r: 0, g: 255, b: 0 });
    expect(hslToRgb(hsl)).toEqual({ r: 0, g: 255, b: 0 });
  });

  it("round-trips with rgbToHsl for pure blue", () => {
    const hsl = rgbToHsl({ r: 0, g: 0, b: 255 });
    expect(hslToRgb(hsl)).toEqual({ r: 0, g: 0, b: 255 });
  });

  it("s=0 produces grayscale", () => {
    const result = hslToRgb({ h: 0, s: 0, l: 0.5 });
    expect(result.r).toBe(result.g);
    expect(result.g).toBe(result.b);
  });

  it("h wraps at 360", () => {
    const a = hslToRgb({ h: 0, s: 1, l: 0.5 });
    const b = hslToRgb({ h: 360, s: 1, l: 0.5 });
    expect(a).toEqual(b);
  });

  it("negative h wraps correctly", () => {
    const a = hslToRgb({ h: 0, s: 1, l: 0.5 });
    const b = hslToRgb({ h: -360, s: 1, l: 0.5 });
    expect(a).toEqual(b);
  });
});

// ── ansi256ToRgb ────────────────────────────────────────────────────────────

describe("ansi256ToRgb", () => {
  it("code 0 returns black", () => {
    expect(ansi256ToRgb(0)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("code 9 returns red", () => {
    expect(ansi256ToRgb(9)).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("code 15 returns white", () => {
    expect(ansi256ToRgb(15)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("code 16 returns cube start (0,0,0)", () => {
    expect(ansi256ToRgb(16)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("code 196 returns cube red (255,0,0)", () => {
    expect(ansi256ToRgb(196)).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("code 231 returns cube end (255,255,255)", () => {
    expect(ansi256ToRgb(231)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("code 232 returns grayscale start (8,8,8)", () => {
    expect(ansi256ToRgb(232)).toEqual({ r: 8, g: 8, b: 8 });
  });

  it("code 255 returns grayscale end (238,238,238)", () => {
    expect(ansi256ToRgb(255)).toEqual({ r: 238, g: 238, b: 238 });
  });

  it("out-of-range throws", () => {
    expect(() => ansi256ToRgb(-1)).toThrow("out of range");
    expect(() => ansi256ToRgb(256)).toThrow("out of range");
  });
});

// ── parseAnsiFgToRgb ────────────────────────────────────────────────────────

describe("parseAnsiFgToRgb", () => {
  it("parses truecolor sequence", () => {
    const result = parseAnsiFgToRgb("\x1b[38;2;255;128;64m");
    expect(result).toEqual({ r: 255, g: 128, b: 64 });
  });

  it("parses 256 palette sequence", () => {
    const result = parseAnsiFgToRgb("\x1b[38;5;196m");
    expect(result).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("returns null for empty input", () => {
    expect(parseAnsiFgToRgb("")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(parseAnsiFgToRgb(null as unknown as string)).toBeNull();
  });

  it("returns null for non-matching string", () => {
    expect(parseAnsiFgToRgb("hello")).toBeNull();
  });
});

// ── deriveDimColor ──────────────────────────────────────────────────────────

describe("deriveDimColor", () => {
  it("number input with anchorLightness", () => {
    const result = deriveDimColor(100, 0.5);
    expect(typeof result).toBe("string");
    expect(result.startsWith("#")).toBe(true);
  });

  it("string hex input with custom saturationFactor", () => {
    const result = deriveDimColor("#ff0000", 0.3, 0.7);
    expect(typeof result).toBe("string");
    expect(result.startsWith("#")).toBe(true);
  });

  it("default saturationFactor is 0.5", () => {
    const withDefault = deriveDimColor("#ff0000", 0.5);
    const explicit = deriveDimColor("#ff0000", 0.5, 0.5);
    expect(withDefault).toBe(explicit);
  });

  it("lightness clamping — anchorLightness limits l", () => {
    // Pure red has l=0.5, anchorLightness=0.2 should clamp to 0.2
    const result = deriveDimColor("#ff0000", 0.2);
    const hsl = rgbToHsl(hexToRgb(result));
    expect(hsl.l).toBeLessThanOrEqual(0.2);
  });
});

// ── rgbToTruecolorFg ────────────────────────────────────────────────────────

describe("rgbToTruecolorFg", () => {
  it("produces correct format", () => {
    expect(rgbToTruecolorFg({ r: 255, g: 128, b: 64 })).toBe(
      "\x1b[38;2;255;128;64m"
    );
  });

  it("clamps values to 0-255", () => {
    expect(rgbToTruecolorFg({ r: -1, g: 0, b: 300 })).toBe(
      "\x1b[38;2;0;0;255m"
    );
  });
});

// ── gray ────────────────────────────────────────────────────────────────────

describe("gray", () => {
  it("produces truecolor gray with correct level", () => {
    expect(gray(128, "hello")).toBe("\x1b[38;2;128;128;128mhello\x1b[0m");
  });

  it("clamps level to 0-255", () => {
    expect(gray(-10, "x")).toBe("\x1b[38;2;0;0;0mx\x1b[0m");
    expect(gray(300, "x")).toBe("\x1b[38;2;255;255;255mx\x1b[0m");
  });
});

// ── rgb ─────────────────────────────────────────────────────────────────────

describe("rgb", () => {
  it("produces truecolor with correct values", () => {
    expect(rgb(255, 128, 64, "text")).toBe(
      "\x1b[38;2;255;128;64mtext\x1b[0m"
    );
  });

  it("floors float values", () => {
    expect(rgb(255.9, 128.1, 64.5, "x")).toBe(
      "\x1b[38;2;255;128;64mx\x1b[0m"
    );
  });
});

// ── extractRgb ──────────────────────────────────────────────────────────────

describe("extractRgb", () => {
  it("extracts from themed string", () => {
    expect(extractRgb("\x1b[38;2;200;100;50mhello")).toEqual([200, 100, 50]);
  });

  it("returns default for non-themed string", () => {
    expect(extractRgb("plain text")).toEqual([100, 100, 100]);
  });

  it("returns default for empty string", () => {
    expect(extractRgb("")).toEqual([100, 100, 100]);
  });
});

// ── lerp ────────────────────────────────────────────────────────────────────

describe("lerp", () => {
  it("t=0 returns a", () => {
    expect(lerp(10, 20, 0)).toBe(10);
  });

  it("t=1 returns b", () => {
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it("t=0.5 returns midpoint", () => {
    expect(lerp(10, 20, 0.5)).toBe(15);
  });

  it("works with negative values", () => {
    expect(lerp(-10, 10, 0.5)).toBe(0);
  });
});
