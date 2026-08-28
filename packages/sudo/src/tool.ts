import { spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

import { credentialCache } from "./cache.js";
import { splitCommandIntoArgv } from "./argv-split.js";
import { loadSudoConfig } from "./config.js";
import { confirmCommand, promptForPassword } from "./prompt.js";

// ── Schemas ──────────────────────────────────────────────────────────────────

const SudoExecParamsSchema = Type.Object({
	command: Type.String({
		description:
			'Exact command and arguments to run with elevated privileges, e.g. "apt install ripgrep". Do NOT include a leading \'sudo\'. Executed directly via argv — no shell: avoid pipes, redirects, &&, env assignments, or quotes-as-syntax; pass multiple args space-separated, quote only literal args.',
	}),
	reason: Type.String({
		description: "Human-readable explanation of why this privileged command is needed, shown to the user before execution.",
	}),
	timeoutMs: Type.Optional(Type.Number({ description: "Optional timeout in milliseconds (default from config)." })),
});

export type SudoExecInput = Static<typeof SudoExecParamsSchema>;

export interface SudoExecDetails {
	command: string;
	reason: string;
	exitCode: number;
	stdout: string;
	stderr: string;
	error?: string;
}

// ── process plumbing ─────────────────────────────────────────────────────────

/** Structural subset of ChildProcess used by runSudo — injectable for tests. */
export interface SudoChild {
	readonly stdin?: { write(chunk: string): void; end(): void } | null;
	readonly stdout: { on(evt: string, cb: (data: Buffer) => void): unknown };
	readonly stderr: { on(evt: string, cb: (data: Buffer) => void): unknown };
	kill(signal?: NodeJS.Signals): boolean;
	on(evt: string, cb: (code: number | null, signal?: NodeJS.Signals | null) => void): unknown;
}

export type SudoSpawner = (command: string, args: string[]) => SudoChild;

const defaultSpawner: SudoSpawner = (command, args) => spawn(command, args);

export interface SudoRunResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	/** sudo printed its password prompt on stderr (normal for `sudo -S`). */
	authPromptSeen: boolean;
	/** stderr indicated the password was wrong — the credential is stale. */
	authFailed: boolean;
	/** the timeout fired and the child was SIGKILLed. */
	timedOut: boolean;
}

/**
 * Run `sudo -S <argv>`, writing the password to stdin only. `argv` is the
 * FULL argv (command first, e.g. ["sudo", "-S", "apt", "update"] from
 * buildSudoArgv); this splits the leading command off for the spawner. The
 * password never appears in argv or env. Uses spawn (never exec), enforces
 * the timeout with SIGKILL, and honours an externally-supplied abort signal.
 */
export function runSudo(
	commandArgv: string[],
	password: string,
	timeoutMs: number,
	signal: AbortSignal | undefined,
	spawner: SudoSpawner,
): Promise<SudoRunResult> {
	return new Promise<SudoRunResult>((resolve) => {
		const [command, ...args] = commandArgv;
		if (!command) {
			resolve({ exitCode: -1, stdout: "", stderr: "no command in argv", authPromptSeen: false, authFailed: false, timedOut: false });
			return;
		}
		const child = spawner(command, args);

		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;
		let exitFallback: ReturnType<typeof setTimeout> | undefined;

		const onStdout = (data: Buffer): void => {
			stdout += data.toString();
		};
		const onStderr = (data: Buffer): void => {
			stderr += data.toString();
		};
		child.stdout.on("data", onStdout);
		child.stderr.on("data", onStderr);

		const finish = (exitCode: number): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (exitFallback) clearTimeout(exitFallback);
			if (signal) signal.removeEventListener("abort", onAbort);
			resolve({
				exitCode,
				stdout,
				stderr,
				authPromptSeen: /\[sudo\] password for/i.test(stderr),
				// "3 incorrect password attempts" / "incorrect password" — only
				// meaningful when sudo actually asked for a password.
				authFailed: /\[sudo\] password for/i.test(stderr) && /incorrect password/i.test(stderr),
				timedOut,
			});
		};

		const onAbort = (): void => {
			child.kill("SIGKILL");
			finish(130);
		};

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
			// belt-and-braces: resolve even if no exit/close ever fires
			exitFallback = setTimeout(() => finish(124), 2000);
		}, timeoutMs);

		const onExit = (code: number | null, sig: NodeJS.Signals | null | undefined): void => {
			finish(code === null ? (sig === "SIGKILL" ? 137 : timedOut ? 124 : -1) : code);
		};
		child.on("exit", onExit);
		child.on("close", onExit);

		if (signal && signal.aborted) {
			child.kill("SIGKILL");
			finish(130);
			return;
		}
		if (signal) {
			signal.addEventListener("abort", onAbort);
		}

		// The password travels via stdin ONLY — sudo -S reads it from there.
		child.stdin?.write(`${password}\n`);
		child.stdin?.end();
	});
}

/**
 * Belt-and-braces: drop any line that contains the raw password so it can
 * never appear in tool details/result content (normally stderr is clean —
 * the password never appears in argv — but scrub defensively).
 */
export function scrubSecret(text: string, secret: string): string {
	if (!secret) return text;
	return text
		.split("\n")
		.map((line) => (line.includes(secret) ? "[redacted]" : line))
		.join("\n");
}

