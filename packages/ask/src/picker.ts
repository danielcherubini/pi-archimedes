import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	Markdown,
	type EditorTheme,
	type MarkdownTheme,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import {
	OTHER_OPTION,
	appendRecommendedTagToOptionLabels,
	buildSingleSelectionResult,
	type AskOption,
	type AskSelection,
} from "./selection.js";
import { getLinearCursorIndexFromEditor } from "./cursor.js";
import { INLINE_NOTE_WRAP_PADDING, buildWrappedOptionLabelWithInlineNote } from "./note.js";
import { appendWrappedTextLines } from "./wrap.js";

interface SingleQuestionInput {
	question: string;
	description?: string;
	options: AskOption[];
	recommended?: number;
}

interface InlineSelectionResult {
	cancelled: boolean;
	selectedOption?: string;
	note?: string;
}

function resolveInitialCursorIndexFromRecommendedOption(
	recommendedOptionIndex: number | undefined,
	optionCount: number,
): number {
	if (recommendedOptionIndex == null) return 0;
	if (recommendedOptionIndex < 0 || recommendedOptionIndex >= optionCount) return 0;
	return recommendedOptionIndex;
}

export async function askSingleQuestionWithInlineNote(
	ui: ExtensionUIContext,
	questionInput: SingleQuestionInput,
	options?: { overlay?: boolean },
): Promise<AskSelection> {
	const baseOptionLabels = questionInput.options.map((option) => option.label);
	const optionLabelsWithRecommendedTag = appendRecommendedTagToOptionLabels(
		baseOptionLabels,
		questionInput.recommended,
	);
	const selectableOptionLabels = [...optionLabelsWithRecommendedTag, OTHER_OPTION];
	const initialCursorIndex = resolveInitialCursorIndexFromRecommendedOption(
		questionInput.recommended,
		optionLabelsWithRecommendedTag.length,
	);

	const result = await ui.custom<InlineSelectionResult>((tui, theme, _keybindings, done) => {
		let cursorOptionIndex = initialCursorIndex;
		let isNoteEditorOpen = false;
		let cachedRenderedLines: string[] | undefined;
		let cachedRenderedWidth: number | undefined;
		const noteByOptionIndex = new Map<number, string>();

		const editorTheme: EditorTheme = {
			borderColor: (text) => theme.fg("accent", text),
			selectList: {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			},
		};
		const noteEditor = new Editor(tui, editorTheme);
		const markdownTheme: MarkdownTheme = {
			heading: (text) => theme.fg("mdHeading", text),
			link: (text) => theme.fg("mdLink", text),
			linkUrl: (text) => theme.fg("mdLinkUrl", text),
			code: (text) => theme.fg("mdCode", text),
			codeBlock: (text) => theme.fg("mdCodeBlock", text),
			codeBlockBorder: (text) => theme.fg("mdCodeBlockBorder", text),
			quote: (text) => theme.fg("mdQuote", text),
			quoteBorder: (text) => theme.fg("mdQuoteBorder", text),
			hr: (text) => theme.fg("mdHr", text),
			listBullet: (text) => theme.fg("mdListBullet", text),
			bold: (text) => theme.bold(text),
			italic: (text) => theme.italic(text),
			strikethrough: (text) => theme.strikethrough(text),
			underline: (text) => theme.underline(text),
		};
		const questionDescriptionMarkdown =
			questionInput.description && questionInput.description.trim().length > 0
				? new Markdown(questionInput.description, 0, 0, markdownTheme, {
						color: (text) => theme.fg("muted", text),
					})
				: undefined;

		const requestUiRerender = () => {
			cachedRenderedLines = undefined;
			cachedRenderedWidth = undefined;
			tui.requestRender();
		};

		const getRawNoteForOption = (optionIndex: number): string => noteByOptionIndex.get(optionIndex) ?? "";
		const getTrimmedNoteForOption = (optionIndex: number): string => getRawNoteForOption(optionIndex).trim();

		const loadCurrentNoteIntoEditor = () => {
			noteEditor.setText(getRawNoteForOption(cursorOptionIndex));
		};

		const openNoteEditorForCurrentOption = () => {
			if (isNoteEditorOpen) return;
			isNoteEditorOpen = true;
			loadCurrentNoteIntoEditor();
		};

		const saveCurrentNoteFromEditor = (value: string) => {
			noteByOptionIndex.set(cursorOptionIndex, value);
		};

		const submitCurrentSelection = (selectedOptionLabel: string, note: string) => {
			done({
				cancelled: false,
				selectedOption: selectedOptionLabel,
				note,
			});
		};

		noteEditor.onChange = (value) => {
			saveCurrentNoteFromEditor(value);
			requestUiRerender();
		};

		noteEditor.onSubmit = (value) => {
			saveCurrentNoteFromEditor(value);
			const selectedOptionLabel = selectableOptionLabels[cursorOptionIndex] ?? "";
			const trimmedNote = value.trim();

			if (selectedOptionLabel === OTHER_OPTION && !trimmedNote) {
				requestUiRerender();
				return;
			}

			submitCurrentSelection(selectedOptionLabel, trimmedNote);
		};

		const render = (width: number): string[] => {
			if (cachedRenderedLines && cachedRenderedWidth === width) return cachedRenderedLines;

			const renderedLines: string[] = [];
			const addLine = (line: string) => renderedLines.push(truncateToWidth(line, width));

			addLine(theme.fg("accent", "─".repeat(width)));
			appendWrappedTextLines(renderedLines, questionInput.question, width, {
				indent: 1,
				formatLine: (line) => theme.fg("text", line),
			});
			if (questionDescriptionMarkdown) {
				renderedLines.push("");
				const descriptionLines = questionDescriptionMarkdown.render(Math.max(1, width - 1));
				for (const descriptionLine of descriptionLines) {
					addLine(` ${descriptionLine}`);
				}
			}
			renderedLines.push("");

			const activeEditingCursorIndex = isNoteEditorOpen
				? getLinearCursorIndexFromEditor(noteEditor)
				: undefined;
			for (let optionIndex = 0; optionIndex < selectableOptionLabels.length; optionIndex++) {
				const optionLabel = selectableOptionLabels[optionIndex] ?? "";
				const isCursorOption = optionIndex === cursorOptionIndex;
				const isEditingThisOption = isNoteEditorOpen && isCursorOption;
				const cursorPrefixText = isCursorOption ? "→ " : "  ";
				const cursorPrefix = isCursorOption ? theme.fg("accent", cursorPrefixText) : cursorPrefixText;
				const bullet = isCursorOption ? "●" : "○";
				const markerText = `${bullet} `;
				const optionColor = isCursorOption ? "accent" : "text";
				const prefixWidth = visibleWidth(cursorPrefixText) + visibleWidth(markerText);
				const wrappedInlineLabelLines = buildWrappedOptionLabelWithInlineNote(
					optionLabel,
					getRawNoteForOption(optionIndex),
					isEditingThisOption,
					Math.max(1, width - prefixWidth),
					INLINE_NOTE_WRAP_PADDING,
					isEditingThisOption ? activeEditingCursorIndex : undefined,
					isEditingThisOption,
				);
				const continuationPrefix = " ".repeat(prefixWidth);
				addLine(`${cursorPrefix}${theme.fg(optionColor, `${markerText}${wrappedInlineLabelLines[0] ?? ""}`)}`);
				for (const wrappedLine of wrappedInlineLabelLines.slice(1)) {
					addLine(`${continuationPrefix}${theme.fg(optionColor, wrappedLine)}`);
				}
			}

			renderedLines.push("");

			if (isNoteEditorOpen) {
				addLine(theme.fg("dim", " Typing note inline • Enter submit • Tab/Esc stop editing"));
			} else if (getTrimmedNoteForOption(cursorOptionIndex).length > 0) {
				addLine(theme.fg("dim", " ↑↓ move • Enter submit • Tab edit note • Esc cancel"));
			} else {
				addLine(theme.fg("dim", " ↑↓ move • Enter submit • Tab add note • Esc cancel"));
			}

			addLine(theme.fg("accent", "─".repeat(width)));
			cachedRenderedLines = renderedLines;
			cachedRenderedWidth = width;
			return renderedLines;
		};

		const handleInput = (data: string) => {
			if (matchesKey(data, Key.ctrl("c"))) {
				done({ cancelled: true });
				return;
			}

			if (isNoteEditorOpen) {
				if (matchesKey(data, Key.tab) || matchesKey(data, Key.escape)) {
					isNoteEditorOpen = false;
					requestUiRerender();
					return;
				}

				if (
					(matchesKey(data, Key.up) || matchesKey(data, Key.down)) &&
					getTrimmedNoteForOption(cursorOptionIndex).length === 0
				) {
					isNoteEditorOpen = false;
				} else {
					noteEditor.handleInput(data);
					requestUiRerender();
					return;
				}
			}

			if (matchesKey(data, Key.up)) {
				cursorOptionIndex = Math.max(0, cursorOptionIndex - 1);
				if (selectableOptionLabels[cursorOptionIndex] === OTHER_OPTION) {
					openNoteEditorForCurrentOption();
				}
				requestUiRerender();
				return;
			}
			if (matchesKey(data, Key.down)) {
				cursorOptionIndex = Math.min(selectableOptionLabels.length - 1, cursorOptionIndex + 1);
				if (selectableOptionLabels[cursorOptionIndex] === OTHER_OPTION) {
					openNoteEditorForCurrentOption();
				}
				requestUiRerender();
				return;
			}

			if (matchesKey(data, Key.tab)) {
				openNoteEditorForCurrentOption();
				requestUiRerender();
				return;
			}

			if (matchesKey(data, Key.enter)) {
				const selectedOptionLabel = selectableOptionLabels[cursorOptionIndex] ?? "";
				const trimmedNote = getTrimmedNoteForOption(cursorOptionIndex);

				if (selectedOptionLabel === OTHER_OPTION && !trimmedNote) {
					isNoteEditorOpen = true;
					loadCurrentNoteIntoEditor();
					requestUiRerender();
					return;
				}

				submitCurrentSelection(selectedOptionLabel, trimmedNote);
				return;
			}

			if (matchesKey(data, Key.escape)) {
				done({ cancelled: true });
				return;
			}

			if (selectableOptionLabels[cursorOptionIndex] === OTHER_OPTION) {
				openNoteEditorForCurrentOption();
				noteEditor.handleInput(data);
				requestUiRerender();
				return;
			}
		};

		return {
			focused: true,
			render,
			invalidate: () => {
				cachedRenderedLines = undefined;
				cachedRenderedWidth = undefined;
			},
			handleInput,
		};
	}, options?.overlay ? { overlay: true } : undefined);

	if (!result || result.cancelled || !result.selectedOption) {
		return { selectedOptions: [] };
	}

	return buildSingleSelectionResult(result.selectedOption, result.note);
}
