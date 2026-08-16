import { describe, it, expect } from "vitest";
import {
  visibleWidth,
  padEnd,
  wrapText,
  hardTruncate,
  renderHeader,
  renderFooter,
  wrapWithBorder,
  borderContentWidth,
  OVERLAY_CHROME,
  type OverlayTheme,
} from "./overlay.js";

// Mock theme: fg returns its text argument untouched.
const mockTheme: OverlayTheme = {
  fg: (_color: string, text: string) => text,
};

// Mock theme that records the color token passed to fg.
function recordingTheme() {
  let lastColor: string | null = null;
  const theme: OverlayTheme = {
    fg: (color: string, text: string) => {
      lastColor = color;
      return text;
    },
  };
  return { theme, lastColor: () => lastColor };
}

// ── visibleWidth ─────────────────────────────────────────────────────────────

describe("visibleWidth", () => {
  it("counts a plain string", () => {
    expect(visibleWidth("hello")).toBe(5);
  });

  it("ignores ANSI SGR codes", () => {
    expect(visibleWidth("\x1b[31mred\x1b[0m")).toBe(3);
  });

  it("returns 0 for empty string", () => {
    expect(visibleWidth("")).toBe(0);
  });
});

// ── padEnd ───────────────────────────────────────────────────────────────────

describe("padEnd", () => {
  it("pads to width", () => {
    expect(padEnd("hi", 5)).toBe("hi   ");
  });

  it("returns input unchanged when visible width >= target", () => {
    expect(padEnd("hello", 5)).toBe("hello");
    expect(padEnd("toolong", 5)).toBe("toolong");
  });

  it("returns '' for width <= 0", () => {
    expect(padEnd("text", 0)).toBe("");
    expect(padEnd("text", -3)).toBe("");
  });
});

// ── wrapText ─────────────────────────────────────────────────────────────────

describe("wrapText", () => {
  it("wraps a long line to width", () => {
    expect(wrapText("aaa bbb ccc ddd", 8)).toEqual(["aaa bbb ", "ccc ddd"]);
  });

  it("wraps long words to width", () => {
    expect(wrapText("hello world", 5)).toEqual(["hello", " ", "world"]);
  });

  it("preserves empty paragraphs as blank lines", () => {
    expect(wrapText("one\n\ntwo", 10)).toEqual(["one", "", "two"]);
  });

  it("returns [] for width <= 0", () => {
    expect(wrapText("anything", 0)).toEqual([]);
  });
});

// ── hardTruncate ─────────────────────────────────────────────────────────────

describe("hardTruncate", () => {
  it("leaves short strings alone", () => {
    expect(hardTruncate("short", 10)).toBe("short");
  });

  it("truncates at the visible-width boundary", () => {
    expect(hardTruncate("hello world", 5)).toBe("hello");
  });

  it("truncates an ANSI-colored string and appends a reset", () => {
    const result = hardTruncate("\x1b[31mhello world\x1b[0m", 5);
    expect(result).toBe("\x1b[31mhello\x1b[0m");
    expect(result).toContain("\x1b[0m");
  });
});

// ── renderHeader / renderFooter ──────────────────────────────────────────────

describe("renderHeader", () => {
  it("pads to width and renders with the accent token", () => {
    const { theme, lastColor } = recordingTheme();
    const out = renderHeader(" Title ", 10, theme);
    expect(out).toBe(" Title    ");
    expect(lastColor()).toBe("accent");
  });
});

describe("renderFooter", () => {
  it("pads to width and renders with the dim token", () => {
    const { theme, lastColor } = recordingTheme();
    const out = renderFooter(" hint ", 10, theme);
    expect(out).toBe(" hint     ");
    expect(lastColor()).toBe("dim");
  });
});

// ── wrapWithBorder / borderContentWidth ──────────────────────────────────────

describe("borderContentWidth", () => {
  it("derives content width from outer width", () => {
    expect(borderContentWidth(84)).toBe(80);
  });

  it("floors at 1 for tiny widths", () => {
    expect(borderContentWidth(0)).toBe(1);
    expect(borderContentWidth(2)).toBe(1);
  });
});

describe("wrapWithBorder", () => {
  const W = 84;

  it("emits border rows with the correct shape", () => {
    const out = wrapWithBorder(["a", "b"], W, mockTheme);
    expect(out[0]).toBe("┌" + "─".repeat(W - 2) + "┐");
    expect(out[out.length - 1]).toBe("└" + "─".repeat(W - 2) + "┘");
    expect(out[1]).toBe("│ a" + " ".repeat(W - 4) + "│");
    expect(out[2]).toBe("│ b" + " ".repeat(W - 4) + "│");
  });

  it("emits exactly lines.length + 2 rows", () => {
    const out = wrapWithBorder(["a", "b", "c"], W, mockTheme);
    expect(out.length).toBe(5);
  });

  it("pads every row to exactly the outer width", () => {
    const out = wrapWithBorder(["x", "shorter", "y"], W, mockTheme);
    for (const line of out) {
      expect(visibleWidth(line)).toBe(W);
    }
  });

  it("hard-truncates content wider than the content width, without overflowing", () => {
    const long = "z".repeat(W + 10); // wider than the 80-col content area
    const out = wrapWithBorder([long], W, mockTheme);
    expect(out.length).toBe(3);
    for (const line of out) {
      expect(visibleWidth(line)).toBe(W);
    }
    expect(out[1]).toBe("│ " + "z".repeat(W - 4) + " │");
  });
});

// ── OVERLAY_CHROME ───────────────────────────────────────────────────────────

describe("OVERLAY_CHROME", () => {
  it("matches the /agents overlay options", () => {
    expect(OVERLAY_CHROME).toEqual({
      anchor: "center",
      width: 84,
      maxHeight: "80%",
    });
  });
});
