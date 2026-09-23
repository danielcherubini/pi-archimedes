import { describe, it, expect, beforeEach } from "vitest";
import { parseDiff } from "../core/diff.js";
import { shouldUseSplit, setConfigGetter, getConfig } from "./shared.js";

describe("render shared / shouldUseSplit", () => {
	beforeEach(() => {
		setConfigGetter(() => ({
			diffSplitMinWidth: 150,
			diffSplitMinCodeWidth: 60,
			diffSplitWrapCheck: true,
		}));
	});

	it("returns false for empty diff", () => {
		const diff = parseDiff("", "");
		expect(shouldUseSplit(diff, 200)).toBe(false);
	});

	it("returns false if terminal width < diffSplitMinWidth", () => {
		const old = "const x = 1;\n";
		const updated = "const x = 2;\n";
		const diff = parseDiff(old, updated);
		expect(shouldUseSplit(diff, 140)).toBe(false);
	});

	it("returns false if available code column width < diffSplitMinCodeWidth", () => {
		setConfigGetter(() => ({
			diffSplitMinWidth: 100,
			diffSplitMinCodeWidth: 60,
			diffSplitWrapCheck: true,
		}));
		const old = "const x = 1;\n";
		const updated = "const x = 2;\n";
		const diff = parseDiff(old, updated);
		// With tw=110, half=54, nw=2, gw=7, cw=47 < 60 -> false
		expect(shouldUseSplit(diff, 110)).toBe(false);
	});

	it("returns true for normal short lines when terminal width and code width fit", () => {
		const old = "const x = 1;\n";
		const updated = "const x = 2;\n";
		const diff = parseDiff(old, updated);
		expect(shouldUseSplit(diff, 200)).toBe(true);
	});

	it("falls back to false when lines wrap and diffSplitWrapCheck is true", () => {
		const longLineOld = "const longLine = '" + "a".repeat(150) + "';\n";
		const longLineNew = "const longLine = '" + "b".repeat(150) + "';\n";
		const diff = parseDiff(longLineOld, longLineNew);
		// In a 200 col terminal, cw ~ 92, line length > 150, all lines wrap (ratio = 1.0 >= 0.2)
		expect(shouldUseSplit(diff, 200)).toBe(false);
	});

	it("returns true when lines wrap but diffSplitWrapCheck is false", () => {
		setConfigGetter(() => ({
			diffSplitMinWidth: 150,
			diffSplitMinCodeWidth: 60,
			diffSplitWrapCheck: false,
		}));
		const longLineOld = "const longLine = '" + "a".repeat(150) + "';\n";
		const longLineNew = "const longLine = '" + "b".repeat(150) + "';\n";
		const diff = parseDiff(longLineOld, longLineNew);
		expect(shouldUseSplit(diff, 200)).toBe(true);
	});
});
