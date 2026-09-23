import { describe, it, expect, beforeEach } from "vitest";
import { parseDiff } from "../core/diff.js";
import {
	shouldUseSplit,
	setConfigGetter,
	getConfig,
	adaptiveWrapRows,
	wrapAnsi,
} from "./shared.js";

describe("adaptiveWrapRows", () => {
	it("returns correct row limits at width boundaries", () => {
		expect(adaptiveWrapRows(44)).toBe(2);
		expect(adaptiveWrapRows(45)).toBe(4);
		expect(adaptiveWrapRows(79)).toBe(4);
		expect(adaptiveWrapRows(80)).toBe(5);
	});
});

describe("wrapAnsi", () => {
	it("wraps lines without exceeding max rows", () => {
		const str = "a".repeat(100);
		// w=44 -> adaptiveWrapRows=2
		const rows = wrapAnsi(str, 44);
		expect(rows).toHaveLength(2);
	});

	it("wraps up to the adaptive row limits and emits › when truncated on maxRows", () => {
		// w=80 -> maxRows=5; input requires > 5 rows
		const longStr = "x".repeat(80 * 6);
		const rows = wrapAnsi(longStr, 80);
		expect(rows).toHaveLength(5);
		expect(rows[4]).toContain("›");

		// w=44 -> maxRows=2; input requires > 2 rows
		const narrowLongStr = "y".repeat(44 * 3);
		const narrowRows = wrapAnsi(narrowLongStr, 44);
		expect(narrowRows).toHaveLength(2);
		expect(narrowRows[1]).toContain("›");
	});

	it("does not emit › when content fits within maxRows", () => {
		const str = "z".repeat(80 * 3);
		const rows = wrapAnsi(str, 80);
		expect(rows).toHaveLength(3);
		expect(rows[2]).not.toContain("›");
	});
});

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
