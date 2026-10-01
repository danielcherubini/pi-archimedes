import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import {
  padEnd,
  renderFooter,
  renderHeader,
  wrapWithBorder,
  type OverlayTheme,
} from "@pi-archimedes/core/overlay";
import type { OutputStyle } from "@pi-archimedes/ui/config";
import { spinFrame } from "@pi-archimedes/ui/editor";

/**
 * The onboarding modal's result. Each `*Answered` flag tells the orchestrator
 * (Task 4) whether the user actually committed that step — an unanswered step
 * is left untouched on the write side. `thinkingValue`/`toolValue` are only
 * meaningful when their step was answered; `pluginSelections` maps every plugin
 * id to its final on/off state (present regardless, so the orchestrator can
 * diff against the current flags).
 */
export interface OnboardingResult {
  thinkingAnswered: boolean;
  thinkingValue: OutputStyle;
  toolAnswered: boolean;
  toolValue: OutputStyle;
  pluginsAnswered: boolean;
  pluginSelections: Record<string, boolean>;
  spinnerAnswered: boolean;
  spinnerValue: string;
}

export interface OnboardingOverlayOptions {
  theme: OverlayTheme;
  thinkingDefault: OutputStyle;
  toolDefault: OutputStyle;
  plugins: { id: string; label: string; description: string; selected: boolean }[];
  spinners: readonly string[];
  spinnerDefault: string;
  /** The TUI repaint hook (the `ui.custom` factory's `tui.requestRender`) — when provided, the spinner step's live 4-cell previews animate on a 40 ms tick; without it the previews are static (tick 0) and no timer runs. */
  requestRender?: () => void;
  onDone: (result: OnboardingResult) => void;
}

// The single "style" question was split into two INDEPENDENT ones (thinking +
// tool) so the user can mix, e.g. "Full thinking" + "Compact tools".
const THINKING_OPTIONS: { label: OutputStyle; description: string }[] = [
  { label: "Full", description: "Show all of the model's reasoning" },
  { label: "Compact", description: "One line of reasoning (click to expand)" },
];
const TOOL_OPTIONS: { label: OutputStyle; description: string }[] = [
  { label: "Full", description: "Show all tool output (expanded)" },
  { label: "Compact", description: "Collapse tool output (click to expand)" },
];

/**
 * Build the onboarding wizard as a single pure TUI component: one `ui.custom`
 * overlay with an internal `step` state (0 → 1 → 2 → 3) and no open/close
 * flicker between steps. It is deliberately NOT a reuse of the `ask`
 * package's `askQuestionsWithTabs` (whose "Other" option,
 * cancel-discards-everything semantics, and blocked empty-multi-select don't
 * fit a setup wizard).
 *
 * It is a pure function: it takes the pre-selected values + an `onDone`
 * callback and returns a TUI component; it knows nothing about settings or
 * plugins, so it is testable in isolation. The `theme` is typed as the
 * structural `OverlayTheme` (not the `Theme` class, which has private members
 * and can't be satisfied by a plain object mock).
 */
