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
	readonly pid?: number | undefined;
	readonly stdin?: {
		write(chunk: string): void;
		end(): void;
		/** Stream error registration — present on real child stdin; optional so fakes can omit it. */
		on?(evt: "error", cb: (err: Error) => void): unknown;
	} | null;
	readonly stdout: { on(evt: string, cb: (data: Buffer) => void): unknown };
	readonly stderr: { on(evt: string, cb: (data: Buffer) => void): unknown };
	kill(signal?: NodeJS.Signals): boolean;
	on(evt: "exit" | "close", cb: (code: number | null, signal?: NodeJS.Signals | null) => void): unknown;
	on(evt: "error", cb: (err: Error) => void): unknown;
}

export type SudoSpawner = (command: string, args: string[], options?: { detached: boolean }) => SudoChild;

const defaultSpawner: SudoSpawner = (command, args, options) => spawn(command, args, options);

/** Short delay before the ONE retry of a transient group-kill failure. */
const GROUP_KILL_RETRY_DELAY_MS = 50;

function sleepMs(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Kill the command's ENTIRE process group — the child is spawned detached
 * (own group), so a root process that forked further survives
 * `child.kill()` alone. Group first: a DEFINITIVE ESRCH means the group no
 * longer exists — the whole group is already dead, so that is complete
 * success (no retry, no fallback). Only a non-ESRCH throw (transient /
 * state-uncertain) waits one short tick and retries the group signal ONCE
 * before falling back to the single-process kill; that last-ditch kill is
 * swallowed if it throws too — the child is gone in that case.
 */
async function killProcessTree(child: SudoChild): Promise<void> {
	if (!child.pid) return;
	try {
		process.kill(-child.pid, "SIGKILL");
		return;
	} catch (err) {
		if ((err as NodeJS.ErrnoException | undefined)?.code === "ESRCH") return; // group definitively dead — done
		await sleepMs(GROUP_KILL_RETRY_DELAY_MS);
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch (err) {
			if ((err as NodeJS.ErrnoException | undefined)?.code === "ESRCH") return; // retry confirmed the group is dead
			try {
				child.kill("SIGKILL");
			} catch {
				// even the single-process signal failed — the child is gone; nothing left to do
			}
		}
	}
}

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
	/**
	 * Process-level failure under the hood (spawn `error` event, spawner
	 * threw, fatal stdin write). When set, `exitCode` is -1 and `authFailed`
	 * / `timedOut` are false — surface as a tool failure, NOT an auth
	 * failure, and keep the credential cache.
	 */
	error?: string;
}

/** "ENOENT" et al. when the errno code is present, the error message otherwise. */
function errDetail(err: unknown): string {
	if (err instanceof Error) {
		const code = (err as NodeJS.ErrnoException).code;
		return code ?? err.message;
	}
	return String(err);
}

