import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function registerUI(_pi: ExtensionAPI): void {
  // Scaffold: visual presentation and bash tool overrides will be registered here.
}

export default function (pi: ExtensionAPI): void {
  registerUI(pi);
}
