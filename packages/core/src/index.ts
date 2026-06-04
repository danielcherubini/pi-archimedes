import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { TUI, EditorTheme, Component, type SettingItem } from "@earendil-works/pi-tui";

import { HephaestusEditor } from "./editor/index.js";
import { patchUserMessage, resetInstanceCount } from "./message/index.js";
import { renderHeader, patchStartupListing, type ListingRef } from "./startup/index.js";
import { patchConsoleLog } from "./startup/capture.js";
import { patchThinkingRenderer } from "./thinking/patch.js";
import { transformThinkingContent } from "./thinking/transform.js";
import { loadCoreConfig, saveCoreConfig, DEFAULT_CORE_CONFIG, ANIMATION_STYLES, type CoreConfig } from "./config.js";
import { initBus } from "./bus.js";

// ── Settings items ────────────────────────────────────────────────────────

export function getCoreSettingsItems(config: CoreConfig): SettingItem[] {
  return [
    {
      id: "mutedTheme",
      label: "Muted Theme",
      description: "Use muted colors for thinking blocks",
      currentValue: config.mutedTheme ? "On" : "Off",
      values: ["On", "Off"],
    },
    {
      id: "codeUnindent",
      label: "Code Unindent",
      description: "Remove 2-space indent from code blocks",
      currentValue: config.codeUnindent ? "On" : "Off",
      values: ["On", "Off"],
    },
    {
      id: "labelText",
      label: "Label Text",
      description: "Text shown before thinking blocks",
      currentValue: config.labelText,
    },
    {
      id: "labelColor",
      label: "Label Color",
      description: "RGB color for thinking label (e.g. 255,215,0)",
      currentValue: config.labelColor,
    },
    {
      id: "animationStyle",
      label: "Logo Animation",
      description: "Splashscreen logo reveal style",
      currentValue: config.animationStyle,
      values: [...ANIMATION_STYLES],
    },
  ];
}

// ── Core registration ─────────────────────────────────────────────────────

export function registerCore(pi: ExtensionAPI): void {
  // Patch console.log for model scope capture
  patchConsoleLog();

  // session_start handler
  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    // Initialize bus (flushes queued events)
    initBus();

    // Set animated header
    const ref: ListingRef = {
      sections: [],
      frame: 0,
      revealed: false,
      revealedAt: 0,
      scaffoldAt: 0,
      settled: false,
    };
    const headerFactory = (tui: TUI, theme: Theme): Component & { dispose?(): void } => {
      const comp: Component & { dispose?(): void } = {
        invalidate(): void { /* no-op */ },
        render(width: number): string[] {
          return renderHeader(theme, ref, width, tui.terminal.rows - 3);
        },
      };
      patchStartupListing(tui, theme, ref);
      return comp;
    };
    ctx.ui.setHeader(headerFactory);

    // Shared response times array (used by both patchUserMessage and message_end)
    const responseTimes: number[] = [];

    // Set editor component
    ctx.ui.setEditorComponent((tui: TUI, editorTheme: EditorTheme, keybindings: KeybindingsManager) => {
      const theme = ctx.ui.theme;
      return new HephaestusEditor(tui, editorTheme, keybindings, {
        getTheme: () => theme,
        isIdle: () => ctx.isIdle(),
        shutdown: () => ctx.shutdown(),
      });
    });

    // Patch thinking renderer
    patchThinkingRenderer(() => ctx.ui.theme);

    // Patch user message response time
    patchUserMessage(() => ctx.ui.theme, responseTimes);

    // Load config for thinking transformation
    const config = loadCoreConfig();

    // Register events
    pi.on("message_end", (event, _ctx) => {
      // Transform thinking content (unindent code blocks if enabled)
      if (config.codeUnindent) {
        transformThinkingContent(event.message as any);
      }

      // Track response time from the raw message
      const rawMsg = event.message as any;
      if (rawMsg.duration) {
        const idx = rawMsg.instanceIndex ?? responseTimes.length;
        responseTimes[idx] = rawMsg.duration;
      }
    });

    pi.on("session_shutdown", (_event, _ctx) => {
      // Mark listing as settled
      const g: Record<string | symbol, unknown> = globalThis as unknown as typeof global & Record<string | symbol, unknown>;
      const listingRef = g["listingRef"] as ListingRef | undefined;
      if (listingRef) { listingRef.settled = true; }

      // Clear response times
      responseTimes.length = 0;

      // Reset instance count
      resetInstanceCount();

      // Clear editor component override
      ctx.ui.setEditorComponent(undefined);
    });
  });
}

// ── Default export (for standalone pi.extensions loading) ─────────────────

export default function (pi: ExtensionAPI): void {
  registerCore(pi);
}