/**
 * Run `sudo -S <argv>`, writing the password to stdin only. `argv` is the
 * FULL argv (command first, e.g. ["sudo", "-S", "apt", "update"] from
 * buildSudoArgv); this splits the leading command off for the spawner. The
 * password never appears in argv or env. Uses spawn (never exec) with
 * `detached: true` so the command owns its process group; the timeout and
 * the honoured externally-supplied abort signal kill the WHOLE group with
 * SIGKILL (privileged descendants cannot survive).
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
			resolve({ exitCode: -1, stdout: "", stderr: "no command in argv", authPromptSeen: false, authFailed: false, timedOut: false, error: "no command in argv" });
			return;
		}

		let child: SudoChild;
		try {
			child = spawner(command, args, { detached: true });
		} catch (err) {
			// the spawner itself threw (platform/transport) — resolving the
			// failed shape instead of letting the throw escape the promise
			// executor, which would hand the tool an unhandled rejection.
			resolve({ exitCode: -1, stdout: "", stderr: "", authPromptSeen: false, authFailed: false, timedOut: false, error: `failed to spawn ${command}: ${errDetail(err)}` });
			return;
		}

		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;
		// An abort claims the settlement SYNCHRONOUSLY, before its (async,
		// retrying) group kill. While that kill is in flight, the child's
		// real 'exit'/'close' can still land with an ordinary 1–123 code —
		// without the flag the settled-once guard would let that exit win,
		// settling a user CANCELLATION as a command failure and dragging it
		// into the ticket-probe/two-strike path. With the flag, post-abort
		// exits/closes are swallowed: a cancellation is ALWAYS the 130 abort
		// outcome and never touches the credential bookkeeping.
		let abortSettled = false;
		let exitFallback: ReturnType<typeof setTimeout> | undefined;

		const onStdout = (data: Buffer): void => {
			stdout += data.toString();
		};
		const onStderr = (data: Buffer): void => {
			stderr += data.toString();
		};
		child.stdout.on("data", onStdout);
		child.stderr.on("data", onStderr);

		// A child 'error' with no listener (ENOENT for a missing sudo,
		// EACCES/EPERM, …) crashes the process. Always attach and route it
		// through the normal settle path; the settled guard swallows any
		// 'exit'/'close' that follows.
		child.on("error", (err) => {
			finish(-1, `failed to spawn ${command}: ${errDetail(err)}`);
		});

		let stdinReadSideClosed = false;
		// Asynchronous stdin-stream 'error' events are NOT caught by the
		// synchronous write/end try/catch below: a dead child's EPIPE can land
		// on a later tick after the write already completed. With no 'error'
		// listener on the stream, that event takes the whole host process
		// down. Policy (never false-fail a legitimate fast-exit success):
		//  • EPIPE / ECONNRESET — the child's read side is gone (e.g. a
		//    NOPASSWD sudo that finishes without ever reading the password).
		//    DECIDE NOTHING here: the 'exit' handler settles the run with the
		//    child's real code; if no exit ever comes, the dead process's own
		//    'error' path — or the timeout + exit fallback — settles it.
		//  • anything else — the child is alive but the channel went bad and
		//    the outcome is still undecided: settle a clean transport failure
		//    (credential cache retained); once settled, 'exit' has already won
		//    and this is ignored.
		// Both branches run under `finish`'s settled guard, so 'exit'/'close'
		// double events and out-of-order stream errors can't double-settle.
		child.stdin?.on?.("error", (err) => {
			const code = (err as NodeJS.ErrnoException | undefined)?.code;
			if (code === "EPIPE" || code === "ECONNRESET") {
				stdinReadSideClosed = true; // record only — 'exit' settles with the real code
				return;
			}
			if (!settled) finish(-1, `stdin failed: ${errDetail(err)}`);
		});

		const finish = (exitCode: number, error?: string): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (exitFallback) clearTimeout(exitFallback);
			if (signal) signal.removeEventListener("abort", onAbort);
			const result: SudoRunResult = {
				exitCode,
				stdout,
				stderr,
				authPromptSeen: /\[sudo\] password for/i.test(stderr),
				// "3 incorrect password attempts" / "incorrect password" — only
				// meaningful when sudo actually asked for a password.
				authFailed: /\[sudo\] password for/i.test(stderr) && /incorrect password/i.test(stderr),
				timedOut,
			};
			// exactOptionalPropertyTypes: attach `error` only when present.
			if (error !== undefined) result.error = error;
			resolve(result);
		};

		// The kill may transiently need its one retry (short real delay), so
		// it runs async: finish() stays EXACTLY ONCE via the settled guard,
		// called only AFTER the kill — same ordering as before. The
		// abortSettled flag is set FIRST (synchronously) so any exit/close
		// event landing while the kill awaits its retry tick cannot win the
		// settled-once race against the 130 settle.
		const onAbort = (): void => {
			abortSettled = true;
			void killProcessTree(child).then(() => finish(130));
		};

		const timer = setTimeout(() => {
			timedOut = true;
			void killProcessTree(child); // fire-and-forget: the 2s exit fallback below settles if no exit comes
			// belt-and-braces: resolve even if no exit/close ever fires
			exitFallback = setTimeout(() => finish(124), 2000);
		}, timeoutMs);

		const onExit = (code: number | null, sig: NodeJS.Signals | null | undefined): void => {
			// Post-abort exit/close (the child finally died while the abort's
			// async group kill was still retrying): swallow — the abort already
			// claimed the settlement and finish(130) will land when the bounded
			// kill completes.
			if (abortSettled) return;
			finish(code === null ? (sig === "SIGKILL" ? 137 : timedOut ? 124 : -1) : code);
		};
		child.on("exit", onExit);
		child.on("close", onExit);

		if (signal && signal.aborted) {
			abortSettled = true;
			void killProcessTree(child).then(() => finish(130));
			return;
		}
		if (signal) {
			signal.addEventListener("abort", onAbort);
		}

		// The password travels via stdin ONLY — sudo -S reads it from there.
		// A fatal EPIPE / ERR_STREAM_DESTROYED (child died before reading it)
		// is NOT an auth failure: route it through the failed process shape
		// instead of throwing out of the async function.
		try {
			child.stdin?.write(`${password}\n`);
			child.stdin?.end();
		} catch (err) {
			finish(-1, `failed to write to child stdin: ${errDetail(err)}`);
		}
	});
}

/** Timeout for the credential ticket probe (see probeSudoTicket). */
export const AUTH_PROBE_TIMEOUT_MS = 5000;

