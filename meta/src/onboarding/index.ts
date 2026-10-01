import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, updateConfig } from "@pi-archimedes/core/settings-io";
import { OVERLAY_CHROME } from "@pi-archimedes/core/overlay";
import {
  DEFAULT_UI_CONFIG,
  loadUIConfig,
  normalizeThinkingStyle,
  normalizeToolStyle,
  SPINNER_STYLES,
} from "@pi-archimedes/ui/config";
import { isPluginEnabled, PLUGINS, setPluginEnabled } from "../plugins.js";
import { createOnboardingOverlay, type OnboardingResult } from "./overlay.js";

const META_NS = "archimedes.meta";

export async function runOnboarding(ctx: ExtensionContext): Promise<void> {
  // Gate 1: TUI only (the marker is not consumed in non-TUI modes, so a later
  // TUI session still gets the onboarding — same as offerKeybindingFix gate 2).
  if (ctx.mode !== "tui") return;
  // Gate 2: marker unset.
  if (loadConfig(META_NS, { onboarded: false }).onboarded === true) return;
  // Defer one tick so the TUI processes current state (mirrors the ask IPC relay).
  await new Promise((resolve) => setImmediate(resolve));
  // Re-check the marker after the defer (a concurrent session may have set it).
  if (loadConfig(META_NS, { onboarded: false }).onboarded === true) return;

  const ui = loadUIConfig();
  const plugins = PLUGINS.map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    selected: isPluginEnabled(p.id),
  }));

  // Per-invocation idempotence: onDone runs the write at most once per runOnboarding.
  // A failed write leaves the marker unset, so the NEXT session re-runs with a
  // fresh `finished` and retries (self-heal).
  let finished = false;
  const finish = (result: OnboardingResult): void => {
    if (finished) return;
    finished = true;
    const uiMutations: Partial<typeof DEFAULT_UI_CONFIG> = {};
    if (result.thinkingAnswered) uiMutations.thinkingStyle = result.thinkingValue;
    if (result.toolAnswered) uiMutations.toolStyle = result.toolValue;
    if (result.spinnerAnswered) uiMutations.editorSpinStyle = result.spinnerValue as typeof DEFAULT_UI_CONFIG["editorSpinStyle"];
    try {
      if (Object.keys(uiMutations).length > 0) {
        updateConfig("archimedes.ui", DEFAULT_UI_CONFIG, (c) => ({ ...c, ...uiMutations }));
      }
      if (result.pluginsAnswered) {
        for (const p of PLUGINS) {
          const selected = result.pluginSelections[p.id];
          if (selected !== undefined && selected !== isPluginEnabled(p.id)) {
            setPluginEnabled(p.id, selected);
          }
        }
      }
      updateConfig(META_NS, { onboarded: false }, (c) => ({ ...c, onboarded: true })); // marker last
    } catch (err) {
      console.error("[archimedes] onboarding save failed:", err); // marker NOT set → self-heals
    }
  };

  await ctx.ui.custom((tui, theme, _keybindings, done) => {
    return createOnboardingOverlay({
      theme,
      thinkingDefault: normalizeThinkingStyle(ui.thinkingStyle),
      toolDefault: normalizeToolStyle(ui.toolStyle),
      plugins,
      spinners: SPINNER_STYLES,
      spinnerDefault: ui.editorSpinStyle,
      // The live spinner previews animate on a 40 ms tick (the TUI does not repaint on a global timer — the component owns the timer and asks for a repaint).
      requestRender: () => tui.requestRender(),
      onDone: (result: OnboardingResult) => {
        finish(result);
        done(undefined);
      },
    });
  }, { overlay: true, overlayOptions: OVERLAY_CHROME });
}
