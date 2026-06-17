import { CURSOR_MARKER, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const INLINE_NOTE_SEPARATOR = " — note: ";
const INLINE_EDIT_CURSOR_INVERT_ON = "\u001b[7m";
const INLINE_EDIT_CURSOR_INVERT_OFF = "\u001b[27m";

export const INLINE_NOTE_WRAP_PADDING = 2;

function sanitizeNoteForInlineDisplay(rawNote: string): string {
	return rawNote.replace(/[\r\n\t]/g, " ").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function clampCursorIndex(index: number, rawTextLength: number): number {
	if (!Number.isFinite(index)) return rawTextLength;
	if (index < 0) return 0;
	if (index > rawTextLength) return rawTextLength;
	return Math.floor(index);
}

function buildEditingInlineNote(
	rawNote: string,
	editingCursorIndex?: number,
	includeHardwareCursorMarker = false,
): string {
	const cursorIndex = clampCursorIndex(editingCursorIndex ?? rawNote.length, rawNote.length);
	const beforeCursor = sanitizeNoteForInlineDisplay(rawNote.slice(0, cursorIndex));
	const rawCharAtCursor = rawNote.slice(cursorIndex, cursorIndex + 1);
	const charAtCursor = sanitizeNoteForInlineDisplay(rawCharAtCursor) || " ";
	const afterCursorStartIndex = rawCharAtCursor.length > 0 ? cursorIndex + 1 : cursorIndex;
	const afterCursor = sanitizeNoteForInlineDisplay(rawNote.slice(afterCursorStartIndex));
	const cursorMarker = includeHardwareCursorMarker ? CURSOR_MARKER : "";
	const cursorCell = `${cursorMarker}${INLINE_EDIT_CURSOR_INVERT_ON}${charAtCursor}${INLINE_EDIT_CURSOR_INVERT_OFF}`;
	return `${beforeCursor}${cursorCell}${afterCursor}`;
}

function truncateTextKeepingTail(text: string, maxLength: number): string {
	if (maxLength <= 0) return "";
	if (text.length <= maxLength) return text;
	if (maxLength === 1) return "…";
	return `…${text.slice(-(maxLength - 1))}`;
}

function truncateTextKeepingHead(text: string, maxLength: number): string {
	if (maxLength <= 0) return "";
	if (text.length <= maxLength) return text;
	if (maxLength === 1) return "…";
	return `${text.slice(0, maxLength - 1)}…`;
}

export function buildOptionLabelWithInlineNote(
	baseOptionLabel: string,
	rawNote: string,
	isEditingNote: boolean,
	maxInlineLabelLength?: number,
	editingCursorIndex?: number,
	includeHardwareCursorMarker = false,
): string {
	const sanitizedNote = sanitizeNoteForInlineDisplay(rawNote);
	if (!isEditingNote && sanitizedNote.trim().length === 0) {
		return baseOptionLabel;
	}

	const labelPrefix = `${baseOptionLabel}${INLINE_NOTE_SEPARATOR}`;
	const inlineNote = isEditingNote
		? buildEditingInlineNote(rawNote, editingCursorIndex, includeHardwareCursorMarker)
		: sanitizedNote.trim();
	const inlineLabel = `${labelPrefix}${inlineNote}`;

	if (maxInlineLabelLength == null) {
		return inlineLabel;
	}

	return isEditingNote
		? truncateTextKeepingTail(inlineLabel, maxInlineLabelLength)
		: truncateTextKeepingHead(inlineLabel, maxInlineLabelLength);
}

export function buildWrappedOptionLabelWithInlineNote(
	baseOptionLabel: string,
	rawNote: string,
	isEditingNote: boolean,
	maxInlineLabelLength: number,
	wrapPadding = INLINE_NOTE_WRAP_PADDING,
	editingCursorIndex?: number,
	includeHardwareCursorMarker = false,
): string[] {
	const inlineLabel = buildOptionLabelWithInlineNote(
		baseOptionLabel,
		rawNote,
		isEditingNote,
		undefined,
		editingCursorIndex,
		includeHardwareCursorMarker,
	);
	const sanitizedWrapPadding = Number.isFinite(wrapPadding) ? Math.max(0, Math.floor(wrapPadding)) : 0;
	const sanitizedMaxInlineLabelLength = Number.isFinite(maxInlineLabelLength)
		? Math.max(1, Math.floor(maxInlineLabelLength))
		: 1;
	const wrapWidth = Math.max(1, sanitizedMaxInlineLabelLength - sanitizedWrapPadding);
	const wrappedLines = wrapTextWithAnsi(inlineLabel, wrapWidth);
	return wrappedLines.length > 0 ? wrappedLines : [""];
}
