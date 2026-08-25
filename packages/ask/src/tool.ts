import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { getBus, Events } from "@pi-archimedes/core/bus";
import { connect } from "node:net";
import { randomUUID } from "node:crypto";
import { OTHER_OPTION, type AskQuestion } from "./selection.js";
import { askSingleQuestionWithInlineNote } from "./picker.js";
import { askQuestionsWithTabs } from "./dialog.js";

// ── Schemas ──────────────────────────────────────────────────────────────────

const OptionItemSchema = Type.Object({
	label: Type.String({ description: "Display label" }),
});

const QuestionItemSchema = Type.Object({
	id: Type.String({ description: "Question id (e.g. auth, cache, priority)" }),
	question: Type.String({ description: "Question text" }),
	description: Type.Optional(
		Type.String({
			description:
				"Optional context in Markdown/plain text. Rendered above options with wrapping (supports headings/lists/code blocks).",
		}),
	),
	options: Type.Array(OptionItemSchema, {
		description: "Available options. Do not include 'Other'.",
		minItems: 1,
	}),
	multi: Type.Optional(Type.Boolean({ description: "Allow multi-select" })),
	recommended: Type.Optional(
		Type.Number({ description: "0-indexed recommended option. '(Recommended)' is shown automatically." }),
	),
});

const AskParamsSchema = Type.Object({
	questions: Type.Array(QuestionItemSchema, { description: "Questions to ask", minItems: 1 }),
});

type AskParams = Static<typeof AskParamsSchema>;

// ── Types ────────────────────────────────────────────────────────────────────

export interface QuestionResult {
	id: string;
	question: string;
	description: string | undefined;
	options: string[];
	multi: boolean;
	selectedOptions: string[];
	customInput: string | undefined;
}

export interface AskToolDetails {
	id?: string;
	question?: string;
	description: string | undefined;
	options?: string[];
	multi?: boolean;
	selectedOptions?: string[];
	customInput: string | undefined;
	results?: QuestionResult[];
}

// ── Session-text helpers ─────────────────────────────────────────────────────

function sanitizeForSessionText(value: string): string {
	return value
		.replace(/[\r\n\t]/g, " ")
		.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
		.replace(/\s{2,}/g, " ")
		.trim();
}

function sanitizeMultilineForSessionText(value: string): string {
	return value
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.split("\n")
		.map((line) => sanitizeForSessionText(line))
		.join("\n")
		.trim();
}

function sanitizeOptionForSessionText(option: string): string {
	const sanitizedOption = sanitizeForSessionText(option);
	return sanitizedOption.length > 0 ? sanitizedOption : "(empty option)";
}

function toSessionSafeQuestionResult(result: QuestionResult): QuestionResult {
	const selectedOptions = result.selectedOptions
		.map((selectedOption) => sanitizeForSessionText(selectedOption))
		.filter((selectedOption) => selectedOption.length > 0);

	const rawDescription = result.description;
	const description = rawDescription == null ? undefined : sanitizeMultilineForSessionText(rawDescription);
	const rawCustomInput = result.customInput;
	const customInput = rawCustomInput == null ? undefined : sanitizeForSessionText(rawCustomInput);

	return {
		id: sanitizeForSessionText(result.id) || "(unknown)",
		question: sanitizeForSessionText(result.question) || "(empty question)",
		description: description && description.length > 0 ? description : undefined,
		options: result.options.map(sanitizeOptionForSessionText),
		multi: result.multi,
		selectedOptions,
		customInput: customInput && customInput.length > 0 ? customInput : undefined,
	};
}

function formatSelectionForSummary(result: QuestionResult): string {
	const hasSelectedOptions = result.selectedOptions.length > 0;
	const hasCustomInput = Boolean(result.customInput);

	if (!hasSelectedOptions && !hasCustomInput) {
		return "(cancelled)";
	}

	if (hasSelectedOptions && hasCustomInput) {
		const selectedPart = result.multi
			? `[${result.selectedOptions.join(", ")}]`
			: result.selectedOptions[0] ?? "";
		return `${selectedPart} + Other: "${result.customInput}"`;
	}

	if (hasCustomInput) {
		return `"${result.customInput}"`;
	}

	if (result.multi) {
		return `[${result.selectedOptions.join(", ")}]`;
	}

	return result.selectedOptions[0] ?? "";
}

