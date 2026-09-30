import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import {
  padEnd,
  renderFooter,
  renderHeader,
  wrapWithBorder,
  type OverlayTheme,
} from "@pi-archimedes/core/overlay";
import type { OutputStyle } from "@pi-archimedes/ui/config";

/**
 * The onboarding modal's result. Each `*Answered` flag tells the orchestrator
 * (Task 4) whether the user actually committed that step — an unanswered step
 * is left untouched on the write side. `styleValue`/`spinnerValue` are only
 * meaningful when their step was answered; `pluginSelections` maps every plugin
 * id to its final on/off state (present regardless, so the orchestrator can
 * diff against the current flags).
 */
export interface OnboardingResult {
  styleAnswered: boolean;
  styleValue: OutputStyle;
  pluginsAnswered: boolean;
  pluginSelections: Record<string, boolean>;
  spinnerAnswered: boolean;
  spinnerValue: string;
}

export interface OnboardingOverlayOptions {
  theme: OverlayTheme;
  styleDefault: OutputStyle;
  plugins: { id: string; label: string; description: string; selected: boolean }[];
  spinners: readonly string[];
  spinnerDefault: string;
  onDone: (result: OnboardingResult) => void;
}

const STYLE_OPTIONS: { label: OutputStyle; description: string }[] = [
  { label: "Full", description: "Full thinking blocks, tools expanded" },
  { label: "Compact", description: "One-line thinking, collapsed tools" },
];

/**
 * Build the onboarding wizard as a single pure TUI component: one `ui.custom`
 * overlay with an internal `step` state (0 → 1 → 2) and no open/close flicker
 * between steps. It is deliberately NOT a reuse of the `ask` package's
 * `askQuestionsWithTabs` (whose "Other" option, cancel-discards-everything
 * semantics, and blocked empty-multi-select don't fit a setup wizard).
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
    Math.max(0, STYLE_OPTIONS.findIndex((o) => o.label === opts.styleDefault)),
    0,
    Math.max(0, opts.spinners.indexOf(opts.spinnerDefault)),
  ];
  const pluginToggles: boolean[] = opts.plugins.map((p) => p.selected);
  const confirmed: boolean[] = [false, false, false];
  let finalized = false;

  function optionsCountForStep(step: number): number {
    if (step === 0) return STYLE_OPTIONS.length;
    if (step === 1) return opts.plugins.length;
    return opts.spinners.length;
  }

  function finalize(): void {
    if (finalized) return;
    finalized = true;
    const styleIdx = cursorByStep[0] ?? 0;
    const spinnerIdx = cursorByStep[2] ?? 0;
    const pluginSelections: Record<string, boolean> = {};
    for (let i = 0; i < opts.plugins.length; i++) {
      const p = opts.plugins[i];
      if (!p) continue;
      pluginSelections[p.id] = pluginToggles[i] ?? false;
    }
    opts.onDone({
      styleAnswered: confirmed[0] ?? false,
      styleValue: STYLE_OPTIONS[styleIdx]?.label ?? "Full",
      pluginsAnswered: confirmed[1] ?? false,
      pluginSelections,
      spinnerAnswered: confirmed[2] ?? false,
      spinnerValue: opts.spinners[spinnerIdx] ?? "",
    });
  }

  function handleInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      cursorByStep[activeStep] = Math.max(0, (cursorByStep[activeStep] ?? 0) - 1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      cursorByStep[activeStep] = Math.min(
        optionsCountForStep(activeStep) - 1,
        (cursorByStep[activeStep] ?? 0) + 1,
      );
      return;
    }
    if (matchesKey(data, Key.space) && activeStep === 1) {
      const cur = cursorByStep[1] ?? 0;
      pluginToggles[cur] = !(pluginToggles[cur] ?? false);
      return;
    }
    if (matchesKey(data, Key.enter)) {
      confirmed[activeStep] = true;
      if (activeStep === 2) finalize();
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
    lines.push(padEnd(`Set up your preferences · ${activeStep + 1}/3`, width - 2));
    lines.push("");

    if (activeStep === 0) {
      lines.push(padEnd("How should the output look?", width - 2));
      lines.push("");
      for (let i = 0; i < STYLE_OPTIONS.length; i++) {
        const opt = STYLE_OPTIONS[i];
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
      lines.push(padEnd("Which plugins do you want?", width - 2));
      lines.push("");
      for (let i = 0; i < opts.plugins.length; i++) {
        const p = opts.plugins[i];
        if (!p) continue;
        const marker = (pluginToggles[i] ?? false) ? "✓ " : "· ";
        const label = truncateToWidth(p.label, 18, "");
        lines.push(
          padEnd(
            `${marker}${label.padEnd(19)}${truncateToWidth(p.description, width - 22, "")}`,
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
        const marker = i === (cursorByStep[2] ?? 0) ? "> " : "  ";
        lines.push(padEnd(`${marker}${name}`, width - 2));
      }
      lines.push("");
      lines.push(renderFooter(" [↑↓] move  [enter] done  [esc] finish ", width - 2, theme));
    }

    return wrapWithBorder(lines, width, theme);
  }

  return {
    focused: true,
    render,
    handleInput,
    invalidate(): void {},
    dispose(): void {},
  };
}
