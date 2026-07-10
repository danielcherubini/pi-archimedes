import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
	OTHER_OPTION,
	appendRecommendedTagToOptionLabels,
	buildMultiSelectionResult,
	buildSingleSelectionResult,
	type AskQuestion,
	type AskSelection,
} from "./selection.js";

const DONE_OPTION = "✓ Done";

function questionTitle(question: AskQuestion): string {
	const description = question.description?.trim();
	return description ? `${question.question}\n\n${description}` : question.question;
}

async function askSingle(ui: ExtensionUIContext, question: AskQuestion): Promise<AskSelection | undefined> {
	const labels = appendRecommendedTagToOptionLabels(
		question.options.map((option) => option.label),
		question.recommended,
	);
	const selected = await ui.select(questionTitle(question), [...labels, OTHER_OPTION]);
	if (!selected) return undefined;
	if (selected !== OTHER_OPTION) return buildSingleSelectionResult(selected);
	const custom = await ui.input(question.question, "Type your answer");
	if (!custom?.trim()) return undefined;
	return buildSingleSelectionResult(OTHER_OPTION, custom);
}

async function askMulti(ui: ExtensionUIContext, question: AskQuestion): Promise<AskSelection | undefined> {
	const labels = [
		...appendRecommendedTagToOptionLabels(
			question.options.map((option) => option.label),
			question.recommended,
		),
		OTHER_OPTION,
	];
	const otherIndex = labels.length - 1;
	const selected = new Set<number>();
	const notes = Array(labels.length).fill("") as string[];

	while (true) {
		const choices = labels.map((label, index) => `${selected.has(index) ? "☑" : "☐"} ${label}`);
		if (selected.size > 0) choices.unshift(DONE_OPTION);
		const choice = await ui.select(questionTitle(question), choices);
		if (!choice) return undefined;
		if (choice === DONE_OPTION) {
			return buildMultiSelectionResult(labels, [...selected], notes, otherIndex);
		}
		const index = choices.indexOf(choice) - (selected.size > 0 ? 1 : 0);
		if (index < 0 || index >= labels.length) continue;
		if (selected.has(index)) {
			selected.delete(index);
			notes[index] = "";
			continue;
		}
		if (index === otherIndex) {
			const custom = await ui.input(question.question, "Type your answer");
			if (custom?.trim()) {
				notes[index] = custom;
				selected.add(index);
			}
			continue;
		}
		selected.add(index);
	}
}

export async function askQuestionsWithRpcUi(
	ui: ExtensionUIContext,
	questions: AskQuestion[],
): Promise<{ cancelled: boolean; selections: AskSelection[] }> {
	const selections: AskSelection[] = [];
	for (const question of questions) {
		const selection = question.multi ? await askMulti(ui, question) : await askSingle(ui, question);
		if (!selection) {
			while (selections.length < questions.length) selections.push({ selectedOptions: [] });
			return { cancelled: true, selections };
		}
		selections.push(selection);
	}
	return { cancelled: false, selections };
}
