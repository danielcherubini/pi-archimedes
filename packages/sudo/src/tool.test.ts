import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// Mock core/settings-io BEFORE importing the tool — the real module builds
// its settings path at module load and would read the user's real settings.
const store = vi.hoisted(() => ({
	settings: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("@pi-archimedes/core/settings-io", () => ({
	loadConfig: (namespace: string, defaults: Record<string, unknown>) => ({
		...defaults,
		...store.settings[namespace],
	}),
	saveConfig: (namespace: string, config: Record<string, unknown>) => {
		store.settings[namespace] = config;
	},
}));

import { buildSudoArgv, createSudoExecTool } from "./tool.js";
import { credentialCache } from "./cache.js";

// ── fakes ────────────────────────────────────────────────────────────────────

interface FakeChild {
	stdin: { written: string[]; write(chunk: string): void; end(): void };
	stdout: { on(evt: string, cb: (data: Buffer) => void): unknown };
	stderr: { on(evt: string, cb: (data: Buffer) => void): unknown };
	killed: boolean;
	kill(): boolean;
	on(evt: string, cb: (code: number) => void): unknown;
}

function makeFakeSpawner(opts: { stderr?: string; stdout?: string; code: number }): {
	spawner: (command: string, args: string[]) => FakeChild;
	last: { command: string; args: string[]; child: FakeChild };
} {
	const last: { command: string; args: string[]; child: FakeChild } = { command: "", args: [], child: undefined as unknown as FakeChild };
	const spawner = (command: string, args: string[]): FakeChild => {
		last.command = command;
		last.args = args;
		const stdout = {
			on(_evt: string, cb: (data: Buffer) => void) {
				if (opts.stdout) queueMicrotask(() => cb(Buffer.from(opts.stdout as string)));
				return stdout;
			},
		};
		const stderr = {
			on(_evt: string, cb: (data: Buffer) => void) {
				queueMicrotask(() => cb(Buffer.from(opts.stderr ?? "")));
				return stderr;
			},
		};
		const child: FakeChild = {
			stdin: {
				written: [],
				write(chunk: string) {
					this.written.push(chunk);
				},
				end() {},
			},
			stdout,
			stderr,
			killed: false,
			kill() {
				this.killed = true;
				return true;
			},
			on(evt: string, cb: (code: number) => void) {
				if (evt === "exit" || evt === "close") queueMicrotask(() => cb(opts.code));
				return child;
			},
		};
		last.child = child;
		return child;
	};
	return { spawner, last };
}

function headlessCtx(mode: string): ExtensionContext {
	return ({ mode, hasUI: mode === "rpc", ui: {} }) as unknown as ExtensionContext;
}

interface RunResult {
	content: Array<{ type: string; text: string }>;
	details: Record<string, unknown>;
	isError?: boolean;
}

function run(tool: ReturnType<typeof createSudoExecTool>, ctx: ExtensionContext, params: Record<string, unknown>): Promise<RunResult> {
	return tool.execute("call-1", params as never, undefined, undefined, ctx) as unknown as Promise<RunResult>;
}

describe("sudo_exec tool", () => {
	beforeEach(() => {
		credentialCache.clear();
		for (const key of Object.keys(store.settings)) delete store.settings[key];
	});

	describe("schema", () => {
		const tool = createSudoExecTool();

		it("registers as sudo_exec", () => {
			expect(tool.name).toBe("sudo_exec");
		});

		it("exposes exactly command, reason, timeoutMs — no password, no host", () => {
			const params = tool.parameters as unknown as { properties: Record<string, unknown>; required?: string[] };
			expect(Object.keys(params.properties).sort()).toEqual(["command", "reason", "timeoutMs"]);
			expect("password" in params.properties).toBe(false);
			expect("host" in params.properties).toBe(false);
		});

		it("requires command and reason; timeoutMs is optional", () => {
			const params = tool.parameters as unknown as { required?: string[] };
			expect(params.required?.sort()).toEqual(["command", "reason"]);
		});
	});

	describe("headless block", () => {
		it("fails with a clear error when ctx.mode is not tui, without prompting", async () => {
			const tool = createSudoExecTool();
			const spies = { confirmCalls: [] as unknown[], customCalls: [] as unknown[] };
			const ui = { confirm: (...args: unknown[]) => spies.confirmCalls.push(args), custom: (...args: unknown[]) => spies.customCalls.push(args) } as unknown as ExtensionContext["ui"];
			const ctx = { mode: "json", hasUI: false, ui } as unknown as ExtensionContext;

			const result = await run(tool, ctx, { command: "apt install ripgrep", reason: "install tool" });

			expect(result.isError).toBe(true);
			expect((result.content[0] as { text: string }).text).toMatch(/interactive/i);
			// no UI was touched at all
			expect(spies.confirmCalls).toHaveLength(0);
			expect(spies.customCalls).toHaveLength(0);
		});

		it("fails in rpc mode too (custom components need the TUI)", async () => {
			const tool = createSudoExecTool();
			const result = await run(tool, headlessCtx("rpc"), { command: "apt install ripgrep", reason: "install tool" });
			expect(result.isError).toBe(true);
			expect((result.content[0] as { text: string }).text).toMatch(/interactive/i);
		});

		it("carries the reason in details", async () => {
			const tool = createSudoExecTool();
			const result = await run(tool, headlessCtx("json"), { command: "apt install ripgrep", reason: "install tool" });
			expect((result.details as { reason: string }).reason).toBe("install tool");
		});
	});

	describe("validation", () => {
		it("rejects an empty command", async () => {
			const tool = createSudoExecTool();
			const spies = spiesNoPrompt();
			const result = await run(tool, tuiCtxWithSpies(true, spies), { command: "   ", reason: "x" });
			expect(result.isError).toBe(true);
			expect((result.content[0] as { text: string }).text).toMatch(/command/i);
		});
	});

	describe("confirmation gate", () => {
		it("fails with 'not confirmed' when the user declines, without prompting for a password", async () => {
			const tool = createSudoExecTool();
			const spies = { confirmCalls: [] as Array<{ title: string; message: string }>, customCalls: [] as unknown[] };
			const ctx = tuiCtxWithSpies(false, spies);
			const result = await run(tool, ctx, { command: "apt install ripgrep", reason: "install ripgrep" });

			expect(result.isError).toBe(true);
			expect((result.content[0] as { text: string }).text).toMatch(/not confirmed/i);
			expect(spies.customCalls).toHaveLength(0); // never prompted
			// the confirmation displayed the exact command and reason
			expect(spies.confirmCalls).toHaveLength(1);
			expect(spies.confirmCalls[0]?.message).toContain("apt install ripgrep");
			expect(spies.confirmCalls[0]?.message).toContain("install ripgrep");
		});
	});

	describe("buildSudoArgv", () => {
		it("builds sudo -S argv for a plain command", () => {
			expect(buildSudoArgv("apt install ripgrep")).toEqual(["sudo", "-S", "apt", "install", "ripgrep"]);
		});

		it("splits quoted arguments into single argv entries", () => {
			expect(buildSudoArgv(`systemctl restart "open rest api"`)).toEqual(["sudo", "-S", "systemctl", "restart", "open rest api"]);
		});

		it("strips a stray leading sudo", () => {
			expect(buildSudoArgv("sudo apt update")).toEqual(["sudo", "-S", "apt", "update"]);
		});
	});

	describe("execution", () => {
		it("runs the command and returns stdout with scrubbed details on success", async () => {
			const { spawner, last } = makeFakeSpawner({ stdout: "hello\n", stderr: "[sudo] password for daniel: ", code: 0 });
			const tool = createSudoExecTool({ spawner });
			credentialCache.set("cachedpw", 60_000);
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			const result = await run(tool, ctx, { command: "echo hello", reason: "test" });

			expect(last.command).toBe("sudo");
			expect(last.args).toEqual(["-S", "echo", "hello"]);
			expect(result.isError).toBeFalsy();
			const details = result.details as { command: string; reason: string; exitCode: number; stdout: string; stderr: string };
			expect(details.exitCode).toBe(0);
			expect(details.stdout).toBe("hello\n");
			expect((result.content[0] as { text: string }).text).toBe("hello\n");
			expect(details.command).toBe("echo hello");
			expect(details.reason).toBe("test");
		});

		it("clears the credential cache on auth failure and reports an error", async () => {
			const { spawner } = makeFakeSpawner({
				stderr: "[sudo] password for daniel: \nsorry, try again.\n3 incorrect password attempts\n",
				code: 1,
			});
			const tool = createSudoExecTool({ spawner });
			credentialCache.set("badpw", 60_000);
			const spies = spiesNoPrompt();
			const ctx = tuiCtxWithSpies(true, spies);

			const result = await run(tool, ctx, { command: "reboot", reason: "retry service" });

			expect(result.isError).toBe(true);
			expect((result.content[0] as { text: string }).text).toMatch(/authentication|incorrect password/i);
			expect(credentialCache.get()).toBeNull(); // cache cleared
			// and the cached (now-bad) password was never retained for retry
			expect(spies.customCalls).toHaveLength(0);
		});

		it("writes the password plus newline to sudo stdin (never argv)", async () => {
			const { spawner, last } = makeFakeSpawner({ stderr: "", code: 0 });
			const tool = createSudoExecTool({ spawner });
			credentialCache.set("hunter2", 60_000);
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			await run(tool, ctx, { command: "apt update", reason: "maintain" });

			expect(JSON.stringify(last.args)).not.toContain("hunter2");
			expect(last.child.stdin.written.join("")).toBe("hunter2\n");
		});

		it("reports non-zero exit codes as errors", async () => {
			const { spawner } = makeFakeSpawner({ stderr: "E: not found", code: 100 });
			const tool = createSudoExecTool({ spawner });
			credentialCache.set("pw", 60_000);
			const spies = spiesNoPrompt();
			const ctx = tuiCtxWithSpies(true, spies);

			const result = await run(tool, ctx, { command: "apt install nope", reason: "test" });
			expect(result.isError).toBe(true);
			expect((result.details as { exitCode: number }).exitCode).toBe(100);
		});

		it("never lets the raw password leak into the result details (scrub)", async () => {
			const { spawner } = makeFakeSpawner({ stderr: "weird echo: secret-leak-value\n", code: 0 });
			const tool = createSudoExecTool({ spawner });
			credentialCache.set("secret-leak-value", 60_000);
			const spies = spiesNoPrompt();
			const ctx = tuiCtxWithSpies(true, spies);

			const result = await run(tool, ctx, { command: "true", reason: "test" });
			const whole = JSON.stringify({ details: result.details, content: result.content });
			expect(whole).not.toContain("secret-leak-value");
		});
	});
});

// The 'spiesNoPrompt' helper: confirmation says yes, and any accidental
// password prompt resolves empty (custom is expected to be never called).
function spiesNoPrompt() {
	return {
		confirmCalls: [] as Array<{ title: string; message: string }>,
		customCalls: [] as unknown[],
	};
}

function tuiCtxWithSpies(confirmAnswer: boolean, spies: { confirmCalls: Array<{ title: string; message: string }>; customCalls: unknown[] }): ExtensionContext {
	const ui = {
		confirm: (title: string, message: string) => {
			spies.confirmCalls.push({ title, message });
			return Promise.resolve(confirmAnswer);
		},
		custom: (factory: unknown): Promise<string> => {
			spies.customCalls.push(factory);
			return Promise.resolve("");
		},
	};
	return { mode: "tui", hasUI: true, cwd: "/tmp", ui: ui as unknown as ExtensionContext["ui"] } as unknown as ExtensionContext;
}
