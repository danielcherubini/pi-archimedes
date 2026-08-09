import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { deriveBgFromTheme } from "./colors.js";
import { DEFAULT_DIFF_BG, FG_RULE } from "./codes.js";

// ── deriveBgFromTheme ───────────────────────────────────────────────────────

describe("deriveBgFromTheme", () => {
	it("returns DEFAULT_DIFF_BG when theme is null", () => {
		const result = deriveBgFromTheme(null);
		expect(result).toEqual(DEFAULT_DIFF_BG);
	});

	it("returns DEFAULT_DIFF_BG when theme is undefined", () => {
		const result = deriveBgFromTheme(undefined);
		expect(result).toEqual(DEFAULT_DIFF_BG);
	});

	it("returns DEFAULT_DIFF_BG when theme lacks getFgAnsi", () => {
		const result = deriveBgFromTheme({});
		expect(result).toEqual(DEFAULT_DIFF_BG);
	});

	it("returns DEFAULT_DIFF_BG when getFgAnsi returns non-parseable values", () => {
		const theme = {
			getFgAnsi: () => "not-an-ansi-code",
		};
		const result = deriveBgFromTheme(theme);
		expect(result).toEqual(DEFAULT_DIFF_BG);
	});

	it("derives colors from theme with valid getFgAnsi", () => {
		const theme = {
			getFgAnsi: (token: string) => {
				if (token === "toolDiffAdded") return "\x1b[38;2;100;200;150m";
				if (token === "toolDiffRemoved") return "\x1b[38;2;200;100;100m";
				return "";
			},
		};
		const result = deriveBgFromTheme(theme);
		// bgAdd should be a mix of black (base) + green accent at 0.08 intensity
		expect(result.bgAdd).toMatch(/\x1b\[48;2;\d+;\d+;\d+m/);
		expect(result.bgDel).toMatch(/\x1b\[48;2;\d+;\d+;\d+m/);
		// Should differ from defaults since we have a theme
		expect(result.bgAdd).not.toBe(DEFAULT_DIFF_BG.bgAdd);
	});

	it("uses bgBase from theme when getBgAnsi is available", () => {
		const theme = {
			getFgAnsi: (token: string) => {
				if (token === "toolDiffAdded") return "\x1b[38;2;100;200;150m";
				if (token === "toolDiffRemoved") return "\x1b[38;2;200;100;100m";
				return "";
			},
			getBgAnsi: (token: string) => {
				if (token === "toolSuccessBg") return "\x1b[48;2;20;40;30m";
				if (token === "toolErrorBg") return "\x1b[48;2;40;20;20m";
				return "";
			},
		};
		const result = deriveBgFromTheme(theme);
		// bgBase should come from the theme's success bg
		expect(result.bgBase).toBe("\x1b[48;2;20;40;30m");
		// bgEmpty should equal bgBase
		expect(result.bgEmpty).toBe(result.bgBase);
	});

	it("returns DiffBg with all required fields", () => {
		const theme = {
			getFgAnsi: (token: string) => {
				if (token === "toolDiffAdded") return "\x1b[38;2;100;200;150m";
				if (token === "toolDiffRemoved") return "\x1b[38;2;200;100;100m";
				return "";
			},
		};
		const result = deriveBgFromTheme(theme);
		expect(typeof result.bgAdd).toBe("string");
		expect(typeof result.bgDel).toBe("string");
		expect(typeof result.bgAddW).toBe("string");
		expect(typeof result.bgDelW).toBe("string");
		expect(typeof result.bgGutterAdd).toBe("string");
		expect(typeof result.bgGutterDel).toBe("string");
		expect(typeof result.bgEmpty).toBe("string");
		expect(typeof result.bgBase).toBe("string");
		expect(typeof result.rst).toBe("string");
		expect(typeof result.divider).toBe("string");
	});

	it("bg colors are ANSI truecolor escapes (48;2;r;g;b format)", () => {
		const theme = {
			getFgAnsi: (token: string) => {
				if (token === "toolDiffAdded") return "\x1b[38;2;100;200;150m";
				if (token === "toolDiffRemoved") return "\x1b[38;2;200;100;100m";
				return "";
			},
		};
		const result = deriveBgFromTheme(theme);
		const bgFields = [
			result.bgAdd,
			result.bgDel,
			result.bgAddW,
			result.bgDelW,
			result.bgGutterAdd,
			result.bgGutterDel,
		];
		for (const bg of bgFields) {
			expect(bg).toMatch(/\x1b\[48;2;\d+;\d+;\d+m/);
		}
	});

	it("divider contains FG_RULE character", () => {
		const theme = {
			getFgAnsi: (token: string) => {
				if (token === "toolDiffAdded") return "\x1b[38;2;100;200;150m";
				if (token === "toolDiffRemoved") return "\x1b[38;2;200;100;100m";
				return "";
			},
		};
		const result = deriveBgFromTheme(theme);
		expect(result.divider).toContain(FG_RULE);
	});

	it("rst is reset when no bgBase from theme", () => {
		const theme = {
			getFgAnsi: (token: string) => {
				if (token === "toolDiffAdded") return "\x1b[38;2;100;200;150m";
				if (token === "toolDiffRemoved") return "\x1b[38;2;200;100;100m";
				return "";
			},
		};
		const result = deriveBgFromTheme(theme);
		// Without getBgAnsi, bgBase is \x1b[49m, so rst is just \x1b[0m
		expect(result.rst).toBe("\x1b[0m");
	});

	it("rst includes bgBase reset when theme provides getBgAnsi", () => {
		const theme = {
			getFgAnsi: (token: string) => {
				if (token === "toolDiffAdded") return "\x1b[38;2;100;200;150m";
				if (token === "toolDiffRemoved") return "\x1b[38;2;200;100;100m";
				return "";
			},
			getBgAnsi: (token: string) => {
				if (token === "toolSuccessBg") return "\x1b[48;2;20;40;30m";
				return "";
			},
		};
		const result = deriveBgFromTheme(theme);
		// With getBgAnsi, rst should be \x1b[0m + bgBase
		expect(result.rst).toBe("\x1b[0m\x1b[48;2;20;40;30m");
	});

	it("handles getFgAnsi that throws gracefully", () => {
		const theme = {
			getFgAnsi: () => {
				throw new Error("theme error");
			},
		};
		const result = deriveBgFromTheme(theme);
		expect(result).toEqual(DEFAULT_DIFF_BG);
	});

	it("handles getBgAnsi that throws gracefully", () => {
		const theme = {
			getFgAnsi: (token: string) => {
				if (token === "toolDiffAdded") return "\x1b[38;2;100;200;150m";
				if (token === "toolDiffRemoved") return "\x1b[38;2;200;100;100m";
				return "";
			},
			getBgAnsi: () => {
				throw new Error("bg error");
			},
		};
		const result = deriveBgFromTheme(theme);
		// Should still produce valid output, falling back to default bgBase
		expect(result.bgBase).toBe("\x1b[49m");
		expect(result.rst).toBe("\x1b[0m");
	});

	it("property: rst always contains reset escape", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.tuple(
						fc.constant("toolDiffAdded"),
						fc.string({ maxLength: 20 }),
					),
					{ minLength: 0, maxLength: 5 },
				),
				(pairs) => {
					const map = new Map(pairs);
					const theme = {
						getFgAnsi: (token: any) => map.get(token) || "",
					};
					const result = deriveBgFromTheme(theme);
					return result.rst.includes("\x1b[0m");
				},
			),
		);
	});

	it("property: all bg fields are valid truecolor bg escapes or defaults", () => {
		fc.assert(
			fc.property(
				fc.string({ maxLength: 50 }),
				(addColor) => {
					const theme = {
						getFgAnsi: (token: string) => {
							if (token === "toolDiffAdded") return addColor;
							if (token === "toolDiffRemoved") return addColor;
							return "";
						},
					};
					const result = deriveBgFromTheme(theme);
					// Either we get valid truecolor bg escapes, or we get defaults
					const isTruecolorBg = (s: string) => /\x1b\[48;2;\d+;\d+;\d+m/.test(s);
					const allValid = [
						result.bgAdd,
						result.bgDel,
						result.bgAddW,
						result.bgDelW,
						result.bgGutterAdd,
						result.bgGutterDel,
					].every((bg) => isTruecolorBg(bg));
					const isDefault = result === DEFAULT_DIFF_BG || result.bgAdd === DEFAULT_DIFF_BG.bgAdd;
					return allValid || isDefault;
				},
			),
		);
	});

	it("property: divider always contains the rule character", () => {
		fc.assert(
			fc.property(
				fc.string({ maxLength: 100 }),
				(rawColor) => {
					const theme = {
						getFgAnsi: () => rawColor,
					};
					const result = deriveBgFromTheme(theme);
					return result.divider.includes(FG_RULE);
				},
			),
		);
	});
});
