import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { SettingsList, type SettingItem, TUI } from "@earendil-works/pi-tui";

import { getCoreSettingsItems } from "@pi-archimedes/core";
import { getFooterSettingsItems } from "@pi-archimedes/footer/config";
import { getDiffSettingsItems } from "@pi-archimedes/diff";
import { getNotifySettingsItems } from "@pi-archimedes/notify";
import {
  loadAllConfig,
  saveCoreConfig,
  saveFooterConfig,
  saveDiffConfig,
  saveNotifyConfig,
  ANIMATION_STYLES,
  type CoreConfig,
  type FooterConfig,
  type DiffConfig,
  type NotifyConfig,
} from "./config.js";

// ── Factory: text submenu ───────────────────────────────────────────────

function createTextSubmenu(opts: {
  label: string;
  cancelHint?: string;
  confirmHint?: string;
}): (currentValue: string, done: (selectedValue?: string) => void) => import("@earendil-works/pi-tui").Component {
  return (currentValue: string, done: (selectedValue?: string) => void) => {
    const state = { value: currentValue };
    return {
      invalidate(): void { /* no-op */ },
      render(): string[] {
        const hints: string[] = [];
        if (opts.cancelHint) hints.push(opts.cancelHint);
        if (opts.confirmHint) hints.push(opts.confirmHint);
        return [
          opts.label,
          "",
          `  ${state.value}`,
          "",
          hints.join(" | "),
        ];
      },
      handleInput(data: string): void {
        if (data === "\x1b") { done(); return; }
        if (data === "\r" || data === "\n") { done(state.value); return; }
        if (data === "\x7f" || data === "\x08") { state.value = state.value.slice(0, -1); }
        else if (data.length === 1) { state.value += data; }
      },
    };
  };
}

// ── Factory: number submenu ─────────────────────────────────────────────

function createNumberSubmenu(opts: {
  label: string;
  cancelHint?: string;
  confirmHint?: string;
  min?: number;
}): (currentValue: string, done: (selectedValue?: string) => void) => import("@earendil-works/pi-tui").Component {
  return (currentValue: string, done: (selectedValue?: string) => void) => {
    const state = { value: currentValue };
    return {
      invalidate(): void { /* no-op */ },
      render(): string[] {
        const hints: string[] = [];
        if (opts.cancelHint) hints.push(opts.cancelHint);
        if (opts.confirmHint) hints.push(opts.confirmHint);
        return [
          opts.label,
          "",
          `  ${state.value}`,
          "",
          hints.join(" | "),
        ];
      },
      handleInput(data: string): void {
        if (data === "\x1b") { done(); return; }
        if (data === "\r" || data === "\n") {
          const n = parseInt(state.value, 10);
          if (Number.isFinite(n) && (!opts.min || n >= opts.min)) done(String(n));
          else done();
          return;
        }
        if (data === "\x7f" || data === "\x08") { state.value = state.value.slice(0, -1); }
        else if (/^\d$/.test(data)) { state.value += data; }
      },
    };
  };
}

// ── Settings UI ─────────────────────────────────────────────────────────

export function openSettings(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const allConfig = loadAllConfig();

  const coreConfig: CoreConfig = { ...allConfig.core };
  const footerConfig: FooterConfig = { ...allConfig.footer };
  const diffConfig: DiffConfig = { ...allConfig.diff };
  const notifyConfig: NotifyConfig = { ...allConfig.notify };

  // Build composed items from sub-packages
  const coreItems = getCoreSettingsItems(coreConfig);
  const footerItems = getFooterSettingsItems();
  const diffItems = getDiffSettingsItems();
  const notifyItems = getNotifySettingsItems(notifyConfig);

  // Add submenus for text/number fields
  const addSubmenus = (items: SettingItem[]) => {
    for (const item of items) {
      if (item.id === "labelText") {
        item.submenu = createTextSubmenu({
          label: "Enter label text (ESC to cancel):",
          cancelHint: "ESC: cancel",
          confirmHint: "ENTER: confirm",
        });
      } else if (item.id === "labelColor") {
        item.submenu = createTextSubmenu({
          label: "Enter RGB color (ESC to cancel):",
          cancelHint: "ESC: cancel",
          confirmHint: "ENTER: confirm",
        });
      } else if (item.id === "diffTheme") {
        item.submenu = createTextSubmenu({
          label: "Enter Shiki theme (ESC to cancel):",
          cancelHint: "ESC: cancel",
          confirmHint: "ENTER: confirm",
        });
      } else if (item.id === "diffSplitMinWidth") {
        item.submenu = createNumberSubmenu({
          label: "Enter min width (ESC to cancel):",
          cancelHint: "ESC: cancel",
          confirmHint: "min 100",
          min: 100,
        });
      } else if (item.id === "diffSplitMinCodeWidth") {
        item.submenu = createNumberSubmenu({
          label: "Enter min code width (ESC to cancel):",
          cancelHint: "ESC: cancel",
          confirmHint: "min 30",
          min: 30,
        });
      } else if (item.id === "splitThreshold") {
        item.submenu = createNumberSubmenu({
          label: "Enter split threshold (ESC to cancel):",
          cancelHint: "ESC: cancel",
          confirmHint: "min 80",
          min: 80,
        });
      } else if (item.id === "delayMs") {
        item.submenu = createNumberSubmenu({
          label: "Enter delay in seconds (ESC to cancel):",
          cancelHint: "ESC: cancel",
          confirmHint: "min 1",
          min: 1,
        });
      }
    }
  };

  addSubmenus(coreItems);
  addSubmenus(diffItems);
  addSubmenus(footerItems);
  addSubmenus(notifyItems);

  const items: SettingItem[] = [
    ...coreItems,
    ...footerItems,
    ...diffItems,
    ...notifyItems,
    {
      id: "save",
      label: "Save",
      description: "Save changes and exit",
      currentValue: "",
      values: ["Save"],
    },
  ];

  ctx.ui.custom((tui: TUI, theme: Theme, _keybindings, done) => {
    const settingsList = new SettingsList(items, 10, getSettingsListTheme(), (id: string, newValue: string) => {
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

        // ── Save ──
        case "save": {
          saveCoreConfig(coreConfig);
          saveFooterConfig(footerConfig);
          saveDiffConfig(diffConfig);
          saveNotifyConfig(notifyConfig);
          done(undefined);
          return;
        }
      }
    }, () => {
      // ESC cancels without saving
      done(undefined);
    });

    return settingsList;
  });
}
