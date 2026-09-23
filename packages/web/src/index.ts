import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTools } from "./tools";
import { registerCommand } from "./command";

export function registerWeb(pi: ExtensionAPI) {
  registerTools(pi);
  registerCommand(pi);
}

export default function register(pi: ExtensionAPI) {
  registerWeb(pi);
}
