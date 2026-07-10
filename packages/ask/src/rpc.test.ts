import { describe, expect, it } from "vitest";
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerAsk } from "./index.js";
import { askQuestionsWithRpcUi } from "./rpc.js";
import { hasAnsweredSelections, type AskQuestion } from "./selection.js";

function fakeUi(selectAnswers: Array<string | undefined>, inputAnswers: Array<string | undefined> = []) {
	const selectCalls: Array<{ title: string; options: string[] }> = [];
	const inputCalls: Array<{ title: string; placeholder?: string }> = [];
	let customCalls = 0;
	const ui = {
		async select(title: string, options: string[]) {
			selectCalls.push({ title, options });
			return selectAnswers.shift();
		},
		async input(title: string, placeholder?: string) {
			const inputCall: { title: string; placeholder?: string } = { title };
			if (placeholder !== undefined) inputCall.placeholder = placeholder;
			inputCalls.push(inputCall);
			return inputAnswers.shift();
		},
		async custom() {
			customCalls += 1;
			throw new Error("RPC fallback must not call custom()");
		},
	} as unknown as ExtensionUIContext;
	return { ui, selectCalls, inputCalls, get customCalls() { return customCalls; } };
}

const single: AskQuestion = {
	id: "approach",
	question: "Which approach?",
	description: "Choose the safest option.",
	options: [{ label: "Minimal" }, { label: "Broad" }],
	recommended: 0,
};

describe("registered ask tool RPC routing", () => {
	it("uses native select and input without calling custom UI in RPC mode", async () => {
		let askTool: ToolDefinition<any, any, any> | undefined;
		const pi = {
			on() {},
			registerTool(tool: ToolDefinition<any, any, any>) {
				askTool = tool;
			},
		};
		registerAsk(pi as unknown as ExtensionAPI);

		const fake = fakeUi(["Other (type your own)"], ["Use the RPC-native path"]);
		const rpcCtx = { mode: "rpc" as const, hasUI: true, ui: fake.ui } satisfies Pick<ExtensionContext, "mode" | "hasUI" | "ui">;

		const result = await askTool?.execute(
			"tool-call-1",
			{ questions: [single] },
			undefined,
			undefined,
			rpcCtx as unknown as ExtensionContext,
		);

		expect(result?.content[0]).toEqual(expect.objectContaining({ type: "text" }));
		expect(fake.selectCalls).toHaveLength(1);
		expect(fake.inputCalls).toHaveLength(1);
		expect(fake.customCalls).toBe(0);
		expect(result?.details).toEqual(expect.objectContaining({
			customInput: "Use the RPC-native path",
			selectedOptions: [],
		}));
	});
});

describe("askQuestionsWithRpcUi", () => {
	it("returns a single native selection and preserves description context", async () => {
		const { ui, selectCalls } = fakeUi(["Minimal (Recommended)"]);
		const result = await askQuestionsWithRpcUi(ui, [single]);
		expect(result).toEqual({ cancelled: false, selections: [{ selectedOptions: ["Minimal"] }] });
		expect(selectCalls[0]?.title).toContain("Which approach?");
		expect(selectCalls[0]?.title).toContain("Choose the safest option.");
	});

	it("collects Other text through input", async () => {
		const { ui } = fakeUi(["Other (type your own)"], ["A custom answer"]);
		await expect(askQuestionsWithRpcUi(ui, [single])).resolves.toEqual({
			cancelled: false,
			selections: [{ selectedOptions: [], customInput: "A custom answer" }],
		});
	});

	it("returns aligned empty selections when a sequential flow is cancelled", async () => {
		const second = { ...single, id: "second", question: "Second?" };
		const { ui } = fakeUi(["Minimal (Recommended)", undefined]);
		await expect(askQuestionsWithRpcUi(ui, [single, second])).resolves.toEqual({
			cancelled: true,
			selections: [{ selectedOptions: ["Minimal"] }, { selectedOptions: [] }],
		});
	});

	it("treats an earlier custom-only answer as answered when a later RPC question is cancelled", async () => {
		const second = { ...single, id: "second", question: "Second?" };
		const { ui } = fakeUi(["Other (type your own)", undefined], ["Use a custom approach"]);
		const result = await askQuestionsWithRpcUi(ui, [single, second]);

		expect(result).toEqual({
			cancelled: true,
			selections: [{ selectedOptions: [], customInput: "Use a custom approach" }, { selectedOptions: [] }],
		});
		expect(hasAnsweredSelections(result.selections)).toBe(true);
	});

	it("toggles RPC multi-select options and finishes explicitly", async () => {
		const multi = { ...single, multi: true };
		const { ui } = fakeUi(["☐ Minimal (Recommended)", "☐ Broad", "✓ Done"]);
		await expect(askQuestionsWithRpcUi(ui, [multi])).resolves.toEqual({
			cancelled: false,
			selections: [{ selectedOptions: ["Minimal", "Broad"] }],
		});
	});

	it("toggles a checked RPC multi-select option off", async () => {
		const multi = { ...single, multi: true };
		const { ui } = fakeUi(["☐ Minimal (Recommended)", "☑ Minimal (Recommended)", "☐ Broad", "✓ Done"]);
		await expect(askQuestionsWithRpcUi(ui, [multi])).resolves.toEqual({
			cancelled: false,
			selections: [{ selectedOptions: ["Broad"] }],
		});
	});

	it("toggles checked Other off without prompting again", async () => {
		const multi = { ...single, multi: true };
		const { ui, inputCalls } = fakeUi(
			["☐ Other (type your own)", "☑ Other (type your own)", "☐ Broad", "✓ Done"],
			["Custom"],
		);
		await expect(askQuestionsWithRpcUi(ui, [multi])).resolves.toEqual({
			cancelled: false,
			selections: [{ selectedOptions: ["Broad"] }],
		});
		expect(inputCalls).toHaveLength(1);
	});

	it("collects Other text during RPC multi-select", async () => {
		const multi = { ...single, multi: true };
		const { ui } = fakeUi(["☐ Other (type your own)", "✓ Done"], ["Custom"]);
		await expect(askQuestionsWithRpcUi(ui, [multi])).resolves.toEqual({
			cancelled: false,
			selections: [{ selectedOptions: [], customInput: "Custom" }],
		});
	});
});