function formatQuestionResult(result: QuestionResult): string {
	return `${result.id}: ${formatSelectionForSummary(result)}`;
}

function formatQuestionContext(result: QuestionResult, questionIndex: number): string {
	const lines: string[] = [`Question ${questionIndex + 1} (${result.id})`, `Prompt: ${result.question}`];

	if (result.description) {
		lines.push("Context:");
		for (const descriptionLine of result.description.split("\n")) {
			lines.push(`  ${descriptionLine}`);
		}
	}

	lines.push("Options:");
	lines.push(...result.options.map((option, optionIndex) => `  ${optionIndex + 1}. ${option}`));
	lines.push("Response:");

	const hasSelectedOptions = result.selectedOptions.length > 0;
	const hasCustomInput = Boolean(result.customInput);

	if (!hasSelectedOptions && !hasCustomInput) {
		lines.push("  Selected: (cancelled)");
		return lines.join("\n");
	}

	if (hasSelectedOptions) {
		const selectedText = result.multi
			? `[${result.selectedOptions.join(", ")}]`
			: result.selectedOptions[0];
		lines.push(`  Selected: ${selectedText}`);
	}

	if (hasCustomInput) {
		if (!hasSelectedOptions) {
			lines.push(`  Selected: ${OTHER_OPTION}`);
		}
		lines.push(`  Custom input: ${result.customInput}`);
	}

	return lines.join("\n");
}

export function buildAskSessionContent(results: QuestionResult[]): string {
	const safeResults = results.map(toSessionSafeQuestionResult);
	const summaryLines = safeResults.map(formatQuestionResult).join("\n");
	const contextBlocks = safeResults.map((result, index) => formatQuestionContext(result, index)).join("\n\n");
	return `User answers:\n${summaryLines}\n\nAnswer context:\n${contextBlocks}`;
}

// ── Tool description ─────────────────────────────────────────────────────────

const ASK_TOOL_DESCRIPTION = `
Ask the user for clarification when a choice materially affects the outcome.

- Use when multiple valid approaches have different trade-offs.
- Prefer 2-5 concise options.
- Use multi=true when multiple answers are valid.
- Use recommended=<index> (0-indexed) to mark the default option.
- Use description to provide Markdown/plain context (supports long explanations and structure diagrams).
- You can ask multiple related questions in one call using questions[].
- Do NOT include an 'Other' option; UI adds it automatically.
`.trim();

// ── Tool registration ────────────────────────────────────────────────────────

