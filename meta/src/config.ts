// ── Re-export UI config ──────────────────────────────────────────────

import {
  loadCoreConfig,
  type CoreConfig,
} from "@pi-archimedes/core/config";
export {
  loadCoreConfig,
  type CoreConfig,
} from "@pi-archimedes/core/config";

// ── Re-export UI config ──────────────────────────────────────────────

import {
  loadUIConfig,
  saveUIConfig,
  DEFAULT_UI_CONFIG,
  type UIConfig,
  ANIMATION_STYLES,
} from "@pi-archimedes/ui/config";
export {
  loadUIConfig,
  saveUIConfig,
  DEFAULT_UI_CONFIG,
  type UIConfig,
  ANIMATION_STYLES,
} from "@pi-archimedes/ui/config";

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

// ── Re-export notify config ────────────────────────────────────────────

import {
  loadNotifyConfig,
  saveNotifyConfig,
  DEFAULT_NOTIFY_CONFIG,
  type NotifyConfig,
} from "@pi-archimedes/notify";
export {
  loadNotifyConfig,
  saveNotifyConfig,
  DEFAULT_NOTIFY_CONFIG,
  type NotifyConfig,
} from "@pi-archimedes/notify";

// ── Composed config loader ─────────────────────────────────────────────

export function loadAllConfig(): {
  core: CoreConfig;
  ui: UIConfig;
  footer: FooterConfig;
  diff: DiffConfig;
  notify: NotifyConfig;
  sessionName: SessionNameSettings;
} {
  return {
    core: loadCoreConfig(),
    ui: loadUIConfig(),
    footer: loadFooterConfig(),
    diff: loadDiffConfig(),
    notify: loadNotifyConfig(),
    sessionName: loadSessionNameConfigWrapper(),
  };
}

// ── Session name config ─────────────────────────────────────────────────

import type { SessionNameSettings } from "@pi-archimedes/session-name";
import { loadSessionNameConfig } from "@pi-archimedes/session-name";
export type { SessionNameSettings } from "@pi-archimedes/session-name";

export const DEFAULT_SESSION_NAME_CONFIG: SessionNameSettings = {
  model: undefined,
};

export function loadSessionNameConfigWrapper(): SessionNameSettings {
  return loadSessionNameConfig();
}

export function saveSessionNameConfig(config: SessionNameSettings): void {
  saveConfig("archimedes.sessionName", config);
}
