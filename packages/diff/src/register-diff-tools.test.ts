/**
 * The `registerDiffTools` install guard (ADR 0029).
 *
 * pi keeps a LIST of resolvers and of event handlers per extension, so a second
 * registration on the SAME extension would stack a duplicate. But a session
 * replacement (`/new`, `/fork`, `/resume`) reuses pi's cached extension MODULE
 * while creating a FRESH extension — meta's own comment records exactly that —
 * so installation has to be keyed to the `pi` handle it is registering on, not
 * to the module. A module-wide flag hands every session after the first pi's
 * native `edit`/`write` rows and no result details at all.
 */

import { describe, expect, it, vi } from "vitest";
import { registerDiffTools } from "./index.js";

/** A `pi` handle that records what this registration asked for. */
function fakePi() {
  const renderers: ((name: string, next: () => unknown) => unknown)[] = [];
  const events: string[] = [];
  return {
    pi: {
      registerTool: vi.fn(),
      registerToolRenderer: (r: (name: string, next: () => unknown) => unknown) => {
        renderers.push(r);
      },
      on: (event: string) => {
        events.push(event);
        return () => {};
      },
    },
    renderers,
    events,
  };
}

const themeGetter = () => ({}) as never;
const configGetter = () => ({
  diffTheme: "github-dark",
  diffSplitMinWidth: 150,
  diffSplitMinCodeWidth: 60,
});

describe("registerDiffTools install scope", () => {
  it("does not stack a second set of renderers on the same pi handle", () => {
    const a = fakePi();
    // Two `session_start`s on one extension (the case the guard exists for).
    registerDiffTools(a.pi as never, themeGetter, configGetter);
    registerDiffTools(a.pi as never, themeGetter, configGetter);

    expect(a.renderers).toHaveLength(2); // edit + write, once each
    expect(a.events.filter((e) => e === "tool_result")).toHaveLength(2);
    expect(a.events.filter((e) => e === "tool_call")).toHaveLength(1);
  });

  it("installs again for a fresh pi handle sharing the cached module", () => {
    const first = fakePi();
    registerDiffTools(first.pi as never, themeGetter, configGetter);

    // A session replacement: same imported module, brand new extension.
    const second = fakePi();
    registerDiffTools(second.pi as never, themeGetter, configGetter);

    expect(second.renderers).toHaveLength(2);
    expect(second.events.filter((e) => e === "tool_result")).toHaveLength(2);
    expect(second.events.filter((e) => e === "tool_call")).toHaveLength(1);

    // The renderers the new extension was handed actually resolve, so the rows
    // are the Archimedes ones rather than pi's natives.
    const native = Object.freeze({ native: true });
    for (const name of ["edit", "write"]) {
      const resolved = second.renderers.map((r) => r(name, () => native));
      const mine = resolved.filter((x) => x !== native);
      expect(mine).toHaveLength(1);
      expect(typeof (mine[0] as { renderCall?: unknown }).renderCall).toBe("function");
      expect(typeof (mine[0] as { renderResult?: unknown }).renderResult).toBe("function");
      // Tools this extension does not own fall through to the next resolver.
      const other = second.renderers.map((r) => r("read", () => native));
      expect(other.every((x) => x === native)).toBe(true);
    }
  });
});
