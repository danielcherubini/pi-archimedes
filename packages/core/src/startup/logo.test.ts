import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { stripAnsi } from "../text.js";

// ── Helpers for dynamic imports with controlled TRUECOLOR ────────────────────

async function importLogoWithTruecolor(truecolor: boolean) {
	vi.resetModules();

	// Set env before the module loads
	const origColorterm = process.env.COLORTERM;
	const origTerm = process.env.TERM;
	const origTermProgram = process.env.TERM_PROGRAM;
	const origWtSession = process.env.WT_SESSION;

	if (truecolor) {
		process.env.COLORTERM = "truecolor";
	} else {
		delete process.env.COLORTERM;
		process.env.TERM = "xterm";
		delete process.env.TERM_PROGRAM;
		delete process.env.WT_SESSION;
	}

	const mod = await import("./logo.js");

	// Restore env
	if (origColorterm === undefined) delete process.env.COLORTERM;
	else process.env.COLORTERM = origColorterm;
	if (origTerm === undefined) delete process.env.TERM;
	else process.env.TERM = origTerm;
	if (origTermProgram === undefined) delete process.env.TERM_PROGRAM;
	else process.env.TERM_PROGRAM = origTermProgram;
	if (origWtSession === undefined) delete process.env.WT_SESSION;
	else process.env.WT_SESSION = origWtSession;

	return mod;
}

// ── LOGO structure (static, no env dependency) ──────────────────────────────

describe("LOGO structure", () => {
	it("has 8 rows", async () => {
		const mod = await importLogoWithTruecolor(false);
		expect(mod.LOGO.length).toBe(8);
	});

	it("each row has 16 characters", async () => {
		const mod = await importLogoWithTruecolor(false);
		for (const row of mod.LOGO) {
			expect(row.length).toBe(16);
		}
	});

	it("first row is 12 blocks + 4 spaces", async () => {
		const mod = await importLogoWithTruecolor(false);
		expect(mod.LOGO[0]).toBe("████████████    ");
	});

	it("last row is 4 blocks + 6 spaces + 4 blocks", async () => {
		const mod = await importLogoWithTruecolor(false);
		expect(mod.LOGO[7]).toBe("████        ████");
	});

	it("LOGO contains only block chars and spaces", async () => {
		const mod = await importLogoWithTruecolor(false);
		for (const row of mod.LOGO) {
			for (const ch of row) {
				expect(ch === " " || ch === "█").toBe(true);
			}
		}
	});
});

// ── Animation constants ──────────────────────────────────────────────────────

describe("animation constants", () => {
	it("CHAR_FADE_FRAMES is 22", async () => {
		const mod = await importLogoWithTruecolor(false);
		expect(mod.CHAR_FADE_FRAMES).toBe(22);
	});

	it("LOGO_SETTLE_FRAME is 90", async () => {
		const mod = await importLogoWithTruecolor(false);
		expect(mod.LOGO_SETTLE_FRAME).toBe(90);
	});

	it("LOGO_PAD is 0", async () => {
		const mod = await importLogoWithTruecolor(false);
		expect(mod.LOGO_PAD).toBe(0);
	});

	it("LOGO_GAP is 4", async () => {
		const mod = await importLogoWithTruecolor(false);
		expect(mod.LOGO_GAP).toBe(4);
	});
});

// ── TRUECOLOR detection ──────────────────────────────────────────────────────

describe("TRUECOLOR", () => {
	it("is true when COLORTERM contains truecolor", async () => {
		const mod = await importLogoWithTruecolor(true);
		expect(mod.TRUECOLOR).toBe(true);
	});

	it("is false when no truecolor env vars set", async () => {
		const mod = await importLogoWithTruecolor(false);
		expect(mod.TRUECOLOR).toBe(false);
	});
});

// ── getShinedLogo — non-truecolor ────────────────────────────────────────────

describe("getShinedLogo (non-truecolor)", () => {
	let mod: typeof import("./logo.js");

	beforeEach(async () => {
		mod = await importLogoWithTruecolor(false);
	});

	it("returns LOGO unchanged when TRUECOLOR is false", () => {
		const result = mod.getShinedLogo(0, "wave");
		expect(result).toBe(mod.LOGO);
	});

	it("returns LOGO at any frame when TRUECOLOR is false", () => {
		expect(mod.getShinedLogo(999, "wave")).toBe(mod.LOGO);
	});

	it("returns 8 rows regardless of frame", () => {
		expect(mod.getShinedLogo(50, "diagonal").length).toBe(8);
	});
});

