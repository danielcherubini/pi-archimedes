import { describe, it, expect, vi } from "vitest";
import { createOnboardingOverlay, type OnboardingResult } from "./overlay.js";
import type { OverlayTheme } from "@pi-archimedes/core/overlay";

// A plain-object theme satisfying the structural OverlayTheme (no ANSI — the
// `fg` mock returns its input verbatim, so rendered lines are plain text).
const theme: OverlayTheme = { fg: (_t: string, s: string) => s };

// Raw terminal sequences (matchesKey compares against these, NOT the Key.*
// literals): down / up / enter / space / escape.
const DOWN = "\x1b[B";
const UP = "\x1b[A";
const ENTER = "\r";
const SPACE = " ";
const ESC = "\x1b";

type PluginSeed = { id: string; label: string; description: string; selected: boolean };

function makeOverlay(opts: {
  styleDefault?: "Full" | "Compact";
  plugins?: PluginSeed[];
  spinners?: readonly string[];
  spinnerDefault?: string;
} = {}) {
  const onDone = vi.fn<(result: OnboardingResult) => void>();
  const comp = createOnboardingOverlay({
    theme,
    styleDefault: opts.styleDefault ?? "Full",
    plugins:
      opts.plugins ?? [
        { id: "ui", label: "UI", description: "TUI enhancements", selected: true },
        { id: "diff", label: "Diff", description: "Diff rendering", selected: false },
      ],
    spinners: opts.spinners ?? ["typing", "pulse", "rain"],
    spinnerDefault: opts.spinnerDefault ?? "pulse",
    onDone,
  });
  return { comp, onDone };
}

function resultOf(onDone: ReturnType<typeof vi.fn>): OnboardingResult {
  const call = onDone.mock.calls[0];
  expect(call).toBeDefined();
  return call?.[0] as OnboardingResult;
}

describe("createOnboardingOverlay", () => {
  it("returns a TUI component with the expected shape", () => {
    const { comp } = makeOverlay();
    expect(comp.focused).toBe(true);
    expect(typeof comp.render).toBe("function");
    expect(typeof comp.handleInput).toBe("function");
    expect(typeof comp.invalidate).toBe("function");
    expect(typeof comp.dispose).toBe("function");
  });

  // (a) step 0 renders both style options; the default carries the "> " cursor.
  it("step 0 shows both style options with the default carrying the cursor", () => {
    const { comp } = makeOverlay({ styleDefault: "Compact" });
    const lines = comp.render(80);
    const text = lines.join("\n");
    expect(text).toContain("Full");
    expect(text).toContain("Compact");
    const fullLine = lines.find((l) => l.includes("Full"));
    const compactLine = lines.find((l) => l.includes("Compact"));
    expect(fullLine).toBeDefined();
    expect(compactLine).toBeDefined();
    // The pre-selected (Compact) carries the cursor; the other does not.
    expect(compactLine).toContain("> Compact");
    expect(fullLine).not.toContain("> Full");
    // A corrupt/unknown default clamps to index 0 (Full), never -1.
    const { comp: corrupt } = makeOverlay({ styleDefault: "Bogus" as "Full" | "Compact" });
    expect(corrupt.render(80).join("\n")).toContain("> Full");
  });

  // (b) down then enter advances to step 1 (plugins header) and confirms style.
  it("down + enter advances to step 1 and a later finalize reports styleAnswered", () => {
    const { comp, onDone } = makeOverlay({ styleDefault: "Full" });
    comp.handleInput(DOWN); // move the style cursor Full → Compact
    comp.handleInput(ENTER); // confirm style, advance to step 1
    expect(comp.render(80).join("\n")).toContain("Which plugins do you want?");
    comp.handleInput(ESC); // finalize
    expect(onDone).toHaveBeenCalledTimes(1);
    const result = resultOf(onDone);
    expect(result.styleAnswered).toBe(true);
    expect(result.styleValue).toBe("Compact"); // the down-arrow selection
    expect(result.pluginsAnswered).toBe(false);
    expect(result.spinnerAnswered).toBe(false);
  });

  // (c) space on step 1 toggles the selected plugin; finalize reports it.
  it("space on step 1 toggles the selected plugin", () => {
    const { comp, onDone } = makeOverlay({
      styleDefault: "Full",
      plugins: [
        { id: "ui", label: "UI", description: "TUI", selected: true },
        { id: "diff", label: "Diff", description: "Diff", selected: false },
      ],
    });
    comp.handleInput(ENTER); // confirm step 0 → step 1 (cursor at index 0 = ui)
    comp.handleInput(SPACE); // toggle ui: true → false
    comp.handleInput(ESC); // finalize
    expect(onDone).toHaveBeenCalledTimes(1);
    const result = resultOf(onDone);
    expect(result.pluginSelections).toEqual({ ui: false, diff: false });
  });

  // (d) escape on step 0 finalizes with nothing answered, exactly once.
  it("escape on step 0 calls onDone once with nothing answered", () => {
    const { comp, onDone } = makeOverlay();
    comp.handleInput(ESC);
    expect(onDone).toHaveBeenCalledTimes(1);
    const result = resultOf(onDone);
    expect(result.styleAnswered).toBe(false);
    expect(result.pluginsAnswered).toBe(false);
    expect(result.spinnerAnswered).toBe(false);
  });

  // (e) completing all three steps reports everything answered + selected values.
  it("completing all three steps reports all answered with the selected values", () => {
    const { comp, onDone } = makeOverlay({
      styleDefault: "Full",
      plugins: [
        { id: "ui", label: "UI", description: "TUI", selected: true },
        { id: "diff", label: "Diff", description: "Diff", selected: false },
      ],
      spinners: ["typing", "pulse", "rain"],
      spinnerDefault: "pulse",
    });
    comp.handleInput(ENTER); // step 0 → 1
    comp.handleInput(ENTER); // step 1 → 2
    comp.handleInput(ENTER); // step 2 → finalize
    expect(onDone).toHaveBeenCalledTimes(1);
    const result = resultOf(onDone);
    expect(result.styleAnswered).toBe(true);
    expect(result.pluginsAnswered).toBe(true);
    expect(result.spinnerAnswered).toBe(true);
    expect(result.styleValue).toBe("Full");
    expect(result.pluginSelections).toEqual({ ui: true, diff: false });
    expect(result.spinnerValue).toBe("pulse");
  });

  // (f) onDone is called at most once — a second finalize/escape is a no-op.
  it("onDone is called at most once (repeated finalize is a no-op)", () => {
    const { comp, onDone } = makeOverlay();
    comp.handleInput(ENTER); // step 0 → 1
    comp.handleInput(ENTER); // step 1 → 2
    comp.handleInput(ENTER); // step 2 → finalize (first onDone)
    comp.handleInput(ESC); // second finalize attempt → no-op
    comp.handleInput(ENTER); // enter after finalize → no-op
    comp.handleInput(DOWN); // cursor moves are still safe no-ops
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  // Up-arrow clamps at the top (never a negative index).
  it("up-arrow clamps the cursor at index 0", () => {
    const { comp, onDone } = makeOverlay({ styleDefault: "Full" });
    comp.handleInput(UP); // already at 0 → stays 0
    comp.handleInput(UP);
    comp.handleInput(ENTER); // confirm
    comp.handleInput(ENTER);
    comp.handleInput(ENTER); // finalize
    const result = resultOf(onDone);
    expect(result.styleValue).toBe("Full"); // never wrapped to a negative index
  });
});
