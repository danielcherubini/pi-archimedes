import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getBus, Events } from "@pi-archimedes/core/bus";
import { type AskQuestion, type AskSelection } from "./selection.js";
import { askSingleQuestionWithInlineNote } from "./picker.js";
import { askQuestionsWithTabs } from "./dialog.js";

export function registerIpcRelay(
	pi: ExtensionAPI,
	getCtx: () => ExtensionContext | undefined,
	unsubscribes: Array<() => void>,
): void {
	const unsubAskRequest = getBus().on(Events.ASK_REQUEST, async (payload: unknown) => {
		const data = payload as {
			source: string;
			requestId: string;
			questions: AskQuestion[];
		};

		// Skip main agent — it shows its own UI in the tool handler
		if (data.source === "main") return;

		if (!data.questions || data.questions.length === 0) return;

		// Defer to next tick so TUI can process current state
		await new Promise((resolve) => setImmediate(resolve));
		await handleAskRequest(data, getCtx);
	});
	unsubscribes.push(unsubAskRequest);
}

async function handleAskRequest(
	data: {
		requestId: string;
		questions: AskQuestion[];
	},
	getCtx: () => ExtensionContext | undefined,
): Promise<void> {
	const ctx = getCtx();
	if (!ctx?.ui) return;

	const questions = data.questions;
	let cancelled = true;
	let selections: AskSelection[] = [];

	try {
		if (questions.length === 1) {
			const q = questions[0]!;
			if (q.multi) {
				// Multi-select single question routes to the tabs dialog (picker doesn't support multi)
				const res = await askQuestionsWithTabs(ctx.ui, questions);
				cancelled = res.cancelled;
				selections = res.selections;
			} else {
				const input: { question: string; description?: string; options: typeof q.options; recommended?: number } = {
					question: q.question,
					options: q.options,
				};
				if (q.description && q.description.trim().length > 0) input.description = q.description;
				if (q.recommended != null) input.recommended = q.recommended;
				const sel = await askSingleQuestionWithInlineNote(ctx.ui, input);
				selections = [sel];
				cancelled = sel.selectedOptions.length === 0 && !sel.customInput;
			}
		} else {
			const res = await askQuestionsWithTabs(ctx.ui, questions);
			cancelled = res.cancelled;
			selections = res.selections;
		}
	} catch {
		cancelled = true;
		selections = questions.map(() => ({ selectedOptions: [] }));
	}

	// Build results matching the request's questions
	const results = questions.map((q, i) => ({
		id: q.id,
		selectedOptions: selections[i]?.selectedOptions ?? [],
		customInput: selections[i]?.customInput,
	}));

	// Emit on bus — parent's streamEvents writes to child socket
	getBus().emit(Events.ASK_RESPONSE, {
		requestId: data.requestId,
		cancelled,
		results,
	});
}
