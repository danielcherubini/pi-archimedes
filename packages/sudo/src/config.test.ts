import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock core/settings-io BEFORE importing loadSudoConfig — the real module
// builds its settings path at module load and would read/write the user's
// actual ~/.pi/agent/settings.json.
const store = vi.hoisted(() => ({
	settings: {} as Record<string, Record<string, unknown>>,
	saveCalls: [] as Array<{ namespace: string; config: object }>,
}));

vi.mock("@pi-archimedes/core/settings-io", () => ({
	loadConfig: (namespace: string, defaults: Record<string, unknown>) => ({
		...defaults,
		...store.settings[namespace],
	}),
	saveConfig: (namespace: string, config: Record<string, unknown>) => {
		store.saveCalls.push({ namespace, config });
		store.settings[namespace] = config;
	},
}));

import { DEFAULT_SUDO_CONFIG, loadSudoConfig, saveSudoConfig } from "./config.js";

describe("sudo config", () => {
	beforeEach(() => {
		for (const key of Object.keys(store.settings)) delete store.settings[key];
		store.saveCalls.length = 0;
	});

	it("exposes the shared defaults (15 min TTL, 120 s command timeout)", () => {
		expect(DEFAULT_SUDO_CONFIG).toEqual({ ttlMs: 900000, defaultTimeoutMs: 120000 });
	});

	it("returns the defaults when no archimedes.sudo section exists", () => {
		expect(loadSudoConfig()).toEqual(DEFAULT_SUDO_CONFIG);
	});

	it("merges a partial archimedes.sudo section over the defaults", () => {
		store.settings["archimedes.sudo"] = { ttlMs: 5000 };
		expect(loadSudoConfig()).toEqual({ ttlMs: 5000, defaultTimeoutMs: 120000 });
	});

	it("saveSudoConfig writes to the archimedes.sudo namespace", () => {
		saveSudoConfig({ ttlMs: 1234, defaultTimeoutMs: 5678 });
		expect(store.saveCalls).toEqual([{ namespace: "archimedes.sudo", config: { ttlMs: 1234, defaultTimeoutMs: 5678 } }]);
	});
});
