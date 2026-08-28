import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { time as archTime, print as archPrintTimings, reset as archResetTimings } from "@pi-archimedes/core/profiler";
import { registerCore, unpatchConsoleLog } from "@pi-archimedes/core";
import { registerFooter } from "@pi-archimedes/footer";

// Mark when module finishes evaluating (before factory runs) for gap analysis
const _moduleEvalAt = Date.now();
// diff — lazy-loaded in session_start to avoid pulling @shikijs/cli at startup
// image-paste & subagent — also lazy-loaded below (heavy deps, only needed on use)
import { registerTodo } from "@pi-archimedes/todo";
import { registerAsk } from "@pi-archimedes/ask";
import { isPluginEnabled, migrateLegacyPluginsMap } from "./plugins.js";
import { registerNotify } from "@pi-archimedes/notify";
import { registerSessionName } from "@pi-archimedes/session-name";
import { loadDiffConfig } from "./config.js";
import { openSettings } from "./settings.js"
import { registerPluginsCommand } from "./plugin-manager.js"

// Module-level ref for shutdown (survives session replacements)
let imagePasteShutdown: (() => void) | undefined;
// Module-level ref for current session context (survives /reload, /new, /fork)
// Used by diff's theme getter callback — updated every session_start so the
// getter always returns the latest ctx's theme even after session replacement.
let currentCtx: ExtensionContext | undefined;

export default function (pi: ExtensionAPI): void {
  // Must run before any isPluginEnabled gate evaluation: re-points the
  // legacy archimedes.plugins map onto per-package namespaces, once.
  migrateLegacyPluginsMap();
  archResetTimings();
  archTime(`factory start (module eval was ${Date.now() - _moduleEvalAt}ms ago)`);

  // Register all component extensions (static imports already compiled by jiti above)
  registerCore(pi);
  archTime("registerCore");
  if (isPluginEnabled("footer")) registerFooter(pi);
  archTime("registerFooter");

  // image-paste & subagent lazy-loaded in session_start below — not here

  // Register todo (lightweight, registers tool + bus listener)
  if (isPluginEnabled("todo")) registerTodo(pi);
  archTime("registerTodo");

  // Register ask tool
  if (isPluginEnabled("ask")) registerAsk(pi);
  archTime("registerAsk");

  // Register notify
  if (isPluginEnabled("notify")) registerNotify(pi);
  archTime("registerNotify");

  // Register session-name
  if (isPluginEnabled("session-name")) registerSessionName(pi);
  archTime("registerSessionName");

  archTime("factory end");

  // session_shutdown handler (top-level to prevent accumulation on /reload)
  pi.on("session_shutdown", (_event, _ctx) => {
    // Liveness-gated on the ref itself: it is set only when image-paste was
    // registered during THIS session (session_start, gated by config at that
    // moment). Config may be toggled mid-session via /plugins — cleanup must
    // still run. Nulled afterwards so a later never-registered session cannot
    // re-execute a stale ref.
    imagePasteShutdown?.();
    imagePasteShutdown = undefined;
    unpatchConsoleLog();
    archPrintTimings();
  });

  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    archTime(`session_start (factory was ${Date.now() - _moduleEvalAt}ms ago)`);

    // Update module-level context ref so lazy-loaded callbacks always see current session
    currentCtx = ctx;

    // ── Parallel lazy-load all three packages (saves ~100ms vs sequential) ──
    const [diffMod, ipMod, saMod, mcpMod] = await Promise.all([
      isPluginEnabled("diff")
        ? import("@pi-archimedes/diff").catch((e) => { console.error("[archimedes] diff load failed:", e); return null; })
        : Promise.resolve(null),
      isPluginEnabled("image-paste")
        ? import("@pi-archimedes/image-paste").catch((e) => { console.error("[archimedes] image-paste load failed:", e); return null; })
        : Promise.resolve(null),
      isPluginEnabled("subagent")
        ? import("@pi-archimedes/subagent").catch((e) => { console.error("[archimedes] subagent load failed:", e); return null; })
        : Promise.resolve(null),
      isPluginEnabled("mcp")
        ? import("@pi-archimedes/mcp").catch((e) => { console.error("[archimedes] mcp load failed:", e); return null; })
        : Promise.resolve(null),
    ]);
    archTime("4 packages loaded in parallel");

    // Each session_start fires on a fresh Extension (pi creates a new
    // ExtensionRunner per session). Registration is safe to — and must —
    // run every time. The registeredLazy guard was removed because it
    // prevented subagent/diff/image-paste from being registered after
    // /new, /fork, /resume: jiti caches the compiled module, so the guard
    // persisted across sessions while each new session creates a fresh
    // Extension with empty tools/commands maps.
    if (diffMod) {
      diffMod.registerDiffTools(pi, () => currentCtx!.ui.theme, () => loadDiffConfig());
    }
    if (ipMod) {
      // registerImagePaste calls pi.on("input", ...) and pi.registerShortcut()
      // on the current Extension. Since each session replacement creates a
      // new Extension with its own handler list, there is no accumulation.
      ipMod.registerImagePaste(pi);
      imagePasteShutdown = ipMod.shutdownImagePaste;
      // initImagePasteSession must run every session_start (captures fresh ctx)
      ipMod.initImagePasteSession(ctx);
    }
    if (saMod) {
      saMod.registerSubagent(pi);
      saMod.registerAgentsCommand(pi);
    }
    if (mcpMod) {
      mcpMod.registerMcp(pi);
    }
  });

  // Register /archimedes command
  pi.registerCommand("archimedes", {
    description: "Open Archimedes settings",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await openSettings(pi, ctx);
    },
  });

  // Register /plugins command (plugin manager — single home in plugin-manager.ts)
  registerPluginsCommand(pi);
  archTime("registerCommands");
}
