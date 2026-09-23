import { Text } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { renderToolHeader, renderStatusLabel } from "@pi-archimedes/core/tool-render";
import { formatSelectionForSummary, type QuestionResult } from "./tool.js";

export type RenderContext = {
	lastComponent?: Component;
	isError?: boolean;
	expanded?: boolean;
	isPartial?: boolean;
};

export type RenderOptions = {
	expanded?: boolean;
	isPartial?: boolean;
};

function reuseText(context?: RenderContext): Text {
	return (context?.lastComponent instanceof Text
		? context.lastComponent
		: new Text("", 0, 0)) as Text;
}

function extractQuestionResults(result: unknown, context?: RenderContext): { results: QuestionResult[]; isCancelled: boolean; isError: boolean; errorMessage: string | undefined } {
	const r = result as { content?: Array<{ type: string; text?: string }>; details?: { results?: QuestionResult[]; id?: string; question?: string; description?: string; options?: string[]; multi?: boolean; selectedOptions?: string[]; customInput?: string } };
	
	let results: QuestionResult[] = [];
	if (r.details?.results && r.details.results.length > 0) {
		results = r.details.results;
	} else if (r.details?.id && r.details?.question) {
		results = [{
			id: r.details.id,
			question: r.details.question,
			description: r.details.description,
			options: r.details.options ?? [],
			multi: Boolean(r.details.multi),
			selectedOptions: r.details.selectedOptions ?? [],
			customInput: r.details.customInput,
		}];
	}

	const isCancelled = (results.length > 0 && results.every(res => res.selectedOptions.length === 0 && !res.customInput)) || 
						(r.content?.some(c => c.text?.match(/user cancelled the question/i)) ?? false);
	
	const isError = context?.isError === true || results.length === 0;
	const errorMessage = isError ? (r.content?.[0]?.text ?? "failed") : undefined;

	return { results, isCancelled, isError, errorMessage };
}

function formatExpandedBreakdown(results: QuestionResult[], isCancelled: boolean, theme: Theme): string {
	if (isCancelled) return theme.fg("error", "✗ (cancelled)");
	if (results.length === 0) return theme.fg("muted", "(no details)");

	return results.map(q => 
		`${theme.fg("dim", q.question)}\n  ${theme.fg("success", "✓")} ${theme.fg("toolOutput", formatSelectionForSummary(q))}`
	).join("\n\n");
}

export function renderAskCall(args: unknown, theme: Theme, context?: unknown): Text {
	const text = reuseText(context as RenderContext | undefined);
	try {
		text.setText(renderToolHeader("ask", undefined, theme));
	} catch {
		text.setText("ask");
	}
	return text;
}

export function renderAskResult(result: unknown, options: RenderOptions = {}, theme: Theme, context?: unknown): Text {
	const text = reuseText(context as RenderContext | undefined);
	const ctx = context as RenderContext | undefined;
	
	try {
		const expanded = options?.expanded ?? ctx?.expanded ?? false;
		const isPartial = options?.isPartial ?? ctx?.isPartial ?? false;
		const { results, isCancelled, isError, errorMessage } = extractQuestionResults(result, ctx);
		if (expanded) {
			if (isCancelled) {
				text.setText(formatExpandedBreakdown(results, true, theme));
			} else if (isError) {
				text.setText(theme.fg("error", errorMessage ?? "failed"));
			} else {
				text.setText(formatExpandedBreakdown(results, false, theme));
			}
		} else {
			if (isPartial) text.setText(renderStatusLabel("running", "waiting for input...", theme));
			else if (isCancelled) text.setText(renderStatusLabel("error", "(cancelled)", theme));
			else if (isError) text.setText(renderStatusLabel("error", errorMessage ?? "failed", theme));
			else if (results.length === 1) {
				const first = results[0];
				text.setText(renderStatusLabel("success", first ? formatSelectionForSummary(first) : "(unknown)", theme));
			} else if (results.length > 1) {
				const summary = results.map((r) => `${r.id}: ${formatSelectionForSummary(r)}`).join(", ");
				text.setText(renderStatusLabel("success", summary, theme));
			} else {
				text.setText(renderStatusLabel("error", "failed", theme));
			}
		}
	} catch (e) {
		text.setText("");
	}
	return text;
}
