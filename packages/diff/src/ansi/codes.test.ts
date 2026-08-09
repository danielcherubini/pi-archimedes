import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
	RST,
	BOLD,
	DIM,
	FG_ADD,
	FG_DEL,
	FG_DIM,
	FG_LNUM,
	FG_RULE,
	FG_SAFE_MUTED,
	FG_STRIPE,
	BORDER_BAR,
	ANSI_RE,
	ANSI_CAPTURE_RE,
	ANSI_PARAM_CAPTURE_RE,
	DEFAULT_DIFF_COLORS,
	DEFAULT_DIFF_BG,
	themeCacheKey,
	resolveDiffColors,
	resetDiffColors,
} from "./codes.js";

// ── Exported constants ──────────────────────────────────────────────────────

describe("ANSI constants", () => {
	it("all exported constants are non-empty strings", () => {
		expect(typeof RST).toBe("string");
		expect(RST.length).toBeGreaterThan(0);
		expect(typeof BOLD).toBe("string");
		expect(BOLD.length).toBeGreaterThan(0);
		expect(typeof DIM).toBe("string");
		expect(DIM.length).toBeGreaterThan(0);
		expect(typeof FG_ADD).toBe("string");
		expect(FG_ADD.length).toBeGreaterThan(0);
		expect(typeof FG_DEL).toBe("string");
		expect(FG_DEL.length).toBeGreaterThan(0);
		expect(typeof FG_DIM).toBe("string");
		expect(FG_DIM.length).toBeGreaterThan(0);
		expect(typeof FG_LNUM).toBe("string");
		expect(FG_LNUM.length).toBeGreaterThan(0);
		expect(typeof FG_RULE).toBe("string");
		expect(FG_RULE.length).toBeGreaterThan(0);
		expect(typeof FG_SAFE_MUTED).toBe("string");
		expect(FG_SAFE_MUTED.length).toBeGreaterThan(0);
		expect(typeof FG_STRIPE).toBe("string");
		expect(FG_STRIPE.length).toBeGreaterThan(0);
		expect(typeof BORDER_BAR).toBe("string");
		expect(BORDER_BAR.length).toBeGreaterThan(0);
	});

	it("RST is reset escape", () => {
		expect(RST).toBe("\x1b[0m");
	});

	it("BOLD is bold escape", () => {
		expect(BOLD).toBe("\x1b[1m");
	});

	it("DIM is dim escape", () => {
		expect(DIM).toBe("\x1b[2m");
	});

	it("FG_ADD is truecolor green-ish", () => {
		expect(FG_ADD).toBe("\x1b[38;2;100;180;120m");
	});

	it("FG_DEL is truecolor red-ish", () => {
		expect(FG_DEL).toBe("\x1b[38;2;200;100;100m");
	});
});

// ── Regex patterns ──────────────────────────────────────────────────────────

describe("ANSI_RE", () => {
	it("matches standard ANSI escapes", () => {
		// Use exec on a copy to avoid lastIndex state issues with global flag
		const re = new RegExp(ANSI_RE.source, "g");
		expect(re.test("\x1b[0m")).toBe(true);
		re.lastIndex = 0;
		expect(re.test("\x1b[31m")).toBe(true);
		re.lastIndex = 0;
		expect(re.test("\x1b[38;2;255;128;64m")).toBe(true);
	});

	it("matches multiple escapes in a string", () => {
		const matches = "\x1b[31mred\x1b[0m".match(ANSI_RE);
		expect(matches).toHaveLength(2);
	});

	it("does not match plain text", () => {
		expect("hello world".match(ANSI_RE)).toBeNull();
	});
});

describe("ANSI_CAPTURE_RE", () => {
	it("captures parameters between [ and m", () => {
		// Use exec() for capture groups with global regex
		const re = new RegExp(ANSI_CAPTURE_RE.source, "g");
		const match = re.exec("\x1b[38;2;255;128;64m");
		expect(match).not.toBeNull();
		expect(match![1]).toBe("38;2;255;128;64");
	});

	it("captures empty params for reset", () => {
		const re = new RegExp(ANSI_CAPTURE_RE.source, "g");
		const match = re.exec("\x1b[0m");
		expect(match).not.toBeNull();
		expect(match![1]).toBe("0");
	});
});

describe("ANSI_PARAM_CAPTURE_RE", () => {
	it("captures numeric params", () => {
		const re = new RegExp(ANSI_PARAM_CAPTURE_RE.source, "g");
		const match = re.exec("\x1b[38;2;255;128;64m");
		expect(match).not.toBeNull();
		expect(match![1]).toBe("38;2;255;128;64");
	});

	it("captures simple numeric code", () => {
		const re = new RegExp(ANSI_PARAM_CAPTURE_RE.source, "g");
		const match = re.exec("\x1b[31m");
		expect(match).not.toBeNull();
		expect(match![1]).toBe("31");
	});
});

