import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { credentialCache } from "./cache.js";
import { splitCommandIntoArgv } from "./argv-split.js";
import { DEFAULT_SUDO_CONFIG, loadSudoConfig, saveSudoConfig, type SudoConfig } from "./config.js";
import { handleBashToolCall, isInteractiveSudoAttempt, type GuardResult } from "./guard.js";
import { confirmCommand, maskLine, promptForPassword } from "./prompt.js";
import { buildSudoArgv, createSudoExecTool, registerSudoTool, scrubSecret, type SudoSpawner } from "./tool.js";

/**
 * Registers `sudo_exec` (Task 1), the bash-sudo guard (Task 2) — a
 * `pi.on("tool_call")` veto that blocks interactive `sudo` issued through
 * the built-in bash tool — and the session lifecycle + `/sudo` command
 * (Task 3). ALL registrations happen at the top level of this function,
 * never inside a session handler (nested registration accumulates on
 * `/reload`).
 */
export function registerSudo(pi: ExtensionAPI, options?: { spawner?: SudoSpawner }): void {
	registerSudoTool(pi, options);
	// Active veto: the guard is pure (isInteractiveSudoAttempt) and exported for
	// direct testing; handleBashToolCall only vets — it never mutates event.input.
	pi.on("tool_call", (event) => handleBashToolCall(event));

	// Session lifecycle: the credential is a module singleton and must never
	// outlive a session — cleared at every session boundary (ADR 0010).
	pi.on("session_start", () => {
		credentialCache.clear();
	});
	pi.on("session_shutdown", () => {
		credentialCache.clear();
	});

	// /sudo — manage the credential cache (v1: state + forget, JSON-only config).
	pi.registerCommand("sudo", {
		description: "Manage the sudo credential cache",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const args = _args.trim();
			if (args === "forget") {
				credentialCache.clear();
				ctx.ui.notify("Sudo credential cleared.", "info");
				return;
			}
			if (args !== "") {
				ctx.ui.notify("Unknown /sudo subcommand. Usage: /sudo, /sudo forget", "info");
				return;
			}
			// Bare: report state. get() is expiry-aware, so a stale entry reads
			// as "not cached" (it re-prompts on next use) without being dropped.
			ctx.ui.notify(
				credentialCache.get() !== null
					? "Sudo credential cached."
					: "No sudo credential cached.",
				"info",
			);
		},
	});
}

// Exports for Tasks 2–3 (guard wiring, /sudo command + session lifecycle)
export {
	credentialCache,
	splitCommandIntoArgv,
	buildSudoArgv,
	scrubSecret,
	confirmCommand,
	promptForPassword,
	maskLine,
	loadSudoConfig,
	saveSudoConfig,
	DEFAULT_SUDO_CONFIG,
	createSudoExecTool,
	handleBashToolCall,
	isInteractiveSudoAttempt,
};
export type { SudoConfig, SudoSpawner, GuardResult };

// Standalone entry — pi's loader requires a default export (see the
// image-paste fix precedent). Under meta, the named exports are used.
export default function (pi: ExtensionAPI): void {
	registerSudo(pi);
}
