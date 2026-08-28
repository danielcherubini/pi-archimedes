import { describe, expect, it } from "vitest";
import defaultExport from "./index.js";

describe("mcp default export (standalone factory)", () => {
	it("is a function that registers the mcp extension (registerMcp subscribes its own session events)", () => {
		expect(typeof defaultExport).toBe("function");

		const handlers: Record<string, Array<(...args: unknown[]) => unknown>> = {};
		const tools: Array<{ name: string }> = [];
		const commands: Record<string, unknown> = {};
		const pi = {
			on: (name: string, fn: (...args: unknown[]) => unknown) => {
				(handlers[name] ??= []).push(fn);
			},
			registerTool: (def: { name: string }) => {
				tools.push(def);
			},
			registerCommand: (name: string, def: unknown) => {
				commands[name] = def;
			},
		} as any;

		defaultExport(pi);

		// session lifecycle handled inside registerMcp
		expect(handlers["session_start"]?.length).toBeGreaterThan(0);
		expect(handlers["session_shutdown"]?.length).toBeGreaterThan(0);

		// mcp proxy tool + /mcp command registered
		expect(tools.some((t) => t.name === "mcp")).toBe(true);
		expect(commands["mcp"]).toBeDefined();
	});
});