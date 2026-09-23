import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { clearCache, getCacheStats } from "./storage/cache.js";
import { loadConfig } from "./config.js";
import { executeSearch } from "./providers/registry.js";

export function registerCommand(pi: ExtensionAPI) {
  pi.registerCommand("web", {
    description: "Web search tools",
    handler: async (args: string, ctx) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0];
      switch (subcommand) {
        case "clear": {
          clearCache();
          ctx.ui.notify("Cache cleared");
          break;
        }
        case "status": {
          const stats = getCacheStats();
          const config = loadConfig();
          const keys = Object.keys(config).filter(k => (config as any)[k] !== undefined);
          ctx.ui.notify(`Configured keys: ${keys.join(", ")} | Default provider: ${config.braveApiKey ? "Brave" : "Unknown"} | Cache items: ${stats.count}`);
          break;
        }
        case "search": {
          const query = parts.slice(1).join(" ");
          if (!query) {
            ctx.ui.notify("Usage: /web search <query>");
            return;
          }
          await ctx.ui.notify("Error: executeTool not available");
          break;
        }
        default:
          ctx.ui.notify("Usage: /web status | clear | search <query>");
          break;
      }
    },
  });
}
