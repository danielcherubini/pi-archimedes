import { describe, expect, it, vi } from "vitest";
import defaultExport from "./index.js";

describe("diff default export (standalone factory)", () => {
	it("is a function that registers diff tools on session_start with a per-session theme", () => {
		expect(typeof defaultExport).toBe("function");

		const on = vi.fn();
		const registerTool = vi.fn();
		const pi = { on, registerTool } as any;

		defaultExport(pi);

		const startHandler = on.mock.calls.find((c: Array<unknown>) => c[0] === "session_start")?.[1];
		expect(typeof startHandler).toBe("function");

		// Mirror of meta's wiring: registerDiffTools(pi, getTheme, readConfig)
		// runs per session with the session's ctx.theme.
		startHandler!({}, { ui: { theme: {} } });

		// write/edit tool overrides registered when the SDK loaded
		expect(registerTool).toHaveBeenCalled();
	});
});