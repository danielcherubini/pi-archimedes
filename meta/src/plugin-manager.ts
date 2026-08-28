// ── /plugins — plugin manager ─────────────────────────────────────────────
//
// Single registration path for the /plugins command (mirrors the subagent
// package's registerAgentsCommand pattern). Reuses the settings-manager
// chrome for a minimal per-plugin list: each row has `values: ["On", "Off"]`
// cycled with ←/→, and every change persists immediately to
// archimedes.plugins. There are deliberately NO prompt descriptors — Enter /
// Space stay inert in list mode so the rows toggle instead of opening a
// text prompt.

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";
import { OVERLAY_CHROME } from "@pi-archimedes/core/overlay";

import {
  PLUGINS,
  isPluginEnabled,
  loadPluginsConfig,
  savePluginsConfig,
  type PluginDef,
} from "./plugins.js";
import { createSettingsManager } from "./settings-manager.js";

// Free-input descriptors are intentionally empty — no prompt mode.
const PLUGIN_PROMPTS: Record<string, never> = {};

export function registerPluginsCommand(pi: ExtensionAPI): void {
  pi.registerCommand("plugins", {
    description: "Enable or disable optional archimedes plugins",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await buildPluginManager(ctx);
    },
  });
}

/**
 * Open the plugin manager overlay. `plugins` defaults to the global
 * PLUGINS manifest; tests may inject stubbed entries.
 *
 * "Installed" probe: a plugin with a rejecting `load()` import is not
 * installed and is hidden from the menu (same semantics as the /plugins
 * registration gate — a missing package is simply absent).
 */
export async function buildPluginManager(
  ctx: ExtensionContext,
  plugins: PluginDef[] = PLUGINS,
): Promise<void> {
  const installed = (
    await Promise.all(
      plugins.map(async (p): Promise<PluginDef | null> => {
        try {
          await p.load();
          return p;
        } catch {
          return null; // not installed (or current broken) — hidden
        }
      }),
    )
  ).filter((p): p is PluginDef => p !== null);

  if (installed.length === 0) {
    ctx.ui.notify("No optional plugins installed.", "info");
    return;
  }

  const items: SettingItem[] = installed.map((p) => ({
    id: `plugin:${p.id}`,
    label: p.label,
    description: p.description,
    currentValue: isPluginEnabled(p.id) ? "On" : "Off",
    values: ["On", "Off"],
  }));

  await ctx.ui.custom(
    (_tui, theme, _keybindings, done) => {
      return createSettingsManager({
        items,
        prompts: PLUGIN_PROMPTS,
        theme,
        onChange: (id: string, newValue: string) => {
          const pluginId = id.startsWith("plugin:") ? id.slice("plugin:".length) : id;
          savePluginsConfig({ ...loadPluginsConfig(), [pluginId]: newValue === "On" });
        },
        onSave: () => {
          // Toggles already persist on change — nothing to save on exit.
        },
        onClose: () => {
          done(undefined);
        },
      });
    },
    { overlay: true, overlayOptions: OVERLAY_CHROME },
  );
}
