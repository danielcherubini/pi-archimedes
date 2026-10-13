import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { initBus } from "./bus.js";
import { registerBridge } from "./bridge/index.js";
import { registerSelfUsage } from "./bridge/self-usage.js";

// ── Core registration ─────────────────────────────────────────────────────

export function registerCore(pi: ExtensionAPI): void {
  initBus();
  registerBridge(pi);

  // Self-usage (per-turn COST_UPDATE, source "main") — top-level like the
  // bridge (never inside a session handler, so it doesn't accumulate on
  // /reload). Unconditional: NOT gated on bridge mode (design decision 3).
  // Its live consumer is the events.ts forwarder, which carries it to the
  // desktop as `cost_update`; the footer stopped subscribing in Task 9 (it
  // reads usage from the session entries, which already include the main
  // agent's — see bridge/self-usage.ts).
  registerSelfUsage(pi);
}

// ── Default export (for standalone pi.extensions loading) ─────────────────

export default function (pi: ExtensionAPI): void {
  registerCore(pi);
}
