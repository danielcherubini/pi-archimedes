import { describe, it, expect, vi, afterEach } from "vitest";
import type { CompactThinking } from "../config.js";

// Symbols used by patch.ts to mark patched prototypes
const PATCHED_KEY = Symbol.for("archimedes:thinkingPatched");
const PATCH_VERSION_KEY = Symbol.for("archimedes:thinkingPatchVersion");
const THINKING_STATES_KEY = Symbol.for("archimedes:thinkingStateOverrides");

// Dynamic import after mocking the pi-coding-agent module
async function importPatch() {
	vi.resetModules();
	const mod = await import("./patch.js");
	return mod.patchThinkingRenderer;
}

describe("patchThinkingRenderer", () => {
	afterEach(() => {
		vi.resetModules();
	});

	it("returns early when AssistantMessageComponent is undefined", async () => {
		vi.doMock("@earendil-works/pi-coding-agent", () => ({
			AssistantMessageComponent: undefined,
			VERSION: "1.0.0",
			highlightCode: vi.fn(),
		}));

		const patch = await importPatch();
		// Should not throw
		patch(() => ({} as any));
	});

	it("returns early when prototype is null", async () => {
		const MockClass = function AssistantMessageComponent() {};
		MockClass.prototype = null;

		vi.doMock("@earendil-works/pi-coding-agent", () => ({
			AssistantMessageComponent: MockClass,
			VERSION: "1.0.0",
			highlightCode: vi.fn(),
		}));

		const patch = await importPatch();
		patch(() => ({} as any));
		// Prototype must still be null — no patching occurred
		expect(MockClass.prototype).toBeNull();
	});

	it("returns early when updateContent is not a function", async () => {
		const MockClass = function AssistantMessageComponent() {};
		MockClass.prototype.updateContent = "not a function";

		vi.doMock("@earendil-works/pi-coding-agent", () => ({
			AssistantMessageComponent: MockClass,
			VERSION: "1.0.0",
			highlightCode: vi.fn(),
		}));

		const patch = await importPatch();
		patch(() => ({} as any));
		// PATCHED_KEY must NOT be set — early return before patching
		expect(MockClass.prototype[PATCHED_KEY]).toBeUndefined();
	});

	it("returns early when class name does not match", async () => {
		const WrongName = function () {};
		WrongName.prototype.updateContent = function () {};

		vi.doMock("@earendil-works/pi-coding-agent", () => ({
			AssistantMessageComponent: WrongName,
			VERSION: "1.0.0",
			highlightCode: vi.fn(),
		}));

		const patch = await importPatch();
		patch(() => ({} as any));
		// PATCHED_KEY must NOT be set — name mismatch causes early return
		expect(WrongName.prototype[PATCHED_KEY]).toBeUndefined();
	});

	it("returns early when source lacks thinking check", async () => {
		const MockClass = function AssistantMessageComponent() {};
		MockClass.prototype.updateContent = function updateContent() {
			// Does NOT contain: content.type === "thinking"
			this.doSomething();
		};

		vi.doMock("@earendil-works/pi-coding-agent", () => ({
			AssistantMessageComponent: MockClass,
			VERSION: "1.0.0",
			highlightCode: vi.fn(),
		}));

		const patch = await importPatch();
		patch(() => ({} as any));
		// PATCHED_KEY must NOT be set — signature mismatch causes early return
		expect(MockClass.prototype[PATCHED_KEY]).toBeUndefined();
	});

	it("returns early when source lacks markdownTheme reference", async () => {
		const MockClass = function AssistantMessageComponent() {};
		MockClass.prototype.updateContent = function updateContent() {
			// Has thinking check but no markdownTheme
			if (this.content.type === "thinking") {
				this.render();
			}
		};

		vi.doMock("@earendil-works/pi-coding-agent", () => ({
			AssistantMessageComponent: MockClass,
			VERSION: "1.0.0",
			highlightCode: vi.fn(),
		}));

		const patch = await importPatch();
		patch(() => ({} as any));
		// PATCHED_KEY must NOT be set — signature mismatch causes early return
		expect(MockClass.prototype[PATCHED_KEY]).toBeUndefined();
	});

	it("patches successfully when signature matches", async () => {
		const MockClass = function AssistantMessageComponent() {};
		MockClass.prototype.updateContent = function updateContent() {
			if (this.content.type === "thinking") {
				this.markdownTheme.codeBlockIndent = "";
			}
		};

		vi.doMock("@earendil-works/pi-coding-agent", () => ({
			AssistantMessageComponent: MockClass,
			VERSION: "1.0.0",
			highlightCode: vi.fn(),
		}));

		const patch = await importPatch();
		patch(() => ({} as any));

		// The prototype should be marked as patched
		expect(MockClass.prototype[PATCHED_KEY]).toBe(true);
		expect(MockClass.prototype[PATCH_VERSION_KEY]).toBe("1.0.0");
	});

	it("marks prototype with correct version", async () => {
		const MockClass = function AssistantMessageComponent() {};
		MockClass.prototype.updateContent = function updateContent() {
			if (this.content.type === "thinking") {
				this.markdownTheme.codeBlockIndent = "";
			}
		};

		vi.doMock("@earendil-works/pi-coding-agent", () => ({
			AssistantMessageComponent: MockClass,
			VERSION: "2.5.0",
			highlightCode: vi.fn(),
		}));

		const patch = await importPatch();
		patch(() => ({} as any));

		expect(MockClass.prototype[PATCH_VERSION_KEY]).toBe("2.5.0");
	});

	it("re-patches when version changes", async () => {
		// First patch with version 1.0.0
		const MockClassV1 = function AssistantMessageComponent() {};
		MockClassV1.prototype.updateContent = function updateContent() {
			if (this.content.type === "thinking") {
				this.markdownTheme.codeBlockIndent = "";
			}
		};

		vi.doMock("@earendil-works/pi-coding-agent", () => ({
			AssistantMessageComponent: MockClassV1,
			VERSION: "1.0.0",
			highlightCode: vi.fn(),
		}));

		const patchV1 = await importPatch();
		patchV1(() => ({} as any));
		expect(MockClassV1.prototype[PATCH_VERSION_KEY]).toBe("1.0.0");

		// Now simulate a version change with a fresh class
		const MockClassV2 = function AssistantMessageComponent() {};
		MockClassV2.prototype.updateContent = function updateContent() {
			if (this.content.type === "thinking") {
				this.markdownTheme.codeBlockIndent = "";
			}
		};

		vi.doMock("@earendil-works/pi-coding-agent", () => ({
			AssistantMessageComponent: MockClassV2,
			VERSION: "2.0.0",
			highlightCode: vi.fn(),
		}));

		const patchV2 = await importPatch();
		patchV2(() => ({} as any));
		expect(MockClassV2.prototype[PATCH_VERSION_KEY]).toBe("2.0.0");
	});

	it("accepts a minified thinking-check variant (no whitespace around ===)", async () => {
		const MockClass = function AssistantMessageComponent() {};
		MockClass.prototype.updateContent = function updateContent() {
			// Minified dist-chunk shape: no whitespace around ===, single quotes
			const content = { type: "thinking" };
			if (content.type==="thinking") {
				this.markdownTheme.codeBlockIndent="";
			}
		};

		vi.doMock("@earendil-works/pi-coding-agent", () => ({
			AssistantMessageComponent: MockClass,
			VERSION: "1.0.0",
			highlightCode: vi.fn(),
		}));

		const patch = await importPatch();
		patch(() => ({} as any));

		// The minification-safe regex probe must accept the minified variant
		expect(MockClass.prototype[PATCHED_KEY]).toBe(true);
	});

	it("rejects a negated thinking check", async () => {
		const MockClass = function AssistantMessageComponent() {};
		MockClass.prototype.updateContent = function updateContent() {
			// pi 0.84.3's own minified chunk contains
			// `thinkingContent.type!=="thinking"` (inner batch-loop break). A source whose
			// ONLY thinking-relations are negations must NOT pass the probe.
			const content = { type: "thinking" };
			if (content.type!=="thinking") {
				this.markdownTheme.codeBlockIndent="";
			}
		};

		vi.doMock("@earendil-works/pi-coding-agent", () => ({
			AssistantMessageComponent: MockClass,
			VERSION: "1.0.0",
			highlightCode: vi.fn(),
		}));

		const patch = await importPatch();
		patch(() => ({} as any));

		// PATCHED_KEY must NOT be set — the probe must not match `!==`
		expect(MockClass.prototype[PATCHED_KEY]).toBeUndefined();
	});

	it("re-patches on same version to update getTheme closure", async () => {
		const MockClass = function AssistantMessageComponent() {};
		MockClass.prototype.updateContent = function updateContent() {
			if (this.content.type === "thinking") {
				this.markdownTheme.codeBlockIndent = "";
			}
		};

		vi.doMock("@earendil-works/pi-coding-agent", () => ({
			AssistantMessageComponent: MockClass,
			VERSION: "1.0.0",
			highlightCode: vi.fn(),
		}));

		const patch = await importPatch();

		// First patch
		patch(() => ({} as any));
		expect(MockClass.prototype[PATCHED_KEY]).toBe(true);
		const first = MockClass.prototype.updateContent;

		// Second patch (same version) — must produce a new function
		patch(() => ({} as any));
		expect(MockClass.prototype[PATCHED_KEY]).toBe(true);
		expect(MockClass.prototype[PATCH_VERSION_KEY]).toBe("1.0.0");
		// The patched function must be a new closure (not the same reference)
		expect(MockClass.prototype.updateContent).not.toBe(first);
	});

	// ── Configurable thinking label (issue #36) ────────────────────────────

	// Patches with a valid AssistantMessageComponent + mocked pi-tui so the
	// Markdown content rendered for a thinking block can be inspected.
	async function patchAndRender(
		config?: { labelText?: string; labelColor?: string },
		thinkingText = "Let me consider this carefully.",
	) {
		const MockClass = function AssistantMessageComponent() {};
		MockClass.prototype.updateContent = function updateContent() {
			if (this.content.type === "thinking") {
				this.markdownTheme.codeBlockIndent = "";
			}
		};

		vi.doMock("@earendil-works/pi-coding-agent", () => ({
			AssistantMessageComponent: MockClass,
			VERSION: "1.0.0",
			highlightCode: vi.fn(),
		}));

		const capturedMarkdown: any[] = [];
		class MockMarkdown {
			content: string;
			constructor(content: string, ..._rest: any[]) {
				this.content = content;
				capturedMarkdown.push(this);
			}
		}
		class MockSpacer {}
		class MockText {}
		class MockTruncatedText {}
		class MockMouseRegion {
			child: any;
			onMouse: any;
			constructor(child: any, onMouse: any) {
				this.child = child;
				this.onMouse = onMouse;
			}
		}
		vi.doMock("@earendil-works/pi-tui", () => ({
			Markdown: MockMarkdown,
			Spacer: MockSpacer,
			Text: MockText,
			TruncatedText: MockTruncatedText,
			MouseRegion: MockMouseRegion,
		}));

		vi.resetModules();
		const mod = await import("./patch.js");
		mod.patchThinkingRenderer(
			() => ({ getFgAnsi: () => "", fg: (_t: string, text: string) => text }) as any,
			config,
		);

		const instance = {
			contentContainer: { clear: vi.fn(), addChild: vi.fn() },
			isStreaming: false,
			markdownTheme: { codeBlockIndent: "" },
			markdownTransformers: [],
			hideThinkingBlock: false,
			outputPad: 1,
		};
		const message = {
			content: [{ type: "thinking", thinking: thinkingText }],
			stopReason: undefined,
		};
		MockClass.prototype.updateContent.call(instance, message, false);
		return capturedMarkdown;
	}

	it("uses configured labelText/labelColor for the thinking label", async () => {
		const captured = await patchAndRender({
			labelText: "Yapping...",
			labelColor: "255,215,0",
		});

		expect(captured).toHaveLength(1);
		expect(
			captured[0]!.content.startsWith("\x1b[1m\x1b[38;2;255;215;0mYapping...\x1b[39m\x1b[22m\n\n"),
		).toBe(true);
	});

	it("defaults to the original Thinking... label when no config is given", async () => {
		const captured = await patchAndRender();

		expect(captured).toHaveLength(1);
		// Byte-identical to the previous hardcoded THINKING_LABEL
		expect(
			captured[0]!.content.startsWith("\x1b[1m\x1b[38;2;255;215;0mThinking...\x1b[39m\x1b[22m\n\n"),
		).toBe(true);
	});

	it("trims whitespace from configured labelText and labelColor", async () => {
		const captured = await patchAndRender({
			labelText: "  Yapping...  ",
			labelColor: " 255, 215, 0 ",
		});

		expect(
			captured[0]!.content.startsWith("\x1b[1m\x1b[38;2;255;215;0mYapping...\x1b[39m\x1b[22m\n\n"),
		).toBe(true);
	});

	it("falls back to 255,215,0 when labelColor is not a valid RGB triple", async () => {
		const captured = await patchAndRender({
			labelText: "Hmm",
			labelColor: "not-a-color",
		});

		expect(
			captured[0]!.content.startsWith("\x1b[1m\x1b[38;2;255;215;0mHmm\x1b[39m\x1b[22m\n\n"),
		).toBe(true);
	});

	it("does not double-prepend the label when content already starts with it", async () => {
		const label = "\x1b[1m\x1b[38;2;255;215;0mYapping...\x1b[39m\x1b[22m";
		const captured = await patchAndRender(
			{ labelText: "Yapping...", labelColor: "255,215,0" },
			`${label}\n\nAlready labelled body.`,
		);

		expect(captured[0]!.content).toBe(`${label}\n\nAlready labelled body.`);
	});

	// ── Mouse click-to-toggle (MouseRegion) ─────────────────────────────

	async function renderThinkingComponent(options?: {
		hideThinkingBlock?: boolean;
		message?: any;
		isStreaming?: boolean;
		config?: {
			labelText?: string;
			labelColor?: string;
			autoCollapseThinking?: boolean;
			compactThinking?: CompactThinking;
		};
	}) {
		const MockClass = function AssistantMessageComponent() {};
		MockClass.prototype.updateContent = function updateContent() {
			if (this.content.type === "thinking") {
				this.markdownTheme.codeBlockIndent = "";
			}
		};

		vi.doMock("@earendil-works/pi-coding-agent", () => ({
			AssistantMessageComponent: MockClass,
			VERSION: "1.0.0",
			highlightCode: vi.fn(),
		}));

		class MockMarkdown {
			content: string;
			constructor(content: string, ..._rest: any[]) {
				this.content = content;
			}
		}
		class MockSpacer {}
		class MockText {
			text: string;
			constructor(text: string, ..._rest: any[]) {
				this.text = text;
			}
		}
		class MockTruncatedText {
			text: string;
			constructor(text: string, ..._rest: any[]) {
				this.text = text;
			}
		}
		class MockMouseRegion {
			child: any;
			onMouse: (event: any) => any;
			constructor(child: any, onMouse: (event: any) => any) {
				this.child = child;
				this.onMouse = onMouse;
			}
		}
		vi.doMock("@earendil-works/pi-tui", () => ({
			Markdown: MockMarkdown,
			Spacer: MockSpacer,
			Text: MockText,
			TruncatedText: MockTruncatedText,
			MouseRegion: MockMouseRegion,
		}));

		vi.resetModules();
		const mod = await import("./patch.js");
		mod.patchThinkingRenderer(
			() => ({ getFgAnsi: () => "", fg: (_t: string, text: string) => text, italic: (text: string) => text }) as any,
			options?.config,
		);

		const addedChildren: any[] = [];
		const instance: any = {
			contentContainer: {
				clear: vi.fn(),
				addChild: vi.fn((child: any) => {
					addedChildren.push(child);
				}),
			},
			isStreaming: false,
			markdownTheme: { codeBlockIndent: "" },
			markdownTransformers: [],
			hideThinkingBlock: options?.hideThinkingBlock ?? false,
			hiddenThinkingLabel: "Thinking...",
			outputPad: 1,
			updateContent: vi.fn(function (this: any, message: any, isStreaming?: boolean) {
				return MockClass.prototype.updateContent.call(this, message, isStreaming);
			}),
		};
		const message = options?.message ?? {
			content: [{ type: "thinking", thinking: "Testing thinking toggle" }],
			stopReason: undefined,
		};
		const isStreaming = options?.isStreaming ?? false;
		instance.updateContent(message, isStreaming);
		return { instance, addedChildren, MockMouseRegion, MockMarkdown, MockText, MockTruncatedText };
	}

	it("wraps expanded thinking block in MouseRegion with Markdown child", async () => {
		const { addedChildren, MockMouseRegion, MockMarkdown } = await renderThinkingComponent({
			hideThinkingBlock: false,
		});
		const mouseRegions = addedChildren.filter((c) => c instanceof MockMouseRegion);
		expect(mouseRegions).toHaveLength(1);
		expect(mouseRegions[0]!.child).toBeInstanceOf(MockMarkdown);
	});

	it("wraps hidden thinking block in MouseRegion with Text child", async () => {
		const { addedChildren, MockMouseRegion, MockText } = await renderThinkingComponent({
			hideThinkingBlock: true,
		});
		const mouseRegions = addedChildren.filter((c) => c instanceof MockMouseRegion);
		expect(mouseRegions).toHaveLength(1);
		expect(mouseRegions[0]!.child).toBeInstanceOf(MockText);
	});

	it("left-click toggles thinkingVisibilityOverrides and re-invokes updateContent", async () => {
		const { instance, addedChildren, MockMouseRegion } = await renderThinkingComponent({
			hideThinkingBlock: false,
		});
		const mouseRegion = addedChildren.find((c) => c instanceof MockMouseRegion);
		expect(mouseRegion).toBeDefined();

		expect(instance.thinkingVisibilityOverrides).toBeInstanceOf(Map);
		expect(instance.thinkingVisibilityOverrides.get(0)).toBeUndefined();

		const initialUpdateCalls = instance.updateContent.mock.calls.length;

		const result = mouseRegion!.onMouse({ type: "click", button: "left" });
		expect(result).toEqual({ handled: true });

		expect(instance.thinkingVisibilityOverrides.get(0)).toBe(true);
		expect(instance.updateContent).toHaveBeenCalledTimes(initialUpdateCalls + 1);
		expect(instance.updateContent).toHaveBeenLastCalledWith(instance.lastMessage);
	});

	it("left-click on hidden thinking block toggles override to false", async () => {
		const { instance, addedChildren, MockMouseRegion } = await renderThinkingComponent({
			hideThinkingBlock: true,
		});
		const mouseRegion = addedChildren.find((c) => c instanceof MockMouseRegion);
		expect(mouseRegion).toBeDefined();

		const result = mouseRegion!.onMouse({ type: "click", button: "left" });
		expect(result).toEqual({ handled: true });

		expect(instance.thinkingVisibilityOverrides.get(0)).toBe(false);
	});

	it("ignores non-left-click or non-click mouse events", async () => {
		const { instance, addedChildren, MockMouseRegion } = await renderThinkingComponent({
			hideThinkingBlock: false,
		});
		const mouseRegion = addedChildren.find((c) => c instanceof MockMouseRegion);
		expect(mouseRegion).toBeDefined();

		const callsBefore = instance.updateContent.mock.calls.length;

		expect(mouseRegion!.onMouse({ type: "click", button: "right" })).toBeUndefined();
		expect(mouseRegion!.onMouse({ type: "move" })).toBeUndefined();

		expect(instance.thinkingVisibilityOverrides.has(0)).toBe(false);
		expect(instance.updateContent).toHaveBeenCalledTimes(callsBefore);
	});

	it("tracks separate run indices for multiple thinking blocks", async () => {
		const message = {
			content: [
				{ type: "thinking", thinking: "First thought" },
				{ type: "text", text: "Answer 1" },
				{ type: "thinking", thinking: "Second thought" },
			],
		};
		const { instance, addedChildren, MockMouseRegion } = await renderThinkingComponent({
			hideThinkingBlock: false,
			message,
		});
		const mouseRegions = addedChildren.filter((c) => c instanceof MockMouseRegion);
		expect(mouseRegions).toHaveLength(2);

		mouseRegions[1]!.onMouse({ type: "click", button: "left" });
		expect(instance.thinkingVisibilityOverrides.get(0)).toBeUndefined();
		expect(instance.thinkingVisibilityOverrides.get(1)).toBe(true);
	});

	describe("autoCollapseThinking", () => {
		it("renders expanded Markdown while actively streaming thinking", async () => {
			const { addedChildren, MockMouseRegion, MockMarkdown } = await renderThinkingComponent({
				config: { autoCollapseThinking: true },
				isStreaming: true,
				message: {
					content: [{ type: "thinking", thinking: "Streamed thought" }],
				},
			});
			const mouseRegions = addedChildren.filter((c) => c instanceof MockMouseRegion);
			expect(mouseRegions).toHaveLength(1);
			expect(mouseRegions[0]!.child).toBeInstanceOf(MockMarkdown);
		});

		it("collapses to Text once streaming ends", async () => {
			const { addedChildren, MockMouseRegion, MockText } = await renderThinkingComponent({
				config: { autoCollapseThinking: true },
				isStreaming: false,
				message: {
					content: [{ type: "thinking", thinking: "Finished thought" }],
				},
			});
			const mouseRegions = addedChildren.filter((c) => c instanceof MockMouseRegion);
			expect(mouseRegions).toHaveLength(1);
			expect(mouseRegions[0]!.child).toBeInstanceOf(MockText);
		});

		it("collapses to Text during streaming when followed by text content", async () => {
			const { addedChildren, MockMouseRegion, MockText } = await renderThinkingComponent({
				config: { autoCollapseThinking: true },
				isStreaming: true,
				message: {
					content: [
						{ type: "thinking", thinking: "Completed thought" },
						{ type: "text", text: "Answer in progress..." },
					],
				},
			});
			const mouseRegions = addedChildren.filter((c) => c instanceof MockMouseRegion);
			expect(mouseRegions).toHaveLength(1);
			expect(mouseRegions[0]!.child).toBeInstanceOf(MockText);
		});

		it("collapses to Text during streaming when followed by toolCall", async () => {
			const { addedChildren, MockMouseRegion, MockText } = await renderThinkingComponent({
				config: { autoCollapseThinking: true },
				isStreaming: true,
				message: {
					content: [
						{ type: "thinking", thinking: "Completed thought" },
						{ type: "toolCall", id: "call_1", name: "bash", args: {} },
					],
				},
			});
			const mouseRegions = addedChildren.filter((c) => c instanceof MockMouseRegion);
			expect(mouseRegions).toHaveLength(1);
			expect(mouseRegions[0]!.child).toBeInstanceOf(MockText);
		});

		it("respects user click override when autoCollapseThinking is enabled", async () => {
			const { instance, addedChildren, MockMouseRegion, MockMarkdown } = await renderThinkingComponent({
				config: { autoCollapseThinking: true },
				isStreaming: false,
				message: {
					content: [{ type: "thinking", thinking: "Finished thought" }],
				},
			});
			const mouseRegion = addedChildren.find((c) => c instanceof MockMouseRegion);
			expect(mouseRegion).toBeDefined();

			// User clicks collapsed block to expand it
			mouseRegion!.onMouse({ type: "click", button: "left" });
			expect(instance.thinkingVisibilityOverrides.get(0)).toBe(false);

			// Re-render with override applied
			const childrenAfter: any[] = [];
			instance.contentContainer.addChild = vi.fn((c: any) => childrenAfter.push(c));
			instance.updateContent(instance.lastMessage, false);

			const regionAfter = childrenAfter.find((c) => c instanceof MockMouseRegion);
			expect(regionAfter!.child).toBeInstanceOf(MockMarkdown);
		});
	});

	describe("compactThinking", () => {
		const THINKING_LABEL = "\x1b[1m\x1b[38;2;255;215;0mThinking...\x1b[39m\x1b[22m";

		it("renders single inline TruncatedText containing label and last line for '1 line' (streaming and finished)", async () => {
			const multiline = "Line 1\nLine 2\nLine 3";

			// Streaming
			const streamingResult = await renderThinkingComponent({
				config: { compactThinking: "1 line" },
				isStreaming: true,
				message: { content: [{ type: "thinking", thinking: multiline }] },
			});
			const streamRegion = streamingResult.addedChildren.find((c) => c instanceof streamingResult.MockMouseRegion);
			expect(streamRegion).toBeDefined();
			expect(streamRegion!.child).toBeInstanceOf(streamingResult.MockTruncatedText);
			expect((streamRegion!.child as any).text).toBe(`${THINKING_LABEL} Line 3`);

			// Finished
			const finishedResult = await renderThinkingComponent({
				config: { compactThinking: "1 line" },
				isStreaming: false,
				message: { content: [{ type: "thinking", thinking: multiline }] },
			});
			const finishedRegion = finishedResult.addedChildren.find((c) => c instanceof finishedResult.MockMouseRegion);
			expect(finishedRegion).toBeDefined();
			expect(finishedRegion!.child).toBeInstanceOf(finishedResult.MockTruncatedText);
			expect((finishedRegion!.child as any).text).toBe(`${THINKING_LABEL} Line 3`);
		});

		it("renders multi-line Text containing label on line 1 and last 3 lines formatted line-by-line for '3 lines'", async () => {
			const text = "L1\nL2\nL3\nL4\nL5";
			const { addedChildren, MockMouseRegion, MockText } = await renderThinkingComponent({
				config: { compactThinking: "3 lines" },
				isStreaming: false,
				message: { content: [{ type: "thinking", thinking: text }] },
			});
			const region = addedChildren.find((c) => c instanceof MockMouseRegion);
			expect(region).toBeDefined();
			expect(region!.child).toBeInstanceOf(MockText);
			expect((region!.child as any).text).toBe(`${THINKING_LABEL}\nL3\nL4\nL5`);
		});

		it("renders multi-line Text containing label on line 1 and last 5 lines for '5 lines'", async () => {
			const text = "1\n2\n3\n4\n5\n6\n7";
			const { addedChildren, MockMouseRegion, MockText } = await renderThinkingComponent({
				config: { compactThinking: "5 lines" },
				isStreaming: false,
				message: { content: [{ type: "thinking", thinking: text }] },
			});
			const region = addedChildren.find((c) => c instanceof MockMouseRegion);
			expect(region).toBeDefined();
			expect(region!.child).toBeInstanceOf(MockText);
			expect((region!.child as any).text).toBe(`${THINKING_LABEL}\n3\n4\n5\n6\n7`);
		});

		it("displays all available lines when thinking text has fewer lines than compact limit", async () => {
			const text = "Alpha\nBeta";
			const { addedChildren, MockMouseRegion, MockText } = await renderThinkingComponent({
				config: { compactThinking: "5 lines" },
				isStreaming: false,
				message: { content: [{ type: "thinking", thinking: text }] },
			});
			const region = addedChildren.find((c) => c instanceof MockMouseRegion);
			expect(region).toBeDefined();
			expect(region!.child).toBeInstanceOf(MockText);
			expect((region!.child as any).text).toBe(`${THINKING_LABEL}\nAlpha\nBeta`);
		});

		it("collapses to hidden Text once streaming concludes when both compactThinking and autoCollapseThinking are active", async () => {
			// While streaming: renders compact
			const streamResult = await renderThinkingComponent({
				config: { compactThinking: "3 lines", autoCollapseThinking: true },
				isStreaming: true,
				message: { content: [{ type: "thinking", thinking: "A\nB\nC\nD" }] },
			});
			const streamRegion = streamResult.addedChildren.find((c) => c instanceof streamResult.MockMouseRegion);
			expect(streamRegion!.child).toBeInstanceOf(streamResult.MockText);
			expect((streamRegion!.child as any).text).toBe(`${THINKING_LABEL}\nB\nC\nD`);

			// Finished streaming: collapses to hidden label
			const finishedResult = await renderThinkingComponent({
				config: { compactThinking: "3 lines", autoCollapseThinking: true },
				isStreaming: false,
				message: { content: [{ type: "thinking", thinking: "A\nB\nC\nD" }] },
			});
			const finishedRegion = finishedResult.addedChildren.find((c) => c instanceof finishedResult.MockMouseRegion);
			expect(finishedRegion!.child).toBeInstanceOf(finishedResult.MockText);
			expect((finishedRegion!.child as any).text).toBe("Thinking..."); // this.hiddenThinkingLabel
		});

		it("transitions state properly on click with compact active: compact -> full -> compact", async () => {
			const { instance, addedChildren, MockMouseRegion, MockMarkdown, MockText } =
				await renderThinkingComponent({
					config: { compactThinking: "3 lines" },
					message: { content: [{ type: "thinking", thinking: "A\nB\nC" }] },
				});

			const mouseRegion = addedChildren.find((c) => c instanceof MockMouseRegion);
			expect(mouseRegion!.child).toBeInstanceOf(MockText);

			// First click: compact -> full
			mouseRegion!.onMouse({ type: "click", button: "left" });
			expect(instance[THINKING_STATES_KEY].get(0)).toBe("full");
			expect(instance.thinkingVisibilityOverrides.get(0)).toBe(false);

			const childrenAfterClick1: any[] = [];
			instance.contentContainer.addChild = vi.fn((c: any) => childrenAfterClick1.push(c));
			instance.updateContent(instance.lastMessage, false);

			const region1 = childrenAfterClick1.find((c) => c instanceof MockMouseRegion);
			expect(region1!.child).toBeInstanceOf(MockMarkdown);

			// Second click: full -> compact
			region1!.onMouse({ type: "click", button: "left" });
			expect(instance[THINKING_STATES_KEY].get(0)).toBe("compact");
			expect(instance.thinkingVisibilityOverrides.get(0)).toBe(false);

			const childrenAfterClick2: any[] = [];
			instance.contentContainer.addChild = vi.fn((c: any) => childrenAfterClick2.push(c));
			instance.updateContent(instance.lastMessage, false);

			const region2 = childrenAfterClick2.find((c) => c instanceof MockMouseRegion);
			expect(region2!.child).toBeInstanceOf(MockText);
			expect((region2!.child as any).text).toBe(`${THINKING_LABEL}\nA\nB\nC`);
		});

		it("transitions from hidden to full, and subsequent click returns to compact", async () => {
			const { instance, addedChildren, MockMouseRegion, MockMarkdown, MockText } =
				await renderThinkingComponent({
					config: { compactThinking: "3 lines", autoCollapseThinking: true },
					isStreaming: false,
					message: { content: [{ type: "thinking", thinking: "A\nB\nC" }] },
				});

			const mouseRegion = addedChildren.find((c) => c instanceof MockMouseRegion);
			expect(mouseRegion!.child).toBeInstanceOf(MockText);
			expect((mouseRegion!.child as any).text).toBe("Thinking..."); // Hidden state

			// First click on hidden: hidden -> full
			mouseRegion!.onMouse({ type: "click", button: "left" });
			expect(instance[THINKING_STATES_KEY].get(0)).toBe("full");
			expect(instance.thinkingVisibilityOverrides.get(0)).toBe(false);

			const childrenAfterClick1: any[] = [];
			instance.contentContainer.addChild = vi.fn((c: any) => childrenAfterClick1.push(c));
			instance.updateContent(instance.lastMessage, false);

			const region1 = childrenAfterClick1.find((c) => c instanceof MockMouseRegion);
			expect(region1!.child).toBeInstanceOf(MockMarkdown);

			// Second click: full -> compact
			region1!.onMouse({ type: "click", button: "left" });
			expect(instance[THINKING_STATES_KEY].get(0)).toBe("compact");
			expect(instance.thinkingVisibilityOverrides.get(0)).toBe(false);

			const childrenAfterClick2: any[] = [];
			instance.contentContainer.addChild = vi.fn((c: any) => childrenAfterClick2.push(c));
			instance.updateContent(instance.lastMessage, false);

			const region2 = childrenAfterClick2.find((c) => c instanceof MockMouseRegion);
			expect(region2!.child).toBeInstanceOf(MockText);
			expect((region2!.child as any).text).toBe(`${THINKING_LABEL}\nA\nB\nC`);
		});

		it("synchronizes thinkingVisibilityOverrides (false for compact/full, true for hidden)", async () => {
			const { instance, addedChildren, MockMouseRegion } = await renderThinkingComponent({
				config: { compactThinking: "3 lines", autoCollapseThinking: true },
				isStreaming: false, // will resolve to hidden initially
				message: { content: [{ type: "thinking", thinking: "Thought" }] },
			});

			const mouseRegion = addedChildren.find((c) => c instanceof MockMouseRegion);
			// Initially hidden because autoCollapseThinking is true and not streaming
			// Click to full
			mouseRegion!.onMouse({ type: "click", button: "left" });
			expect(instance[THINKING_STATES_KEY].get(0)).toBe("full");
			expect(instance.thinkingVisibilityOverrides.get(0)).toBe(false);

			// Re-render to get updated MouseRegion with state === "full"
			const childrenAfterClick1: any[] = [];
			instance.contentContainer.addChild = vi.fn((c: any) => childrenAfterClick1.push(c));
			instance.updateContent(instance.lastMessage, false);

			const region1 = childrenAfterClick1.find((c) => c instanceof MockMouseRegion);

			// Click to compact
			region1!.onMouse({ type: "click", button: "left" });
			expect(instance[THINKING_STATES_KEY].get(0)).toBe("compact");
			expect(instance.thinkingVisibilityOverrides.get(0)).toBe(false);
		});

		it("renders no MouseRegion child for whitespace-only thinking content", async () => {
			const { addedChildren, MockMouseRegion } = await renderThinkingComponent({
				config: { compactThinking: "3 lines" },
				isStreaming: false,
				message: { content: [{ type: "thinking", thinking: "   " }] },
			});
			const mouseRegions = addedChildren.filter((c) => c instanceof MockMouseRegion);
			expect(mouseRegions).toHaveLength(0);
		});
	});
});