// ── DEFAULT_DIFF_COLORS ─────────────────────────────────────────────────────

describe("DEFAULT_DIFF_COLORS", () => {
	it("has all required fields", () => {
		expect(DEFAULT_DIFF_COLORS.fgAdd).toBe(FG_ADD);
		expect(DEFAULT_DIFF_COLORS.fgDel).toBe(FG_DEL);
		expect(DEFAULT_DIFF_COLORS.fgCtx).toBe(FG_DIM);
	});
});

// ── themeCacheKey ───────────────────────────────────────────────────────────

describe("themeCacheKey", () => {
	it("returns 'no-theme' for null theme", () => {
		expect(themeCacheKey(null)).toBe("no-theme");
	});

	it("returns 'no-theme' for undefined theme", () => {
		expect(themeCacheKey(undefined)).toBe("no-theme");
	});

	it("returns 'no-theme' for theme without fg", () => {
		expect(themeCacheKey({})).toBe("no-theme");
	});

	it("returns deterministic string for same theme", () => {
		const theme = {
			fg: (token: string, fallback: string) => `fg-${token}`,
			bg: (token: string, fallback: string) => `bg-${token}`,
		};
		const key1 = themeCacheKey(theme);
		const key2 = themeCacheKey(theme);
		expect(key1).toBe(key2);
		expect(typeof key1).toBe("string");
		expect(key1.length).toBeGreaterThan(0);
	});

	it("property: deterministic — themeCacheKey(a) === themeCacheKey(a)", () => {
		fc.assert(
			fc.property(
				fc.record({
					fg: fc.constant((t: string, f: string) => `${t}-${f}`),
					bg: fc.constant((t: string, f: string) => `bg-${t}`),
				}),
				(theme) => {
					const key1 = themeCacheKey(theme);
					const key2 = themeCacheKey(theme);
					return key1 === key2;
				},
			),
		);
	});
});

// ── resolveDiffColors ───────────────────────────────────────────────────────

describe("resolveDiffColors", () => {
	it("returns DEFAULT_DIFF_COLORS when no theme", () => {
		resetDiffColors();
		const result = resolveDiffColors(undefined);
		expect(result).toEqual(DEFAULT_DIFF_COLORS);
	});

	it("returns DEFAULT_DIFF_COLORS when theme lacks getFgAnsi", () => {
		resetDiffColors();
		const result = resolveDiffColors({ fg: () => "" });
		expect(result).toEqual(DEFAULT_DIFF_COLORS);
	});

	it("returns theme-derived colors when theme has getFgAnsi", () => {
		resetDiffColors();
		const theme = {
			getFgAnsi: (token: string) => {
				if (token === "toolDiffAdded") return "\x1b[38;2;50;200;50m";
				if (token === "toolDiffRemoved") return "\x1b[38;2;200;50;50m";
				if (token === "toolDiffContext") return "\x1b[38;2;100;100;100m";
				return "";
			},
		};
		const result = resolveDiffColors(theme);
		expect(result.fgAdd).toBe("\x1b[38;2;50;200;50m");
		expect(result.fgDel).toBe("\x1b[38;2;200;50;50m");
		expect(result.fgCtx).toBe("\x1b[38;2;100;100;100m");
	});

	it("falls back to defaults when getFgAnsi returns empty string", () => {
		resetDiffColors();
		const theme = {
			getFgAnsi: () => "",
		};
		const result = resolveDiffColors(theme);
		expect(result.fgAdd).toBe(FG_ADD);
		expect(result.fgDel).toBe(FG_DEL);
		expect(result.fgCtx).toBe(FG_DIM);
	});
});

// ── resetDiffColors ─────────────────────────────────────────────────────────

describe("resetDiffColors", () => {
	it("clears cache so subsequent call re-derives", () => {
		const theme = {
			getFgAnsi: (token: string) => {
				if (token === "toolDiffAdded") return "\x1b[38;2;50;200;50m";
				if (token === "toolDiffRemoved") return "\x1b[38;2;200;50;50m";
				if (token === "toolDiffContext") return "\x1b[38;2;100;100;100m";
				return "";
			},
		};

		// First call derives colors
		const result1 = resolveDiffColors(theme);
		expect(result1.fgAdd).toBe("\x1b[38;2;50;200;50m");

		// Reset clears cache
		resetDiffColors();

		// Now change the theme
		const newTheme = {
			getFgAnsi: (token: string) => {
				if (token === "toolDiffAdded") return "\x1b[38;2;10;100;10m";
				if (token === "toolDiffRemoved") return "\x1b[38;2;100;10;10m";
				if (token === "toolDiffContext") return "\x1b[38;2;50;50;50m";
				return "";
			},
		};

		// After reset, new theme should be picked up
		const result2 = resolveDiffColors(newTheme);
		expect(result2.fgAdd).toBe("\x1b[38;2;10;100;10m");
	});
});
