import { loadConfig, saveConfig, removeConfig } from "@pi-archimedes/core/settings-io";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import type { UIConfig } from "./config.js";

export const UI_CONFIG_KEYS: readonly (keyof UIConfig | "compactThinking")[] = [
  "bashToolStyling",
  "mutedTheme",
  "autoCollapseThinking",
  "compactThinking",
  "thinkingStyle",
  "toolStyle",
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

/**
 * One-time migration: removes the `toolStyle: "Full"` auto-expand patch from
 * `ToolExecutionComponent`'s prototype, if an older version installed it in
 * this process. The old patch saved the TRUE originals on the prototype under
 * `Symbol.for` markers (which survive a jiti re-evaluation); since the patch
 * is gone from the codebase, the wrappers would otherwise survive a `/reload`
 * in the same process and keep auto-expanding tools even when the reloaded
 * setting is Native/Minimal. Restoring the originals (and dropping the
 * markers) makes the removal stick. Idempotent: a no-op when the markers are
 * absent (fresh process, or never patched).
 */
export function migrateRemovedToolPatch(): void {
  const proto: any = ToolExecutionComponent?.prototype;
  if (!proto) return;
  const ORIG_UPDATE = Symbol.for("archimedes:toolOrigUpdate");
  const ORIG_SET_EXPANDED = Symbol.for("archimedes:toolOrigSetExpanded");
  if (proto[ORIG_UPDATE]) {
    proto.updateDisplay = proto[ORIG_UPDATE];
    delete proto[ORIG_UPDATE];
  }
  if (proto[ORIG_SET_EXPANDED]) {
    proto.setExpanded = proto[ORIG_SET_EXPANDED];
    delete proto[ORIG_SET_EXPANDED];
  }
}

/**
 * One-time migration: converts the legacy `compactThinking` setting to the new
 * `thinkingStyle` (Full/Compact) and removes `compactThinking` from archimedes.ui.
 * Idempotent: a no-op when `compactThinking` is already gone. An existing
 * `thinkingStyle` is preserved; `toolStyle` is never touched.
 */
export function migrateCompactThinkingToStyle(): void {
  const raw = loadConfig("archimedes.ui", {});
  if (!("compactThinking" in raw)) return; // idempotent no-op
  const migrated: Record<string, unknown> = { ...raw };
  delete migrated.compactThinking;
  if (!("thinkingStyle" in migrated)) {
    const legacy = raw.compactThinking;
    migrated.thinkingStyle =
      legacy === "Off" ? "Full"
      : legacy === "1 line" || legacy === "3 lines" || legacy === "5 lines" ? "Compact"
      : "Full";
  }
  saveConfig("archimedes.ui", migrated);
}