export function registerAskTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "ask",
		label: "Ask",
		description: ASK_TOOL_DESCRIPTION,
		parameters: AskParamsSchema,

		async execute(_toolCallId, params: AskParams, _signal, _onUpdate, ctx) {
			// Headless/subagent path: the child's ask tool connects to the parent's
			// PI_SUBAGENT_SOCKET bridge (created in subagent/spawn.ts:startAskSocketServer)
			// and exchanges ask_request/ask_response JSON lines.
			if (!ctx.hasUI) {
				const requestId = randomUUID();
				const socketPath = process.env.PI_SUBAGENT_SOCKET;

				const response = await new Promise<{
					cancelled: boolean;
					results: Array<{ id: string; selectedOptions: string[]; customInput?: string }>;
				}>((resolve) => {
					if (!socketPath) {
						resolve({ cancelled: true, results: params.questions.map((q) => ({ id: q.id, selectedOptions: [] })) });
						return;
					}

					let resolved = false;
					const finish = (r: { cancelled: boolean; results: Array<{ id: string; selectedOptions: string[]; customInput?: string }> }) => {
						if (resolved) return;
						resolved = true;
						clearTimeout(timer);
						resolve(r);
					};

					const socket = connect(socketPath, () => {
						// Connected — send the question to the parent
						socket.write(JSON.stringify({
							type: "ask_request",
							requestId,
							questions: params.questions,
						}) + "\n");
					});

					let buffer = "";
					socket.on("data", (data: Buffer) => {
						buffer += data.toString();
						const lines = buffer.split("\n");
						buffer = lines.pop() ?? "";
						for (const line of lines) {
							try {
								const msg = JSON.parse(line);
								if (msg.type === "ask_response" && msg.requestId === requestId) {
									socket.end();
									finish({ cancelled: msg.cancelled, results: msg.results });
								}
							} catch { /* ignore */ }
						}
					});

					socket.on("error", () => {
						finish({ cancelled: true, results: params.questions.map((q) => ({ id: q.id, selectedOptions: [] })) });
					});

					socket.on("close", () => {
						finish({ cancelled: true, results: params.questions.map((q) => ({ id: q.id, selectedOptions: [] })) });
					});

					// Timeout after 5 minutes
					const timer = setTimeout(() => {
						socket.end();
						finish({ cancelled: true, results: params.questions.map((q) => ({ id: q.id, selectedOptions: [] })) });
					}, 5 * 60 * 1000);
					timer.unref();
				});

				// Build results from response
				const results: QuestionResult[] = params.questions.map((q, i) => {
					const r = response.results[i];
					return {
						id: q.id,
						question: q.question,
						description: q.description && q.description.trim().length > 0 ? q.description : undefined,
						options: q.options.map((o) => o.label),
						multi: q.multi ?? false,
						selectedOptions: r?.selectedOptions ?? [],
						customInput: r?.customInput ?? undefined,
					};
				});

				if (response.cancelled && results.every((r) => r.selectedOptions.length === 0)) {
					return {
						content: [{ type: "text", text: "User cancelled the question." }],
						details: { results, customInput: undefined, description: undefined } satisfies AskToolDetails,
					};
				}

				return {
					content: [{ type: "text", text: buildAskSessionContent(results) }],
					details: { results, customInput: undefined, description: undefined } satisfies AskToolDetails,
				};
			}

			if (params.questions.length === 0) {
				return {
					content: [{ type: "text", text: "Error: questions must not be empty" }],
					details: {},
				};
			}

			// Emit bus event so notify (if installed) can schedule a desktop notification
			getBus().emit(Events.ASK_REQUEST, { source: "main", requestId: randomUUID(), questions: params.questions });

			if (params.questions.length === 1) {
				const q = params.questions[0]!;
				const selection = q.multi
					? (await askQuestionsWithTabs(ctx.ui, [q as AskQuestion])).selections[0] ?? { selectedOptions: [] }
					: await askSingleQuestionWithInlineNote(ctx.ui, q as AskQuestion);
				const optionLabels = q.options.map((option) => option.label);
				const desc = q.description && q.description.trim().length > 0 ? q.description : undefined;

				const result: QuestionResult = {
					id: q.id,
					question: q.question,
					description: desc,
					options: optionLabels,
					multi: q.multi ?? false,
					selectedOptions: selection.selectedOptions,
					customInput: selection.customInput,
				};

				const details: AskToolDetails = {
					id: q.id,
					question: q.question,
					description: desc,
					options: optionLabels,
					multi: q.multi ?? false,
					selectedOptions: selection.selectedOptions,
					customInput: selection.customInput,
					results: [result],
				};

				return {
					content: [{ type: "text", text: buildAskSessionContent([result]) }],
					details,
				};
			}

			const results: QuestionResult[] = [];
			const tabResult = await askQuestionsWithTabs(ctx.ui, params.questions as AskQuestion[]);
			for (let i = 0; i < params.questions.length; i++) {
				const q = params.questions[i]!;
				const selection = tabResult.selections[i] ?? { selectedOptions: [] };
				const desc = q.description && q.description.trim().length > 0 ? q.description : undefined;
				results.push({
					id: q.id,
					question: q.question,
					description: desc,
					options: q.options.map((option) => option.label),
					multi: q.multi ?? false,
					selectedOptions: selection.selectedOptions,
					customInput: selection.customInput,
				});
			}

			return {
				content: [{ type: "text", text: buildAskSessionContent(results) }],
				details: { results, customInput: undefined, description: undefined } satisfies AskToolDetails,
			};
		},
	});
}
