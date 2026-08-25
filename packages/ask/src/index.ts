import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerIpcRelay } from "./ipc-relay.js";
import { registerAskTool } from "./tool.js";

export function registerAsk(pi: ExtensionAPI) {
	const unsubscribes: Array<() => void> = [];
	let currentCtx: ExtensionContext | undefined;

	// Keep ctx reference fresh
	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		currentCtx = ctx;
	});
	pi.on("turn_start", (_event, ctx: ExtensionContext) => {
		currentCtx = ctx;
	});

	// Register the IPC relay for subagent ask requests
	registerIpcRelay(pi, () => currentCtx, unsubscribes);

	// Register the ask tool
	registerAskTool(pi);

	// Clean up on shutdown
	pi.on("session_shutdown", (_event, _ctx) => {
		unsubscribes.forEach((unsub) => unsub());
		unsubscribes.length = 0;
	});
}
