import { loadConfig, saveConfig, removeConfig } from "@pi-archimedes/core/settings-io";
import type { UIConfig } from "./config.js";

export const UI_CONFIG_KEYS: readonly (keyof UIConfig)[] = [
  "bashToolStyling",
  "mutedTheme",
  "autoCollapseThinking",
  "compactThinking",
  "codeUnindent",
  "labelText",
  "labelColor",
  "animationStyle",
  "editorSpinBorder",
  "editorSpinSpeed",
  "editorSpinLabel",
  "editorSpinStyle",
] as const;

/**
 * One-time migration: copies any existing UI keys from archimedes.core to archimedes.ui
 * and removes them from archimedes.core. If archimedes.core is left empty, the namespace is removed.
 */
export function migrateCoreToUIConfig(): void {
  const core = loadConfig("archimedes.core", {}) as Record<string, unknown>;
  const keysToMigrate = UI_CONFIG_KEYS.filter((k) => k in core);
  if (keysToMigrate.length === 0) return;

  const ui = loadConfig("archimedes.ui", {}) as Record<string, unknown>;

  for (const key of keysToMigrate) {
    if (!(key in ui)) {
      ui[key] = core[key];
    }
    delete core[key];
  }

  saveConfig("archimedes.ui", ui);

  if (Object.keys(core).length === 0) {
    removeConfig("archimedes.core");
  } else {
    saveConfig("archimedes.core", core);
  }
}
