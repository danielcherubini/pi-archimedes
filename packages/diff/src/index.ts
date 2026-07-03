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
import { resetDiffColors } from "./ansi/index.js";
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

// Load SDK dependencies at module evaluation time (top-level await) so they are
// ready before any session_start event fires. If these imports fail the
// extension will skip diff tool registration gracefully.
let _sdk: { createWriteTool: any; createEditTool: any } | null = null;
let _TextComponent: any = null;

try {
  const [sdk, tui] = await Promise.all([
    import("@earendil-works/pi-coding-agent"),
    import("@earendil-works/pi-tui"),
  ]);
  _sdk = {
    createWriteTool: sdk.createWriteTool,
    createEditTool: sdk.createEditTool,
  };
  _TextComponent = tui.Text;
} catch (error) {
  console.error(
    `[diff] failed to load Pi SDK: ${error instanceof Error ? error.message : String(error)}`,
  );
}

export function registerDiffTools(
  pi: ExtensionAPI,
  _getTheme: () => Theme,
  readConfig: () => DiffConfig,
): void {
  _readConfig = readConfig;

  // Reset theme-derived colors so they are re-derived from the current theme
  resetDiffColors();

  // Wire config getters into submodules
  setShikiConfig(() => getConfig());
  setRenderConfig(() => getConfig());

  if (!_sdk?.createWriteTool || !_sdk?.createEditTool || !_TextComponent) {
    console.warn("[diff] SDK not available, skipping diff tool registration");
    return;
  }

  const cwd = process.cwd();
  const home = process.env.HOME ?? "";

  // Register write tool override
  registerWriteTool(pi, cwd, home, _sdk.createWriteTool, _TextComponent);

  // Register edit tool override
  registerEditTool(pi, cwd, home, _sdk.createEditTool);
}
