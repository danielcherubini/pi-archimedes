import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";

import { getUISettingsItems, saveUIConfig, type UIConfig } from "@pi-archimedes/ui";
import { getFooterSettingsItems } from "@pi-archimedes/footer/config";
import { getNotifySettingsItems } from "@pi-archimedes/notify";
import { getSessionNameSettingsItems } from "@pi-archimedes/session-name";
import {
  loadAllConfig,
  saveFooterConfig,
  saveDiffConfig,
  saveNotifyConfig,
  saveSessionNameConfig,
  type NotifyConfig,
} from "./config.js";
import { isPluginEnabled } from "./plugins.js";
import { OVERLAY_CHROME } from "@pi-archimedes/core/overlay";
import { createSettingsManager, type PromptDescriptor } from "./settings-manager.js";

// ── Free-input prompt descriptors (keyed by item.id) ───────────────────────

const PROMPTS: Record<string, PromptDescriptor> = {
  labelText: { kind: "text", label: "Label text" },
  editorSpinLabel: { kind: "text", label: "Spinner label" },
  labelColor: { kind: "text", label: "RGB color (e.g. 255,215,0)" },
  diffTheme: { kind: "text", label: "Shiki theme" },
  diffSplitMinWidth: { kind: "number", label: "Diff split min width", min: 100 },
  diffSplitMinCodeWidth: { kind: "number", label: "Diff split min code width", min: 30 },
  splitThreshold: { kind: "number", label: "Footer split threshold", min: 80 },
  delayMs: { kind: "number", label: "Notify delay (seconds)", min: 1 },
};

// ── Settings UI ─────────────────────────────────────────────────────────────

// Compose the /archimedes item list. Core is always included; every other
// package's items are gated by the per-namespace plugin gate
// (archimedes.<pkg>.enabled — see ADR 0012) so a disabled plugin can
// not leak back in through the settings overlay. The diff import (heavy —
// pulls in shiki) is lazy AND inside the gate: disabled diff is never loaded.
export async function buildSettingsItems(allConfig: ReturnType<typeof loadAllConfig>): Promise<SettingItem[]> {
  const items: SettingItem[] = [];

  if (isPluginEnabled("ui")) {
    items.push(...getUISettingsItems({ ...allConfig.ui }));
  }

  if (isPluginEnabled("footer")) {
    items.push(...getFooterSettingsItems());
  }

  if (isPluginEnabled("diff")) {
    const { getDiffSettingsItems } = await import("@pi-archimedes/diff");
    items.push(...getDiffSettingsItems());
  }

  if (isPluginEnabled("notify")) {
    const notifyItems = getNotifySettingsItems({ ...allConfig.notify });
    // The notify package seeds delayMs as "30s" — strip the suffix so the
    // number prompt can be edited in place (typed digits would otherwise
    // append to "30s" and parseInt would discard the edit).
    const delayItem = notifyItems.find((i) => i.id === "delayMs");
    if (delayItem) {
      delayItem.currentValue = String(allConfig.notify.delayMs / 1000);
    }
    items.push(...notifyItems);
  }

  if (isPluginEnabled("session-name")) {
    items.push(...getSessionNameSettingsItems({ ...allConfig.sessionName }));
  }

  return items;
}

export async function openSettings(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const allConfig = loadAllConfig();

  const uiConfig: UIConfig = { ...allConfig.ui };
  const notifyConfig: NotifyConfig = { ...allConfig.notify };
  const footerConfig = { ...allConfig.footer };
  const diffConfig = { ...allConfig.diff };
  const sessionNameConfig = { ...allConfig.sessionName };

  const items = await buildSettingsItems(allConfig);

  ctx.ui.custom((_tui, theme, _keybindings, done) => {
    const settingsManager = createSettingsManager({
      items,
      prompts: PROMPTS,
      theme,
      onChange: (id: string, newValue: string) => {
        switch (id) {
          // ── UI settings ──
          case "mutedTheme": uiConfig.mutedTheme = newValue === "On"; break;
          case "autoCollapseThinking": uiConfig.autoCollapseThinking = newValue === "On"; break;
          case "compactThinking": uiConfig.compactThinking = newValue as UIConfig["compactThinking"]; break;
          case "codeUnindent": uiConfig.codeUnindent = newValue === "On"; break;
          case "editorSpinBorder": uiConfig.editorSpinBorder = newValue === "On"; break;
          case "editorSpinSpeed": uiConfig.editorSpinSpeed = newValue.toLowerCase() as UIConfig["editorSpinSpeed"]; break;
          case "editorSpinStyle": uiConfig.editorSpinStyle = newValue.toLowerCase().replace(/ /g, "-") as UIConfig["editorSpinStyle"]; break;
          case "editorSpinLabel": uiConfig.editorSpinLabel = newValue; break;
          case "labelText": uiConfig.labelText = newValue; break;
          case "labelColor": uiConfig.labelColor = newValue; break;
          case "animationStyle": uiConfig.animationStyle = newValue as UIConfig["animationStyle"]; break;

          // ── Footer settings ──
          case "splitThreshold": {
            const v = parseInt(newValue, 10);
            if (Number.isFinite(v)) footerConfig.splitThreshold = v;
            break;
          }

          // ── Diff settings ──
          case "diffTheme": diffConfig.diffTheme = newValue; break;
          case "diffSplitMinWidth": {
            const v = parseInt(newValue, 10);
            if (Number.isFinite(v)) diffConfig.diffSplitMinWidth = v;
            break;
          }
          case "diffSplitMinCodeWidth": {
            const v = parseInt(newValue, 10);
            if (Number.isFinite(v)) diffConfig.diffSplitMinCodeWidth = v;
            break;
          }

          // ── Notify settings ──
          case "notifyOnAgentEnd": notifyConfig.notifyOnAgentEnd = newValue === "On"; break;
          case "notifyOnQuestion": notifyConfig.notifyOnQuestion = newValue === "On"; break;
          case "delayMs": {
            const v = parseInt(newValue, 10);
            if (Number.isFinite(v) && v >= 1) notifyConfig.delayMs = v * 1000;
            break;
          }

          // ── Session name settings ──
          case "sessionNameModel": sessionNameConfig.model = newValue === "(current model)" ? undefined : newValue; break;
        }
      },
      onSave: () => {
        saveUIConfig(uiConfig);
        saveFooterConfig(footerConfig);
        saveDiffConfig(diffConfig);
        saveNotifyConfig(notifyConfig);
        saveSessionNameConfig(sessionNameConfig);
        done(undefined);
      },
      onClose: () => { done(undefined); },
    });
    return settingsManager;
  }, { overlay: true, overlayOptions: OVERLAY_CHROME });
}
