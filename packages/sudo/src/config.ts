import { loadConfig, saveConfig } from "@pi-archimedes/core/settings-io";

export interface SudoConfig {
	/**
	 * Suite-managed by meta's plugin gate (archimedes.sudo.enabled, ADR 0012).
	 * sudo NEVER reads this key — when off, meta skips registerSudo entirely.
	 * Declared here only so settings editors see the shape.
	 */
	enabled?: boolean;
	/** Password cache TTL in ms. Default 15 min. */
	ttlMs: number;
	/** sudo_exec default command timeout in ms. Default 120 s. */
	defaultTimeoutMs: number;
}

export const DEFAULT_SUDO_CONFIG: SudoConfig = {
	ttlMs: 900_000,
	defaultTimeoutMs: 120_000,
};

export function loadSudoConfig(): SudoConfig {
	return loadConfig("archimedes.sudo", DEFAULT_SUDO_CONFIG);
}

export function saveSudoConfig(config: SudoConfig): void {
	saveConfig("archimedes.sudo", config);
}
