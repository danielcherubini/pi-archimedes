import { describe, it, expect } from "vitest";
import {
  THINKING_LEVELS,
  isThinkingLevel,
  resolveThinkingLevel,
  formatUnknownThinkingWarning,
} from "./thinking-validation.js";

// pi's CLI keeps its own list of accepted `--thinking` levels and, for anything
// outside it, warns and drops the flag rather than failing
// (`pi/dist/cli/args.js`: `VALID_THINKING_LEVELS`). A child configured with a
// level pi does not take therefore runs at the default while its config claims
// otherwise, and in `--mode json` the warning lands in stderr — which the stream
// reader only ever shows for a failed run.
//
// This file pins the copy of that list the suite checks against. If pi changes
// the set, the assertion below goes red and the consequence of not noticing is
// a warning plus the default level, never a refused dispatch.

describe("isThinkingLevel", () => {
  it("accepts exactly pi's seven levels", () => {
    expect([...THINKING_LEVELS]).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    for (const level of THINKING_LEVELS) expect(isThinkingLevel(level)).toBe(true);
  });

  it("refines the value it accepts", () => {
    const value: unknown = "high";
    if (isThinkingLevel(value)) {
      const asString: string = value;
      expect(asString).toBe("high");
    } else {
      throw new Error("high should be a thinking level");
    }
  });

  it("refuses a level pi warns about and drops", () => {
    for (const bad of ["ultra", "Medium", "medium ", "highest", "auto", "0"]) {
      expect(isThinkingLevel(bad), bad).toBe(false);
    }
  });

  it("refuses anything that is not a string at all", () => {
    for (const bad of [undefined, null, 2, true, ["low"]]) {
      expect(isThinkingLevel(bad)).toBe(false);
    }
  });
});

describe("resolveThinkingLevel", () => {
  it("passes a valid level through", () => {
    expect(resolveThinkingLevel("xhigh")).toEqual({ level: "xhigh", warning: undefined });
  });

  it("says nothing when the config set no level", () => {
    expect(resolveThinkingLevel(undefined)).toEqual({ level: undefined, warning: undefined });
    expect(resolveThinkingLevel("")).toEqual({ level: undefined, warning: undefined });
  });

  it("withholds a level pi would drop, and says so", () => {
    const resolved = resolveThinkingLevel("ultra");
    expect(resolved.level).toBeUndefined();
    expect(resolved.warning).toContain('"ultra"');
    expect(resolved.warning).toMatch(/default thinking level/i);
    for (const level of THINKING_LEVELS) {
      expect(resolved.warning).toContain(level);
    }
  });
});

describe("formatUnknownThinkingWarning", () => {
  it("names the value rather than describing the problem in the abstract", () => {
    expect(formatUnknownThinkingWarning("turbo")).toContain("turbo");
  });
});
