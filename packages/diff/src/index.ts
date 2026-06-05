/**
 * @pi-archimedes/diff — Shiki-powered terminal diff rendering.
 *
 * Adapted from pi-ui-hephaestus diff renderer.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";

import { setConfigGetter as setShikiConfig } from "./shiki.js";
import { setConfigGetter as setRenderConfig } from "./render/index.js";
import { DiffComponent } from "./diff-component.js";
import type { DiffBg, DiffColors } from "./ansi/index.js";
import { registerWriteTool, registerEditTool } from "./tools/index.js";

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { DiffComponent } from "./diff-component.js";
export type { DiffBg, DiffColors } from "./ansi/index.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface DiffConfig {
	diffTheme: string;
	diffSplitMinWidth: number;
	diffSplitMinCodeWidth: number;
}

const DEFAULT_DIFF_CONFIG: DiffConfig = {
	diffTheme: "github-dark",
	diffSplitMinWidth: 150,
	diffSplitMinCodeWidth: 60,
};

let _readConfig: () => DiffConfig = () => DEFAULT_DIFF_CONFIG;
function getConfig(): DiffConfig { return _readConfig(); }

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function getDiffSettingsItems(): SettingItem[] {
	const config = getConfig();
	return [
		{
			id: "diffTheme",
			label: "Diff Theme",
			description: "Shiki theme for diff syntax highlighting",
			currentValue: config.diffTheme,
		},
		{
			id: "diffSplitMinWidth",
			label: "Split Min Width",
			description: "Minimum terminal width for split diff view",
			currentValue: String(config.diffSplitMinWidth),
		},
		{
			id: "diffSplitMinCodeWidth",
			label: "Split Min Code Width",
			description: "Minimum code column width for split diff view",
			currentValue: String(config.diffSplitMinCodeWidth),
		},
	];
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export function registerDiffTools(
	pi: ExtensionAPI,
	_getTheme: () => Theme,
	readConfig: () => DiffConfig,
): void {
	_readConfig = readConfig;

	// Wire config getters into submodules
	setShikiConfig(() => getConfig());
	setRenderConfig(() => getConfig());

	(async () => {
		let createWriteTool: any, createEditTool: any, TextComponent: any;
		try {
			const sdk = await import("@earendil-works/pi-coding-agent");
			const tui = await import("@earendil-works/pi-tui");
			createWriteTool = sdk.createWriteTool;
			createEditTool = sdk.createEditTool;
			TextComponent = tui.Text;
		} catch (error) {
			console.error(
				`[diff] failed to load Pi SDK: ${error instanceof Error ? error.message : String(error)}`,
			);
			return;
		}
		if (!createWriteTool || !createEditTool || !TextComponent) return;

		const cwd = process.cwd();
		const home = process.env.HOME ?? "";

		// Register write tool override
		registerWriteTool(pi, cwd, home, createWriteTool, TextComponent);

		// Register edit tool override
		registerEditTool(pi, cwd, home, createEditTool);
	})().catch(console.error);
}
