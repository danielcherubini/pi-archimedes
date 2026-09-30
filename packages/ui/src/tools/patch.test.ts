import { describe, it, expect, vi, afterEach } from "vitest";

// Symbols used by patch.ts to mark patched instances
const TOOL_FRESH_KEY = Symbol.for("archimedes:toolFresh");

// Dynamic import after mocking the pi-coding-agent module
async function importPatch() {
	vi.resetModules();
	const mod = await import("./patch.js");
	return mod.patchToolRenderer;
}

// Build a mock ToolExecutionComponent whose prototype.updateDisplay/setExpanded
// are spies. `setExpanded` writes `this.expanded` (the native write path), so
// "respected" calls are observable on a plain fake instance.
function mockToolComponent(opts?: {
	updateDisplay?: boolean;
	setExpanded?: boolean;
	undefinedClass?: boolean;
}) {
	const origUpdateDisplay = vi.fn(function (this: any) {
		// native updateDisplay — no-op for the test
	});
	const origSetExpanded = vi.fn(function (this: any, expanded: boolean) {
		this.expanded = expanded;
	});
	const MockClass = function ToolExecutionComponent() {};
	if (opts?.updateDisplay !== false) MockClass.prototype.updateDisplay = origUpdateDisplay;
	if (opts?.setExpanded !== false) MockClass.prototype.setExpanded = origSetExpanded;
	vi.doMock("@earendil-works/pi-coding-agent", () => ({
		ToolExecutionComponent: opts?.undefinedClass ? undefined : MockClass,
	}));
	return { MockClass, origUpdateDisplay, origSetExpanded };
}

