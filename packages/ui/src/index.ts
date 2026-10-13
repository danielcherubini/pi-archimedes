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
import {
  renderHeader,
  patchStartupListing,
  revealStartupListing,
  stopStartupListing,
  modelScopeSection,
  CONTENT_ONLY_HEIGHT,
  type ListingRef,
} from "./startup/index.js";
import type { ParsedSection } from "./startup/sections.js";
import { patchThinkingRenderer } from "./thinking/patch.js";
import { transformThinkingContent } from "./thinking/transform.js";
import {
  loadUIConfig,
  saveUIConfig,
  readQuietStartup,
  DEFAULT_UI_CONFIG,
  ANIMATION_STYLES,
  normalizeThinkingStyle,
  normalizeToolStyle,
  type UIConfig,
  type CoreConfig,
} from "./config.js";
import { screenCapabilities, screenMode } from "@pi-archimedes/core/screen-mode";
import { reportPiSupport } from "@pi-archimedes/core/pi-support";
import { getUISettingsItems } from "./settings.js";
import { migrateCoreToUIConfig, migrateCompactThinkingToStyle, migrateRemovedToolPatch } from "./migration.js";
import { renderBashCall, renderBashResult } from "./bash/index.js";
import { renderCodemodeCall, renderCodemodeResult } from "./codemode/index.js";

// Re-exports
export { getUISettingsItems } from "./settings.js";
export {
  loadUIConfig,
  saveUIConfig,
  DEFAULT_UI_CONFIG,
  ANIMATION_STYLES,
  normalizeThinkingStyle,
  normalizeToolStyle,
  THINKING_STYLE_VALUES,
  TOOL_STYLE_VALUES,
  type UIConfig,
  type CoreConfig,
  type ThinkingStyle,
  type ToolStyle,
} from "./config.js";

// Module-level state for session lifecycle
let uiRef: ListingRef | undefined;
let uiCtx: ExtensionContext | undefined;

let spinFlag = false;
let spinInterval: ReturnType<typeof setInterval> | undefined;

/**
 * Which Archimedes tool rows the current session asks for, refreshed at every
 * `session_start` and read by the renderer resolver. The resolver itself is
 * registered once per extension load — pi keeps a list of resolvers per
 * extension, so registering it from `session_start` would stack a duplicate on
 * every `/reload` — which means the settings have to be read here rather than
 * inside the resolver: `renderCall`/`renderResult` run on every frame.
 */
let styledTools = { bash: false, codemode: false };

function clearSpinInterval(): void {
  if (spinInterval) {
    clearInterval(spinInterval);
    spinInterval = undefined;
  }
}

/**
 * Draw the bash row through pi's renderer resolution (ADR 0029).
 *
 * `registerToolRenderer()` was added in pi 1.0.1 precisely for presentation
 * overrides: it chooses how calls to a tool are drawn without registering the
 * tool, and `next()` hands the tool to the remaining resolvers and then to
 * whatever is registered. Off settings therefore give back pi's own row rather
 * than the previous arrangement — re-registering `bash` from
 * `createBashToolDefinition()` with our renderers bolted on — which also means
 * anything pi later adds to that tool cannot be silently dropped by us.
 */
function registerToolRenderers(pi: ExtensionAPI): void {
  // Capability check, not a version wish: on a host without the API there is
  // nothing to resolve through, and pi's own rows stand in.
  if (typeof pi.registerToolRenderer !== "function") return;

  pi.registerToolRenderer((toolName, next) => {
    // `next()` is spread first so that whatever the built-in definition
    // declares besides the two renderers — `renderShell` is the one that matters
    // today — survives resolution instead of being silently dropped by us.
    const ours =
      toolName === "bash" && styledTools.bash
        ? { renderCall: renderBashCall, renderResult: renderBashResult }
        : toolName === "codemode" && styledTools.codemode
          ? { renderCall: renderCodemodeCall, renderResult: renderCodemodeResult }
          : undefined;
    return ours ? { ...next(), ...ours } : next();
  });
}

