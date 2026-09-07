import { describe, it, expect } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { resolvePalette } from "./chrome.js";

// ── Mock theme (mirrors the stubTheme / safeThemeColor assertion style) ──

// theme.fg per safeThemeColor: a key missing from `defined` resolves to
// undefined, exercising the fallback chain. Each available key answers
// with its own marker so tests can tell which key won.
function makeTheme(defined: Record<string, string>): Theme {
  return {
    fg: (key: string, text: string) => {
      const marker = defined[key];
      return marker === undefined ? undefined : `\x1b[${marker}m${text}\x1b[0m`;
    },
  } as unknown as Theme;
}

// ── spin palette entry ───────────────────────────────────────────────────

describe("resolvePalette spin", () => {
  it("wraps in the accent fg when the theme provides accent (and differs from prefix)", () => {
    const p = resolvePalette(
      makeTheme({
        accent: "38;2;1;2;3",
        borderMuted: "38;2;9;9;9",
        border: "38;2;9;9;99",
      }),
    );
    // accent wins for spin ...
    expect(p.spin("t")).toBe("\x1b[38;2;1;2;3mt\x1b[0m");
    // ... while prefix stays on borderMuted
    expect(p.prefix("t")).toBe("\x1b[38;2;9;9;9mt\x1b[0m");
    expect(p.spin("t")).not.toBe(p.prefix("t"));
  });

  it("falls back to borderMuted when accent is unavailable", () => {
    const p = resolvePalette(
      makeTheme({
        borderMuted: "38;2;9;9;9",
        border: "38;2;9;9;99",
      }),
    );
    expect(p.spin("t")).toBe("\x1b[38;2;9;9;9mt\x1b[0m");
    expect(p.spin("t")).toBe(p.prefix("t"));
  });

  it("falls back to the neutral gray when neither is available", () => {
    const p = resolvePalette(makeTheme({}));
    // Same fallback the safeThemeColor chain already uses for borderMuted/border
    expect(p.spin("t")).toBe("\x1b[38;2;74;74;74mt\x1b[0m");
  });
});
