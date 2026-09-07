import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type TUI, type EditorTheme, type Component, type SettingItem } from "@earendil-works/pi-tui";

import { HephaestusEditor } from "./editor/index.js";

import { renderHeader, patchStartupListing, type ListingRef } from "./startup/index.js";
import { patchConsoleLog, unpatchConsoleLog } from "./startup/capture.js";
import { patchThinkingRenderer } from "./thinking/patch.js";
import { transformThinkingContent } from "./thinking/transform.js";
import { loadCoreConfig, saveCoreConfig, DEFAULT_CORE_CONFIG, ANIMATION_STYLES, type CoreConfig } from "./config.js";
import { initBus } from "./bus.js";

// Re-export for session lifecycle management
export { unpatchConsoleLog } from "./startup/capture.js";

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
    {
      id: "editorSpinBorder",
      label: "Editor Spin Border",
      description: "Type across the editor's top border while the agent is working (hides the “Working” line)",
      currentValue: config.editorSpinBorder ? "On" : "Off",
      values: ["On", "Off"],
    },
    {
      id: "editorSpinSpeed",
      label: "Spin Speed",
      description: "Border spinner speed (slow / normal / fast — the × 1.5 / × 1 / × 0.6 of the style's native tempo)",
      currentValue: config.editorSpinSpeed[0]!.toUpperCase() + config.editorSpinSpeed.slice(1),
      values: ["Slow", "Normal", "Fast"],
    },
    {
      id: "editorSpinStyle",
      label: "Spin Style",
      description: "Which animation the editor border runs while working",
      currentValue: config.editorSpinStyle
        .split("-")
        .map((w) => w[0]!.toUpperCase() + w.slice(1))
        .join(" "),
      values: [
        "Typing",
        "Wave Rows",
        "Columns",
        "Pulse",
        "Marquee",
        "Pendulum",
        "Rain",
        "Cascade",
        "Diagonal Swipe",
        "Sparkle",
      ],
    },
    {
      id: "editorSpinLabel",
      label: "Spinner Label",
      description: "Label typed after the spin window (empty hides it)",
      currentValue: config.editorSpinLabel,
    },
  ];
}

// ── Core registration ─────────────────────────────────────────────────────

// Module-level state for session lifecycle (shared between session_start and session_shutdown)
let coreRef: ListingRef | undefined;
let coreCtx: ExtensionContext | undefined;
let coreTui: TUI | undefined;

// Spin-prompt lifecycle state: the editor self-drives its timer and reports it
// back via onSpinInterval so the session handlers can reap it (no circular import
// — editor/index.ts must never import this module).
let spinFlag = false;
let spinInterval: ReturnType<typeof setInterval> | undefined;
function clearSpinInterval(): void {
  if (spinInterval) {
    clearInterval(spinInterval);
    spinInterval = undefined;
  }
}

export function registerCore(pi: ExtensionAPI): void {
  // Patch console.log for model scope capture
  patchConsoleLog();

  // session_shutdown handler (top-level to prevent accumulation on /reload)
  pi.on("session_shutdown", (_event, _ctx) => {
    // Restore the Working line if we hid it, and reap the editor's spinner
    // timer. Runs FIRST: enabled-only restore of the Working line +
    // unconditional spinner-timer reap (idempotent when spin is off).
    if (spinFlag) { _ctx.ui.setWorkingVisible(true); }
    clearSpinInterval();
    spinFlag = false;

    // Mark listing as settled
    if (coreRef) { coreRef.settled = true; }
    const g: Record<string | symbol, unknown> = globalThis as unknown as typeof global & Record<string | symbol, unknown>;
    const listingRef = g["listingRef"] as ListingRef | undefined;
    if (listingRef) { listingRef.settled = true; }

    // Restore patched addChild to prevent closure accumulation across reloads
    const PATCHED_LISTING = Symbol.for("splashscreen:listingPatched");
    const ORIG_ADD_CHILD = Symbol.for("splashscreen:origAddChild");
    if (coreTui) {
      try {
        // Direct TUI children (old Pi: chatContainer was a direct child)
        for (const child of coreTui.children) {
          const cc = child as any;
          if (cc[PATCHED_LISTING] && cc[ORIG_ADD_CHILD]) {
            cc.addChild = cc[ORIG_ADD_CHILD];
            cc[PATCHED_LISTING] = false;
            cc[ORIG_ADD_CHILD] = undefined;
          }
        }
        // Nested children (Pi 0.84+: loadedResourcesContainer is inside documentContainer)
        for (const topChild of coreTui.children) {
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

      // Clear animation interval and debounce timer for prompt cleanup
      const ANIM_INTERVAL = Symbol.for("splashscreen:animInterval");
      const DEBOUNCE_TIMER = Symbol.for("splashscreen:debounceTimer");
      for (const child of coreTui.children) {
        const cc = child as any;
        if (cc[ANIM_INTERVAL]) clearInterval(cc[ANIM_INTERVAL]);
        if (cc[DEBOUNCE_TIMER]) clearTimeout(cc[DEBOUNCE_TIMER]);
      }
      // Nested children (Pi 0.84+: loadedResourcesContainer is inside documentContainer)
      for (const topChild of coreTui.children) {
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

    // Clear editor component override
    if (coreCtx) { coreCtx.ui.setEditorComponent(undefined); }
  });

  // session_start handler
  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    // Initialize bus (flushes queued events)
    initBus();

    // Save context for shutdown cleanup
    coreCtx = ctx;

    // Spin-prompt flag (drives the editor self-timer + Working-line visibility)
    const config = loadCoreConfig();
    spinFlag = config.editorSpinBorder;

    // Set animated header
    coreRef = {
      sections: [],
      frame: 0,
      revealed: false,
      revealedAt: 0,
      scaffoldAt: 0,
      settled: false,
    };
    const ref = coreRef;
    const headerFactory = (tui: TUI, theme: Theme): Component & { dispose?(): void } => {
      coreTui = tui; // Capture for shutdown cleanup
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

    // Set editor component (reap any orphaned timer from a previous editor /
    // /reload rebind first — pi does not dispose the old editor's timer)
    clearSpinInterval();
    // Unconditional: OFF idempotently recovers a carried-over hidden state
    // (pi's resetExtensionUI() resets workingVisible = true before session_start
    // re-applies it, so this is always safe)
    ctx.ui.setWorkingVisible(!spinFlag);
    ctx.ui.setEditorComponent((tui: TUI, editorTheme: EditorTheme, keybindings: KeybindingsManager) => {
      const theme = ctx.ui.theme;
      return new HephaestusEditor(tui, editorTheme, keybindings, {
        getTheme: () => theme,
        isIdle: () => ctx.isIdle(),
        shutdown: () => ctx.shutdown(),
        spin: spinFlag,
        spinSpeed: config.editorSpinSpeed,
        spinStyle: config.editorSpinStyle,
        spinLabel: config.editorSpinLabel,
        onSpinInterval: (i) => { spinInterval = i; },
      });
    });

    // Patch thinking renderer (config was hoisted above the editor factory)
    patchThinkingRenderer(() => ctx.ui.theme, {
      labelText: config.labelText,
      labelColor: config.labelColor,
    });

    // Register events
    pi.on("message_end", (event, _ctx) => {
      // Transform thinking content (unindent code blocks if enabled)
      if (config.codeUnindent) {
        transformThinkingContent(event.message as any);
      }
    });
  });
}

// ── Default export (for standalone pi.extensions loading) ─────────────────

export default function (pi: ExtensionAPI): void {
  registerCore(pi);
}
