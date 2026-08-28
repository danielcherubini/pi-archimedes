import { describe, expect, it, vi } from "vitest";
import defaultExport from "./index.js";

describe("ask default export (standalone factory)", () => {
	it("is a function that registers the ask extension (registerAsk subscribes its own session events)", () => {
		expect(typeof defaultExport).toBe("function");

		const on = vi.fn();
		const registerTool = vi.fn();
		const pi = { on, registerTool } as any;

		defaultExport(pi);

		// ask tool registered
		expect(registerTool).toHaveBeenCalled();

		// registerAsk wires its own session lifecycle internally
		const events = on.mock.calls.map((c: Array<unknown>) => c[0]);
		expect(events).toEqual(
			expect.arrayContaining(["session_start", "turn_start", "session_shutdown"]),
		);
	});
});