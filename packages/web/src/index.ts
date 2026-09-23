import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTools } from "./tools.js";
import { registerCommand } from "./command.js";
import { clearCache } from "./storage/cache.js";

export function registerWeb(pi: ExtensionAPI) {
  pi.on("session_start", () => clearCache());
  pi.on("session_shutdown", () => clearCache());
  registerTools(pi);
  registerCommand(pi);
}

export default function register(pi: ExtensionAPI) {
  registerWeb(pi);
}
