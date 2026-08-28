import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { credentialCache } from "./cache.js";
import { splitCommandIntoArgv } from "./argv-split.js";
import { DEFAULT_SUDO_CONFIG, loadSudoConfig, saveSudoConfig, type SudoConfig } from "./config.js";
import { handleBashToolCall, isInteractiveSudoAttempt, type GuardResult } from "./guard.js";
import { confirmCommand, maskLine, promptForPassword } from "./prompt.js";
import { buildSudoArgv, createSudoExecTool, registerSudoTool, scrubSecret, type SudoSpawner } from "./tool.js";

/**
 * Registers `sudo_exec` (Task 1) AND the bash-sudo guard (Task 2): a
 * `pi.on("tool_call")` veto that blocks interactive `sudo` issued through
 * the built-in bash tool — the handler's `{ block: true }` makes the shell
 * spawn never run (ADR 0010; NOT the observational `tool_execution_start`
 * bus event). Registered at the top level, not inside a session handler
 * (nested registration accumulates on `/reload`).
 */
export function registerSudo(pi: ExtensionAPI, options?: { spawner?: SudoSpawner }): void {
	registerSudoTool(pi, options);
	// Active veto: the guard is pure (isInteractiveSudoAttempt) and exported for
	// direct testing; handleBashToolCall only vets — it never mutates event.input.
	pi.on("tool_call", (event) => handleBashToolCall(event));
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
