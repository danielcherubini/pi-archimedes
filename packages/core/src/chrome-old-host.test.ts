import { describe, it, expect, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { resolvePalette } from "./chrome.js";

// ── An old host: pi-tui without a colour emitter ────────────────────────────
//
// `chrome.ts` reaches the host's foreground emitter through a *namespace*
// import, and that choice is the whole subject of this file, so it gets its own
// module graph (vitest isolates modules per file) with the emitter taken away.
//
// pi-tui 0.87.0 — inside the range this suite supports, because `pi install`
// installs extensions with peerDependencies omitted, so the host's own copy is
// what runs — exported no `foregroundAnsi` and no `backgroundAnsi`. Measured
// against the real 0.87.0 dist: 72 exports, neither name among them, and a
// namespace import of it yields `undefined` for both. A *named* import of a name
// the module never exported fails when the module **links**, before one line of
// this package runs (measured on that same dist: `SyntaxError: The requested
// module … does not provide an export named 'foregroundAnsi'`), which would take
// the palette and every importer down instead of degrading. ADR 0026's rule is
// to warn about an old host and keep working, so the emitter is looked up at
// runtime and its absence means *no edge colour*.
//
// The mock reproduces exactly that one fact — reading the emitter answers
// `undefined` — and the assertions are the degradation contract: no throw, no
// colour, and nothing else about the palette changes.
//
// The keys are set to `undefined` rather than deleted because vitest's mocked
// namespace keeps the original module's export list and raises its own
// "No \"foregroundAnsi\" export is defined on the mock" error when a listed key
// is missing — an artefact of the mock machinery, not of ESM. What the code
// under test reads is `undefined` either way.
vi.mock("@earendil-works/pi-tui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@earendil-works/pi-tui")>()),
  foregroundAnsi: undefined,
  backgroundAnsi: undefined,
}));

/**
 * A theme of the modern shape — it has a `colors` map and a colour mode, so the
 * only thing missing is the emitter the host never had. The tint is deliberately
 * far from the border colour, so a substitute would show up.
 */
const tintedTheme = {
  appearance: "dark",
  getBgAnsi: (key: string) =>
    key === "userMessageBg" ? "\x1b[48;2;33;59;73m" : "\x1b[49m",
  getFgAnsi: (key: string) =>
    key === "borderMuted" ? "\x1b[38;2;118;129;134m" : "\x1b[39m",
  // `frame:` / `prefix:` go through `theme.fg()`, a different surface from the
  // one the edge uses — which is the point of the second test below.
  fg: (key: string, text: string) =>
    key === "borderMuted"
      ? `\x1b[38;2;118;129;134m${text}\x1b[0m`
      : (undefined as unknown as string),
  colors: { userMessageBg: { kind: "rgb", r: 33, g: 59, b: 73 } },
  getColorMode: () => "truecolor",
} as unknown as Theme;

describe("resolvePalette on a host whose pi-tui has no colour emitter", () => {
  it("degrades to no edge colour without throwing", () => {
    // The theme can name its own panel colour; nobody can render it as a
    // foreground. That is *no colour*, not an error and not a guess.
    expect(() => resolvePalette(tintedTheme)).not.toThrow();
    expect(resolvePalette(tintedTheme).panelEdge).toBe("");
  });

  it("keeps the panel tint and every other palette entry answering", () => {
    // Losing the slab colour must not cost the user the rest of the palette: a
    // package that half-loads on an old host is the failure ADR 0026 forbids.
    const p = resolvePalette(tintedTheme);
    expect(p.panelBg).toBe("\x1b[48;2;33;59;73m");
    expect(p.frame("┌")).toBe("\x1b[38;2;118;129;134m┌\x1b[0m");
    expect(p.prefix("> ")).toBe("\x1b[38;2;118;129;134m> \x1b[0m");
  });

  it("does not reach for a border token as the edge on an old host", () => {
    // The failure this guards is quiet: "no emitter" turning into "use the
    // border colour instead" would repaint the cushion as a grey rule, which is
    // the exact regression the edge rows were fixed for.
    expect(resolvePalette(tintedTheme).panelEdge).not.toBe(
      "\x1b[38;2;118;129;134m",
    );
  });
});