export function registerUI(pi: ExtensionAPI): void {
  // Floor check before anything that can fail (ADR 0026): pi never installs or
  // solves peers, so the peer range below cannot warn anyone — the runtime
  // comparison against the host's own VERSION is the only thing that can. It
  // records a warning for meta to print once, aggregated; nothing here is
  // withheld on a below-floor host, because a `ui` that registered nothing
  // would make /plugins report an enabled package that did nothing.
  reportPiSupport("ui", "1.2.0");

  // Registered once per extension load, before any session exists (ADR 0029).
  registerToolRenderers(pi);

  // One-time migration of any legacy core config to UI config
  migrateCoreToUIConfig();
  migrateCompactThinkingToStyle();
  // The toolStyle "Full" auto-expand patch was removed: drop any wrapper a
  // previous version left on the shared prototype (upgrade + /reload case).
  migrateRemovedToolPatch();

  pi.on("message_end", (event, _ctx) => {
    if (loadUIConfig().codeUnindent) {
      transformThinkingContent(event.message as any);
    }
  });

  // session_shutdown handler (top-level to prevent accumulation on /reload)
  pi.on("session_shutdown", (_event, ctx) => {
    const targetCtx = ctx?.hasUI ? ctx : uiCtx;
    if (targetCtx?.hasUI) {
      targetCtx.ui.setWorkingVisible(true);
      // Give back everything the session borrowed: pi's animated indicator and
      // its own hidden-thinking wording, so a session that starts after this
      // one (or after `/reload` with the plugin off) sees pi's defaults.
      targetCtx.ui.setWorkingIndicator(undefined);
      targetCtx.ui.setHiddenThinkingLabel(undefined);
      targetCtx.ui.setEditorComponent(undefined);
    }
    clearSpinInterval();
    spinFlag = false;

    // The splash: stop the frame/reveal timers, then freeze the ref so a late
    // render of a header still on screen cannot restart the animation. Nothing
    // else to undo — the startup listing interception and the console.log patch
    // this used to un-install are gone (pi 1.x alignment, Task 8).
    stopStartupListing();
    if (uiRef) {
      uiRef.settled = true;
    }
  });

  // session_start handler
  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    uiCtx = ctx;

    const config = loadUIConfig();
    const toolStyle = normalizeToolStyle(config.toolStyle);
    const minimal = toolStyle === "Minimal";

    // What the resolver answers with for this session (see `styledTools`).
    // `Minimal` = archimedes tool styling (the per-tool toggles fine-tune it);
    // `Native` = none of it, so pi's own rows stand everywhere.
    styledTools = {
      bash: minimal && config.bashToolStyling !== false,
      codemode: minimal && config.codemodeToolStyling !== false,
    };

    if (ctx.hasUI) {
      spinFlag = config.editorSpinBorder;

      // pi 1.x owns the startup screen. `quietStartup` says how much of it is
      // shown — `false` header + details, `"header"` the header alone, `true`
      // nothing — and `ctx.scopedModels` is the model scope pi would otherwise
      // have printed, so nothing here scrapes pi's stdout or its component tree
      // any more (that was `startup/capture.ts` plus the `addChild`
      // interception in `patchStartupListing`, both removed here).
      const quietStartup = readQuietStartup(pi);

      if (quietStartup === true) {
        // pi's own header is an empty component in this mode. Handing ours back
        // is what keeps that silence: a splash left installed from an earlier
        // session in the same process (`/reload` after a settings change) would
        // otherwise animate over it.
        ctx.ui.setHeader(undefined);
        uiRef = undefined;
      } else {
        // What the splash reveals after the logo. The version row belongs to
        // the header itself; the model scope is a startup *detail*, so it
        // follows pi's own rule for the `Model scope:` line and the resource
        // listing: visible only when `quietStartup` is `false`.
        const sections: ParsedSection[] = [];
        const models = quietStartup === false ? modelScopeSection(ctx.scopedModels) : undefined;
        if (models) sections.push(models);

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
        const headerFactory = (tui: TUI, theme: Theme): Component & { dispose(): void } => {
          // Screen mode is asked of the renderer we were just handed, never
          // cached in a module or a field (ADR 0027). Be exact about what that
          // buys: pi calls this factory again whenever the header is replaced —
          // a new session, `/reload` (which goes through `resetExtensionUI()`),
          // or any `setHeader()`. It does *not* call it for a `tuiMode` switch:
          // `switchTuiMode()` stops the old TUI, builds a new one and re-mounts
          // the components it already has, and `customHeader` is only ever
          // assigned in `setExtensionHeader()`. So the sizing decided here is
          // the sizing that header keeps until the next replacement.
          const caps = screenCapabilities(screenMode(tui));
          const comp: Component & { dispose(): void } = {
            // pi invalidates the component tree on every theme change
            // (`onThemeChange()` → `ui.invalidate()`) and from the theme file
            // watcher, and the splash's cached lines carry the theme's colours
            // — so this is the hook that keeps a finished splash from rendering
            // yesterday's palette for the rest of the session. The cache key is
            // the size it was drawn at, which a theme switch leaves alone.
            // Only the memo goes: this is a repaint, not an animation restart.
            invalidate(): void {
              delete ref.cachedLines;
              delete ref.cachedWidth;
              delete ref.cachedHeight;
            },
            render(width: number): string[] {
              // Regular screen: sized to the terminal the splash scrolls
              // through. Frame-bounded screen: the viewport owns the height, so
              // the header gets its content and nothing more — padded to the
              // terminal it would be the whole viewport, editor excluded.
              const height = caps.frameBounded ? CONTENT_ONLY_HEIGHT : tui.terminal.rows - 3;
              return renderHeader(theme, ref, width, height);
            },
            // pi disposes the header it is replacing before it builds the next
            // one (`setExtensionHeader()` disposes, then calls the factory), so
            // this is where the splash's timers die on a `setHeader()`
            // replacement or a session restart — no stored renderer needed. A
            // `tuiMode` switch does not dispose: it re-mounts this same
            // component, whose timers then run until they settle themselves.
            dispose(): void {
              stopStartupListing();
            },
          };
          patchStartupListing(tui, ref);
          revealStartupListing(tui, ref, sections);
          return comp;
        };
        ctx.ui.setHeader(headerFactory);
      }

      clearSpinInterval();
      // pi's working row carries an animated indicator by default. When the
      // border spinner is on, that animation would run twice, so the row is
      // asked for no frames — it keeps showing what the agent is doing, in
      // pi's own words, while the border carries the movement. Hiding the row
      // wholesale (the old `setWorkingVisible(false)`) also took that message
      // away, and on a `ctrl-o` screen it took the only sign of life.
      ctx.ui.setWorkingIndicator(spinFlag ? { frames: [] } : undefined);

      // The word a collapsed thinking block shows is pi's own row, so the
      // setting is handed to pi rather than rebuilt here. An empty setting
      // hands the label back to pi's default.
      ctx.ui.setHiddenThinkingLabel(config.labelText.trim() || undefined);

      if (spinFlag) {
        // The border spinner lives in the editor frame, not in scrollback, so
        // it runs on either screen. The renderer is handed straight to the
        // editor and never kept by us, and idleness is read from `ctx` rather
        // than from the renderer, so a screen-mode switch cannot strand it.
        //
        // `ctx.isIdle()` is false from `before_agent_start` onward — i.e. from
        // the moment a run begins, not from the first token — which is exactly
        // the *Busy episode* boundary in `CONTEXT.md` (idle → working → idle),
        // so the spinner starting on the run's first tick is the behaviour the
        // term defines, not an early start.
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

      patchThinkingRenderer(
        () => ctx.ui.theme,
        {
          labelText: config.labelText,
          labelColor: config.labelColor,
          autoCollapseThinking: config.autoCollapseThinking,
          thinkingStyle: normalizeThinkingStyle(config.thinkingStyle),
        },
        // The patch's one user-visible diagnostic (a skipped patch) goes to the
        // notification surface — the console is not a surface on either screen
        // mode, and a subagent child discards it.
        (message) => ctx.ui.notify(message, "warning"),
      );
    }
  });
}

export default function (pi: ExtensionAPI): void {
  registerUI(pi);
}
