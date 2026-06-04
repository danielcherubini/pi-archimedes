import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

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

export interface DiffConfig {
  diffTheme: string;
  diffSplitMinWidth: number;
  diffSplitMinCodeWidth: number;
}

export const DEFAULT_DIFF_CONFIG: DiffConfig = {
  diffTheme: "github-dark",
  diffSplitMinWidth: 150,
  diffSplitMinCodeWidth: 60,
};

const SETTINGS_PATH = join(getAgentDir(), "settings.json");

export function loadDiffConfig(): DiffConfig {
  if (existsSync(SETTINGS_PATH)) {
    try {
      const full = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
      return { ...DEFAULT_DIFF_CONFIG, ...(full["archimedes.diff"] ?? {}) };
    } catch {
      /* ignore corrupt file */
    }
  }
  return DEFAULT_DIFF_CONFIG;
}

export function saveDiffConfig(config: DiffConfig): void {
  let full: Record<string, unknown> = {};
  if (existsSync(SETTINGS_PATH)) {
    try {
      full = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
    } catch {
      /* ignore corrupt file */
    }
  }
  full["archimedes.diff"] = config;
  writeFileSync(SETTINGS_PATH, JSON.stringify(full, null, 2), "utf-8");
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
