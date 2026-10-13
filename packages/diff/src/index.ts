/**
 * @pi-archimedes/diff — Shiki-powered terminal diff rendering.
 *
 * Adapted from pi-ui-hephaestus diff renderer.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, SettingItem } from "@earendil-works/pi-tui";

import { setConfigGetter as setShikiConfig } from "./shiki.js";
import { setConfigGetter as setRenderConfig } from "./render/index.js";
import { DiffComponent } from "./diff-component.js";
import type { DiffBg, DiffColors } from "./ansi/index.js";
import { resetDiffColors } from "./ansi/index.js";
import { installWriteTool, installEditTool } from "./tools/index.js";
import { diag } from "./log.js";
import { reportPiSupport } from "./pi-support.js";

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
	diffSplitWrapCheck?: boolean;
}

const DEFAULT_DIFF_CONFIG: DiffConfig = {
	diffTheme: "github-dark",
	diffSplitMinWidth: 150,
	diffSplitMinCodeWidth: 60,
	diffSplitWrapCheck: true,
};

let _readConfig: () => DiffConfig = () => DEFAULT_DIFF_CONFIG;
function getConfig(): DiffConfig { return _readConfig(); }

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function getDiffSettingsItems(overrideConfig?: DiffConfig): SettingItem[] {
	const config = overrideConfig ?? getConfig();
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
		{
			id: "diffSplitWrapCheck",
			label: "Split Wrap Check",
			description: "Fall back to unified diff if lines wrap",
			currentValue: (config.diffSplitWrapCheck ?? true) ? "On" : "Off",
			values: ["On", "Off"],
		},
	];
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

// `Text` is the component the `write` row reuses across repaints. It is loaded
// at module evaluation time (top-level await) so it is ready before any
// `session_start`; a failure here means the rows are skipped rather than
// half-installed.
let _TextComponent:
	| (new (text?: string, paddingX?: number, paddingY?: number) => Component)
	| null = null;

try {
	const tui = await import("@earendil-works/pi-tui");
	_TextComponent = tui.Text;
} catch (error) {
	// A missing SDK means the diff tool is not registered at all, which is a
	// developer-facing structural failure — the log file, never the console, and
	// with the stack: this error is swallowed, so nothing else ever prints it.
	// (Inlined rather than imported: `describeError` lives in core, which a
	// standalone install does not have — see `pi-support.ts`.)
	diag(
		"diff",
		`[diff] failed to load Pi SDK: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
	);
}

/**
 * Install the diff-drawing `edit` and `write` rows.
 *
 * Idempotent per `pi` handle, and it has to be: pi keeps a LIST of resolvers and
 * of event handlers per extension, so registering twice on the same extension
 * stacks a duplicate. It is keyed to the handle rather than to this module
 * because the two lifetimes differ — pi caches the compiled extension MODULE
 * across sessions while every session replacement (`/new`, `/fork`, `/resume`)
 * builds a fresh extension and hands registration a new handle. A module-wide
 * flag would then install for the first session only, and every session after
 * it would get pi's native `edit`/`write` rows and none of the result details
 * the rows read. The theme and config readers are per-session, so those are
 * refreshed on every call.
 */
const _installedExtensions = new WeakSet<object>();

export function registerDiffTools(
	pi: ExtensionAPI,
	_getTheme: () => Theme,
	readConfig: () => DiffConfig,
): void {
	// Floor check first, before anything can fail: pi 1.x APIs this package now
	// relies on are not guaranteed below 1.2.0, and a peer range cannot warn
	// anyone because pi never installs or solves peers (ADR 0026). Warn and
	// carry on — a `diff` that declined to load would make /plugins report an
	// enabled package that registered nothing. Idempotent per package, and this
	// runs again on every session_start.
	reportPiSupport("diff", "1.2.0");

	_readConfig = readConfig;

	// Reset theme-derived colors so they are re-derived from the current theme
	resetDiffColors();

	// Wire config getters into submodules
	setShikiConfig(() => getConfig());
	setRenderConfig(() => getConfig());

	// Already installed on this extension: re-registering would stack a duplicate
	// resolver and handler set. A different handle is a different extension, so
	// it installs even when this module instance is a reused one.
	if (_installedExtensions.has(pi)) return;

	if (!_TextComponent) {
		diag("diff", "[diff] SDK not available, skipping diff tool registration");
		return;
	}

	const cwd = process.cwd();
	const home = process.env.HOME ?? "";

	// Capability check, not a version wish: without renderer resolution there is
	// nothing to install, and pi's own rows stand in. The floor check above is
	// what tells the user why.
	if (typeof pi.registerToolRenderer !== "function" || typeof pi.on !== "function") {
		diag("diff", "[diff] pi has no registerToolRenderer(), skipping diff tool installation");
		return;
	}

	// The rows are chosen by pi's renderer resolution, and the result details
	// each row reads arrive through `tool_result` (ADR 0029). Neither registers a
	// tool, so pi's own `edit` and `write` stay in place.
	installEditTool(pi, cwd, home);
	installWriteTool(pi, cwd, home, _TextComponent);
	_installedExtensions.add(pi);
}

// ── Default export (for standalone pi.extensions loading) ─────────────────

// Diff tools need a per-session theme, so registration runs on session_start
// (mirroring meta's wiring: registerDiffTools with a theme getter + config
// reader). Meta supplies a settings-backed config loader; standalone uses the
// package defaults.
export default function (pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		registerDiffTools(pi, () => ctx.ui.theme, () => DEFAULT_DIFF_CONFIG);
	});
}
