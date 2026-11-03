import type { SettingItem } from "@earendil-works/pi-tui";

import { loadConfig, updateConfig } from "@pi-archimedes/core/settings-io";

// Kept free of the package's main entry (clipboard, renderer) so meta's
// /archimedes panel can import it without loading the lazily-loaded plugin.

const NAMESPACE = "archimedes.imagePaste";

/**
 * `archimedes.imagePaste.preview`, default on. Only the strict boolean `false`
 * disables it. Read per call so a settings change applies on the next submit.
 */
export function previewEnabled(): boolean {
  return loadConfig<{ preview: boolean }>(NAMESPACE, { preview: true }).preview !== false;
}

export function getImagePasteSettingsItems(): SettingItem[] {
  return [
    {
      id: "imagePastePreview",
      label: "Image Paste Preview",
      description: "Show an inline preview of pasted images after you submit",
      currentValue: previewEnabled() ? "On" : "Off",
      values: ["On", "Off"],
    },
  ];
}

/** Merges `preview` into the namespace; its other keys are kept. */
export function saveImagePastePreview(on: boolean): void {
  updateConfig<Record<string, unknown>>(NAMESPACE, {}, (cfg) => ({ ...cfg, preview: on }));
}
