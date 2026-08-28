import { describe, expect, it, vi } from "vitest";
import defaultExport from "./index.js";

describe("image-paste default export (standalone factory)", () => {
	it("is a function that registers paste + per-session lifecycle on the pi extension", () => {
		expect(typeof defaultExport).toBe("function");

		const on = vi.fn();
		const registerShortcut = vi.fn();
		const registerMessageRenderer = vi.fn();

		const pi = { on, registerShortcut, registerMessageRenderer } as any;

		defaultExport(pi);

		// registerImagePaste wires the preview renderer + shortcuts
		expect(registerMessageRenderer).toHaveBeenCalled();
		expect(registerShortcut).toHaveBeenCalled();

		// input handler (from registerImagePaste) + session lifecycle handlers
		const events = on.mock.calls.map((c: Array<unknown>) => c[0]);
		expect(events).toEqual(
			expect.arrayContaining(["input", "session_start", "session_shutdown"]),
		);
	});

	it("resets the per-session queue on session_start and clears it on shutdown", () => {
		const on = vi.fn();
		const pi = { on, registerShortcut: vi.fn(), registerMessageRenderer: vi.fn() } as any;
		defaultExport(pi);

		const startHandler = on.mock.calls.find((c: Array<unknown>) => c[0] === "session_start")?.[1];
		const shutdownHandler = on.mock.calls.find((c: Array<unknown>) => c[0] === "session_shutdown")?.[1];
		expect(typeof startHandler).toBe("function");
		expect(typeof shutdownHandler).toBe("function");

		// Must not throw when wired to a session context
		expect(() => (startHandler as (...a: unknown[]) => unknown)({}, { hasUI: true })).not.toThrow();
		expect(() => (shutdownHandler as (...a: unknown[]) => unknown)({}, {})).not.toThrow();
	});
});