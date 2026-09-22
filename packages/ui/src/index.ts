import type {
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type {
  TUI,
  EditorTheme,
  Component,
} from "@earendil-works/pi-tui";

import { HephaestusEditor } from "./editor/index.js";
import { renderHeader, patchStartupListing, type ListingRef } from "./startup/index.js";
import { patchConsoleLog, unpatchConsoleLog } from "./startup/capture.js";
import { patchThinkingRenderer } from "./thinking/patch.js";
import { transformThinkingContent } from "./thinking/transform.js";
import {
  loadUIConfig,
  saveUIConfig,
  DEFAULT_UI_CONFIG,
  ANIMATION_STYLES,
  normalizeCompactThinking,
  type UIConfig,
  type CoreConfig,
} from "./config.js";
import { getUISettingsItems } from "./settings.js";
import { migrateCoreToUIConfig } from "./migration.js";
import { registerBashToolOverride } from "./bash/index.js";

// Re-exports
export { unpatchConsoleLog } from "./startup/capture.js";
export { getUISettingsItems } from "./settings.js";
export {
  loadUIConfig,
  saveUIConfig,
  DEFAULT_UI_CONFIG,
  ANIMATION_STYLES,
  type UIConfig,
  type CoreConfig,
} from "./config.js";

// Module-level state for session lifecycle
let uiRef: ListingRef | undefined;
let uiCtx: ExtensionContext | undefined;
let uiTui: TUI | undefined;

let spinFlag = false;
let spinInterval: ReturnType<typeof setInterval> | undefined;

function clearSpinInterval(): void {
  if (spinInterval) {
    clearInterval(spinInterval);
    spinInterval = undefined;
  }
}

export function registerUI(pi: ExtensionAPI): void {
  // One-time migration of any legacy core config to UI config
  migrateCoreToUIConfig();

  // Patch console.log for model scope capture
  patchConsoleLog();

  // session_shutdown handler (top-level to prevent accumulation on /reload)
  pi.on("session_shutdown", (_event, ctx) => {
    unpatchConsoleLog();

    const targetCtx = ctx?.hasUI ? ctx : uiCtx;
    if (targetCtx?.hasUI) {
      targetCtx.ui.setWorkingVisible(true);
      targetCtx.ui.setEditorComponent(undefined);
    }
    clearSpinInterval();
    spinFlag = false;

    if (uiRef) {
      uiRef.settled = true;
    }

    const PATCHED_LISTING = Symbol.for("splashscreen:listingPatched");
    const ORIG_ADD_CHILD = Symbol.for("splashscreen:origAddChild");
    if (uiTui) {
      try {
        for (const child of uiTui.children) {
          const cc = child as any;
          if (cc[PATCHED_LISTING] && cc[ORIG_ADD_CHILD]) {
            cc.addChild = cc[ORIG_ADD_CHILD];
            cc[PATCHED_LISTING] = false;
            cc[ORIG_ADD_CHILD] = undefined;
          }
        }
        for (const topChild of uiTui.children) {
          const tc = topChild as any;
          if (!tc.children) continue;
          for (const child of tc.children) {
            const cc = child as any;
            if (cc[PATCHED_LISTING] && cc[ORIG_ADD_CHILD]) {
              cc.addChild = cc[ORIG_ADD_CHILD];
              cc[PATCHED_LISTING] = false;
              cc[ORIG_ADD_CHILD] = undefined;
            }
          }
        }

        const ANIM_INTERVAL = Symbol.for("splashscreen:animInterval");
        const DEBOUNCE_TIMER = Symbol.for("splashscreen:debounceTimer");
        for (const child of uiTui.children) {
          const cc = child as any;
          if (cc[ANIM_INTERVAL]) clearInterval(cc[ANIM_INTERVAL]);
          if (cc[DEBOUNCE_TIMER]) clearTimeout(cc[DEBOUNCE_TIMER]);
        }
        for (const topChild of uiTui.children) {
          const tc = topChild as any;
          if (!tc.children) continue;
          for (const child of tc.children) {
            const cc = child as any;
            if (cc[ANIM_INTERVAL]) clearInterval(cc[ANIM_INTERVAL]);
            if (cc[DEBOUNCE_TIMER]) clearTimeout(cc[DEBOUNCE_TIMER]);
          }
        }
      } catch {
        /* TUI structure may have changed — ignore */
      }
    }
  });

  // session_start handler
  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    uiCtx = ctx;

    const config = loadUIConfig();

    if (config.bashToolStyling !== false) {
      registerBashToolOverride(pi, ctx.cwd);
    }

    if (ctx.hasUI) {
      spinFlag = config.editorSpinBorder;

      // Set animated header
      uiRef = {
        sections: [],
        frame: 0,
        revealed: false,
        revealedAt: 0,
        scaffoldAt: 0,
        settled: false,
      };
      const ref = uiRef;
      const headerFactory = (tui: TUI, theme: Theme): Component & { dispose?(): void } => {
        uiTui = tui;
        const comp: Component & { dispose?(): void } = {
          invalidate(): void {},
          render(width: number): string[] {
            return renderHeader(theme, ref, width, tui.terminal.rows - 3);
          },
        };
        patchStartupListing(tui, theme, ref);
        return comp;
      };
      ctx.ui.setHeader(headerFactory);

      clearSpinInterval();
      ctx.ui.setWorkingVisible(!spinFlag);

      if (spinFlag) {
        ctx.ui.setEditorComponent(
          (tui: TUI, editorTheme: EditorTheme, keybindings: KeybindingsManager) => {
            const theme = ctx.ui.theme;
            return new HephaestusEditor(tui, editorTheme, keybindings, {
              getTheme: () => theme,
              isIdle: () => ctx.isIdle(),
              shutdown: () => ctx.shutdown(),
              spin: true,
              spinSpeed: config.editorSpinSpeed,
              spinStyle: config.editorSpinStyle,
              spinLabel: config.editorSpinLabel,
              onSpinInterval: (i) => {
                spinInterval = i;
              },
            });
          },
        );
      }

      patchThinkingRenderer(() => ctx.ui.theme, {
        labelText: config.labelText,
        labelColor: config.labelColor,
        autoCollapseThinking: config.autoCollapseThinking,
        compactThinking: normalizeCompactThinking(config.compactThinking),
      });
    }

    pi.on("message_end", (event, _ctx) => {
      if (config.codeUnindent) {
        transformThinkingContent(event.message as any);
      }
    });
  });
}

export default function (pi: ExtensionAPI): void {
  registerUI(pi);
}
