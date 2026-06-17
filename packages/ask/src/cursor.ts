interface CursorReadableEditor {
	getLines(): string[];
	getCursor(): { line: number; col: number };
}

export function getLinearCursorIndexFromEditor(editor: CursorReadableEditor): number {
	const lines = editor.getLines();
	const cursor = editor.getCursor();
	if (lines.length === 0) return 0;

	const safeLineIndex = Math.max(0, Math.min(cursor.line, lines.length - 1));
	const safeColumnIndex = Math.max(0, Math.min(cursor.col, lines[safeLineIndex]?.length ?? 0));
	let linearCursorIndex = safeColumnIndex;

	for (let lineIndex = 0; lineIndex < safeLineIndex; lineIndex++) {
		linearCursorIndex += (lines[lineIndex]?.length ?? 0) + 1;
	}

	return linearCursorIndex;
}
