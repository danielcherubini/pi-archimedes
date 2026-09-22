import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { renderBashCall, renderBashResult } from "./renderer.js";

/**
 * Register custom styled bash tool override.
 * Preserves core execution, parameters, timeouts, and PI_* environment injection
 * while replacing the presentation with Archimedes styled rendering.
 */
export function registerBashToolOverride(pi: ExtensionAPI, cwd: string): void {
  const def = createBashToolDefinition(cwd);
  pi.registerTool({
    ...def,
    renderCall: renderBashCall,
    renderResult: renderBashResult,
  });
}