/**
 * Honest warning surfaced (content + details) on the FIRST ambiguous failure
 * — a non-zero exit without a recognizable failure signature whose
 * credential probe came back non-terminal: the credential is unverified but
 * NOT yet invalidated (a no-reuse sudoers policy makes `sudo -n -v` fail even
 * for a CORRECT password). Kept for one more attempt; a second consecutive
 * ambiguous failure on the same cached entry clears it and re-prompts.
 */
const AMBIGUOUS_CREDENTIAL_WARNING =
	"the command failed and the cached credential could not be verified (no recognizable authentication failure, and the credential check did not confirm it) — the cached password is kept for one more attempt; if the password itself was wrong it will be cleared and re-prompted after one more such failure.";

/**
 * Locale-immune check that the cached credential is still usable: run
 * `sudo -n -v`. `-v` VALIDATES the credential timestamp without executing
 * any program — its success needs no program entry in the target sudoers,
 * unlike `sudo -n true` (a restricted sudoers can permit the requested
 * command while denying `true` (or not listing it), and a ticketless/no-reuse
 * policy can hold a freshly valid credential with no replayable ticket
 * for `-n true` to find). `-n` refuses to prompt, so nothing is written
 * to its stdin and it exits 0 iff validation succeeded. Takes no password
 * — by design.
 */
