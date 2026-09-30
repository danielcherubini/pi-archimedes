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
// are spies. `setExpanded` writes `this.expanded` (the native write path) and
// ends with `this.updateDisplay()` (the native shape the patch probes for), so
// "respected" calls are observable on a plain fake instance.
//
// NOTE: a vitest `vi.fn` spy's `toString()` returns the spy's own internals,
// not the implementation's source. The patch's minification-safe signature
// probe reads `proto.setExpanded.toString()`, so the spy gets an own
// `toString` that mimics a real native source (exactly what a plain function
// would return).
function mockToolComponent(opts?: {
  updateDisplay?: boolean;
  setExpanded?: boolean;
  undefinedClass?: boolean;
  probeMismatch?: boolean;
}) {
  const origUpdateDisplay = vi.fn(function (this: any) {
    // native updateDisplay — no-op for the test
  });
  const origSetExpanded = vi.fn(function (this: any, expanded: boolean) {
    this.expanded = expanded;
    this.updateDisplay();
  });
  // Emulate the native source for the minification-safe signature probe.
  origSetExpanded.toString = () =>
    opts?.probeMismatch
      ? "function (this, expanded) {\n  this.expanded = expanded;\n}"
      : "function (this, expanded) {\n  this.expanded = expanded;\n  this.updateDisplay();\n}";
  const MockClass = function ToolExecutionComponent() {};
  if (opts?.updateDisplay !== false) MockClass.prototype.updateDisplay = origUpdateDisplay;
  if (opts?.setExpanded !== false) MockClass.prototype.setExpanded = origSetExpanded;
  vi.doMock("@earendil-works/pi-coding-agent", () => ({
    ToolExecutionComponent: opts?.undefinedClass ? undefined : MockClass,
  }));
  return { MockClass, origUpdateDisplay, origSetExpanded };
}

// A plain fake instance. `updateDisplay` is a no-op so the native
// setExpanded's trailing `this.updateDisplay()` call is safe.
function makeInstance(): any {
  return { expanded: false, updateDisplay: () => {} };
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

    const instance = makeInstance();
    MockClass.prototype.updateDisplay.call(instance);
    expect(instance.expanded).toBe(true);
  });

  // (c) pi's construction sequence: the programmatic setExpanded(false) right
  // after construction must NOT collapse the auto-expanded tool
  it("survives pi's construction sequence: updateDisplay -> setExpanded(false) -> updateDisplay stays expanded", async () => {
    const { MockClass, origSetExpanded } = mockToolComponent();
    const patch = await importPatch();
    patch({ toolStyle: "Full" });

    const instance = makeInstance();
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

    const instance = makeInstance();
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

    const instance = makeInstance();
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

    const instance = makeInstance();
    MockClass.prototype.updateDisplay.call(instance);
    expect(instance.expanded).toBe(false);

    MockClass.prototype.setExpanded.call(instance, true);
    expect(instance.expanded).toBe(true); // respected
    expect(origSetExpanded).toHaveBeenCalledWith(true);
  });

  it("respects a first setExpanded(true) under Full (a real expand, not pi's default)", async () => {
    const { MockClass, origSetExpanded } = mockToolComponent();
    const patch = await importPatch();
    patch({ toolStyle: "Full" });

    const instance = makeInstance();
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

    const instance = makeInstance();
    MockClass.prototype.updateDisplay.call(instance);
    expect(origUpdateDisplay).toHaveBeenCalledTimes(1);
  });

  it("refreshes the live config on every call even after wrapping", async () => {
    const { MockClass, origUpdateDisplay } = mockToolComponent();
    const patch = await importPatch();
    patch({ toolStyle: "Full" });
    patch({ toolStyle: "Compact" }); // already wrapped — no double-wrap, but liveConfig refreshes

    const instance = makeInstance();
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

    const a = makeInstance();
    const b = makeInstance();

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

    const instance = makeInstance();
    expect(instance[TOOL_FRESH_KEY]).toBeUndefined();
    MockClass.prototype.setExpanded.call(instance, false);
    expect(instance[TOOL_FRESH_KEY]).toBe(true);
  });

  // (i) re-apply is idempotent across a re-evaluated module (pi /reload): the
  // true originals live on the PROTOTYPE (Symbol.for), so a fresh module
  // re-assigns a fresh wrapper that REPLACES the old one — no chaining, no
  // stale liveConfig layer. (This is the regression the old module-level
  // `wrapped` guard got wrong across reloads.)
  it("re-applies idempotently when the module is re-evaluated (no double-wrap, true original preserved)", async () => {
    const { MockClass, origUpdateDisplay } = mockToolComponent();
    const patch1 = await importPatch();
    patch1({ toolStyle: "Full" });
    // /reload: the extension module is re-evaluated (fresh module state) but
    // ToolExecutionComponent (pi's shared host module) keeps its prototype.
    const patch2 = await importPatch();
    patch2({ toolStyle: "Full" });

    const instance = makeInstance();
    MockClass.prototype.updateDisplay.call(instance);
    expect(origUpdateDisplay).toHaveBeenCalledTimes(1); // NOT twice — no chained wrapper
    expect(instance.expanded).toBe(true); // the fresh wrapper still auto-expands
  });

  it("a re-evaluated module's fresh wrapper replaces the stale one (Full -> Compact across /reload)", async () => {
    const { MockClass, origUpdateDisplay } = mockToolComponent();
    const patch1 = await importPatch();
    patch1({ toolStyle: "Full" });
    const patch2 = await importPatch(); // re-evaluated module
    patch2({ toolStyle: "Compact" }); // Full -> Compact while re-applying

    const instance = makeInstance();
    MockClass.prototype.updateDisplay.call(instance);
    expect(instance.expanded).toBe(false); // the FRESH wrapper's Compact applies (no stale Full layer re-expanding)
    expect(origUpdateDisplay).toHaveBeenCalledTimes(1);
  });

  // (j) signature probe: a setExpanded whose source lacks the expected shape is
  // NOT wrapped (warn + no-op), mirroring thinking/patch.ts.
  it("no-ops (and warns) when setExpanded's signature doesn't match the probed shape", async () => {
    const { MockClass, origUpdateDisplay, origSetExpanded } = mockToolComponent({ probeMismatch: true });
    const patch = await importPatch();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => patch({ toolStyle: "Full" })).not.toThrow();
    expect(MockClass.prototype.updateDisplay).toBe(origUpdateDisplay); // unchanged
    expect(MockClass.prototype.setExpanded).toBe(origSetExpanded); // unchanged
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  // (k) fail-safe swallow: a setExpanded(false) on a tool that was NOT
  // auto-expanded (still collapsed — an ordering failure) calls through and is
  // NOT swallowed. Contrast with (c), where the tool WAS auto-expanded and the
  // first setExpanded(false) IS swallowed.
  it("calls setExpanded(false) through when the tool was not auto-expanded (fail-safe, no swallowed first click)", async () => {
    const { MockClass, origSetExpanded } = mockToolComponent();
    const patch = await importPatch();
    patch({ toolStyle: "Full" });

    // Ordering failure: the construction setExpanded(false) arrives while the
    // tool is still collapsed (the auto-expand never ran / ran late).
    const instance = makeInstance(); // expanded === false
    MockClass.prototype.setExpanded.call(instance, false);
    expect(origSetExpanded).toHaveBeenCalledWith(false); // called through, NOT swallowed
    expect(instance.expanded).toBe(false); // native collapse
  });
});
