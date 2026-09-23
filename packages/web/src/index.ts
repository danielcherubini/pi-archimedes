import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTools } from "./tools.js";
import { registerCommand } from "./command.js";

export function registerWeb(pi: ExtensionAPI) {
  registerTools(pi);
  registerCommand(pi);
}

export default function register(pi: ExtensionAPI) {
  registerWeb(pi);
}
