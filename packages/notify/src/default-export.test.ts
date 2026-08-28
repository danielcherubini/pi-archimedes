import { describe, expect, it, vi } from "vitest";
import defaultExport from "./index.js";

describe("notify default export (standalone factory)", () => {
	it("is a function that registers the notify handlers (registerNotify subscribes its own session events)", () => {
		expect(typeof defaultExport).toBe("function");

		const on = vi.fn();
		const pi = { on } as any;

		defaultExport(pi);

		const events = on.mock.calls.map((c: Array<unknown>) => c[0]);
		expect(events).toEqual(
			expect.arrayContaining([
				"agent_end",
				"input",
				"before_agent_start",
				"agent_start",
				"session_start",
				"session_shutdown",
			]),
		);
	});
});