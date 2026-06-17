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
	buildMultiSelectionResult,
	buildSingleSelectionResult,
	type AskQuestion,
	type AskSelection,
} from "./selection";
import { getLinearCursorIndexFromEditor } from "./cursor";
import { INLINE_NOTE_WRAP_PADDING, buildWrappedOptionLabelWithInlineNote } from "./note";
import { appendWrappedTextLines } from "./wrap";

interface PreparedQuestion {
	id: string;
	question: string;
	description: string | undefined;
	options: string[];
	tabLabel: string;
	multi: boolean;
	otherOptionIndex: number;
}

interface TabsUIState {
	cancelled: boolean;
	selectedOptionIndexesByQuestion: number[][];
	noteByQuestionByOption: string[][];
}

export function formatSelectionForSubmitReview(selection: AskSelection, isMulti: boolean): string {
	const hasSelectedOptions = selection.selectedOptions.length > 0;
	const hasCustomInput = Boolean(selection.customInput);

	if (hasSelectedOptions && hasCustomInput) {
		const selectedPart = isMulti
			? `[${selection.selectedOptions.join(", ")}]`
			: selection.selectedOptions[0] ?? "";
		return `${selectedPart} + Other: ${selection.customInput}`;
	}

	if (hasCustomInput) {
		return `Other: ${selection.customInput}`;
	}

	if (hasSelectedOptions) {
		return isMulti ? `[${selection.selectedOptions.join(", ")}]` : selection.selectedOptions[0] ?? "";
	}

	return "(not answered)";
}

function clampIndex(index: number | undefined, maxExclusive: number): number {
	if (index == null || Number.isNaN(index) || maxExclusive <= 0) return 0;
	if (index < 0) return 0;
	if (index >= maxExclusive) return maxExclusive - 1;
	return index;
}

function normalizeTabLabel(id: string, fallback: string): string {
	const normalized = id.trim().replace(/[_-]+/g, " ");
	return normalized.length > 0 ? normalized : fallback;
}

function buildSelectionForQuestion(
	question: PreparedQuestion,
	selectedOptionIndexes: number[],
	noteByOptionIndex: string[],
): AskSelection {
	if (selectedOptionIndexes.length === 0) {
		return { selectedOptions: [] };
	}

	if (question.multi) {
		return buildMultiSelectionResult(question.options, selectedOptionIndexes, noteByOptionIndex, question.otherOptionIndex);
	}

	const selectedOptionIndex = selectedOptionIndexes[0];
	if (selectedOptionIndex == null) return { selectedOptions: [] };
	const selectedOptionLabel = question.options[selectedOptionIndex] ?? OTHER_OPTION;
	const note = noteByOptionIndex[selectedOptionIndex] ?? "";
	return buildSingleSelectionResult(selectedOptionLabel, note);
}

function isQuestionSelectionValid(
	question: PreparedQuestion,
	selectedOptionIndexes: number[],
	noteByOptionIndex: string[],
): boolean {
	if (selectedOptionIndexes.length === 0) return false;
	if (!selectedOptionIndexes.includes(question.otherOptionIndex)) return true;
	const otherNote = noteByOptionIndex[question.otherOptionIndex]?.trim() ?? "";
	return otherNote.length > 0;
}

function createTabsUiStateSnapshot(
	cancelled: boolean,
	selectedOptionIndexesByQuestion: number[][],
	noteByQuestionByOption: string[][],
): TabsUIState {
	return {
		cancelled,
		selectedOptionIndexesByQuestion: selectedOptionIndexesByQuestion.map((indexes) => [...indexes]),
		noteByQuestionByOption: noteByQuestionByOption.map((notes) => [...notes]),
	};
}

function addIndexToSelection(selectedOptionIndexes: number[], optionIndex: number): number[] {
	if (selectedOptionIndexes.includes(optionIndex)) return selectedOptionIndexes;
	return [...selectedOptionIndexes, optionIndex].sort((a, b) => a - b);
}

function removeIndexFromSelection(selectedOptionIndexes: number[], optionIndex: number): number[] {
	return selectedOptionIndexes.filter((index) => index !== optionIndex);
}