export async function probeSudoTicket(
	timeoutMs: number,
	signal: AbortSignal | undefined,
	spawner: SudoSpawner,
): Promise<boolean> {
	const run = await runSudo(["sudo", "-n", "-v"], "", timeoutMs, signal, spawner);
	return !run.timedOut && run.error === undefined && run.exitCode === 0;
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
 * custom spawner to exercise execution paths without real processes, and a
 * custom authProbe to control the ticket probe without spawning `sudo -n`.
 */
export function createSudoExecTool(options: {
	spawner?: SudoSpawner;
	/**
	 * Locale-immune credential check used to disambiguate a run that
	 * failed at the command level (normal non-zero exit) WITHOUT the
	 * English "incorrect password" fast-path signature matching — e.g.
	 * a non-English sudo. It is not gated on the prompt text: a
	 * localized prompt leaves no recognizer, and `sudo -n -v` (a
	 * password-free credential validation that executes no program)
	 * is safe to run after any command-level failure. Default: a
	 * spawner-based `sudo -n -v` ticket probe (probeSudoTicket). It
	 * never receives the password, by design.
	 */
	authProbe?: (timeoutMs: number, signal: AbortSignal | undefined) => Promise<boolean>;
} = {}) {
	const spawner = options.spawner ?? defaultSpawner;
	const authProbe = options.authProbe ?? ((timeoutMs: number, signal: AbortSignal | undefined) => probeSudoTicket(timeoutMs, signal, spawner));

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
			/** Set when the ambiguous-failure hit its first strike and the credential is kept unverified. */
			let unverifiedCredentialWarning = false;

			// Process-level failure (spawn 'error' event, spawner throw, fatal
			// stdin write) — surface it as a clean tool failure, never as an
			// auth failure, and never drop the password: a transport glitch is
			// transient relative to the credential itself.
			if (run.error) {
				return fail(`failed to run privileged command: ${run.error}`, {
					command,
					reason,
					exitCode: run.exitCode,
					stdout,
					stderr,
					error: run.error,
				});
			}

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

			// Locale-immune auth-failure disambiguation: the run exited
			// non-zero WITHOUT the English "incorrect password" fast-path
			// signature — a wrong password is indistinguishable from a
			// localized message (or a genuine command failure) on the
			// signature path alone. Probe the credential with `sudo -n -v`
			// (validates the ticket, executes no program, no password):
			// the probe succeeding means the credential is fine and the
			// command itself failed → normal result; the probe failing means
			// the credential is unverified. Two-strike rule on the AMBIGUOUS
			// path only: a no-reuse sudoers policy makes `sudo -n -v` fail
			// even for a CORRECT password (no reusable ticket), so the first
			// such failure keeps the credential with a visible one-more-attempt
			// warning; the SECOND consecutive ambiguous failure on the same
			// cached entry clears it and re-prompts. The English fast path
			// (above) still clears immediately, and success / run / /timeout
			// /abort outcomes reset (or leave untouched) the streak.
			// NOT gated on the prompt text — localized sudo emits a prompt in
			// the user's language, and after ANY command-level failure the
			// probe is safe (valid ticket → keep, no ticket → re-prompt).
			// Control/kill exits are excluded: -1 process error (handled
			// above), 124 timeout (handled above), 130 abort, 137 SIGKILL —
			// those aren't auth evidence and must not count as strikes.
			if (run.exitCode >= 1 && run.exitCode < 124) {
				let ticketValid = false;
				try {
					ticketValid = await authProbe(AUTH_PROBE_TIMEOUT_MS, signal);
				} catch {
					ticketValid = false; // probe transport error → non-terminal probe
				}
				if (ticketValid) {
					// Ticket terminal: the credential verified — drop any carried
					// streak; this is a straightforward command failure.
					credentialCache.resetFailStreak();
				} else {
					// Non-terminal probe: unverifiable credential — count a strike
					// on the CURRENT cached entry.
					credentialCache.bumpFailStreak();
					if ((credentialCache.get()?.failStreak ?? 0) >= 2) {
						credentialCache.clear();
						return fail(
							`sudo authentication failed — exit code ${run.exitCode}. The cached password produced two consecutive failures without a verifiable credential — the credential cache was cleared; you will be re-prompted for the password on the next sudo_exec.`,
							{ command, reason, exitCode: run.exitCode, stdout, stderr, error: "authentication failed" },
						);
					}
					unverifiedCredentialWarning = true; // strike 1: keep, warn, and fall through to the normal failure result
				}
			}

			const isError = run.exitCode !== 0;
			if (!isError) {
				credentialCache.resetFailStreak();
				return {
					content: [{ type: "text" as const, text: stdout }],
					details: { command, reason, exitCode: run.exitCode, stdout, stderr } satisfies SudoExecDetails,
				};
			}
			return {
				content: [{ type: "text" as const, text: unverifiedCredentialWarning ? `${stdout}\n(WARNING: ${AMBIGUOUS_CREDENTIAL_WARNING})` : stdout }],
				details: {
					command,
					reason,
					exitCode: run.exitCode,
					stdout,
					stderr,
					error: unverifiedCredentialWarning
						? `command failed with exit code ${run.exitCode} — WARNING: ${AMBIGUOUS_CREDENTIAL_WARNING}`
						: `command failed with exit code ${run.exitCode}`,
				} satisfies SudoExecDetails,
				isError: true,
			};
		},
	};
}

export function registerSudoTool(pi: ExtensionAPI, options?: { spawner?: SudoSpawner }): void {
	pi.registerTool(createSudoExecTool(options));
}