// ── getShinedLogo — truecolor ────────────────────────────────────────────────

describe("getShinedLogo (truecolor)", () => {
	let mod: typeof import("./logo.js");

	beforeEach(async () => {
		mod = await importLogoWithTruecolor(true);
	});

	it("returns 8 rows", () => {
		expect(mod.getShinedLogo(0, "wave").length).toBe(8);
	});

	it("returns different output than LOGO when TRUECOLOR is true", () => {
		const result = mod.getShinedLogo(50, "wave");
		expect(result).not.toBe(mod.LOGO);
	});

	it("early frames show spaces for not-yet-revealed chars", () => {
		const result = mod.getShinedLogo(0, "vertical");
		// At frame 0, nothing should be revealed yet
		for (const row of result) {
			const stripped = stripAnsi(row);
			expect(stripped).toMatch(/^[\s]*$/);
		}
	});

	it("late frames show all characters revealed", () => {
		const result = mod.getShinedLogo(200, "vertical");
		for (let i = 0; i < result.length; i++) {
			const stripped = stripAnsi(result[i]!);
			const expected = stripAnsi(mod.LOGO[i]!);
			expect(stripped).toBe(expected);
		}
	});

	it("output contains ANSI gray escapes", () => {
		const result = mod.getShinedLogo(50, "wave");
		const joined = result.join("\n");
		expect(joined).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/);
	});

	it("default style is wave", () => {
		const result1 = mod.getShinedLogo(50);
		const result2 = mod.getShinedLogo(50, "wave");
		expect(result1).toEqual(result2);
	});
});

// ── All animation styles ─────────────────────────────────────────────────────

describe("animation styles", () => {
	const styles = [
		"diagonal",
		"top-right",
		"bottom-left",
		"bottom-right",
		"center-out",
		"wave",
		"horizontal",
		"vertical",
		"vertical-up",
	] as const;

	it.each(styles)("style '%s' produces valid reveal times", async (style) => {
		const mod = await importLogoWithTruecolor(true);
		const result = mod.getShinedLogo(100, style);
		expect(result.length).toBe(8);
		// Each row should be a string
		for (const row of result) {
			expect(typeof row).toBe("string");
		}
	});

	it.each(styles)("style '%s' fully reveals at high frame count", async (style) => {
		const mod = await importLogoWithTruecolor(true);
		const result = mod.getShinedLogo(500, style);
		for (let i = 0; i < result.length; i++) {
			const stripped = stripAnsi(result[i]!);
			const expected = stripAnsi(mod.LOGO[i]!);
			expect(stripped).toBe(expected);
		}
	});
});

// ── Properties ───────────────────────────────────────────────────────────────

describe("properties", () => {
	it("getShinedLogo always returns 8 rows (truecolor)", async () => {
		const mod = await importLogoWithTruecolor(true);
		fc.assert(
			fc.property(fc.nat(1000), n => {
				return mod.getShinedLogo(n, "wave").length === 8;
			}),
		);
	});

	it("each row visible width equals 16 after stripping ANSI (truecolor)", async () => {
		const mod = await importLogoWithTruecolor(true);
		fc.assert(
			fc.property(fc.nat(500), n => {
				const result = mod.getShinedLogo(n, "diagonal");
				for (const row of result) {
					const stripped = stripAnsi(row);
					// stripAnsi trims, so we check the raw row length instead
					// The actual row length (including ANSI) may vary, but the
					// visible content should always be 16 chars
					// Since stripAnsi trims trailing spaces, check untrimmed
					const raw = row.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
					if (raw.length !== 16) return false;
				}
				return true;
			}),
		);
	});

	it("getShinedLogo returns 8 rows (non-truecolor)", async () => {
		const mod = await importLogoWithTruecolor(false);
		fc.assert(
			fc.property(fc.nat(1000), n => {
				return mod.getShinedLogo(n, "wave").length === 8;
			}),
		);
	});
});
