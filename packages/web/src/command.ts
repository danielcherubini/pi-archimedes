import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { clearCache, getCacheStats } from "./storage/cache.js";
import { loadConfig } from "./config.js";
import { resolveProvider, executeSearch } from "./providers/registry.js";

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
          const config = loadConfig();
          const provider = resolveProvider(undefined, config);
          ctx.ui.notify(`Active provider: ${provider.name}`);
          break;
        }
        case "search": {
          const query = parts.slice(1).join(" ");
          if (!query) {
            ctx.ui.notify("Usage: /web search <query>");
            return;
          }
          const config = loadConfig();
          const results = await executeSearch([query], {}, config);
          const summary = `Found ${results.results.length} results using ${results.provider}:\n${results.results.map(r => `- ${r.title}: ${r.url}`).join("\n")}`;
          ctx.ui.notify(summary, "info");
          break;
        }
        default:
          ctx.ui.notify("Usage: /web status | clear | search <query>");
          break;
      }
    },
  });
}