/**
 * Build the full argv for `sudo -S <command>`. A proper POSIX-ish word
 * split (quoted args stay single argv entries) — never a shell string.
 * A stray leading `sudo` is stripped so `sudo -S` is applied exactly once.
 */
export function buildSudoArgv(command: string): string[] {
	let words = splitCommandIntoArgv(command.trim());
	if (words[0] === "sudo") words = words.slice(1);
	return ["sudo", "-S", ...words];
}

// ── Tool ─────────────────────────────────────────────────────────────────────

const SUDO_EXEC_DESCRIPTION = `Run a command with elevated privileges using sudo.

- BEFORE any credential is requested, the exact command and its reason are shown to the user for confirmation.
- The password is entered only through a masked UI, passed to sudo via stdin, cached in memory for the session, and never exposed.
- Use this instead of sudo in bash — interactive sudo in bash is blocked.
- The command is executed as argv, NOT through a shell: no pipes, redirects, &&, ;, or env assignments; pass args space-separated, quote only literal args.`;

/**
 * Create the sudo_exec tool definition. Options are a test seam: pass a
 * custom spawner to exercise execution paths without real processes.
 */
export function createSudoExecTool(options: { spawner?: SudoSpawner } = {}) {
	const spawner = options.spawner ?? defaultSpawner;

	const fail = (text: string, details: SudoExecDetails) => ({
		content: [{ type: "text" as const, text }],
		details,
		isError: true,
	});

	return {
		name: "sudo_exec",
		label: "sudo",
		description: SUDO_EXEC_DESCRIPTION,
		parameters: SudoExecParamsSchema,

		// NOTE: no return-type annotation on execute — pi reads `isError` at
		// runtime though AgentToolResult omits it; the inferred union escapes
		// fresh-literal excess-property checking (same convention as todo/mcp).
		async execute(
			_toolCallId: string,
			params: SudoExecInput,
			signal: AbortSignal | undefined,
			_onUpdate: undefined,
			ctx: ExtensionContext,
		) {
			const config = loadSudoConfig();
			const command = params.command.trim();
			const reason = params.reason.trim();

			if (!command) {
				return fail("The command is empty — provide the exact command to run with elevated privileges.", {
					command,
					reason,
					exitCode: -1,
					stdout: "",
					stderr: "",
					error: "empty command",
				});
			}

			if (ctx.mode !== "tui") {
				return fail("sudo_exec requires an interactive session — run privileged commands from the main session.", {
					command,
					reason,
					exitCode: -1,
					stdout: "",
					stderr: "",
					error: "headless session",
				});
			}

			// Display the exact command + reason and require confirmation
			// BEFORE any credential is acquired.
			const confirmed = await confirmCommand(ctx, command, reason);
			if (!confirmed) {
				return fail("Command not confirmed — not executed, and no password was requested.", {
					command,
					reason,
					exitCode: -1,
					stdout: "",
					stderr: "",
					error: "command not confirmed",
				});
			}

			let credential = credentialCache.get();
			if (!credential) {
				const password = await promptForPassword(ctx, command, reason);
				if (!password) {
					return fail("Password entry cancelled — not executed, and nothing was cached.", {
						command,
						reason,
						exitCode: -1,
						stdout: "",
						stderr: "",
						error: "password entry cancelled",
					});
				}
				credentialCache.set(password, config.ttlMs);
				credential = credentialCache.get();
				if (!credential) {
					return fail("Password was not cached — aborting without executing.", {
						command,
						reason,
						exitCode: -1,
						stdout: "",
						stderr: "",
						error: "cache unavailable",
					});
				}
			}

			const timeoutMs = params.timeoutMs && params.timeoutMs > 0 ? params.timeoutMs : config.defaultTimeoutMs;
			const run = await runSudo(buildSudoArgv(command), credential.password, timeoutMs, signal, spawner);

			const stdout = scrubSecret(run.stdout, credential.password);
			const stderr = scrubSecret(run.stderr, credential.password);

			if (run.authFailed) {
				credentialCache.clear();
				return fail(
					`sudo authentication failed (incorrect password) — exit code ${run.exitCode}. The in-memory credential cache was cleared; the user will be re-prompted on the next attempt.`,
					{ command, reason, exitCode: run.exitCode, stdout, stderr, error: "authentication failed" },
				);
			}

			if (run.timedOut) {
				return {
					content: [{ type: "text" as const, text: stdout }],
					details: {
						command,
						reason,
						exitCode: run.exitCode,
						stdout,
						stderr,
						error: `timed out after ${timeoutMs}ms — command was killed`,
					} satisfies SudoExecDetails,
					isError: true,
				};
			}

			const isError = run.exitCode !== 0;
			if (!isError) {
				return {
					content: [{ type: "text" as const, text: stdout }],
					details: { command, reason, exitCode: run.exitCode, stdout, stderr } satisfies SudoExecDetails,
				};
			}
			return {
				content: [{ type: "text" as const, text: stdout }],
				details: {
					command,
					reason,
					exitCode: run.exitCode,
					stdout,
					stderr,
					error: `command failed with exit code ${run.exitCode}`,
				} satisfies SudoExecDetails,
				isError: true,
			};
		},
	};
}

export function registerSudoTool(pi: ExtensionAPI, options?: { spawner?: SudoSpawner }): void {
	pi.registerTool(createSudoExecTool(options));
}
