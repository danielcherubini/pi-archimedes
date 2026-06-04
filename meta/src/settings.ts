import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { SettingsList, type SettingItem, TUI } from "@earendil-works/pi-tui";

import { getCoreSettingsItems } from "@pi-archimedes/core";
import { getFooterSettingsItems } from "@pi-archimedes/footer/config";
import { getDiffSettingsItems } from "@pi-archimedes/diff";
import {
  loadAllConfig,
  saveCoreConfig,
  saveFooterConfig,
  saveDiffConfig,
  ANIMATION_STYLES,
  type CoreConfig,
  type FooterConfig,
  type DiffConfig,
} from "./config.js";

// ── Factory: text submenu ───────────────────────────────────────────────

function createTextSubmenu(opts: {
  label: string;
  cancelHint?: string;
  confirmHint?: string;
}): SettingItem["submenu"] {
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
}): SettingItem["submenu"] {
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

  // Build composed items from sub-packages
  const coreItems = getCoreSettingsItems(coreConfig);
  const footerItems = getFooterSettingsItems();
  const diffItems = getDiffSettingsItems();

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
      }
    }
  };

  addSubmenus(coreItems);
  addSubmenus(diffItems);
  addSubmenus(footerItems);

  const items: SettingItem[] = [
    ...coreItems,
    ...footerItems,
    ...diffItems,
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
        case "splitThreshold": footerConfig.splitThreshold = parseInt(newValue, 10); break;

        // ── Diff settings ──
        case "diffTheme": diffConfig.diffTheme = newValue; break;
        case "diffSplitMinWidth": diffConfig.diffSplitMinWidth = parseInt(newValue, 10); break;
        case "diffSplitMinCodeWidth": diffConfig.diffSplitMinCodeWidth = parseInt(newValue, 10); break;

        // ── Save ──
        case "save": {
          saveCoreConfig(coreConfig);
          saveFooterConfig(footerConfig);
          saveDiffConfig(diffConfig);
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
