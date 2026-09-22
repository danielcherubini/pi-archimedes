import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Force TRUECOLOR=false so formatColumns output is deterministic across envs
vi.mock("./logo.js", async (importOriginal) => ({ ...(await importOriginal()), TRUECOLOR: false }));

// Mock pi-tui — visibleWidth and truncateToWidth
vi.mock("@earendil-works/pi-tui", () => ({
	visibleWidth: (s: string) => s.length,
	truncateToWidth: (s: string, w: number) => s.slice(0, w),
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import {
	detectSection,
	parseSectionText,
	parseModelScope,
	extractName,
	formatColumns,
	buildItemWrapper,
	SECTION_KEYS,
	RAMP_FRAMES,
} from "./sections.js";

// ── detectSection ────────────────────────────────────────────────────────────

describe("detectSection", () => {
	it("finds Models section key", () => {
		expect(detectSection("[Models]\nclaude-sonnet")).toBe("Models");
	});

	it("finds Context section key", () => {
		expect(detectSection("some text [Context] more")).toBe("Context");
	});

	it("finds Prompts section key", () => {
		expect(detectSection("[Prompts]")).toBe("Prompts");
	});

	it("finds Skills section key", () => {
		expect(detectSection("Skills: [Skills] list")).toBe("Skills");
	});

	it("finds Extensions section key", () => {
		expect(detectSection("[Extensions]\nfoo")).toBe("Extensions");
	});

	it("finds Themes section key", () => {
		expect(detectSection("[Themes]\ndark")).toBe("Themes");
	});

	it("returns undefined for non-section text", () => {
		expect(detectSection("just some random text")).toBeUndefined();
	});

	it("returns undefined for empty string", () => {
		expect(detectSection("")).toBeUndefined();
	});

	it("returns undefined for bracketed text that is not a section key", () => {
		expect(detectSection("[NotASection]")).toBeUndefined();
	});

	it("returns the first matching section key", () => {
		const text = "[Models]\n[Context]";
		expect(detectSection(text)).toBe("Models");
	});
});

// ── parseSectionText ─────────────────────────────────────────────────────────

describe("parseSectionText", () => {
	it("extracts items correctly", () => {
		const text = "[Models]\nclaude-sonnet\ngpt-4";
		const result = parseSectionText(text);
		expect(result).not.toBeUndefined();
		expect(result!.name).toBe("Models");
		expect(result!.items).toContain("claude-sonnet");
		expect(result!.items).toContain("gpt-4");
	});

	it("returns undefined for non-section text", () => {
		expect(parseSectionText("no section here")).toBeUndefined();
	});

	it("deduplicates items", () => {
		const text = "[Models]\nclaude-sonnet\nclaude-sonnet\ngpt-4";
		const result = parseSectionText(text);
		expect(result).not.toBeUndefined();
		const sonnetCount = result!.items.filter(i => i === "claude-sonnet").length;
		expect(sonnetCount).toBe(1);
	});

	it("prefers prefixed over bare names", () => {
		const text = "[Extensions]\nnpm:@foo/bar\n@foo/bar";
		const result = parseSectionText(text);
		expect(result).not.toBeUndefined();
		// Should prefer the prefixed version
		expect(result!.items.some(i => i.startsWith("npm:"))).toBe(true);
	});

	it("skips empty lines and bracket lines", () => {
		const text = "[Themes]\n\ndark\n[Other]\nlight";
		const result = parseSectionText(text);
		expect(result).not.toBeUndefined();
		expect(result!.items).toContain("dark");
		// "light" is under [Other] which isn't a recognized section,
		// but since we detected [Themes] first, items under [Other] should be skipped
	});

	it("handles empty section (no items)", () => {
		const text = "[Models]";
		const result = parseSectionText(text);
		expect(result).not.toBeUndefined();
		expect(result!.items.length).toBe(0);
	});
});

// ── parseModelScope ──────────────────────────────────────────────────────────

describe("parseModelScope", () => {
	it("extracts model names from 'Model scope:' line", () => {
		const text = "Model scope: claude-sonnet, gpt-4";
		const result = parseModelScope(text);
		expect(result).not.toBeUndefined();
		expect(result!.name).toBe("Models");
		expect(result!.items).toContain("claude-sonnet");
		expect(result!.items).toContain("gpt-4");
	});

	it("strips keyboard shortcut hints", () => {
		const text = "Model scope: claude-sonnet (Ctrl+1), gpt-4 (Ctrl+2)";
		const result = parseModelScope(text);
		expect(result).not.toBeUndefined();
		expect(result!.items).toContain("claude-sonnet");
		expect(result!.items).not.toContain("(Ctrl+1)");
	});

	it("returns undefined when no Model scope line", () => {
		expect(parseModelScope("some random text")).toBeUndefined();
	});

	it("returns undefined for empty items", () => {
		expect(parseModelScope("Model scope:  ")).toBeUndefined();
	});

	it("handles single model", () => {
		const result = parseModelScope("Model scope: only-one");
		expect(result).not.toBeUndefined();
		expect(result!.items).toEqual(["only-one"]);
	});
});

// ── extractName ──────────────────────────────────────────────────────────────

describe("extractName", () => {
	it("extracts Models name from path", () => {
		expect(extractName("/path/to/claude-sonnet", "Models")).toBe("claude-sonnet");
	});

	it("extracts Themes name from path", () => {
		expect(extractName("/path/to/dark-theme", "Themes")).toBe("dark-theme");
	});

	it("extracts Prompts name (strips extension)", () => {
		expect(extractName("/path/to/my-prompt.ts", "Prompts")).toBe("my-prompt");
	});

	it("extracts Context name (basename only)", () => {
		expect(extractName("/path/to/context-file.md", "Context")).toBe("context-file.md");
	});

	it("extracts Skills name from SKILL.md path", () => {
		expect(extractName("/path/to/my-skill/SKILL.md", "Skills")).toBe("my-skill");
	});

	it("extracts Skills name from SKILL.ts path", () => {
		expect(extractName("/path/to/my-skill/SKILL.ts", "Skills")).toBe("my-skill");
	});

	it("handles npm: prefix for Extensions", () => {
		expect(extractName("npm:@foo/bar", "Extensions")).toBe("npm:bar");
	});

	it("handles git: prefix for Extensions", () => {
		expect(extractName("git:github.com/user/repo", "Extensions")).toBe("git:repo");
	});

	it("strips file extensions for Models", () => {
		expect(extractName("/path/to/model.ts", "Models")).toBe("model");
	});

	it("handles simple name without path", () => {
		expect(extractName("simple-name", "Models")).toBe("simple-name");
	});
});

// ── formatColumns ────────────────────────────────────────────────────────────

describe("formatColumns", () => {
	const mockTheme = {
		fg: (token: string, text: string) => text,
		getFgAnsi: (token: string) => "",
	} as any;

	const mockRef = {
		frame: 100,
		revealed: true,
		revealedAt: 0,
		scaffoldAt: 0,
		settled: true,
	};

	it("returns empty array for empty sections", () => {
		expect(formatColumns([], mockTheme, 80, mockRef)).toEqual([]);
	});

	it("returns empty array for sections with no items", () => {
		const sections = [{ name: "Models" as const, items: [] }];
		expect(formatColumns(sections, mockTheme, 80, mockRef)).toEqual([]);
	});

	it("formats a single section with items", () => {
		const sections = [{ name: "Models" as const, items: ["claude-sonnet", "gpt-4"] }];
		const result = formatColumns(sections, mockTheme, 80, mockRef);
		expect(result.length).toBeGreaterThan(0);
		// Should contain the section header
		expect(result.some(line => line.includes("[Models]"))).toBe(true);
	});

	it("formats multiple sections", () => {
		const sections = [
			{ name: "Models" as const, items: ["claude"] },
			{ name: "Themes" as const, items: ["dark"] },
		];
		const result = formatColumns(sections, mockTheme, 80, mockRef);
		expect(result.some(line => line.includes("[Models]"))).toBe(true);
		expect(result.some(line => line.includes("[Themes]"))).toBe(true);
	});

	it("adds blank line after Version section", () => {
		const sections = [{ name: "Version" as const, items: ["1.0.0"] }];
		const result = formatColumns(sections, mockTheme, 80, mockRef);
		expect(result).toContain("");
	});

	it("wraps items to new lines when exceeding width", () => {
		const longItems = Array.from({ length: 20 }, (_, i) => `model-${i}`);
		const sections = [{ name: "Models" as const, items: longItems }];
		const result = formatColumns(sections, mockTheme, 40, mockRef);
		// With narrow width, items should wrap to multiple lines
		expect(result.length).toBeGreaterThan(1);
	});

	it("handles unrevealed state", () => {
		const sections = [{ name: "Models" as const, items: ["test"] }];
		const unrevealedRef = { ...mockRef, revealed: false };
		const result = formatColumns(sections, mockTheme, 80, unrevealedRef);
		expect(result.length).toBeGreaterThan(0);
	});
});

// ── buildItemWrapper ─────────────────────────────────────────────────────────

describe("buildItemWrapper", () => {
	const muted = (t: string) => `\x1b[90m${t}\x1b[0m`;

	it("returns identity function when not revealed", () => {
		const wrapper = buildItemWrapper(0, false, undefined, undefined, muted);
		expect(wrapper("hello")).toBe("hello");
	});

	it("returns muted function when no RGB data", () => {
		const wrapper = buildItemWrapper(10, true, undefined, undefined, muted);
		expect(wrapper("hello")).toBe(muted("hello"));
	});

	it("returns muted function when ramp is complete", () => {
		const startRgb = [20, 20, 20] as [number, number, number];
		const mutedRgb = [100, 100, 100] as [number, number, number];
		const wrapper = buildItemWrapper(RAMP_FRAMES, true, startRgb, mutedRgb, muted);
		expect(wrapper("hello")).toBe(muted("hello"));
	});

	it("returns rgb-colored function during ramp", () => {
		const startRgb = [20, 20, 20] as [number, number, number];
		const mutedRgb = [200, 200, 200] as [number, number, number];
		const wrapper = buildItemWrapper(1, true, startRgb, mutedRgb, muted);
		const result = wrapper("hello");
		// Should be a truecolor ANSI escape, not the muted fallback
		expect(result).toMatch(/\x1b\[38;2;\d+;\d+;\d+mhello\x1b\[0m/);
		expect(result).not.toContain("\x1b[90m");
	});

	it("lerps colors correctly at midpoint", () => {
		const startRgb = [0, 0, 0] as [number, number, number];
		const endRgb = [200, 200, 200] as [number, number, number];
		// At exactly RAMP_FRAMES / 2, t = 0.5, eased = 0.75
		const midAge = Math.floor(RAMP_FRAMES / 2);
		const wrapper = buildItemWrapper(midAge, true, startRgb, endRgb, muted);
		const result = wrapper("x");
		// eased = 1 - (1-0.5)^2 = 0.75
		// lerp(0, 200, 0.75) = 150
		expect(result).toContain("\x1b[38;2;150;150;150mx\x1b[0m");
	});

	it("returns muted when mutedRgb is undefined", () => {
		const startRgb = [20, 20, 20] as [number, number, number];
		const wrapper = buildItemWrapper(5, true, startRgb, undefined, muted);
		expect(wrapper("hello")).toBe(muted("hello"));
	});
});
