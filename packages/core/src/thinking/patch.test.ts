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
		// No patching should occur — proto is null
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
		// Name is "WrongName", not "AssistantMessageComponent" — should skip
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
		// Signature mismatch — no thinking check in source
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
		// Signature mismatch — no markdownTheme in source
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

		// Second patch (same version) — should still re-patch the function
		patch(() => ({} as any));
		expect(MockClass.prototype[PATCHED_KEY]).toBe(true);
		expect(MockClass.prototype[PATCH_VERSION_KEY]).toBe("1.0.0");
	});
});