export function createOnboardingOverlay(opts: OnboardingOverlayOptions) {
  const theme = opts.theme;
  let activeStep = 0;
  // Clamp the pre-selected indices (a corrupt/unknown value → index 0, never -1).
  const cursorByStep: number[] = [
    Math.max(0, THINKING_OPTIONS.findIndex((o) => o.label === opts.thinkingDefault)),
    Math.max(0, TOOL_OPTIONS.findIndex((o) => o.label === opts.toolDefault)),
    0,
    Math.max(0, opts.spinners.indexOf(opts.spinnerDefault)),
  ];
  const pluginToggles: boolean[] = opts.plugins.map((p) => p.selected);
  const confirmed: boolean[] = [false, false, false, false];
  let finalized = false;
  // The live spinner-preview tick (the spinner step renders `spinFrame(name, tick)` next to each name); only advances when a repaint hook is provided.
  let tick = 0;
  const onTick = opts.requestRender;
  // Only the spinner step (3) renders a live frame — don't advance the tick or
  // request a repaint while the user is on the thinking/tool/plugin steps.
  const timer = onTick
    ? setInterval(() => {
        if (activeStep === 3) {
          tick += 1;
          onTick();
        }
      }, 40)
    : undefined;

  function optionsCountForStep(step: number): number {
    if (step === 0) return THINKING_OPTIONS.length;
    if (step === 1) return TOOL_OPTIONS.length;
    if (step === 2) return opts.plugins.length;
    return opts.spinners.length;
  }

  function finalize(): void {
    if (finalized) return;
    finalized = true;
    // Belt-and-braces: stop the interval the moment the wizard is done (in case
    // the TUI tears down without calling dispose()).
    if (timer) clearInterval(timer);
    const thinkingIdx = cursorByStep[0] ?? 0;
    const toolIdx = cursorByStep[1] ?? 0;
    const spinnerIdx = cursorByStep[3] ?? 0;
    const pluginSelections: Record<string, boolean> = {};
    for (let i = 0; i < opts.plugins.length; i++) {
      const p = opts.plugins[i];
      if (!p) continue;
      pluginSelections[p.id] = pluginToggles[i] ?? false;
    }
    opts.onDone({
      thinkingAnswered: confirmed[0] ?? false,
      thinkingValue: THINKING_OPTIONS[thinkingIdx]?.label ?? "Full",
      toolAnswered: confirmed[1] ?? false,
      toolValue: TOOL_OPTIONS[toolIdx]?.label ?? "Full",
      pluginsAnswered: confirmed[2] ?? false,
      pluginSelections,
      spinnerAnswered: confirmed[3] ?? false,
      spinnerValue: opts.spinners[spinnerIdx] ?? "",
    });
  }

  function handleInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      cursorByStep[activeStep] = Math.max(0, (cursorByStep[activeStep] ?? 0) - 1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      // Math.max(0, …): with an empty options list the min() bound alone is -1,
      // which would drive the cursor negative (same discipline as the up clamp).
      cursorByStep[activeStep] = Math.max(
        0,
        Math.min(
          optionsCountForStep(activeStep) - 1,
          (cursorByStep[activeStep] ?? 0) + 1,
        ),
      );
      return;
    }
    if (matchesKey(data, Key.space) && activeStep === 2) {
      const cur = cursorByStep[2] ?? 0;
      pluginToggles[cur] = !(pluginToggles[cur] ?? false);
      return;
    }
    if (matchesKey(data, Key.enter)) {
      confirmed[activeStep] = true;
      if (activeStep === 3) finalize();
      else activeStep += 1;
      return;
    }
    if (matchesKey(data, Key.escape)) {
      finalize();
      return;
    }
  }

  function render(width: number): string[] {
    const lines: string[] = [];
    lines.push(renderHeader(" Welcome to pi-archimedes ", width - 2, theme));
    lines.push(padEnd(`Set up your preferences · ${activeStep + 1}/4`, width - 2));
    lines.push(padEnd("Choices apply from your next session.", width - 2));

    if (activeStep === 0) {
      lines.push(padEnd("Thinking style", width - 2));
      lines.push("");
      for (let i = 0; i < THINKING_OPTIONS.length; i++) {
        const opt = THINKING_OPTIONS[i];
        if (!opt) continue;
        const marker = i === (cursorByStep[0] ?? 0) ? "> " : "  ";
        lines.push(
          padEnd(
            `${marker}${opt.label.padEnd(9)}${truncateToWidth(opt.description, width - 14, "")}`,
            width - 2,
          ),
        );
      }
      lines.push("");
      lines.push(renderFooter(" [↑↓] move  [enter] next  [esc] finish ", width - 2, theme));
    } else if (activeStep === 1) {
      lines.push(padEnd("Tool output style", width - 2));
      lines.push("");
      for (let i = 0; i < TOOL_OPTIONS.length; i++) {
        const opt = TOOL_OPTIONS[i];
        if (!opt) continue;
        const marker = i === (cursorByStep[1] ?? 0) ? "> " : "  ";
        lines.push(
          padEnd(
            `${marker}${opt.label.padEnd(9)}${truncateToWidth(opt.description, width - 14, "")}`,
            width - 2,
          ),
        );
      }
      lines.push("");
      lines.push(renderFooter(" [↑↓] move  [enter] next  [esc] finish ", width - 2, theme));
    } else if (activeStep === 2) {
      lines.push(padEnd("Which plugins do you want?", width - 2));
      lines.push("");
      for (let i = 0; i < opts.plugins.length; i++) {
        const p = opts.plugins[i];
        if (!p) continue;
        // The cursor (>) marks the row Space will toggle; the ✓/· marker shows
        // the row's enabled state — both, so the user sees what they're about
        // to change and what it currently is.
        const cursor = i === (cursorByStep[2] ?? 0) ? "> " : "  ";
        const marker = (pluginToggles[i] ?? false) ? "✓" : "·";
        const label = truncateToWidth(p.label, 15, "");
        lines.push(
          padEnd(
            `${cursor} ${marker} ${label.padEnd(16)}${truncateToWidth(p.description, width - 26, "")}`,
            width - 2,
          ),
        );
      }
      lines.push("");
      lines.push(renderFooter(" [↑↓] move  [space] toggle  [enter] next  [esc] finish ", width - 2, theme));
    } else {
      lines.push(padEnd("Which spinner for the editor border?", width - 2));
      lines.push("");
      for (let i = 0; i < opts.spinners.length; i++) {
        const name = opts.spinners[i] ?? "";
        const marker = i === (cursorByStep[3] ?? 0) ? "> " : "  ";
        const preview = spinFrame(name, tick);
        // Options render consecutively (no blank line between them): the 10
        // options must fit the overlay's 80% max height on a small terminal
        // (24 rows → ~19), so the per-option vertical spacing was dropped.
        lines.push(padEnd(`${marker}${name.padEnd(15)}${preview}`, width - 2));
      }
      lines.push("");
      lines.push(renderFooter(" [↑↓] move  [enter] done  [esc] finish (skip rest) ", width - 2, theme));
    }

    return wrapWithBorder(lines, width, theme);
  }

  return {
    focused: true,
    render,
    handleInput,
    invalidate(): void {},
    dispose(): void {
      if (timer) clearInterval(timer);
    },
  };
}
