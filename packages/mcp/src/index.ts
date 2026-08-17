import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function registerMcp(pi: ExtensionAPI): void {
  pi.on("session_start", async () => {
    console.log("[mcp] loaded");
  });
}
