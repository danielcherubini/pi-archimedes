import * as Diff from "diff";

export interface DiffLine {
	type: "add" | "del" | "ctx" | "sep";
	oldNum: number | null;
	newNum: number | null;
	content: string;
}

export interface ParsedDiff {
	lines: DiffLine[];
	added: number;
	removed: number;
	chars: number;
}

export function parseDiff(oldContent: string, newContent: string, ctx = 3): ParsedDiff {
	const patch = Diff.structuredPatch("", "", oldContent, newContent, "", "", { context: ctx });
	const lines: DiffLine[] = [];
	let added = 0;
	let removed = 0;

	for (let hi = 0; hi < patch.hunks.length; hi++) {
		if (hi > 0) {
			const prev = patch.hunks[hi - 1];
			const gap = patch.hunks[hi].oldStart - (prev.oldStart + prev.oldLines);
			lines.push({ type: "sep", oldNum: null, newNum: gap > 0 ? gap : null, content: "" });
		}
		const h = patch.hunks[hi];
		let oL = h.oldStart;
		let nL = h.newStart;
		for (const raw of h.lines) {
			if (raw === "\\ No newline at end of file") continue;
			const ch = raw[0];
			const text = raw.slice(1);
			if (ch === "+") {
				lines.push({ type: "add", oldNum: null, newNum: nL++, content: text });
				added++;
			} else if (ch === "-") {
				lines.push({ type: "del", oldNum: oL++, newNum: null, content: text });
				removed++;
			} else {
				lines.push({ type: "ctx", oldNum: oL++, newNum: nL++, content: text });
			}
		}
	}
	return { lines, added, removed, chars: oldContent.length + newContent.length };
}
