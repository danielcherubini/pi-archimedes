import type { KeyId } from "@earendil-works/pi-tui";
import { loadConfig } from "@pi-archimedes/core/settings-io";

export interface ImagePasteConfig {
  shortcuts?: KeyId[];
}

export const DEFAULT_IMAGE_PASTE_CONFIG: ImagePasteConfig = {};

const NAMESPACE = "archimedes.imagePaste";

export function loadImagePasteConfig(): ImagePasteConfig {
  return loadConfig(NAMESPACE, DEFAULT_IMAGE_PASTE_CONFIG);
}

function getDefaultShortcuts(platform: string): KeyId[] {
  if (platform === "win32") {
    return ["alt+v", "ctrl+alt+v"] as KeyId[];
  }

  return ["ctrl+v", "alt+v", "ctrl+alt+v"] as KeyId[];
}

/**
 * Resolve configured shortcuts, falling back to the established platform defaults
 * when the persisted value is absent or malformed. An empty array intentionally
 * disables image-paste shortcuts.
 */
export function resolveImagePasteShortcuts(platform: string, configured: unknown): KeyId[] {
  if (
    Array.isArray(configured) &&
    configured.every((shortcut) => typeof shortcut === "string" && shortcut.trim().length > 0)
  ) {
    return configured as KeyId[];
  }

  return getDefaultShortcuts(platform);
}
