import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { initBus } from "./bus.js";
import { registerBridge } from "./bridge/index.js";

// ── Core registration ─────────────────────────────────────────────────────

export function registerCore(pi: ExtensionAPI): void {
  initBus();
  registerBridge(pi);
}

// ── Default export (for standalone pi.extensions loading) ─────────────────

export default function (pi: ExtensionAPI): void {
  registerCore(pi);
}