describe("patchToolRenderer", () => {
	afterEach(() => {
		vi.resetModules();
	});

	// (a) the patch replaces both prototype methods
	it("replaces proto.updateDisplay and proto.setExpanded under Full", async () => {
		const { MockClass, origUpdateDisplay, origSetExpanded } = mockToolComponent();
		const patch = await importPatch();
		patch({ toolStyle: "Full" });

		expect(MockClass.prototype.updateDisplay).not.toBe(origUpdateDisplay);
		expect(MockClass.prototype.setExpanded).not.toBe(origSetExpanded);
		expect(typeof MockClass.prototype.updateDisplay).toBe("function");
		expect(typeof MockClass.prototype.setExpanded).toBe("function");
	});

	// (b) a fresh tool auto-expands under Full
	it("auto-expands a fresh tool on updateDisplay under Full", async () => {
		const { MockClass } = mockToolComponent();
		const patch = await importPatch();
		patch({ toolStyle: "Full" });

		const instance = { expanded: false } as any;
		MockClass.prototype.updateDisplay.call(instance);
		expect(instance.expanded).toBe(true);
	});

	// (c) pi's construction sequence: the programmatic setExpanded(false) right
	// after construction must NOT collapse the auto-expanded tool
	it("survives pi's construction sequence: updateDisplay -> setExpanded(false) -> updateDisplay stays expanded", async () => {
		const { MockClass, origSetExpanded } = mockToolComponent();
		const patch = await importPatch();
		patch({ toolStyle: "Full" });

		const instance = { expanded: false } as any;
		MockClass.prototype.updateDisplay.call(instance); // constructor's updateDisplay
		expect(instance.expanded).toBe(true);

		MockClass.prototype.setExpanded.call(instance, false); // pi's construction default
		expect(instance.expanded).toBe(true); // ignored

		MockClass.prototype.updateDisplay.call(instance); // next state change
		expect(instance.expanded).toBe(true); // still expanded, NOT collapsed
		expect(origSetExpanded).not.toHaveBeenCalled(); // the only setExpanded was ignored
	});

	// (d) a user collapse sticks
	it("respects a second setExpanded(false) (user collapse sticks, no re-expand)", async () => {
		const { MockClass } = mockToolComponent();
		const patch = await importPatch();
		patch({ toolStyle: "Full" });

		const instance = { expanded: false } as any;
		MockClass.prototype.updateDisplay.call(instance);
		expect(instance.expanded).toBe(true);

		MockClass.prototype.setExpanded.call(instance, false); // first — pi's default, ignored
		expect(instance.expanded).toBe(true);

		MockClass.prototype.setExpanded.call(instance, false); // second — user click, respected
		expect(instance.expanded).toBe(false);

		MockClass.prototype.updateDisplay.call(instance);
		expect(instance.expanded).toBe(false); // no re-expand
	});

	// (e) Compact (the default) leaves the native collapsed behavior untouched
	it("leaves the native collapsed behavior untouched under Compact", async () => {
		const { MockClass, origSetExpanded } = mockToolComponent();
		const patch = await importPatch();
		patch({ toolStyle: "Compact" });

		const instance = { expanded: false } as any;
		MockClass.prototype.updateDisplay.call(instance);
		expect(instance.expanded).toBe(false); // no auto-expand

		MockClass.prototype.setExpanded.call(instance, true);
		expect(instance.expanded).toBe(true); // respected
		expect(origSetExpanded).toHaveBeenCalledWith(true);
	});

	it("leaves the native collapsed behavior untouched when config is omitted", async () => {
		const { MockClass, origSetExpanded } = mockToolComponent();
		const patch = await importPatch();
		patch({});

		const instance = { expanded: false } as any;
		MockClass.prototype.updateDisplay.call(instance);
		expect(instance.expanded).toBe(false);

		MockClass.prototype.setExpanded.call(instance, true);
		expect(instance.expanded).toBe(true);
		expect(origSetExpanded).toHaveBeenCalledWith(true);
	});

	it("respects a first setExpanded(true) under Full (a real expand, not pi's default)", async () => {
		const { MockClass, origSetExpanded } = mockToolComponent();
		const patch = await importPatch();
		patch({ toolStyle: "Full" });

		const instance = { expanded: false } as any;
		MockClass.prototype.setExpanded.call(instance, true);
		expect(instance.expanded).toBe(true);
		expect(origSetExpanded).toHaveBeenCalledWith(true);
	});

	// (f) no double-wrap
	it("does not double-wrap when called twice", async () => {
		const { MockClass, origUpdateDisplay } = mockToolComponent();
		const patch = await importPatch();
		patch({ toolStyle: "Full" });
		patch({ toolStyle: "Full" });

		const instance = { expanded: false } as any;
		MockClass.prototype.updateDisplay.call(instance);
		expect(origUpdateDisplay).toHaveBeenCalledTimes(1);
	});

	it("refreshes the live config on every call even after wrapping", async () => {
		const { MockClass, origUpdateDisplay } = mockToolComponent();
		const patch = await importPatch();
		patch({ toolStyle: "Full" });
		patch({ toolStyle: "Compact" }); // already wrapped — no double-wrap, but liveConfig refreshes

		const instance = { expanded: false } as any;
		MockClass.prototype.updateDisplay.call(instance);
		expect(instance.expanded).toBe(false); // the refreshed (Compact) config applies
		expect(origUpdateDisplay).toHaveBeenCalledTimes(1);
	});

	// (g) graceful no-op when the native shape is missing
	it("no-ops when ToolExecutionComponent is undefined", async () => {
		mockToolComponent({ undefinedClass: true });
		const patch = await importPatch();
		expect(() => patch({ toolStyle: "Full" })).not.toThrow();
	});

	it("no-ops when the prototype is null", async () => {
		const MockClass = function ToolExecutionComponent() {};
		MockClass.prototype = null;
		vi.doMock("@earendil-works/pi-coding-agent", () => ({
			ToolExecutionComponent: MockClass,
		}));
		const patch = await importPatch();
		expect(() => patch({ toolStyle: "Full" })).not.toThrow();
		expect(MockClass.prototype).toBeNull();
	});

	it("no-ops when updateDisplay or setExpanded is missing (methods unchanged)", async () => {
		const { MockClass } = mockToolComponent({ setExpanded: false });
		const before = MockClass.prototype.updateDisplay;
		const patch = await importPatch();
		expect(() => patch({ toolStyle: "Full" })).not.toThrow();
		expect(MockClass.prototype.updateDisplay).toBe(before); // unchanged
	});

	// (h) the fresh flag is per-instance, not module-level
	it("tracks the fresh flag per instance: two fresh instances both auto-expand under Full", async () => {
		const { MockClass } = mockToolComponent();
		const patch = await importPatch();
		patch({ toolStyle: "Full" });

		const a = { expanded: false } as any;
		const b = { expanded: false } as any;

		MockClass.prototype.updateDisplay.call(a); // A auto-expands
		MockClass.prototype.setExpanded.call(a, false); // A's construction default (ignored)
		expect(a.expanded).toBe(true);

		MockClass.prototype.updateDisplay.call(b); // B is still fresh
		expect(b.expanded).toBe(true);
	});

	it("marks the instance with TOOL_FRESH_KEY after the first setExpanded", async () => {
		const { MockClass } = mockToolComponent();
		const patch = await importPatch();
		patch({ toolStyle: "Full" });

		const instance = { expanded: false } as any;
		expect(instance[TOOL_FRESH_KEY]).toBeUndefined();
		MockClass.prototype.setExpanded.call(instance, false);
		expect(instance[TOOL_FRESH_KEY]).toBe(true);
	});
});
