import { describe, expect, it, vi } from "vitest";
import defaultExport from "./index.js";

describe("diff default export (standalone factory)", () => {
	it("installs the diff rows once on session_start, without registering a tool", () => {
		expect(typeof defaultExport).toBe("function");

		const on = vi.fn();
		const registerTool = vi.fn();
		const registerToolRenderer = vi.fn();
		const pi = { on, registerTool, registerToolRenderer } as any;

		defaultExport(pi);

		const startHandler = on.mock.calls.find((c: Array<unknown>) => c[0] === "session_start")?.[1];
		expect(typeof startHandler).toBe("function");

		// Mirror of meta's wiring: registerDiffTools(pi, getTheme, readConfig)
		// runs per session with the session's ctx.theme. Twice, to stand in for a
		// `/reload` in the same process.
		startHandler!({}, { ui: { theme: {} } });
		startHandler!({}, { ui: { theme: {} } });

		// Nothing is taken over: pi's own `edit`/`write` stay registered, and the
		// Archimedes rows come from renderer resolution (ADR 0029).
		expect(registerTool).not.toHaveBeenCalled();
		// One resolver per tool, and no duplicate stacked by the second session:
		// pi keeps a list of resolvers and handlers per extension.
		expect(registerToolRenderer).toHaveBeenCalledTimes(2);
		const events = on.mock.calls.map((c: Array<unknown>) => c[0]);
		expect(events.filter((e) => e === "tool_result")).toHaveLength(2); // edit + write
		expect(events.filter((e) => e === "tool_call")).toHaveLength(1); // write only
	});
});
