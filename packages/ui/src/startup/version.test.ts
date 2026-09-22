import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { compareVersions } from "./version.js";

// ── Version generator for property tests ─────────────────────────────────────

const versionArb = fc.tuple(fc.nat(100), fc.nat(100), fc.nat(100)).map(
	([major, minor, patch]) => `${major}.${minor}.${patch}`,
);

// ── compareVersions ──────────────────────────────────────────────────────────

describe("compareVersions", () => {
	it('returns 0 for equal versions', () => {
		expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
	});

	it('returns 1 when first version is greater', () => {
		expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
	});

	it('returns -1 when second version is greater', () => {
		expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
	});

	it("handles v prefix on first argument", () => {
		expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
	});

	it("handles v prefix on second argument", () => {
		expect(compareVersions("1.2.3", "v1.2.3")).toBe(0);
	});

	it("handles v prefix on both arguments", () => {
		expect(compareVersions("v2.0.0", "v1.0.0")).toBe(1);
	});

	it("handles partial versions (2 parts vs 3 parts)", () => {
		expect(compareVersions("1.0", "1.0.0")).toBe(0);
	});

	it("handles partial versions with difference", () => {
		expect(compareVersions("1.1", "1.0.5")).toBe(1);
	});

	it("handles zero-padded versions", () => {
		expect(compareVersions("01.02.03", "1.2.3")).toBe(0);
	});

	it("compares minor version correctly", () => {
		expect(compareVersions("1.2.0", "1.1.9")).toBe(1);
		expect(compareVersions("1.1.0", "1.2.0")).toBe(-1);
	});

	it("compares patch version correctly", () => {
		expect(compareVersions("1.0.5", "1.0.3")).toBe(1);
		expect(compareVersions("1.0.3", "1.0.5")).toBe(-1);
	});

	it("handles all-zero versions", () => {
		expect(compareVersions("0.0.0", "0.0.0")).toBe(0);
	});

	// ── Property tests ───────────────────────────────────────────────────

	it("property: reflexive — compareVersions(a, a) === 0", () => {
		fc.assert(
			fc.property(versionArb, a => {
				return compareVersions(a, a) === 0;
			}),
		);
	});

	it("property: antisymmetric — compareVersions(a, b) === -compareVersions(b, a)", () => {
		fc.assert(
			fc.property(versionArb, versionArb, (a, b) => {
				return compareVersions(a, b) === -compareVersions(b, a);
			}),
		);
	});

	it("property: transitivity — if a<b and b<c then a<c", () => {
		fc.assert(
			fc.property(
				fc.tuple(versionArb, versionArb, versionArb),
				([a, b, c]) => {
					const ab = compareVersions(a, b);
					const bc = compareVersions(b, c);
					const ac = compareVersions(a, c);
					if (ab < 0 && bc < 0) {
						return ac < 0;
					}
					return true;
				},
			),
		);
	});
});
