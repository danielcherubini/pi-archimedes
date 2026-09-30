import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import type { OutputStyle } from "../config.js";

// Per-instance: has a setExpanded been seen yet (fresh = pi's programmatic
// setExpanded hasn't arrived after the constructor's updateDisplay).
const TOOL_FRESH_KEY = Symbol.for("archimedes:toolFresh");
// On the PROTOTYPE (not the module): the TRUE originals. pi's /reload
// re-evaluates the extension module graph (jiti, moduleCache: false) while
// ToolExecutionComponent (pi's shared host module) keeps its already-wrapped
// prototype. A module-level guard would double-wrap on reload (chaining the
// wrapper per reload, each stale layer closing over a frozen liveConfig); a
// prototype-level Symbol.for guard survives the re-evaluation, so a fresh
// module re-assigns a wrapper that REPLACES the old one — no chaining, no
// stale closure (same approach as thinking/patch.ts).
const TOOL_ORIG_UPDATE = Symbol.for("archimedes:toolOrigUpdate");
const TOOL_ORIG_SET_EXPANDED = Symbol.for("archimedes:toolOrigSetExpanded");

// Module-level live config, refreshed on every call. A re-evaluated module
// (pi /reload) gets a fresh one, and its fresh wrapper reads it, so a
// Full→Compact change sticks across reloads.
let liveConfig: { toolStyle?: OutputStyle } = {};

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
 *
 * Reload-safe: the true originals are saved once on the prototype
 * (`Symbol.for`), and the wrappers are (re)ASSIGNED — never chained. A
 * re-evaluated module (pi /reload) installs a fresh wrapper closing over the
 * fresh `liveConfig`, replacing the old one.
 */
export function patchToolRenderer(config: { toolStyle?: OutputStyle }): void {
  liveConfig = config; // always refresh (so /resume + re-patches see fresh config)
  if (!ToolExecutionComponent) return;
  // `updateDisplay` and `expanded` are `private` in the .d.ts — cast to patch them.
  const proto: any = ToolExecutionComponent.prototype;
  if (!proto) return;
  if (typeof proto.updateDisplay !== "function" || typeof proto.setExpanded !== "function") return; // graceful no-op

  // Save the TRUE originals once (on the prototype, so a re-evaluated module
  // re-applying the patch sees the same true original — never chain a wrapper
  // over a wrapper). The signature probe runs only on the first save: on a
  // re-apply the symbol already holds the (already-validated) true original,
  // and probing the wrapped method would false-positive on our own wrapper.
  if (!proto[TOOL_ORIG_SET_EXPANDED]) {
    // Signature probe (minification-safe, mirroring thinking/patch.ts): the
    // native setExpanded must both assign `this.expanded` and call
    // `this.updateDisplay()`. If a pi build changed the shape, wrapping would
    // silently break the native expand/collapse — warn and no-op instead.
    const setExpandedSrc = proto.setExpanded.toString();
    const assignsExpanded = /this\.expanded\s*=/.test(setExpandedSrc);
    const callsUpdateDisplay = /this\.updateDisplay\(\)/.test(setExpandedSrc);
    if (!assignsExpanded || !callsUpdateDisplay) {
      console.warn(
        `[archimedes] Skipping tool renderer patch — setExpanded signature mismatch ` +
          `(assignsExpanded: ${assignsExpanded}, callsUpdateDisplay: ${callsUpdateDisplay}). ` +
          `This likely means pi's ToolExecutionComponent changed. ` +
          `toolStyle "Full" auto-expand will not be applied.`,
      );
      return;
    }
    proto[TOOL_ORIG_SET_EXPANDED] = proto.setExpanded;
  }
  if (!proto[TOOL_ORIG_UPDATE]) proto[TOOL_ORIG_UPDATE] = proto.updateDisplay;

  // (Re)assign the wrappers — replace, never chain. Each reads the true
  // original from the symbol above and the live config from the module-level
  // `liveConfig`, so a re-evaluated module supersedes the old wrapper with a
  // fresh one (fresh closure, no stale layer).
  proto.updateDisplay = function (this: any, ...args: unknown[]): unknown {
    // Auto-expand a fresh tool under Full (fresh = pi's programmatic
    // setExpanded hasn't arrived yet — the constructor's updateDisplay is first).
    if (liveConfig.toolStyle === "Full" && !this[TOOL_FRESH_KEY] && !this.expanded) {
      this.expanded = true;
    }
    return proto[TOOL_ORIG_UPDATE].apply(this, args);
  };
  proto.setExpanded = function (this: any, expanded: boolean): void {
    if (!this[TOOL_FRESH_KEY]) {
      this[TOOL_FRESH_KEY] = true;
      // Ignore pi's programmatic setExpanded(false) at construction under Full
      // (it would override the auto-expand). Respect setExpanded(true) and,
      // after the first call, every call (user click / ctrl+o).
      //
      // Fail-safe: only swallow when the tool was actually auto-expanded
      // (this.expanded === true). If the first setExpanded(false) arrives
      // while the tool is still collapsed (an ordering failure, e.g. a
      // history-restored tool whose construction ran before the auto-expand),
      // calling through (native collapse) is correct — never swallow a first
      // click on a tool we didn't expand.
      if (expanded === false && liveConfig.toolStyle === "Full" && this.expanded) {
        return; // keep the auto-expanded state
      }
    }
    return proto[TOOL_ORIG_SET_EXPANDED].call(this, expanded);
  };
}
