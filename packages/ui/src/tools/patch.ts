import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import type { OutputStyle } from "../config.js";

const TOOL_FRESH_KEY = Symbol.for("archimedes:toolFresh");

// Module-level: wrap once per process; refresh the live config on every call.
// A pi upgrade = a fresh module instance = fresh `wrapped`, so the wrapper is
// naturally re-applied to the new prototype — no version bookkeeping needed.
let liveConfig: { toolStyle?: OutputStyle } = {};
let wrapped = false;

/**
 * Make `toolStyle: "Full"` start every native tool expanded; `Compact` (the
 * default) leaves the native collapsed behavior untouched.
 *
 * The tricky part: pi calls `component.setExpanded(this.toolOutputExpanded)`
 * (default `false`) immediately after constructing each `ToolExecutionComponent`
 * (interactive-mode.js lines 2753/2820/3149 — synchronous, and therefore always
 * the FIRST `setExpanded` on any instance). The other `setExpanded` calls on a
 * `ToolExecutionComponent` — the result-area click handler (tool-execution.js,
 * `this.setExpanded(!this.expanded)`) and the ctrl+o `setToolsExpanded` loop
 * (interactive-mode.js, duck-typed over `isExpandable` chatContainer children)
 * — arrive later and MUST be respected. A naive "auto-expand on updateDisplay,
 * flag on setExpanded" is defeated by that programmatic `setExpanded(false)`. So:
 *   - `updateDisplay` auto-expands a FRESH tool under Full (fresh = no
 *     `setExpanded` seen yet — the constructor's `updateDisplay` runs before pi's
 *     programmatic `setExpanded`).
 *   - `setExpanded` ignores the FIRST `setExpanded(false)` under Full (pi's
 *     construction default) but respects every other call (a user click, a
 *     ctrl+o `setToolsExpanded` toggle, or a `setExpanded(true)`), so a user
 *     collapse/expand sticks.
 */
export function patchToolRenderer(config: { toolStyle?: OutputStyle }): void {
  liveConfig = config; // always refresh (so /resume + re-patches see fresh config)
  if (!ToolExecutionComponent) return;
  // `updateDisplay` and `expanded` are `private` in the .d.ts — cast to patch them.
  const proto: any = ToolExecutionComponent.prototype;
  if (!proto) return;
  if (typeof proto.updateDisplay !== "function" || typeof proto.setExpanded !== "function") return; // graceful no-op
  if (wrapped) return; // already wrapped this process — do NOT double-wrap

  const origUpdateDisplay = proto.updateDisplay as (...args: unknown[]) => unknown;
  const origSetExpanded = proto.setExpanded as (expanded: boolean) => void;

  proto.updateDisplay = function (this: any, ...args: unknown[]): unknown {
    // Auto-expand a fresh tool under Full (fresh = pi's programmatic
    // setExpanded hasn't arrived yet — the constructor's updateDisplay is first).
    if (liveConfig.toolStyle === "Full" && !this[TOOL_FRESH_KEY] && !this.expanded) {
      this.expanded = true;
    }
    return origUpdateDisplay.apply(this, args);
  };
  proto.setExpanded = function (this: any, expanded: boolean): void {
    if (!this[TOOL_FRESH_KEY]) {
      this[TOOL_FRESH_KEY] = true;
      // Ignore pi's programmatic setExpanded(false) at construction under Full
      // (it would override the auto-expand). Respect setExpanded(true) and,
      // after the first call, every call (user click / ctrl+o).
      if (expanded === false && liveConfig.toolStyle === "Full") {
        return; // keep the auto-expanded state
      }
    }
    return origSetExpanded.call(this, expanded);
  };

  wrapped = true;
}
