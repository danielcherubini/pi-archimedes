import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { credentialCache } from "./cache.js";
import { splitCommandIntoArgv } from "./argv-split.js";
import { DEFAULT_SUDO_CONFIG, loadSudoConfig, saveSudoConfig, type SudoConfig } from "./config.js";
import { confirmCommand, maskLine, promptForPassword } from "./prompt.js";
import { buildSudoArgv, createSudoExecTool, registerSudoTool, scrubSecret, type SudoSpawner } from "./tool.js";

/**
 * Task 1 scope: registerSudo registers the `sudo_exec` tool and nothing else.
 * The bash-sudo guard (Task 2) and the `/sudo` command + session lifecycle
 * (Task 3) extend this. Enable/disable is meta's per-namespace plugin gate
 * (archimedes.sudo.enabled, ADR 0012) — sudo never reads it; when off,
 * meta skips registration entirely so execute never runs.
 */
export function registerSudo(pi: ExtensionAPI, options?: { spawner?: SudoSpawner }): void {
	registerSudoTool(pi, options);
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
};
export type { SudoConfig, SudoSpawner };

// Standalone entry — pi's loader requires a default export (see the
// image-paste fix precedent). Under meta, the named exports are used.
export default function (pi: ExtensionAPI): void {
	registerSudo(pi);
}
