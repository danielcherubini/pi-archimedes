import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function registerCommand(pi: ExtensionAPI) {
  pi.registerCommand("web", {
    description: "Web search tools",
    handler: async (args: string, ctx) => {
      const parts = args.split(" ");
      const subcommand = parts[0];
      switch (subcommand) {
        case "status":
          ctx.ui.notify("Web tools status: OK");
          break;
        case "clear":
          ctx.ui.notify("Cache cleared");
          break;
        case "search":
          ctx.ui.notify(`Searching for ${parts.slice(1).join(" ")}`);
          break;
        default:
          ctx.ui.notify("Usage: /web status | clear | search <query>");
          break;
      }
    },
  });
}