export async function askQuestionsWithTabs(
	ui: ExtensionUIContext,
	questions: AskQuestion[],
): Promise<{ cancelled: boolean; selections: AskSelection[] }> {
	const preparedQuestions: PreparedQuestion[] = questions.map((question, questionIndex) => {
		const baseOptionLabels = question.options.map((option) => option.label);
		const optionLabels = [...appendRecommendedTagToOptionLabels(baseOptionLabels, question.recommended), OTHER_OPTION];
		return {
			id: question.id,
			question: question.question,
			description: question.description,
			options: optionLabels,
			tabLabel: normalizeTabLabel(question.id, `Q${questionIndex + 1}`),
			multi: question.multi === true,
			otherOptionIndex: optionLabels.length - 1,
		};
	});

	const initialCursorOptionIndexByQuestion = preparedQuestions.map((preparedQuestion, questionIndex) =>
		clampIndex(questions[questionIndex]?.recommended, preparedQuestion.options.length),
	);

	const result = await ui.custom<TabsUIState>((tui, theme, _keybindings, done) => {
		let activeTabIndex = 0;
		let isNoteEditorOpen = false;
		let cachedRenderedLines: string[] | undefined;
		let cachedRenderedWidth: number | undefined;
		const cursorOptionIndexByQuestion = [...initialCursorOptionIndexByQuestion];
		const selectedOptionIndexesByQuestion = preparedQuestions.map(() => [] as number[]);
		const noteByQuestionByOption = preparedQuestions.map((preparedQuestion) =>
			Array(preparedQuestion.options.length).fill("") as string[],
		);

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
		const descriptionMarkdownByQuestion = preparedQuestions.map((preparedQuestion) =>
			preparedQuestion.description && preparedQuestion.description.trim().length > 0
				? new Markdown(preparedQuestion.description, 0, 0, markdownTheme, {
						color: (text) => theme.fg("muted", text),
					})
				: undefined,
		);

		const submitTabIndex = preparedQuestions.length;

		const requestUiRerender = () => {
			cachedRenderedLines = undefined;
			cachedRenderedWidth = undefined;
			tui.requestRender();
		};

		const getActiveQuestionIndex = (): number | null => {
			if (activeTabIndex >= preparedQuestions.length) return null;
			return activeTabIndex;
		};

		const getPreparedQuestion = (questionIndex: number): PreparedQuestion =>
			preparedQuestions[questionIndex]!;

		const getCursorOptionIndex = (questionIndex: number): number =>
			cursorOptionIndexByQuestion[questionIndex] ?? 0;

		const getSelectedOptionIndexes = (questionIndex: number): number[] =>
			selectedOptionIndexesByQuestion[questionIndex] ?? [];

		const getQuestionNote = (questionIndex: number, optionIndex: number): string =>
			noteByQuestionByOption[questionIndex]?.[optionIndex] ?? "";

		const getTrimmedQuestionNote = (questionIndex: number, optionIndex: number): string =>
			getQuestionNote(questionIndex, optionIndex).trim();

		const isAllQuestionSelectionsValid = (): boolean =>
			preparedQuestions.every((preparedQuestion, questionIndex) =>
				isQuestionSelectionValid(
					preparedQuestion,
					selectedOptionIndexesByQuestion[questionIndex] ?? [],
					noteByQuestionByOption[questionIndex] ?? [],
				),
			);

		const openNoteEditorForActiveOption = () => {
			const questionIndex = getActiveQuestionIndex();
			if (questionIndex == null) return;

			isNoteEditorOpen = true;
			const optionIndex = getCursorOptionIndex(questionIndex);
			noteEditor.setText(getQuestionNote(questionIndex, optionIndex));
			requestUiRerender();
		};

		const advanceToNextTabOrSubmit = () => {
			activeTabIndex = Math.min(submitTabIndex, activeTabIndex + 1);
		};

		noteEditor.onChange = (value) => {
			const questionIndex = getActiveQuestionIndex();
			if (questionIndex == null) return;
			const optionIndex = getCursorOptionIndex(questionIndex);
			const notes = noteByQuestionByOption[questionIndex];
			if (notes) notes[optionIndex] = value;
			requestUiRerender();
		};

		noteEditor.onSubmit = (value) => {
			const questionIndex = getActiveQuestionIndex();
			if (questionIndex == null) return;

			const preparedQuestion = getPreparedQuestion(questionIndex);
			const optionIndex = getCursorOptionIndex(questionIndex);
			const notes = noteByQuestionByOption[questionIndex];
			if (notes) notes[optionIndex] = value;
			const trimmedNote = value.trim();

			if (preparedQuestion.multi) {
				if (trimmedNote.length > 0) {
					selectedOptionIndexesByQuestion[questionIndex] = addIndexToSelection(
						getSelectedOptionIndexes(questionIndex),
						optionIndex,
					);
				}
				if (optionIndex === preparedQuestion.otherOptionIndex && trimmedNote.length === 0) {
					requestUiRerender();
					return;
				}
				isNoteEditorOpen = false;
				requestUiRerender();
				return;
			}

			selectedOptionIndexesByQuestion[questionIndex] = [optionIndex];
			if (optionIndex === preparedQuestion.otherOptionIndex && trimmedNote.length === 0) {
				requestUiRerender();
				return;
			}

			isNoteEditorOpen = false;
			advanceToNextTabOrSubmit();
			requestUiRerender();
		};

		const renderTabs = (): string => {
			const tabParts: string[] = ["← "];
			for (let questionIndex = 0; questionIndex < preparedQuestions.length; questionIndex++) {
				const preparedQuestion = getPreparedQuestion(questionIndex);
				const isActiveTab = questionIndex === activeTabIndex;
				const isQuestionValid = isQuestionSelectionValid(
					preparedQuestion,
					getSelectedOptionIndexes(questionIndex),
					noteByQuestionByOption[questionIndex] ?? [],
				);
				const statusIcon = isQuestionValid ? "■" : "□";
				const tabLabel = ` ${statusIcon} ${preparedQuestion.tabLabel} `;
				const styledTabLabel = isActiveTab
					? theme.bg("selectedBg", theme.fg("text", tabLabel))
					: theme.fg(isQuestionValid ? "success" : "muted", tabLabel);
				tabParts.push(`${styledTabLabel} `);
			}

			const isSubmitTabActive = activeTabIndex === submitTabIndex;
			const canSubmit = isAllQuestionSelectionsValid();
			const submitLabel = " ✓ Submit ";
			const styledSubmitLabel = isSubmitTabActive
				? theme.bg("selectedBg", theme.fg("text", submitLabel))
				: theme.fg(canSubmit ? "success" : "dim", submitLabel);
			tabParts.push(`${styledSubmitLabel} →`);
			return tabParts.join("");
		};

		const renderSubmitTab = (width: number, renderedLines: string[]): void => {
			const addLine = (line: string) => renderedLines.push(truncateToWidth(line, width));

			addLine(theme.fg("accent", theme.bold(" Review answers")));
			renderedLines.push("");

			for (let questionIndex = 0; questionIndex < preparedQuestions.length; questionIndex++) {
				const preparedQuestion = getPreparedQuestion(questionIndex);
				const selection = buildSelectionForQuestion(
					preparedQuestion,
					getSelectedOptionIndexes(questionIndex),
					noteByQuestionByOption[questionIndex] ?? [],
				);
				const value = formatSelectionForSubmitReview(selection, preparedQuestion.multi);
				const isValid = isQuestionSelectionValid(
					preparedQuestion,
					getSelectedOptionIndexes(questionIndex),
					noteByQuestionByOption[questionIndex] ?? [],
				);
				const statusIcon = isValid ? theme.fg("success", "●") : theme.fg("warning", "○");
				addLine(` ${statusIcon} ${theme.fg("muted", `${preparedQuestion.tabLabel}:`)} ${theme.fg("text", value)}`);
			}

			renderedLines.push("");
			if (isAllQuestionSelectionsValid()) {
				addLine(theme.fg("success", " Press Enter to submit"));
			} else {
				const missingQuestions = preparedQuestions
					.filter((preparedQuestion, questionIndex) =>
						!isQuestionSelectionValid(
							preparedQuestion,
							getSelectedOptionIndexes(questionIndex),
							noteByQuestionByOption[questionIndex] ?? [],
						),
					)
					.map((preparedQuestion) => preparedQuestion.tabLabel)
					.join(", ");
				addLine(theme.fg("warning", ` Complete required answers: ${missingQuestions}`));
			}
			addLine(theme.fg("dim", " ←/→ switch tabs • Esc cancel"));
		};

		const renderQuestionTab = (width: number, renderedLines: string[], questionIndex: number): void => {
			const addLine = (line: string) => renderedLines.push(truncateToWidth(line, width));
			const preparedQuestion = getPreparedQuestion(questionIndex);
			const cursorOptionIndex = getCursorOptionIndex(questionIndex);
			const selectedOptionIndexes = getSelectedOptionIndexes(questionIndex);

			appendWrappedTextLines(renderedLines, preparedQuestion.question, width, {
				indent: 1,
				formatLine: (line) => theme.fg("text", line),
			});
			const questionDescriptionMarkdown = descriptionMarkdownByQuestion[questionIndex];
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
			for (let optionIndex = 0; optionIndex < preparedQuestion.options.length; optionIndex++) {
				const optionLabel = preparedQuestion.options[optionIndex] ?? "";
				const isCursorOption = optionIndex === cursorOptionIndex;
				const isOptionSelected = selectedOptionIndexes.includes(optionIndex);
				const isEditingThisOption = isNoteEditorOpen && isCursorOption;
				const cursorPrefixText = isCursorOption ? "→ " : "  ";
				const cursorPrefix = isCursorOption ? theme.fg("accent", cursorPrefixText) : cursorPrefixText;
				const markerText = preparedQuestion.multi
					? `${isOptionSelected ? "[x]" : "[ ]"} `
					: `${isOptionSelected ? "●" : "○"} `;
				const optionColor = isCursorOption ? "accent" : isOptionSelected ? "success" : "text";
				const prefixWidth = visibleWidth(cursorPrefixText) + visibleWidth(markerText);
				const wrappedInlineLabelLines = buildWrappedOptionLabelWithInlineNote(
					optionLabel,
					getQuestionNote(questionIndex, optionIndex),
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
				addLine(theme.fg("dim", " Typing note inline • Enter save note • Tab/Esc stop editing"));
			} else {
				if (preparedQuestion.multi) {
					addLine(
						theme.fg(
							"dim",
							" ↑↓ move • Space toggle/select • Enter next • Tab add note • ←/→ switch tabs • Esc cancel",
						),
					);
				} else {
					addLine(
						theme.fg("dim", " ↑↓ move • Space/Enter select • Tab add note • ←/→ switch tabs • Esc cancel"),
					);
				}
			}
		};

		const render = (width: number): string[] => {
			if (cachedRenderedLines && cachedRenderedWidth === width) return cachedRenderedLines;

			const renderedLines: string[] = [];
			const addLine = (line: string) => renderedLines.push(truncateToWidth(line, width));

			addLine(theme.fg("accent", "─".repeat(width)));
			addLine(` ${renderTabs()}`);
			renderedLines.push("");

			if (activeTabIndex === submitTabIndex) {
				renderSubmitTab(width, renderedLines);
			} else {
				renderQuestionTab(width, renderedLines, activeTabIndex);
			}

			addLine(theme.fg("accent", "─".repeat(width)));
			cachedRenderedLines = renderedLines;
			cachedRenderedWidth = width;
			return renderedLines;
		};

		const handleInput = (data: string) => {
			if (matchesKey(data, Key.ctrl("c"))) {
				done(createTabsUiStateSnapshot(true, selectedOptionIndexesByQuestion, noteByQuestionByOption));
				return;
			}

			if (isNoteEditorOpen) {
				if (matchesKey(data, Key.tab) || matchesKey(data, Key.escape)) {
					isNoteEditorOpen = false;
					requestUiRerender();
					return;
				}

				const questionIndex = getActiveQuestionIndex();
				const cursorOptionIndex = questionIndex == null ? 0 : getCursorOptionIndex(questionIndex);
				const noteIsEmpty = questionIndex == null || getTrimmedQuestionNote(questionIndex, cursorOptionIndex).length === 0;
				if (
					noteIsEmpty &&
					(matchesKey(data, Key.up) || matchesKey(data, Key.down) || matchesKey(data, Key.left) || matchesKey(data, Key.right))
				) {
					isNoteEditorOpen = false;
				} else {
					noteEditor.handleInput(data);
					requestUiRerender();
					return;
				}
			}

			if (matchesKey(data, Key.left)) {
				activeTabIndex = (activeTabIndex - 1 + preparedQuestions.length + 1) % (preparedQuestions.length + 1);
				const qIdx = getActiveQuestionIndex();
				if (qIdx != null) {
					const preparedQuestion = getPreparedQuestion(qIdx);
					const optIdx = getCursorOptionIndex(qIdx);
					if (preparedQuestion.options[optIdx] === OTHER_OPTION) {
						openNoteEditorForActiveOption();
						return;
					}
				}
				requestUiRerender();
				return;
			}

			if (matchesKey(data, Key.right)) {
				activeTabIndex = (activeTabIndex + 1) % (preparedQuestions.length + 1);
				const qIdx = getActiveQuestionIndex();
				if (qIdx != null) {
					const preparedQuestion = getPreparedQuestion(qIdx);
					const optIdx = getCursorOptionIndex(qIdx);
					if (preparedQuestion.options[optIdx] === OTHER_OPTION) {
						openNoteEditorForActiveOption();
						return;
					}
				}
				requestUiRerender();
				return;
			}

			if (activeTabIndex === submitTabIndex) {
				if (matchesKey(data, Key.enter) && isAllQuestionSelectionsValid()) {
					done(createTabsUiStateSnapshot(false, selectedOptionIndexesByQuestion, noteByQuestionByOption));
					return;
				}
				if (matchesKey(data, Key.escape)) {
					done(createTabsUiStateSnapshot(true, selectedOptionIndexesByQuestion, noteByQuestionByOption));
				}
				return;
			}

			const questionIndex = activeTabIndex;
			const preparedQuestion = getPreparedQuestion(questionIndex);

			if (matchesKey(data, Key.up)) {
				cursorOptionIndexByQuestion[questionIndex] = Math.max(0, getCursorOptionIndex(questionIndex) - 1);
				if (preparedQuestion.options[getCursorOptionIndex(questionIndex)] === OTHER_OPTION) {
					openNoteEditorForActiveOption();
					return;
				}
				requestUiRerender();
				return;
			}

			if (matchesKey(data, Key.down)) {
				cursorOptionIndexByQuestion[questionIndex] = Math.min(
					preparedQuestion.options.length - 1,
					getCursorOptionIndex(questionIndex) + 1,
				);
				if (preparedQuestion.options[getCursorOptionIndex(questionIndex)] === OTHER_OPTION) {
					openNoteEditorForActiveOption();
					return;
				}
				requestUiRerender();
				return;
			}

			if (matchesKey(data, Key.tab)) {
				openNoteEditorForActiveOption();
				return;
			}

			if (matchesKey(data, Key.space)) {
				const cursorOptionIndex = getCursorOptionIndex(questionIndex);

				if (preparedQuestion.multi) {
					const currentlySelected = getSelectedOptionIndexes(questionIndex);
					if (currentlySelected.includes(cursorOptionIndex)) {
						selectedOptionIndexesByQuestion[questionIndex] = removeIndexFromSelection(currentlySelected, cursorOptionIndex);
					} else {
						selectedOptionIndexesByQuestion[questionIndex] = addIndexToSelection(currentlySelected, cursorOptionIndex);
					}

					if (
						cursorOptionIndex === preparedQuestion.otherOptionIndex &&
						getSelectedOptionIndexes(questionIndex).includes(cursorOptionIndex) &&
						getTrimmedQuestionNote(questionIndex, cursorOptionIndex).length === 0
					) {
						openNoteEditorForActiveOption();
						return;
					}

					requestUiRerender();
					return;
				}

				selectedOptionIndexesByQuestion[questionIndex] = [cursorOptionIndex];
				if (
					cursorOptionIndex === preparedQuestion.otherOptionIndex &&
					getTrimmedQuestionNote(questionIndex, cursorOptionIndex).length === 0
				) {
					openNoteEditorForActiveOption();
					return;
				}

				requestUiRerender();
				return;
			}

			if (matchesKey(data, Key.enter)) {
				const cursorOptionIndex = getCursorOptionIndex(questionIndex);

				if (preparedQuestion.multi) {
					if (
						cursorOptionIndex === preparedQuestion.otherOptionIndex &&
						getSelectedOptionIndexes(questionIndex).includes(cursorOptionIndex) &&
						getTrimmedQuestionNote(questionIndex, cursorOptionIndex).length === 0
					) {
						openNoteEditorForActiveOption();
						return;
					}

					advanceToNextTabOrSubmit();
					requestUiRerender();
					return;
				}

				selectedOptionIndexesByQuestion[questionIndex] = [cursorOptionIndex];
				if (
					cursorOptionIndex === preparedQuestion.otherOptionIndex &&
					getTrimmedQuestionNote(questionIndex, cursorOptionIndex).length === 0
				) {
					openNoteEditorForActiveOption();
					return;
				}

				advanceToNextTabOrSubmit();
				requestUiRerender();
				return;
			}

			if (matchesKey(data, Key.escape)) {
				done(createTabsUiStateSnapshot(true, selectedOptionIndexesByQuestion, noteByQuestionByOption));
				return;
			}

			const currentCursorOptIdx = getCursorOptionIndex(questionIndex);
			if (preparedQuestion.options[currentCursorOptIdx] === OTHER_OPTION) {
				openNoteEditorForActiveOption();
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
	});

	if (result.cancelled) {
		return {
			cancelled: true,
			selections: preparedQuestions.map(() => ({ selectedOptions: [] } satisfies AskSelection)),
		};
	}

	const selections = preparedQuestions.map((preparedQuestion, questionIndex) =>
		buildSelectionForQuestion(
			preparedQuestion,
			result.selectedOptionIndexesByQuestion[questionIndex] ?? [],
			result.noteByQuestionByOption[questionIndex] ?? Array(preparedQuestion.options.length).fill(""),
		),
	);

	return { cancelled: result.cancelled, selections };
}
