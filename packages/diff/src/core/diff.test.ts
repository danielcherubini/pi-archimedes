import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { parseDiff } from "./diff.js";

// ── Multiline string generator for property tests ────────────────────────────

const lineArb = fc.string({ maxLength: 80 });
const multilineArb = fc.array(lineArb, { maxLength: 20 }).map(lines => lines.join("\n"));

// ── parseDiff ────────────────────────────────────────────────────────────────

describe("parseDiff", () => {
	it("identical content returns empty lines and zero counts", () => {
		const content = "line1\nline2\nline3";
		const result = parseDiff(content, content);
		expect(result.lines).toEqual([]);
		expect(result.added).toBe(0);
		expect(result.removed).toBe(0);
		expect(result.chars).toBe(0);
	});

	it("single line addition", () => {
		const old = "line1\n";
		const newContent = "line1\nline2\n";
		const result = parseDiff(old, newContent);
		expect(result.added).toBe(1);
		expect(result.removed).toBe(0);
		const addLine = result.lines.find(l => l.type === "add");
		expect(addLine).not.toBeUndefined();
		expect(addLine!.content).toBe("line2");
	});

	it("single line deletion", () => {
		const old = "line1\nline2\n";
		const newContent = "line1\n";
		const result = parseDiff(old, newContent);
		expect(result.added).toBe(0);
		expect(result.removed).toBe(1);
		const delLine = result.lines.find(l => l.type === "del");
		expect(delLine).not.toBeUndefined();
		expect(delLine!.content).toBe("line2");
	});

	it("mixed add/delete/context", () => {
		const old = "line1\nline2\nline3";
		const newContent = "line1\nmodified\nline3\nline4";
		const result = parseDiff(old, newContent);
		expect(result.added).toBeGreaterThan(0);
		expect(result.removed).toBeGreaterThan(0);
		expect(result.lines.some(l => l.type === "ctx")).toBe(true);
		expect(result.lines.some(l => l.type === "add")).toBe(true);
		expect(result.lines.some(l => l.type === "del")).toBe(true);
	});

	it("multiple hunks produce separator", () => {
		// Create content with changes far apart to trigger multiple hunks
		const old = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no\np";
		const newContent = "A\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no\nP";
		const result = parseDiff(old, newContent);
		// With context=3, changes at start and end should create 2 hunks with a separator
		expect(result.lines.some(l => l.type === "sep")).toBe(true);
	});

	it("context lines have both oldNum and newNum", () => {
		const old = "line1\nline2\nline3";
		const newContent = "line1\nmodified\nline3";
		const result = parseDiff(old, newContent);
		const ctxLines = result.lines.filter(l => l.type === "ctx");
		for (const line of ctxLines) {
			expect(line.oldNum).not.toBeNull();
			expect(line.newNum).not.toBeNull();
		}
	});

	it("added lines have only newNum", () => {
		const old = "line1";
		const newContent = "line1\nadded";
		const result = parseDiff(old, newContent);
		const addLines = result.lines.filter(l => l.type === "add");
		for (const line of addLines) {
			expect(line.oldNum).toBeNull();
			expect(line.newNum).not.toBeNull();
		}
	});

	it("deleted lines have only oldNum", () => {
		const old = "line1\ndeleted";
		const newContent = "line1";
		const result = parseDiff(old, newContent);
		const delLines = result.lines.filter(l => l.type === "del");
		for (const line of delLines) {
			expect(line.oldNum).not.toBeNull();
			expect(line.newNum).toBeNull();
		}
	});

	it("separator lines have null oldNum", () => {
		const old = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no\np";
		const newContent = "A\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no\nP";
		const result = parseDiff(old, newContent);
		const sepLines = result.lines.filter(l => l.type === "sep");
		for (const line of sepLines) {
			expect(line.oldNum).toBeNull();
		}
	});

	it("chars equals oldContent.length + newContent.length", () => {
		const old = "hello";
		const newContent = "world!!";
		const result = parseDiff(old, newContent);
		expect(result.chars).toBe(old.length + newContent.length);
	});

	it("handles empty strings", () => {
		const result = parseDiff("", "");
		expect(result.lines).toEqual([]);
		expect(result.added).toBe(0);
		expect(result.removed).toBe(0);
	});

	it("handles adding to empty", () => {
		const result = parseDiff("", "new line");
		expect(result.added).toBe(1);
		expect(result.removed).toBe(0);
	});

	it("handles removing everything", () => {
		const result = parseDiff("old line", "");
		expect(result.added).toBe(0);
		expect(result.removed).toBe(1);
	});

	// ── Property tests ───────────────────────────────────────────────────

	it("property: reflexive — parseDiff(x, x).lines.length === 0", () => {
		fc.assert(
			fc.property(multilineArb, x => {
				const result = parseDiff(x, x);
				return result.lines.length === 0;
			}),
		);
	});

	it("property: non-negative — added >= 0 && removed >= 0", () => {
		fc.assert(
			fc.property(multilineArb, multilineArb, (a, b) => {
				const result = parseDiff(a, b);
				return result.added >= 0 && result.removed >= 0;
			}),
		);
	});

	it("property: chars equals sum of input lengths", () => {
		fc.assert(
			fc.property(multilineArb, multilineArb, (a, b) => {
				const result = parseDiff(a, b);
				if (a === b) {
					return result.chars === 0;
				}
				return result.chars === a.length + b.length;
			}),
		);
	});
});
