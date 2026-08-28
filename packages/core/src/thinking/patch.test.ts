import { describe, it, expect, vi, afterEach } from "vitest";

// Symbols used by patch.ts to mark patched prototypes
const PATCHED_KEY = Symbol.for("archimedes:thinkingPatched");
const PATCH_VERSION_KEY = Symbol.for("archimedes:thinkingPatchVersion");

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
		vi.doMock("@earendil-works/pi-tui", () => ({
			Markdown: MockMarkdown,
			Spacer: MockSpacer,
			Text: MockText,
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
});
