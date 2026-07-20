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
import { registerNotify } from "@pi-archimedes/notify";
import { loadDiffConfig } from "./config.js";
import { openSettings } from "./settings.js"

// Module-level refs for shutdown (survive hot-reloads)
let imagePasteShutdown: (() => void) | undefined;

export default function (pi: ExtensionAPI): void {
  archResetTimings();
  archTime(`factory start (module eval was ${Date.now() - _moduleEvalAt}ms ago)`);

  // Register all component extensions (static imports already compiled by jiti above)
  registerCore(pi);
  archTime("registerCore");
  registerFooter(pi);
  archTime("registerFooter");

  // image-paste & subagent lazy-loaded in session_start below — not here

  // Register todo (lightweight, registers tool + bus listener)
  registerTodo(pi);
  archTime("registerTodo");

  // Register ask tool
  registerAsk(pi);
  archTime("registerAsk");

  // Register notify
  registerNotify(pi);
  archTime("registerNotify");

  archTime("factory end");

  // session_shutdown handler (top-level to prevent accumulation on /reload)
  pi.on("session_shutdown", (_event, _ctx) => {
    imagePasteShutdown?.();
    unpatchConsoleLog();
    archPrintTimings();
  });

  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    archTime(`session_start (factory was ${Date.now() - _moduleEvalAt}ms ago)`);

    // ── Parallel lazy-load all three packages (saves ~100ms vs sequential) ──
    const [diffMod, ipMod, saMod] = await Promise.all([
      import("@pi-archimedes/diff").catch((e) => { console.error("[archimedes] diff load failed:", e); return null; }),
      import("@pi-archimedes/image-paste").catch((e) => { console.error("[archimedes] image-paste load failed:", e); return null; }),
      import("@pi-archimedes/subagent").catch((e) => { console.error("[archimedes] subagent load failed:", e); return null; }),
    ]);
    archTime("3 packages loaded in parallel");

    if (diffMod) {
      diffMod.registerDiffTools(pi, () => ctx.ui.theme, () => loadDiffConfig());
    }
    if (ipMod) {
      ipMod.registerImagePaste(pi);
      imagePasteShutdown = ipMod.shutdownImagePaste;
      ipMod.initImagePasteSession(ctx);
    }
    if (saMod) {
      saMod.registerSubagent(pi);
      saMod.registerAgentsCommand(pi);
    }
  });

  // Register /archimedes command
  pi.registerCommand("archimedes", {
    description: "Open Archimedes settings",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await openSettings(pi, ctx);
    },
  });
}
