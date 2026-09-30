import { describe, it, expect, vi, afterEach } from "vitest";
import { createOnboardingOverlay, type OnboardingResult } from "./overlay.js";
import type { OverlayTheme } from "@pi-archimedes/core/overlay";

// The live-preview seam: a deterministic 4-char string that varies with `tick`
// (so the tests can verify the frame advances) — the real spinFrame is the
// stateless 4-cell frame resolver in @pi-archimedes/ui/editor.
vi.mock("@pi-archimedes/ui/editor", () => ({
  spinFrame: vi.fn((style: string, tick: number) => {
    const c = 0x2800 + ((tick % 8) + (style.length % 4));
    return String.fromCharCode(c) + "⣷⣾⣽";
  }),
}));

// Mirrors the mock above — the expected preview for a style at a tick.
const previewAt = (style: string, tick: number): string => {
  const c = 0x2800 + ((tick % 8) + (style.length % 4));
  return String.fromCharCode(c) + "⣷⣾⣽";
};

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
  requestRender?: () => void;
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
    // exactOptionalPropertyTypes: only pass the key when defined.
    ...(opts.requestRender !== undefined
      ? { requestRender: opts.requestRender }
      : {}),
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

  // (g) The spinner step renders a live 4-char preview next to each name
  // (tick 0 — no requestRender means no timer, so the frame is static).
  it("spinner step renders a 4-char preview next to each name", () => {
    const { comp } = makeOverlay({ spinners: ["typing", "pulse", "rain"] });
    comp.handleInput(ENTER); // step 0 → 1
    comp.handleInput(ENTER); // step 1 → 2
    const lines = comp.render(80);
    expect(lines.join("\n")).toContain("Which spinner for the editor border?");
    for (const name of ["typing", "pulse", "rain"]) {
      const line = lines.find((l) => l.includes(name));
      expect(line).toBeDefined();
      expect(line).toContain(previewAt(name, 0));
    }
  });

  // (h) When requestRender is provided, the 40 ms interval fires it and the
  // rendered preview advances (tick increments).
  it("with requestRender: the interval fires it and the preview advances", () => {
    vi.useFakeTimers();
    const requestRender = vi.fn();
    const { comp } = makeOverlay({ requestRender });
    comp.handleInput(ENTER); // step 0 → 1
    comp.handleInput(ENTER); // step 1 → 2 (spinner step)
    const beforeLines = comp.render(80);
    expect(beforeLines.join("\n")).toContain(previewAt("typing", 0));
    vi.advanceTimersByTime(40);
    expect(requestRender).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(40);
    expect(requestRender).toHaveBeenCalledTimes(2);
    const afterLines = comp.render(80);
    expect(afterLines.join("\n")).toContain(previewAt("typing", 2));
    // The typing line's frame advanced (the previews are live, not static).
    const typingBefore = beforeLines.find((l) => l.includes("typing"));
    const typingAfter = afterLines.find((l) => l.includes("typing"));
    expect(typingAfter).toBeDefined();
    expect(typingBefore).toBeDefined();
    expect(typingAfter).not.toBe(typingBefore);
  });

  // (i) dispose() stops the interval — no more requestRender calls after close.
  it("dispose() stops the interval (no more requestRender calls)", () => {
    vi.useFakeTimers();
    const requestRender = vi.fn();
    const { comp } = makeOverlay({ requestRender });
    comp.handleInput(ENTER); // step 0 → 1
    comp.handleInput(ENTER); // step 1 → 2 (the interval only ticks here)
    vi.advanceTimersByTime(40);
    expect(requestRender).toHaveBeenCalledTimes(1);
    comp.dispose();
    vi.advanceTimersByTime(400);
    expect(requestRender).toHaveBeenCalledTimes(1); // no further calls
  });

  // (j) The interval only ticks on the spinner step — the style/plugin steps
  // render no live frame, so no repaint is requested (and no tick advances)
  // while the user is off the spinner step.
  it("the interval only ticks on the spinner step (no repaint on the other steps)", () => {
    vi.useFakeTimers();
    const requestRender = vi.fn();
    const { comp } = makeOverlay({ requestRender });
    vi.advanceTimersByTime(400);
    expect(requestRender).not.toHaveBeenCalled(); // step 0: no repaint
    comp.handleInput(ENTER); // step 0 → 1
    vi.advanceTimersByTime(400);
    expect(requestRender).not.toHaveBeenCalled(); // step 1: no repaint
    comp.handleInput(ENTER); // step 1 → 2
    vi.advanceTimersByTime(40);
    expect(requestRender).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(40);
    expect(requestRender).toHaveBeenCalledTimes(2);
    const lines = comp.render(80);
    expect(lines.join("\n")).toContain(previewAt("typing", 2)); // tick advanced here
  });

  // (k) finalize() stops the interval (belt-and-braces — in case the TUI tears
  // down without calling dispose()).
  it("finalize() stops the interval (no repaint after the wizard is done)", () => {
    vi.useFakeTimers();
    const requestRender = vi.fn();
    const { comp, onDone } = makeOverlay({ requestRender });
    comp.handleInput(ENTER); // step 0 → 1
    comp.handleInput(ENTER); // step 1 → 2
    vi.advanceTimersByTime(40);
    expect(requestRender).toHaveBeenCalledTimes(1);
    comp.handleInput(ENTER); // step 2 → finalize
    expect(onDone).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(400);
    expect(requestRender).toHaveBeenCalledTimes(1); // the interval was cleared in finalize
  });

  // (l) With an empty options list the cursor is clamped at 0 — the min() bound
  // alone could drive it to -1 (zero options → bound -1); Math.max(0, …) keeps it
  // non-negative (finalize then yields a valid empty value, not a crash).
  it("down-arrow with an empty options list keeps the cursor non-negative", () => {
    const { comp, onDone } = makeOverlay({ spinners: [] });
    comp.handleInput(ENTER); // step 0 → 1
    comp.handleInput(ENTER); // step 1 → 2 (empty spinner list)
    comp.handleInput(DOWN); // must stay at 0, never -1
    comp.handleInput(DOWN);
    comp.handleInput(UP);
    comp.handleInput(ENTER); // finalize
    expect(onDone).toHaveBeenCalledTimes(1);
    const result = resultOf(onDone);
    expect(result.spinnerAnswered).toBe(true);
    expect(result.spinnerValue).toBe(""); // empty list → empty value, no crash
  });

  // (m) The spinner-step footer makes the esc skip/discard semantics explicit —
  // esc finalizes and reports ONLY the confirmed steps (the unconfirmed ones
  // are skipped, not applied), so the hint must not read like "keep my changes".
  it("spinner step footer makes the esc skip/discard semantics explicit", () => {
    const { comp } = makeOverlay();
    comp.handleInput(ENTER); // step 0 → 1
    comp.handleInput(ENTER); // step 1 → 2
    const footer = comp.render(80).find((l) => l.includes("esc"));
    expect(footer).toBeDefined();
    expect(footer).toContain("finish (skip rest)");
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
