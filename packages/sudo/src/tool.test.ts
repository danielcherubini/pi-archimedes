import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import { buildSudoArgv, createSudoExecTool, probeSudoTicket, scrubSecret } from "./tool.js";
import type { SudoChild, SudoSpawner } from "./tool.js";
import { credentialCache } from "./cache.js";

// ── fakes ────────────────────────────────────────────────────────────────────

interface FakeChild {
	stdin: { written: string[]; write(chunk: string): void; end(): void };
	stdout: { on(evt: string, cb: (data: Buffer) => void): unknown };
	stderr: { on(evt: string, cb: (data: Buffer) => void): unknown };
	pid: number;
	killed: boolean;
	/** signals passed to kill(), in order. */
	killSignals: Array<NodeJS.Signals | undefined>;
	kill(signal?: NodeJS.Signals): boolean;
	/** 'exit'/'close' pass an exit callback, 'error' passes an Error callback. */
	on(evt: string, cb: ((code: number | null, signal?: NodeJS.Signals | null) => void) | ((err: Error) => void)): unknown;
}

function makeFakeSpawner(opts: { stderr?: string; stdout?: string; code: number | null; signal?: NodeJS.Signals; exitOn?: "register" | "kill" }): {
	spawner: (command: string, args: string[]) => FakeChild;
	last: { command: string; args: string[]; child: FakeChild };
} {
	const last: { command: string; args: string[]; child: FakeChild } = { command: "", args: [], child: undefined as unknown as FakeChild };
	const registeredExits = new Map<string, (code: number | null, signal?: NodeJS.Signals | null) => void>();
	const fireExit = (signal?: NodeJS.Signals): void => {
		for (const cb of registeredExits.values()) queueMicrotask(() => cb(opts.code ?? null, signal ?? opts.signal ?? null));
	};
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
			pid: 4242,
			killed: false,
			killSignals: [],
			kill(signal?: NodeJS.Signals) {
				this.killed = true;
				this.killSignals.push(signal);
				if (opts.exitOn === "kill") fireExit(signal); // async, like a real child
				return true;
			},
			on(evt: string, cb: ((code: number | null, signal?: NodeJS.Signals | null) => void) | ((err: Error) => void)): unknown {
				if (evt === "exit" || evt === "close") {
					const exitCb = cb as (code: number | null, signal?: NodeJS.Signals | null) => void;
					if (opts.exitOn === "kill") registeredExits.set(evt, exitCb);
					else queueMicrotask(() => exitCb(opts.code ?? null, opts.signal ?? null));
				}
				// 'error' is intentionally not fired by the base fake — the
				// process-failure tests build their own error-capable children.
				return child;
			},
		};
		last.child = child;
		return child;
	};
	return { spawner, last };
}

// Locale fixtures for credential failures the tool cannot signature-recognize
// (shared by the probe-gale and two-strike describes).
const NON_ENGLISH_STDERR = '[sudo] password for daniel: \nFalsches Passwort "daniel".\n';
const LOCALIZED_ONLY_STDERR = 'Falsches Passwort "daniel".\n';

/** Spawner yielding the ambiguous (prompt + localized text, exit 1) failure. */
function ambiguousSpawner(): SudoSpawner {
	const { spawner } = makeFakeSpawner({ stderr: NON_ENGLISH_STDERR, code: 1 });
	return spawner;
}

/** Spawner piping consecutive fake runs through, one fixture step each. */
function stepSpawner(steps: Array<{ stderr?: string; stdout?: string; code?: number | null }>): SudoSpawner {
	const instances = steps.map((s) => makeFakeSpawner({ stderr: "", stdout: "", code: 0, ...s }));
	let i = 0;
	return (command, args) => {
		const cur = instances[Math.min(i, instances.length - 1)]!;
		i += 1;
		return cur.spawner(command, args);
	};
}

/** Child whose 'error' event fires asynchronously — a spawn that never produced a usable process. */
function erroredChild(): SudoChild {
	const err = Object.assign(new Error("spawn sudo ENOENT"), { code: "ENOENT" });
	return {
		stdin: { write() {}, end() {} },
		stdout: { on: () => null },
		stderr: { on: () => null },
		kill: () => true,
		on(evt: string, cb: unknown) {
			if (evt === "error") queueMicrotask(() => (cb as (e: Error) => void)(err));
			return null;
		},
	};
}

function headlessCtx(mode: string): ExtensionContext {
	return ({ mode, hasUI: mode === "rpc", ui: {} }) as unknown as ExtensionContext;
}

interface RunResult {
	content: Array<{ type: string; text: string }>;
	details: Record<string, unknown>;
	isError?: boolean;
}

