// ── Re-export core config ──────────────────────────────────────────────

import {
  loadCoreConfig,
  saveCoreConfig,
  DEFAULT_CORE_CONFIG,
  ANIMATION_STYLES,
  type CoreConfig,
} from "@pi-archimedes/core/config";
export {
  loadCoreConfig,
  saveCoreConfig,
  DEFAULT_CORE_CONFIG,
  ANIMATION_STYLES,
  type CoreConfig,
} from "@pi-archimedes/core/config";

// ── Re-export footer config ────────────────────────────────────────────

import {
  loadFooterConfig,
  saveFooterConfig,
  DEFAULT_FOOTER_CONFIG,
  type FooterConfig,
} from "@pi-archimedes/footer/config";
export {
  loadFooterConfig,
  saveFooterConfig,
  DEFAULT_FOOTER_CONFIG,
  type FooterConfig,
} from "@pi-archimedes/footer/config";

// ── Diff config ────────────────────────────────────────────────────────

import type { DiffConfig } from "@pi-archimedes/diff";
import { loadConfig, saveConfig } from "@pi-archimedes/core/settings-io";
export type { DiffConfig } from "@pi-archimedes/diff";

export const DEFAULT_DIFF_CONFIG: DiffConfig = {
  diffTheme: "github-dark",
  diffSplitMinWidth: 150,
  diffSplitMinCodeWidth: 60,
};

const NAMESPACE = "archimedes.diff";

export function loadDiffConfig(): DiffConfig {
  return loadConfig(NAMESPACE, DEFAULT_DIFF_CONFIG);
}

export function saveDiffConfig(config: DiffConfig): void {
  saveConfig(NAMESPACE, config);
}

// ── Composed config loader ─────────────────────────────────────────────

export function loadAllConfig(): {
  core: CoreConfig;
  footer: FooterConfig;
  diff: DiffConfig;
} {
  return {
    core: loadCoreConfig(),
    footer: loadFooterConfig(),
    diff: loadDiffConfig(),
  };
}
