import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { registerCore } from "@pi-archimedes/core";
import { registerFooter } from "@pi-archimedes/footer";
import { registerDiffTools } from "@pi-archimedes/diff";
import { registerImagePaste, initImagePasteSession, shutdownImagePaste } from "@pi-archimedes/image-paste";
import { initBus } from "@pi-archimedes/core/bus";
import { loadDiffConfig } from "./config.js";
import { openSettings } from "./settings.js";

export default function (pi: ExtensionAPI): void {
  // Initialize bus (handles event queuing before session starts)
  initBus();

  // Register all component extensions
  registerCore(pi);
  registerFooter(pi);

  // Register image paste (shortcuts, input handler, preview renderer)
  registerImagePaste(pi);

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    // Register diff tools (needs getTheme + readConfig callbacks)
    registerDiffTools(pi, () => ctx.ui.theme, () => loadDiffConfig());

    // Initialize image paste for this session
    initImagePasteSession(ctx);

    pi.on("session_shutdown", (_event, _ctx) => {
      shutdownImagePaste();
    });
  });

  // Register /archimedes command
  pi.registerCommand("archimedes", {
    description: "Open Archimedes settings",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      openSettings(pi, ctx);
    },
  });
}
