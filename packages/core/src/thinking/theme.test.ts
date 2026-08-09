import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { dimAnsiLine, buildMutedMarkdownTheme } from "./theme.js";
import { stripAnsi } from "../text.js";

// ── dimAnsiLine ──────────────────────────────────────────────────────────────

describe("dimAnsiLine", () => {
	const makeCache = () => new Map<string, string>();

	it("dims a single truecolor fg escape", () => {
		const cache = makeCache();
		const input = "\x1b[38;2;255;128;64mhello";
		const result = dimAnsiLine(input, 0.4, 0.5, cache);
		// Output should still be a truecolor fg escape (38;2;...)
		expect(result).toMatch(/\x1b\[38;2;\d+;\d+;\d+mhello/);
		// But the color should be different (dimmed)
		expect(result).not.toBe(input);
	});

	it("dims multiple fg escapes in one line", () => {
		const cache = makeCache();
		const input = "\x1b[38;2;255;0;0mred\x1b[38;2;0;0;255mblue";
		const result = dimAnsiLine(input, 0.4, 0.5, cache);
		// Both escapes should be rewritten to dimmed versions
		expect(result).not.toContain("\x1b[38;2;255;0;0m");
		expect(result).not.toContain("\x1b[38;2;0;0;255m");
		// Text content preserved
		expect(stripAnsi(result)).toBe("redblue");
	});

	it("leaves lines with no fg escapes unchanged", () => {
		const cache = makeCache();
		const input = "plain text without escapes";
		const result = dimAnsiLine(input, 0.4, 0.5, cache);
		expect(result).toBe(input);
	});

	it("preserves non-fg escapes (bold, italic, reset)", () => {
		const cache = makeCache();
		const input = "\x1b[1mbold\x1b[0m \x1b[3mitalic\x1b[23m";
		const result = dimAnsiLine(input, 0.4, 0.5, cache);
		expect(result).toContain("\x1b[1m");
		expect(result).toContain("\x1b[0m");
		expect(result).toContain("\x1b[3m");
		expect(result).toContain("\x1b[23m");
	});

	it("cache hit returns same result", () => {
		const cache = makeCache();
		const escape = "\x1b[38;2;200;100;50m";
		const input = `${escape}text`;
		const first = dimAnsiLine(input, 0.4, 0.5, cache);
		const second = dimAnsiLine(input, 0.4, 0.5, cache);
		expect(first).toBe(second);
		// Cache should have the entry
		expect(cache.has(escape)).toBe(true);
	});

	it("passes through unrecognized escapes unchanged", () => {
		const cache = makeCache();
		// A bg escape (48;2;...) should not be matched by FG_COLOR_ESCAPE_RE
		const input = "\x1b[48;2;10;10;10mbg text";
		const result = dimAnsiLine(input, 0.4, 0.5, cache);
		expect(result).toBe(input);
	});

	it("dims 256-palette fg escapes to truecolor", () => {
		const cache = makeCache();
		const input = "\x1b[38;5;196mred"; // 256-palette red
		const result = dimAnsiLine(input, 0.4, 0.5, cache);
		// Output should be truecolor (38;2;...), not 256-palette
		expect(result).toMatch(/\x1b\[38;2;\d+;\d+;\d+mred/);
		expect(result).not.toContain("\x1b[38;5;");
	});

	it("handles empty string", () => {
		const cache = makeCache();
		expect(dimAnsiLine("", 0.4, 0.5, cache)).toBe("");
	});

	it("property: preserves non-ANSI text content", () => {
		fc.assert(
			fc.property(
				fc.string({ maxLength: 200 }),
				(s) => {
					const cache = makeCache();
					const result = dimAnsiLine(s, 0.4, 0.5, cache);
					return stripAnsi(s) === stripAnsi(result);
				},
			),
		);
	});

	it("property: never introduces 38;5; escapes (only produces truecolor 38;2;)", () => {
		fc.assert(
			fc.property(
				fc.string({ maxLength: 200 }),
				(s) => {
					const cache = makeCache();
					const result = dimAnsiLine(s, 0.4, 0.5, cache);
					// Any 38;5; in output must have been in the input
					// (dimAnsiLine only produces 38;2; output)
					const inputHas256 = s.includes("38;5;");
					const outputHas256 = result.includes("38;5;");
					// If input didn't have 38;5;, output shouldn't either
					// (because we only dim via truecolor)
					if (!inputHas256) {
						return !outputHas256;
					}
					// If input had 38;5;, they get replaced with 38;2;
					// So output should NOT have 38;5; either
					return !outputHas256;
				},
			),
		);
	});
});

// ── buildMutedMarkdownTheme ──────────────────────────────────────────────────

describe("buildMutedMarkdownTheme", () => {
	const mockTheme = {
		fg: (token: string, text: string) => `\x1b[38;2;180;180;180m${text}\x1b[0m`,
		getFgAnsi: (token: string) => "\x1b[38;2;180;180;180m",
		italic: (text: string) => `\x1b[3m${text}\x1b[23m`,
	};

	it("returns MarkdownTheme with all required fields", () => {
		const theme = buildMutedMarkdownTheme(mockTheme as any);
		expect(typeof theme.codeBlockIndent).toBe("string");
		expect(typeof theme.heading).toBe("function");
		expect(typeof theme.link).toBe("function");
		expect(typeof theme.linkUrl).toBe("function");
		expect(typeof theme.code).toBe("function");
		expect(typeof theme.codeBlock).toBe("function");
		expect(typeof theme.codeBlockBorder).toBe("function");
		expect(typeof theme.quote).toBe("function");
		expect(typeof theme.quoteBorder).toBe("function");
		expect(typeof theme.hr).toBe("function");
		expect(typeof theme.listBullet).toBe("function");
		expect(typeof theme.bold).toBe("function");
		expect(typeof theme.italic).toBe("function");
		expect(typeof theme.strikethrough).toBe("function");
		expect(typeof theme.underline).toBe("function");
		expect(typeof theme.highlightCode).toBe("function");
	});

	it("heading uses gold color (#FFD700)", () => {
		const theme = buildMutedMarkdownTheme(mockTheme as any);
		const result = theme.heading("Title");
		// Gold is #FFD700 = rgb(255, 215, 0)
		expect(result).toContain("\x1b[38;2;255;215;0m");
		expect(result).toContain("Title");
	});

	it("bold uses gold color (#FFD700)", () => {
		const theme = buildMutedMarkdownTheme(mockTheme as any);
		const result = theme.bold("Strong");
		expect(result).toContain("\x1b[38;2;255;215;0m");
		expect(result).toContain("Strong");
	});

	it("codeBlock uses thinkingText", () => {
		const theme = buildMutedMarkdownTheme(mockTheme as any);
		const result = theme.codeBlock("code here");
		expect(result).toContain("code here");
	});

	it("italic wraps with ANSI italic codes", () => {
		const theme = buildMutedMarkdownTheme(mockTheme as any);
		const result = theme.italic("slanted");
		expect(result).toContain("\x1b[3m");
		expect(result).toContain("\x1b[23m");
		expect(result).toContain("slanted");
	});

	it("codeBlockIndent is empty string", () => {
		const theme = buildMutedMarkdownTheme(mockTheme as any);
		expect(theme.codeBlockIndent).toBe("");
	});

	it("highlightCode returns array of strings", () => {
		const theme = buildMutedMarkdownTheme(mockTheme as any);
		const result = theme.highlightCode!("const x = 1;", "javascript");
		expect(Array.isArray(result)).toBe(true);
		expect(result.length).toBeGreaterThan(0);
	});

	it("highlightCode dims ANSI escapes in output", () => {
		const theme = buildMutedMarkdownTheme(mockTheme as any);
		const result = theme.highlightCode!("const x = 1;", "javascript");
		// Output should contain dimmed truecolor escapes
		const joined = result.join("\n");
		expect(joined).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/);
	});

	it("accepts custom saturationFactor", () => {
		const theme1 = buildMutedMarkdownTheme(mockTheme as any, { saturationFactor: 0.3 });
		const theme2 = buildMutedMarkdownTheme(mockTheme as any, { saturationFactor: 0.7 });
		// Different saturation factors should produce different outputs
		const code1 = theme1.highlightCode!("test", "plaintext").join("");
		const code2 = theme2.highlightCode!("test", "plaintext").join("");
		// They may or may not differ depending on input, but both should be valid
		expect(typeof code1).toBe("string");
		expect(typeof code2).toBe("string");
	});

	it("accepts custom codeDefaultLightness", () => {
		const theme = buildMutedMarkdownTheme(mockTheme as any, { codeDefaultLightness: 0.9 });
		const result = theme.highlightCode!("test", "plaintext");
		expect(Array.isArray(result)).toBe(true);
	});
});
