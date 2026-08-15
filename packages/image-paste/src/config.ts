import { Key, type KeyId } from "@earendil-works/pi-tui";
import { loadConfig } from "@pi-archimedes/core/settings-io";

export interface ImagePasteConfig {
  shortcuts?: KeyId[];
}

export const DEFAULT_IMAGE_PASTE_CONFIG: ImagePasteConfig = {};

const NAMESPACE = "archimedes.imagePaste";
const MODIFIERS = ["ctrl", "shift", "alt", "super"] as const;

const VALID_KEY_IDS = new Set<KeyId>();
const namedBaseKeys = Object.values(Key).filter(
  (key): key is Extract<typeof key, string> => typeof key === "string",
);
const baseKeys: string[] = [..."abcdefghijklmnopqrstuvwxyz0123456789", ...namedBaseKeys];

function addKeyIds(baseKey: string, modifiers: string[] = [], remaining: readonly string[] = MODIFIERS): void {
  VALID_KEY_IDS.add(`${modifiers.join("+")}${modifiers.length ? "+" : ""}${baseKey}` as KeyId);

  for (let index = 0; index < remaining.length; index++) {
    const modifier = remaining[index];
    if (modifier) {
      addKeyIds(baseKey, [...modifiers, modifier], remaining.filter((_, i) => i !== index));
    }
  }
}

for (const baseKey of baseKeys) {
  addKeyIds(baseKey);
}

function isKeyId(shortcut: unknown): shortcut is KeyId {
  return typeof shortcut === "string" && VALID_KEY_IDS.has(shortcut as KeyId);
}

export function loadImagePasteConfig(): ImagePasteConfig {
  return loadConfig(NAMESPACE, DEFAULT_IMAGE_PASTE_CONFIG);
}

function getDefaultShortcuts(platform: string): KeyId[] {
  if (platform === "win32") {
    return ["alt+v", "ctrl+alt+v"];
  }

  return ["ctrl+v", "alt+v", "ctrl+alt+v"];
}

/**
 * Resolve configured shortcuts, falling back to the established platform defaults
 * when the persisted value is absent or malformed. An empty array intentionally
 * disables image-paste shortcuts.
 */
export function resolveImagePasteShortcuts(platform: string, configured: unknown): KeyId[] {
  if (
    Array.isArray(configured) &&
    configured.every(isKeyId)
  ) {
    return configured;
  }

  return getDefaultShortcuts(platform);
}