function run(
	tool: ReturnType<typeof createSudoExecTool>,
	ctx: ExtensionContext,
	params: Record<string, unknown>,
	signal: AbortSignal | undefined = undefined,
): Promise<RunResult> {
	return tool.execute("call-1", params as never, signal, undefined, ctx) as unknown as Promise<RunResult>;
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
			const { authProbe, calls } = probeSpy(true);
			const tool = createSudoExecTool({ spawner, authProbe });
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
			expect(calls()).toBe(0); // success path never probes
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
			const { authProbe, calls } = probeSpy(true);
			const tool = createSudoExecTool({ spawner, authProbe });
			credentialCache.set("pw", 60_000);
			const spies = spiesNoPrompt();
			const ctx = tuiCtxWithSpies(true, spies);

			const result = await run(tool, ctx, { command: "apt install nope", reason: "test" });
			expect(result.isError).toBe(true);
			expect((result.details as { exitCode: number }).exitCode).toBe(100);
			// a plain command failure (no English auth signature) now ticket-probes;
			// the valid ticket keeps it a normal command failure, not an auth failure
			expect(calls()).toBe(1);
			expect((result.content[0] as { text: string }).text).not.toMatch(/authentication/i);
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

		it("maps a timeout SIGKILL exit to exit code 137 and reports the timeout error (runSudo contract: code null + SIGKILL → 137)", async () => {
			// exitOn:'kill' — the child only exits when runSudo's timeout kills it.
			const { spawner, last } = makeFakeSpawner({ stderr: "", code: null, exitOn: "kill" });
			const tool = createSudoExecTool({ spawner });
			credentialCache.set("pw", 60_000);
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			const result = await run(tool, ctx, { command: "sleep", reason: "test", timeoutMs: 10 });

			expect(result.isError).toBe(true);
			const details = result.details as { exitCode: number; error?: string };
			expect(details.exitCode).toBe(137);
			expect(details.error).toMatch(/timed out after 10ms/i);
			expect(last.child.killed).toBe(true);
			expect(last.child.killSignals).toContain("SIGKILL");
		});

		it("maps an external abort to exit code 130, kills with SIGKILL, and resolves exactly once (settle-guard)", async () => {
			// No automatic exit: only abort's kill ever settles the child.
			const { spawner, last } = makeFakeSpawner({ stderr: "starting…", code: null, exitOn: "kill" });
			const { authProbe, calls } = probeSpy(true);
			const tool = createSudoExecTool({ spawner, authProbe });
			credentialCache.set("pw", 60_000);
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());
			const controller = new AbortController();

			const promise = run(tool, ctx, { command: "long job", reason: "test", timeoutMs: 60_000 }, controller.signal);
			let rejected = false;
			promise.catch(() => {
				rejected = true;
			});
			// let execute pass the gate and spawn
			await new Promise((r) => setTimeout(r, 1));
			expect(last.command).toBe("sudo");

			controller.abort(); // runSudo: child.kill(SIGKILL) + settle(130), before any exit event

			const result = await promise;
			// the fake's kill() also fires BOTH registered 'exit' and 'close' handlers
			// after the abort — the settled guard must swallow them, keeping 130 stable
			await new Promise((r) => setTimeout(r, 1));

			expect(result.isError).toBe(true);
			const details = result.details as { exitCode: number; error?: string };
			expect(details.exitCode).toBe(130);
			expect(details.error).toMatch(/exit code 130/);
			expect(last.child.killed).toBe(true);
			expect(last.child.killSignals).toContain("SIGKILL");
			expect(rejected).toBe(false);
			expect(calls()).toBe(0); // abort (130) never probes
		});

		it("fails with 'password entry cancelled' when the masked prompt is cancelled — no spawn, nothing cached", async () => {
			let spawned = false;
			const tool = createSudoExecTool({
				spawner: () => {
					spawned = true;
					throw new Error("spawner must not be called");
				},
			});
			// spiesNoPrompt's ui.custom resolves "" = the user cancelled the
			// masked password prompt (Esc / Enter on an empty buffer).
			const spies = spiesNoPrompt();
			const ctx = tuiCtxWithSpies(true, spies);

			const result = await run(tool, ctx, { command: "apt update", reason: "maintain" });

			expect(result.isError).toBe(true);
			expect((result.content[0] as { text: string }).text).toMatch(/password entry cancelled/i);
			expect(spies.confirmCalls).toHaveLength(1); // confirmed, THEN prompted
			expect(spies.customCalls).toHaveLength(1);
			expect(spawned).toBe(false);
			expect(credentialCache.get()).toBeNull(); // nothing cached on cancel
		});
	});

	describe("scrubSecret", () => {
		it("replaces a whole line containing the secret with [redacted]", () => {
			expect(scrubSecret("line one\nsudo: secret-leak-value here\nline three", "secret-leak-value")).toBe(
				"line one\n[redacted]\nline three",
			);
		});

		it("in multi-line text only the offending line is affected", () => {
			expect(scrubSecret("keep a\nhas the p@ssword in it\nkeep c", "p@ssword")).toBe("keep a\n[redacted]\nkeep c");
		});

		it("does NOT scrub a secret split across a newline (line-level matching limit — accepted residual)", () => {
			expect(scrubSecret("pa\nss\nsurrounding", "pa\nss")).toBe("pa\nss\nsurrounding");
		});

		it("returns empty text unchanged", () => {
			expect(scrubSecret("", "secret")).toBe("");
		});

		it("returns the input unchanged for an empty secret (guard against wiping everything)", () => {
			const text = "a\nb\nc";
			expect(scrubSecret(text, "")).toBe(text);
		});
	});

	describe("process-level failures (no crash, no hang, no false auth-failure)", () => {
		/**
		 * Fake child whose 'error' event fires asynchronously (spawn failed —
		 * either the process never started, or it died hard). No 'exit'/'close'
		 * is ever fired: a dead-spawn child has no exit to report.
		 */
		function errorChild(err: Error): SudoChild {
			const errorCbs: Array<(e: Error) => void> = [];
			const child: SudoChild = {
				stdin: { write() {}, end() {} },
				stdout: { on: () => null },
				stderr: { on: () => null },
				kill: () => true,
				on(evt: string, cb: unknown) {
					if (evt === "error") errorCbs.push(cb as (e: Error) => void);
					return null;
				},
			};
			// fires AFTER the executor has synchronously registered listeners —
			// like real Node emitting 'error' on a later tick for a failed spawn.
			queueMicrotask(() => void errorCbs.forEach((cb) => cb(err)));
			return child;
		}

		it("resolves a clean tool failure (exit -1) when the child 'error' event fires (e.g. spawn ENOENT) — no uncaught crash, cache retained", async () => {
			// 3s test timeout is the hang guard: without an 'error' listener the
			// promise would never settle (there is no exit event from a spawn that
			// never produced a process) → the review's crash/hang finding.
			credentialCache.set("pw", 60_000);
			const err = Object.assign(new Error("spawn sudo ENOENT"), { code: "ENOENT" });
			const { authProbe, calls } = probeSpy(true);
			const tool = createSudoExecTool({ spawner: () => errorChild(err), authProbe });
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			const result = await run(tool, ctx, { command: "apt update", reason: "maintain" });

			expect(result.isError).toBe(true);
			const text = (result.content[0] as { text: string }).text;
			expect(text).toMatch(/failed to run privileged command/i);
			expect(text).not.toMatch(/authentication failed|incorrect password/i); // must not look like an auth failure
			const details = result.details as { exitCode: number; error?: string };
			expect(details.exitCode).toBe(-1);
			expect(details.error).toBeTruthy();
			// The password STAYS cached: a spawn/transport failure says nothing
			// about the credential — it may be a transient fs/permission hiccup.
			expect(credentialCache.get()?.password).toBe("pw");
			expect(calls()).toBe(0); // the -1 error path never probes
		}, 3000);

		it("resolves a clean tool failure when the spawner itself throws synchronously — no unhandled rejection, cache retained", async () => {
			credentialCache.set("pw", 60_000);
			const tool = createSudoExecTool({
				spawner: () => {
					throw Object.assign(new Error("spawn sudo EACCES"), { code: "EACCES" });
				},
			});
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			const result = await run(tool, ctx, { command: "apt update", reason: "maintain" });

			expect(result.isError).toBe(true);
			const text = (result.content[0] as { text: string }).text;
			expect(text).toMatch(/failed to run privileged command/i);
			expect(text).not.toMatch(/authentication failed|incorrect password/i);
			expect((result.details as { exitCode: number }).exitCode).toBe(-1);
			// cache retained — a spawning throw is about the transport, not the password
			expect(credentialCache.get()?.password).toBe("pw");
		});

		it("resolves a clean tool failure when writing the password to stdin is fatal (child died before reading it) — cache retained", async () => {
			credentialCache.set("pw", 60_000);
			const child: SudoChild = {
				stdin: {
					write() {
						throw new Error("write EPIPE");
					},
					end() {},
				},
				stdout: { on: () => null },
				stderr: { on: () => null },
				kill: () => true,
				on: () => null,
			};
			const tool = createSudoExecTool({ spawner: () => child });
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			const result = await run(tool, ctx, { command: "apt update", reason: "maintain" });

			expect(result.isError).toBe(true);
			const text = (result.content[0] as { text: string }).text;
			expect(text).toMatch(/failed to run privileged command/i);
			expect(text).not.toMatch(/authentication failed|incorrect password/i);
			expect((result.details as { exitCode: number }).exitCode).toBe(-1);
			// the child dying needs no re-auth of the password — keep it cached
			expect(credentialCache.get()?.password).toBe("pw");
		});
	});

	describe("async stream errors on the child's stdin (no unhandled 'error', no false fail)", () => {
		/**
		 * Fake child whose stdin is a REAL EventEmitter: `emit("error")` with
		 * no listener throws — if runSudo didn't attach an 'error' listener
		 * before the async emit, the queueMicrotask'd throw is an uncaught
		 * exception and this entire test run fails (the crash-safety net for
		 * the "no unhandled 'error'" requirement). Stdout/stderr are inert
		 * sinks — these tests are about the stdin error path only.
		 */
		function streamingChild() {
			const ee = new EventEmitter();
			const written: string[] = [];
			const exitCbs: Array<(code: number | null, signal?: NodeJS.Signals | null) => void> = [];
			const child: SudoChild = {
				stdin: Object.assign(ee, {
					written,
					write(chunk: string) {
						written.push(chunk);
					},
					end() {},
				}),
				stdout: { on: () => null },
				stderr: { on: () => null },
				// no pid on purpose: a kill here is a no-op (killProcessTree
				// skips pid-less children), so the 2s exit fallback is the only
				// thing that settles a "child never reports exit" scenario.
				kill: () => true,
				on(
					evt: string,
					cb: ((code: number | null, signal?: NodeJS.Signals | null) => void) | ((err: Error) => void),
				): unknown {
					if (evt === "exit" || evt === "close") {
						exitCbs.push(cb as (code: number | null, signal?: NodeJS.Signals | null) => void);
					}
					return null;
				},
			};
			return {
				child,
				written,
				emitStdinError(err: Error): void {
					// async, like a real stream — a dead child's EPIPE can land
					// on a later tick after the write already completed.
					queueMicrotask(() => {
						ee.emit("error", err);
					});
				},
				/** fire BOTH 'exit' and 'close' (real children echo either). */
				exit(code: number | null): void {
					for (const cb of exitCbs) queueMicrotask(() => cb(code, null));
				},
			};
		}

		it("EPIPE on stdin (reader went away) followed by exit(0) settles as SUCCESS — no false failure for the NOPASSWD fast-exit path", async () => {
			// NOPASSWD narrative: the host's sudoers grants NOPASSWD, the command
			// finishes almost immediately and never reads the password from stdin
			// (`sudo -S` ignores it), so the stdin write pipe breaks with EPIPE —
			// asynchronously, after our write already completed. The read side
			// dying says NOTHING about the credential or the command: the child's
			// real exit code (0, here) must win. Treating the EPIPE as fatal would
			// false-fail this perfectly legitimate fast-exit success.
			credentialCache.set("nopw", 60_000);
			const { child, emitStdinError, exit } = streamingChild();
			const { authProbe, calls } = probeSpy(true);
			const tool = createSudoExecTool({ spawner: () => child, authProbe });
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			const promise = run(tool, ctx, { command: "hostname", reason: "test" });
			await new Promise((r) => setTimeout(r, 1)); // spawn + stdin listener attached
			emitStdinError(Object.assign(new Error("read EPIPE"), { code: "EPIPE" }));
			exit(0); // 'exit' then 'close' — the settled guard must swallow the echo

			const result = await promise;
			expect(result.isError).toBeFalsy();
			const details = result.details as { exitCode: number; error?: string };
			expect(details.exitCode).toBe(0);
			expect(details.error).toBeUndefined();
			expect(calls()).toBe(0); // success never probes
		}, 3000);

		it("EPIPE on stdin followed by exit(1) settles as a normal command failure (exit 1), no crash", async () => {
			credentialCache.set("pw", 60_000);
			const { child, emitStdinError, exit } = streamingChild();
			const { authProbe, calls } = probeSpy(true); // gate probes; valid ticket → command failure, not auth
			const tool = createSudoExecTool({ spawner: () => child, authProbe });
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			const promise = run(tool, ctx, { command: "systemctl stop dnsmasq", reason: "test" });
			await new Promise((r) => setTimeout(r, 1));
			emitStdinError(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
			exit(1);

			const result = await promise;
			expect(result.isError).toBe(true);
			const details = result.details as { exitCode: number; error?: string };
			expect(details.exitCode).toBe(1);
			expect(details.error).toMatch(/command failed with exit code 1/i);
			expect((result.content[0] as { text: string }).text).not.toMatch(/authentication/i);
			expect(calls()).toBe(1);
		}, 3000);

		it("anomalous stdin error while the child is still running (no exit) settles a clean transport failure — cache RETAINED, no probe", async () => {
			credentialCache.set("pw", 60_000);
			const { child, emitStdinError } = streamingChild();
			const { authProbe, calls } = probeSpy(true);
			const tool = createSudoExecTool({ spawner: () => child, authProbe });
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			const promise = run(tool, ctx, { command: "apt update", reason: "maintain" });
			await new Promise((r) => setTimeout(r, 1));
			emitStdinError(Object.assign(new Error("boom"), { code: "ERR_STREAM_FAKE" }));
			// no exit is fired at all — the handler itself must settle the run
			// (a dead stdin with a live child is a broken transport).
			const result = await promise;

			expect(result.isError).toBe(true);
			const text = (result.content[0] as { text: string }).text;
			expect(text).toMatch(/failed to run privileged command/i);
			expect(text).toMatch(/stdin failed: ERR_STREAM_FAKE/i);
			expect(text).not.toMatch(/authentication failed|incorrect password/i);
			const details = result.details as { exitCode: number; error?: string };
			expect(details.exitCode).toBe(-1);
			expect(details.error).toBe("stdin failed: ERR_STREAM_FAKE");
			// transport failure says nothing about the credential — keep it cached
			expect(credentialCache.get()?.password).toBe("pw");
			expect(calls()).toBe(0); // the -1 error path never probes
		}, 3000);

		it("anomalous stdin error AFTER exit(0) already settled success is ignored — result stays success (no double-settle)", async () => {
			credentialCache.set("pw", 60_000);
			const { child, emitStdinError, exit } = streamingChild();
			const { authProbe } = probeSpy(true);
			const tool = createSudoExecTool({ spawner: () => child, authProbe });
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			const promise = run(tool, ctx, { command: "true", reason: "test" });
			await new Promise((r) => setTimeout(r, 1));
			exit(0); // settles first — 'exit' wins
			await new Promise((r) => setTimeout(r, 1)); // let the settle land
			emitStdinError(Object.assign(new Error("late stream error"), { code: "ERR_STREAM_DESTROYED" }));
			await new Promise((r) => setTimeout(r, 1)); // survive the (ignored) late error

			const result = await promise;
			expect(result.isError).toBeFalsy();
			const details = result.details as { exitCode: number; error?: string };
			expect(details.exitCode).toBe(0);
			expect(details.error).toBeUndefined();
		}, 3000);

		it("EPIPE with a child that never reports exit — no crash, the timeout fallback settles the run (safety harness)", async () => {
			// The EPIPE policy defers to 'exit'; when the registerable process is
			// dead-and-silent, the timeout + 2s exit fallback is what settles the
			// run. Also the crash net: the stdin is a real EventEmitter, so an
			// unattached 'error' listener would take down the run.
			credentialCache.set("pw", 60_000);
			const { child, emitStdinError, written } = streamingChild();
			const tool = createSudoExecTool({ spawner: () => child, authProbe: () => Promise.resolve(true) });
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			const promise = run(tool, ctx, { command: "sleep-forever-in-spirit", reason: "test", timeoutMs: 10 });
			await new Promise((r) => setTimeout(r, 1));
			expect(written.join("")).toBe("pw\n"); // the password write happened before the error
			emitStdinError(Object.assign(new Error("read EPIPE"), { code: "EPIPE" }));
			// no exit ever comes — the exit fallback settles 124 ~2s after the timeout

			const result = await promise;
			expect(result.isError).toBe(true);
			const details = result.details as { exitCode: number; error?: string };
			expect(details.exitCode).toBe(124);
			expect(details.error).toMatch(/timed out after 10ms/i);
		});
	});

	describe("probeSudoTicket argv (password-free credential verification)", () => {
		it("the probe argv is EXACTLY ['sudo','-n','-v'] — no program argument (that is the point of the fix)", async () => {
			const calls: Array<{ command: string; args: string[] }> = [];
			const { spawner } = makeFakeSpawner({ stderr: "", code: 0 });
			const capturing: SudoSpawner = (command, args) => {
				calls.push({ command, args });
				return spawner(command, args);
			};

			const valid = await probeSudoTicket(5000, undefined, capturing);

			expect(calls).toHaveLength(1);
			expect(calls[0]).toEqual({ command: "sudo", args: ["-n", "-v"] });
			expect(calls[0]!.args).not.toContain("true"); // never executes a program
			expect(valid).toBe(true);
		});

		it("returns false when the credential check exits non-zero (non-zero = no valid credential)", async () => {
			const calls: Array<{ command: string; args: string[] }> = [];
			const { spawner } = makeFakeSpawner({ stderr: "sudo: a password is required\n", code: 1 });
			const capturing: SudoSpawner = (command, args) => {
				calls.push({ command, args });
				return spawner(command, args);
			};

			const valid = await probeSudoTicket(5000, undefined, capturing);

			expect(calls[0]).toEqual({ command: "sudo", args: ["-n", "-v"] });
			expect(valid).toBe(false);
		});
	});

	describe("locale-immune auth-failure invalidation (credential ticket probe)", () => {
		// The probe gate no longer requires the English prompt: it fires on any
		// command-level failure (normal non-zero exit) whose stderr did not
		// already match the English "incorrect password" fast-path signature.
		// NON_ENGLISH_STDERR (English prompt + localized failure text) is the
		// case (a) fixture: prompt present — the probe must still run.
		// LOCALIZED_ONLY_STDERR: NO English text at all — promptSeen is false,
		// and the probe must STILL run (the localized-auth regression).

		function ambiguousRunSpawner() {
			return ambiguousSpawner();
		}

		function localizedOnlyRunSpawner() {
			const { spawner } = makeFakeSpawner({ stderr: LOCALIZED_ONLY_STDERR, code: 1 });
			return spawner;
		}

		it("keeps the cache on the FIRST ambiguous failure with a non-terminal probe (strike 1 of two) — with the one-more-attempt warning", async () => {
			const { authProbe, calls } = probeSpy(false);
			const tool = createSudoExecTool({ spawner: ambiguousRunSpawner(), authProbe });
			credentialCache.set("badpw-de", 60_000);
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			const result = await run(tool, ctx, { command: "reboot", reason: "retry service" });

			expect(result.isError).toBe(true);
			const text = (result.content[0] as { text: string }).text;
			// the failure came from the probe, not an English signature — say so
			expect(text).not.toMatch(/authentication failed/i); // not yet invalidated
			expect(text).toMatch(/one more attempt/i); // the honest strike-1 warning
			expect(credentialCache.get()?.password).toBe("badpw-de"); // kept on strike 1 (no-reuse sudoers may probe-fail with a CORRECT password)
			expect(credentialCache.get()?.failStreak).toBe(1);
			expect(calls()).toBe(1);
		});

		it("keeps the cache (and resets a carried streak) when the probe succeeds — valid credential ticket means the command itself failed, NOT the auth", async () => {
			const { authProbe, calls } = probeSpy(true);
			const tool = createSudoExecTool({ spawner: ambiguousRunSpawner(), authProbe });
			credentialCache.set("goodpw", 60_000);
			credentialCache.bumpFailStreak(); // carried streak from an earlier ambiguous failure
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			const result = await run(tool, ctx, { command: "systemctl restart dnsmasq", reason: "flip" });

			// a normal command failure, not an auth failure
			expect(result.isError).toBe(true);
			const text = (result.content[0] as { text: string }).text;
			expect(text).not.toMatch(/authentication/i);
			expect((result.details as { error?: string }).error).toMatch(/command failed with exit code 1/i);
			// the good credential must NOT have been thrown away
			expect(credentialCache.get()?.password).toBe("goodpw");
			// ticket-terminal probe clears the carried streak — the next ambiguous failure starts at 1
			expect(credentialCache.get()?.failStreak).toBe(0);
			expect(calls()).toBe(1);
		});

		it("keeps the cache on the first ambiguous failure when the probe itself errors — strike 1, not an immediate clear", async () => {
			const { authProbe, calls } = probeSpy(false, true);
			const tool = createSudoExecTool({ spawner: ambiguousRunSpawner(), authProbe });
			credentialCache.set("pw", 60_000);
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			const result = await run(tool, ctx, { command: "wake lock", reason: "test" });

			// a probe that blew up must NOT escape as a tool error — it is a non-terminal probe
			expect(result.isError).toBe(true);
			const text = (result.content[0] as { text: string }).text;
			expect(text).not.toMatch(/authentication failed/i); // not yet invalidated
			expect(text).toMatch(/one more attempt/i);
			expect(credentialCache.get()?.password).toBe("pw"); // strike 1: keep
			expect(credentialCache.get()?.failStreak).toBe(1);
			expect(calls()).toBe(1);
		});

		it("does NOT probe on the English-signature fast path (backwards-compatible: one spawn, no probe)", async () => {
			const { spawner, last } = makeFakeSpawner({
				stderr: "[sudo] password for daniel: \nsorry, try again.\n3 incorrect password attempts\n",
				code: 1,
			});
			const { authProbe, calls } = probeSpy(true);
			const tool = createSudoExecTool({ spawner, authProbe });
			credentialCache.set("badpw", 60_000);
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			const result = await run(tool, ctx, { command: "reboot", reason: "retry service" });

			expect(result.isError).toBe(true);
			expect((result.content[0] as { text: string }).text).toMatch(/authentication|incorrect password/i);
			expect(credentialCache.get()).toBeNull();
			expect(calls()).toBe(0); // signature matched — no probe
			expect(last.command).toBe("sudo");
		});

		it("never probes a timed-out run, even when the prompt was seen (124/137 branches stay untouched)", async () => {
			const { spawner } = makeFakeSpawner({ stderr: "[sudo] password for daniel: ", code: null, exitOn: "kill" });
			const { authProbe, calls } = probeSpy(true);
			const tool = createSudoExecTool({ spawner, authProbe });
			credentialCache.set("pw", 60_000);
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			const result = await run(tool, ctx, { command: "sleep", reason: "test", timeoutMs: 10 });

			expect(result.isError).toBe(true);
			expect((result.details as { error?: string }).error).toMatch(/timed out after 10ms/i);
			expect(calls()).toBe(0);
		});

		it("verifies the probe still runs on a localized-sudo failure with NO English prompt text at all (promptSeen=false — the key regression) — and keeps the cache on strike 1", async () => {
			const { authProbe, calls } = probeSpy(false);
			const tool = createSudoExecTool({ spawner: localizedOnlyRunSpawner(), authProbe });
			credentialCache.set("badpw-de", 60_000);
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			const result = await run(tool, ctx, { command: "reboot", reason: "retry service" });

			expect(result.isError).toBe(true);
			const text = (result.content[0] as { text: string }).text;
			expect(text).not.toMatch(/authentication failed/i); // strike 1: not yet invalidated
			expect(text).toMatch(/one more attempt/i);
			expect(credentialCache.get()?.password).toBe("badpw-de");
			expect(credentialCache.get()?.failStreak).toBe(1);
			expect(calls()).toBe(1); // the probe ran despite promptSeen=false
		});

		it("keeps the cache on a no-English-prompt failure when the ticket is valid (probe disambiguates auth from command failure)", async () => {
			const { authProbe, calls } = probeSpy(true);
			const tool = createSudoExecTool({ spawner: localizedOnlyRunSpawner(), authProbe });
			credentialCache.set("goodpw", 60_000);
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			const result = await run(tool, ctx, { command: "systemctl restart dnsmasq", reason: "flip" });

			expect(result.isError).toBe(true);
			expect((result.content[0] as { text: string }).text).not.toMatch(/authentication/i);
			expect((result.details as { error?: string }).error).toMatch(/command failed with exit code 1/i);
			expect(credentialCache.get()?.password).toBe("goodpw");
			expect(calls()).toBe(1);
		});
	});

	describe("two-strike rule on ambiguous auth failure (fail streak on the cached credential)", () => {
		it("a second consecutive ambiguous failure (probe non-terminal) on the same cached entry clears the cache and re-prompts, auth-failed-flavored", async () => {
			const spawner = stepSpawner([
				{ stderr: NON_ENGLISH_STDERR, code: 1 }, // strike 1
				{ stderr: NON_ENGLISH_STDERR, code: 1 }, // strike 2
			]);
			const { authProbe, calls } = probeSpy(false);
			const tool = createSudoExecTool({ spawner, authProbe });
			credentialCache.set("badpw-de", 60_000);
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			const first = await run(tool, ctx, { command: "reboot", reason: "first run" });
			expect(first.isError).toBe(true);
			expect((first.content[0] as { text: string }).text).toMatch(/one more attempt/i);
			expect(credentialCache.get()?.failStreak).toBe(1);

			const second = await run(tool, ctx, { command: "reboot", reason: "second run" });
			expect(second.isError).toBe(true);
			const text = (second.content[0] as { text: string }).text;
			expect(text).toMatch(/authentication failed/i);
			expect(text).toMatch(/twice in a way that looks like authentication failure/i);
			expect(text).toMatch(/re-prompt/i);
			expect(credentialCache.get()).toBeNull(); // bad-password reuse is finally cut off
			expect(calls()).toBe(2); // both runs probed
		});

		it("a successful run (exit 0) resets a carried streak and the cache stays alive — the next ambiguous failure starts at 1 again", async () => {
			const spawner = stepSpawner([
				{ stderr: NON_ENGLISH_STDERR, code: 1 }, // ambiguous → strike 1
				{ stdout: "ok\n", code: 0 },           // success → reset
				{ stderr: NON_ENGLISH_STDERR, code: 1 }, // ambiguous again → must be strike 1, not a clear
			]);
			const { authProbe, calls } = probeSpy(false);
			const tool = createSudoExecTool({ spawner, authProbe });
			credentialCache.set("pw", 60_000);
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			await run(tool, ctx, { command: "svc a", reason: "1" });
			expect(credentialCache.get()?.failStreak).toBe(1);

			const success = await run(tool, ctx, { command: "svc b", reason: "2" });
			expect(success.isError).toBeFalsy();
			expect(credentialCache.get()?.password).toBe("pw");
			expect(credentialCache.get()?.failStreak).toBe(0); // the reset — pinned

			const third = await run(tool, ctx, { command: "svc c", reason: "3" });
			expect(third.isError).toBe(true);
			expect((third.content[0] as { text: string }).text).toMatch(/one more attempt/i);
			expect(credentialCache.get()?.password).toBe("pw"); // kept AGAIN — a fresh strike #1
			expect(credentialCache.get()?.failStreak).toBe(1);
			expect(calls()).toBe(2); // runs 1 and 3 probed; the success never does
		});

		it("the English fast path clears the cache immediately regardless of streak (unchanged behavior, no probe on strike 2)", async () => {
			const spawner = stepSpawner([
				{ stderr: NON_ENGLISH_STDERR, code: 1 },                                               // ambiguous → streak 1
				{ stderr: "[sudo] password for daniel: \nsorry, try again.\n3 incorrect password attempts\n", code: 1 }, // fast path
			]);
			const { authProbe, calls } = probeSpy(false); // non-terminal probe → strike 1, not a ticket-valid reset
			const tool = createSudoExecTool({ spawner, authProbe });
			credentialCache.set("badpw", 60_000);
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			const first = await run(tool, ctx, { command: "reboot", reason: "1" });
			expect(first.isError).toBe(true);
			expect(credentialCache.get()?.failStreak).toBe(1);

			const second = await run(tool, ctx, { command: "reboot", reason: "2" });
			expect(second.isError).toBe(true);
			expect((second.content[0] as { text: string }).text).toMatch(/authentication failed \(incorrect password\)/i);
			expect(credentialCache.get()).toBeNull(); // cleared immediately — fast path never waits for strike 2
			expect(calls()).toBe(1); // run 1 probed (ambiguous); run 2's signature match skipped the probe
		});

		it("a transport failure (-1) mid streak 1 leaves the streak UNCHANGED — the next ambiguous failure is still strike #2", async () => {
			let i = 0;
			const ambient = ambiguousSpawner();
			const spawner: SudoSpawner = (command, args) => {
				i += 1;
				if (i === 2) return erroredChild(); // transport failure says nothing about the credential
				return ambient(command, args);
			};
			const { authProbe } = probeSpy(false);
			const tool = createSudoExecTool({ spawner, authProbe });
			credentialCache.set("pw", 60_000);
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			const r1 = await run(tool, ctx, { command: "apt update", reason: "1" });
			expect(r1.isError).toBe(true);
			expect(credentialCache.get()?.failStreak).toBe(1);

			const r2 = await run(tool, ctx, { command: "apt update", reason: "2" });
			expect(r2.isError).toBe(true);
			expect((r2.content[0] as { text: string }).text).toMatch(/failed to run privileged command/i);
			expect((r2.content[0] as { text: string }).text).not.toMatch(/authentication failed/i);
			expect(credentialCache.get()?.password).toBe("pw");
			expect(credentialCache.get()?.failStreak).toBe(1); // transport failure is not a strike

			const r3 = await run(tool, ctx, { command: "apt update", reason: "3" });
			expect(r3.isError).toBe(true);
			expect(credentialCache.get()).toBeNull(); // the next ambiguous failure IS strike #2 → clear
		});
	});

	describe("process-group kill on timeout/abort (elevated descendants)", () => {
		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("spawns with { detached: true } so the command owns its own process group", async () => {
			const { spawner } = makeFakeSpawner({ stderr: "", code: 0 });
			const captured: Array<{ detached: boolean } | undefined> = [];
			const wrapping = (command: string, args: string[], options?: { detached: boolean }) => {
				captured.push(options);
				return spawner(command, args);
			};
			const tool = createSudoExecTool({ spawner: wrapping, authProbe: () => Promise.resolve(true) });
			credentialCache.set("pw", 60_000);
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			await run(tool, ctx, { command: "echo hi", reason: "test" });

			expect(captured).toEqual([{ detached: true }]);
		});

		it("timeout kill hits the whole process group first (-pid SIGKILL), so root descendants cannot survive", async () => {
			const { spawner } = makeFakeSpawner({ stderr: "", code: null, exitOn: "kill" });
			const killSpy = vi.spyOn(process, "kill").mockImplementation((pid?: number) => {
				if (pid !== -4242) {
					throw Object.assign(new Error("unexpected kill target"), { code: "ESRCH" });
				}
				return true; // pretend the group kill succeeds — the fake child never exits on its own
			});
			const tool = createSudoExecTool({ spawner, authProbe: () => Promise.resolve(true) });
			credentialCache.set("pw", 60_000);
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());

			// settles via runSudo's 2s exit fallback (the faked group kill leaves the
			// fake child unexited) → exercises the 124 branch, which must never probe
			const result = await run(tool, ctx, { command: "sleep", reason: "test", timeoutMs: 10 });

			expect(result.isError).toBe(true);
			expect((result.details as { error?: string }).error).toMatch(/timed out after 10ms/i);
			expect(killSpy).toHaveBeenLastCalledWith(-4242, "SIGKILL");
		}, 10_000);

		it("abort kill hits the whole process group first (-pid SIGKILL)", async () => {
			const { spawner, last } = makeFakeSpawner({ stderr: "starting…", code: null, exitOn: "kill" });
			const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
			const tool = createSudoExecTool({ spawner, authProbe: () => Promise.resolve(true) });
			credentialCache.set("pw", 60_000);
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());
			const controller = new AbortController();

			const promise = run(tool, ctx, { command: "long job", reason: "test", timeoutMs: 60_000 }, controller.signal);
			await new Promise((r) => setTimeout(r, 1)); // let execute pass the gate and spawn
			expect(last.command).toBe("sudo");

			controller.abort();

			const result = await promise;
			expect((result.details as { exitCode: number }).exitCode).toBe(130);
			expect(killSpy).toHaveBeenCalledWith(-4242, "SIGKILL");
		});

		it("falls back to a single-process SIGKILL when the group kill is impossible (ESRCH / already dead)", async () => {
			const { spawner, last } = makeFakeSpawner({ stderr: "starting…", code: null, exitOn: "kill" });
			vi.spyOn(process, "kill").mockImplementation(() => {
				throw Object.assign(new Error("no such process"), { code: "ESRCH" });
			});
			const tool = createSudoExecTool({ spawner, authProbe: () => Promise.resolve(true) });
			credentialCache.set("pw", 60_000);
			const ctx = tuiCtxWithSpies(true, spiesNoPrompt());
			const controller = new AbortController();

			const promise = run(tool, ctx, { command: "long job", reason: "test", timeoutMs: 60_000 }, controller.signal);
			await new Promise((r) => setTimeout(r, 1)); // let execute pass the gate and spawn

			controller.abort();

			const result = await promise;
			expect((result.details as { exitCode: number }).exitCode).toBe(130);
			// the group kill threw → the single-process fallback ran and settled the run
			expect(last.child.killed).toBe(true);
			expect(last.child.killSignals).toContain("SIGKILL");
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

function probeSpy(ok: boolean, throws = false) {
	let calls = 0;
	const authProbe: (timeoutMs: number, signal: AbortSignal | undefined) => Promise<boolean> = () => {
		calls += 1;
		if (throws) return Promise.reject(new Error("probe transport error"));
		return Promise.resolve(ok);
	};
	return { authProbe, calls: () => calls };
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
