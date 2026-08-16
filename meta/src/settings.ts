import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";

import { getCoreSettingsItems } from "@pi-archimedes/core";
import { OVERLAY_CHROME } from "@pi-archimedes/core/overlay";
import { getFooterSettingsItems } from "@pi-archimedes/footer/config";
// diff (shiki) is lazy-loaded below to keep shiki out of the startup import chain
import { getNotifySettingsItems } from "@pi-archimedes/notify";
import { getSessionNameSettingsItems } from "@pi-archimedes/session-name";
import {
  loadAllConfig,
  saveCoreConfig,
  saveFooterConfig,
  saveDiffConfig,
  saveNotifyConfig,
  saveSessionNameConfig,
  type CoreConfig,
  type NotifyConfig,
} from "./config.js";
import { createSettingsManager, type PromptDescriptor } from "./settings-manager.js";

// ── Free-input prompt descriptors (keyed by item.id) ───────────────────────

const PROMPTS: Record<string, PromptDescriptor> = {
  labelText: { kind: "text", label: "Label text" },
  labelColor: { kind: "text", label: "RGB color (e.g. 255,215,0)" },
  diffTheme: { kind: "text", label: "Shiki theme" },
  diffSplitMinWidth: { kind: "number", label: "Diff split min width", min: 100 },
  diffSplitMinCodeWidth: { kind: "number", label: "Diff split min code width", min: 30 },
  splitThreshold: { kind: "number", label: "Footer split threshold", min: 80 },
  delayMs: { kind: "number", label: "Notify delay (seconds)", min: 1 },
};

// ── Settings UI ─────────────────────────────────────────────────────────────

export async function openSettings(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  // Lazy-load diff (pulls in shiki) — only needed when /archimedes is opened
  const { getDiffSettingsItems } = await import("@pi-archimedes/diff");
  const allConfig = loadAllConfig();

  const coreConfig: CoreConfig = { ...allConfig.core };
  const notifyConfig: NotifyConfig = { ...allConfig.notify };
  const footerConfig = { ...allConfig.footer };
  const diffConfig = { ...allConfig.diff };
  const sessionNameConfig = { ...allConfig.sessionName };

  // Build composed items from sub-packages
  const coreItems = getCoreSettingsItems(coreConfig);
  const footerItems = getFooterSettingsItems();
  const diffItems = getDiffSettingsItems();
  const notifyItems = getNotifySettingsItems(notifyConfig);
  const sessionNameItems = getSessionNameSettingsItems(sessionNameConfig);

  // The notify package seeds delayMs as "30s" — strip the suffix so the
  // number prompt can be edited in place (typed digits would otherwise
  // append to "30s" and parseInt would discard the edit).
  const delayItem = notifyItems.find((i) => i.id === "delayMs");
  if (delayItem) {
    delayItem.currentValue = String(notifyConfig.delayMs / 1000);
  }

  const items: SettingItem[] = [
    ...coreItems,
    ...footerItems,
    ...diffItems,
    ...notifyItems,
    ...sessionNameItems,
  ];

  ctx.ui.custom((_tui, theme, _keybindings, done) => {
    const settingsManager = createSettingsManager({
      items,
      prompts: PROMPTS,
      theme,
      onChange: (id: string, newValue: string) => {
        switch (id) {
          // ── Core settings ──
          case "mutedTheme": coreConfig.mutedTheme = newValue === "On"; break;
          case "codeUnindent": coreConfig.codeUnindent = newValue === "On"; break;
          case "labelText": coreConfig.labelText = newValue; break;
          case "labelColor": coreConfig.labelColor = newValue; break;
          case "animationStyle": coreConfig.animationStyle = newValue as CoreConfig["animationStyle"]; break;

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
          case "enabled": notifyConfig.enabled = newValue === "On"; break;
          case "notifyOnAgentEnd": notifyConfig.notifyOnAgentEnd = newValue === "On"; break;
          case "notifyOnQuestion": notifyConfig.notifyOnQuestion = newValue === "On"; break;
          case "delayMs": {
            const v = parseInt(newValue, 10);
            if (Number.isFinite(v) && v >= 1) notifyConfig.delayMs = v * 1000;
            break;
          }

          // ── Session name settings ──
          case "sessionNameEnabled": sessionNameConfig.enabled = newValue === "On"; break;
          case "sessionNameModel": sessionNameConfig.model = newValue === "(current model)" ? undefined : newValue; break;
        }
      },
      onSave: () => {
        saveCoreConfig(coreConfig);
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
