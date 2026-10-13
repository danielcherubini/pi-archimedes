import { describe, it, expect } from "vitest";
import { Theme as PiTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { foregroundAnsi, indexedColor, rgbColor, type Color } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isTerminalDefault, resolvePalette } from "./chrome.js";

// ── Mock theme (mirrors the stubTheme / safeThemeColor assertion style) ──

// theme.fg per safeThemeColor: a key missing from `defined` resolves to
// undefined, exercising the fallback chain. Each available key answers
// with its own marker so tests can tell which key won.
function makeTheme(defined: Record<string, string>): Theme {
  return {
    fg: (key: string, text: string) => {
      const marker = defined[key];
      return marker === undefined ? undefined : `\x1b[${marker}m${text}\x1b[0m`;
    },
  } as unknown as Theme;
}

// ── spin palette entry ───────────────────────────────────────────────────

describe("resolvePalette spin", () => {
  it("wraps in the accent fg when the theme provides accent (and differs from prefix)", () => {
    const p = resolvePalette(
      makeTheme({
        accent: "38;2;1;2;3",
        borderMuted: "38;2;9;9;9",
        border: "38;2;9;9;99",
      }),
    );
    // accent wins for spin ...
    expect(p.spin("t")).toBe("\x1b[38;2;1;2;3mt\x1b[0m");
    // ... while prefix stays on borderMuted
    expect(p.prefix("t")).toBe("\x1b[38;2;9;9;9mt\x1b[0m");
    expect(p.spin("t")).not.toBe(p.prefix("t"));
  });

  it("falls back to borderMuted when accent is unavailable", () => {
    const p = resolvePalette(
      makeTheme({
        borderMuted: "38;2;9;9;9",
        border: "38;2;9;9;99",
      }),
    );
    expect(p.spin("t")).toBe("\x1b[38;2;9;9;9mt\x1b[0m");
    expect(p.spin("t")).toBe(p.prefix("t"));
  });

  it("falls back to the neutral gray when neither is available", () => {
    const p = resolvePalette(makeTheme({}));
    // Same fallback the safeThemeColor chain already uses for borderMuted/border
    expect(p.spin("t")).toBe("\x1b[38;2;74;74;74mt\x1b[0m");
  });
});

// ── Panel tint and edge ─────────────────────────────────────────────────────
//
// pi 0.99.0 made a theme token allowed to be `""` — *terminal default* — and
// `Theme.getBgAnsi()` renders that as `\x1b[49m`, a truthy string (measured
// against pi 1.2.0 below). A `getBgAnsi(...) ?? FALLBACK` chain therefore never
// reaches the fallback, and a `bgToFgAnsi()` that only understood `48;2;` and
// `48;5;` answered a terminal-default background with the near-black slab, so a
// panel got black borders on a light terminal. The rule these tests pin: the
// theme token plus `theme.appearance` decide colour; a terminal-default token
// means *no colour*; and nothing is inferred by parsing an escape sequence.
//
// The edge slab's colour comes from the SAME panel token, asked for as a
// foreground — `theme.colors[token]`, because pi takes a token only in its own
// slot. `borderMuted` colours the frame and never the cushion: a border token on
// the slab is what made a tinted panel look framed by a grey rule.

interface PanelTokens {
  /** Answers for `getBgAnsi`; a missing key makes the accessor throw. */
  bg?: Record<string, string>;
  /** Answers for `getFgAnsi`; a missing key makes the accessor throw. */
  fg?: Record<string, string>;
  /**
   * Answers for `theme.colors` — the cross-slot map the panel edge is read from.
   * Leaving it out stands in for a host old enough not to have it.
   */
  colors?: Record<string, Color>;
  /** `Theme.getColorMode()`: the mode the escapes are emitted in. */
  mode?: "truecolor" | "256color";
  /** `Theme.appearance`, which only exists from pi 0.99.0 on. */
  appearance?: "light" | "dark";
}

function makePanelTheme(tokens: PanelTokens): Theme {
  return {
    ...(tokens.appearance === undefined ? {} : { appearance: tokens.appearance }),
    // `colors` is a property, not a method: absent, it says "this host has no
    // cross-slot map" — a shape, not a colour.
    ...(tokens.colors === undefined
      ? {}
      : {
          colors: tokens.colors,
          getColorMode: () => tokens.mode ?? "truecolor",
        }),
    fg: (key: string, text: string) => {
      const token = tokens.fg?.[key];
      return token === undefined ? undefined : `${token}${text}\x1b[0m`;
    },
    getBgAnsi: (key: string) => {
      const token = tokens.bg?.[key];
      if (token === undefined) throw new Error(`Unknown theme color: ${key}`);
      return token;
    },
    getFgAnsi: (key: string) => {
      const token = tokens.fg?.[key];
      if (token === undefined) throw new Error(`Unknown theme color: ${key}`);
      return token;
    },
  } as unknown as Theme;
}

/**
 * A **real** pi 1.2.0 `Theme`. Constructing one needs every token that another
 * token falls back to (`scrollbarTrack`→`muted`, `scrollbarThumb`/`searchMatchText`→`text`,
 * `searchMatchBg`→`selectedBg`, `thinkingMax`→`thinkingXhigh`), because the
 * constructor resolves those eagerly. The token values below are the dark
 * theme's; `appearance` is declared so a test can ask about a light terminal
 * without shipping a second token table.
 */
function realPiTheme(
  overrides: Record<string, string | number>,
  options: {
    appearance: "light" | "dark";
    mode?: "truecolor" | "256color";
    /**
     * Tokens to leave out entirely, standing in for a hand-written theme JSON
     * that never declares them — `Theme` fills only tokens that declare a
     * fallback, so an omitted token makes `getBgAnsi` throw.
     */
    omit?: string[];
  },
): Theme {
  const tokens: Record<string, string | number> = {
    text: "#d8d8d8",
    muted: "#8a8a8a",
    dim: "#6a6a6a",
    accent: "#c586c0",
    border: "#5f7a91",
    borderMuted: "#768186",
    scrollbarTrack: "#3a3a3a",
    scrollbarThumb: "#d8d8d8",
    selectedBg: "#213b49",
    searchMatchBg: "#3a3a21",
    searchMatchText: "#d8d8d8",
    thinkingXhigh: "#c586c0",
    thinkingMax: "#e06c75",
    userMessageBg: "#213b49",
    customMessageBg: "#3a3055",
    toolDiffAdded: "#68b78d",
    toolDiffRemoved: "#e06c75",
    toolDiffContext: "#8a8a8a",
    ...overrides,
  };
  for (const token of options.omit ?? []) delete tokens[token];
  return new PiTheme(
    tokens as never,
    tokens as never,
    options.mode ?? "truecolor",
    { appearance: options.appearance },
  ) as unknown as Theme;
}

describe("isTerminalDefault", () => {
  it("recognises every shape of \"the terminal's own colour\"", () => {
    // "" is the pre-0.99.0 answer for a default token; the two 39/49 resets are
    // what Theme.getFgAnsi()/getBgAnsi() actually return for a token set to "";
    // the 0m forms are a full reset, which also leaves the colour unset.
    expect(isTerminalDefault("")).toBe(true);
    expect(isTerminalDefault("\x1b[39m")).toBe(true);
    expect(isTerminalDefault("\x1b[49m")).toBe(true);
    expect(isTerminalDefault("\x1b[0m")).toBe(true);
    expect(isTerminalDefault("\x1b[m")).toBe(true);
    expect(isTerminalDefault(undefined)).toBe(true);
  });

  it("does not mistake a colour for the terminal default", () => {
    // These are *compared* against the reset set — never cracked open for the
    // colour they encode (see the discipline test below).
    expect(isTerminalDefault("\x1b[48;2;33;59;73m")).toBe(false);
    expect(isTerminalDefault("\x1b[48;5;236m")).toBe(false);
    expect(isTerminalDefault("\x1b[38;5;2m")).toBe(false);
    expect(isTerminalDefault("\x1b[49;38;2;1;2;3m")).toBe(false);
  });
});

describe("resolvePalette panel tint and edge", () => {
  it("paints nothing when the panel token is the terminal default (\\x1b[49m)", () => {
    // The reported bug: pi's default `system` theme gives its panels no
    // background on a terminal that reported nothing, so getBgAnsi() answers
    // `\x1b[49m` — truthy — and the old chain tinted with it while deriving a
    // near-black edge.
    const p = resolvePalette(
      makePanelTheme({
        appearance: "light",
        bg: { userMessageBg: "\x1b[49m", customMessageBg: "\x1b[49m" },
        fg: { borderMuted: "\x1b[38;2;154;162;167m", border: "\x1b[38;2;118;163;191m" },
      }),
    );
    expect(p.panelBg).toBe("");
    expect(p.panelEdge).toBe("");
  });

  it("treats the pre-0.99.0 empty token as the same \"no colour\" answer", () => {
    const p = resolvePalette(makePanelTheme({ bg: { userMessageBg: "" } }));
    expect(p.panelBg).toBe("");
    expect(p.panelEdge).toBe("");
  });

  it("reads a bare reset as \"no colour\" too", () => {
    for (const reset of ["\x1b[0m", "\x1b[m", "\x1b[39m", "\x1b[49m"]) {
      const p = resolvePalette(makePanelTheme({ bg: { userMessageBg: reset } }));
      expect(p.panelBg, `reset ${JSON.stringify(reset)}`).toBe("");
      expect(p.panelEdge, `reset ${JSON.stringify(reset)}`).toBe("");
    }
  });

  it("keeps tinting with a real truecolour panel token, byte for byte", () => {
    // pi 1.2.0's dark theme measures userMessageBg as exactly this sequence.
    const p = resolvePalette(
      makePanelTheme({
        appearance: "dark",
        bg: { userMessageBg: "\x1b[48;2;33;59;73m" },
        fg: { borderMuted: "\x1b[38;2;118;129;134m" },
      }),
    );
    expect(p.panelBg).toBe("\x1b[48;2;33;59;73m");
  });

  it("edges the slab with the panel's own token asked as a foreground, not the border's", () => {
    // The slab cushions the panel, so it wears the panel's colour. Reaching for
    // `borderMuted` because it looks like a similar colour is the same class of
    // mistake as rewriting the background escape: the cushion stops being the
    // panel and becomes a line. Asking for the panel token in the foreground
    // slot is `theme.colors[token]` — pi takes a token only in its own slot —
    // and it stays a question asked of the theme, never a decode.
    const p = resolvePalette(
      makePanelTheme({
        appearance: "dark",
        bg: { userMessageBg: "\x1b[48;2;33;59;73m" },
        fg: { borderMuted: "\x1b[38;2;118;129;134m", border: "\x1b[38;2;95;122;145m" },
        colors: { userMessageBg: rgbColor(33, 59, 73) },
      }),
    );
    expect(p.panelEdge).toBe("\x1b[38;2;33;59;73m");
    expect(p.panelEdge).not.toBe("\x1b[38;2;118;129;134m");
    expect(p.panelEdge).not.toBe("\x1b[38;2;95;122;145m");
  });

  it("takes no edge when the theme cannot answer its own panel token as a foreground", () => {
    const borderOnly = resolvePalette(
      makePanelTheme({
        bg: { userMessageBg: "\x1b[48;2;33;59;73m" },
        // No `borderMuted`: the old chain fell through to `border` here. That
        // fallthrough is gone — the cushion is not a border, so no border token
        // answers it, `border` included.
        fg: { border: "\x1b[38;2;95;122;145m" },
        colors: { userMessageBg: rgbColor(33, 59, 73) },
      }),
    );
    expect(borderOnly.panelBg).toBe("\x1b[48;2;33;59;73m");
    expect(borderOnly.panelEdge).toBe("\x1b[38;2;33;59;73m");

    // A tinted panel whose theme has nothing for *that* token as a foreground:
    // no edge, and never a substitute token. The editor blanks the rows rather
    // than painting block glyphs in the terminal's own foreground.
    const cantAnswer = resolvePalette(
      makePanelTheme({
        bg: { userMessageBg: "\x1b[48;2;33;59;73m" },
        fg: { borderMuted: "\x1b[38;2;118;129;134m", border: "\x1b[38;2;95;122;145m" },
        colors: { customMessageBg: rgbColor(58, 48, 85) },
      }),
    );
    expect(cantAnswer.panelBg).toBe("\x1b[48;2;33;59;73m");
    expect(cantAnswer.panelEdge).toBe("");

    // The same answer from a host with no cross-slot map at all.
    const noColors = resolvePalette(
      makePanelTheme({
        bg: { userMessageBg: "\x1b[48;2;33;59;73m" },
        fg: { borderMuted: "\x1b[38;2;118;129;134m" },
      }),
    );
    expect(noColors.panelEdge).toBe("");
  });

  it("keeps the frame and the prefix in the border token while the slab wears the panel's", () => {
    // `frame:` and `prefix:` are real chrome and keep `borderMuted`; only the
    // cushion moved, so the `┌──┐` the user sees is untouched.
    const p = resolvePalette(
      makePanelTheme({
        bg: { userMessageBg: "\x1b[48;2;33;59;73m" },
        fg: { borderMuted: "\x1b[38;2;118;129;134m", border: "\x1b[38;2;95;122;145m" },
        colors: { userMessageBg: rgbColor(33, 59, 73) },
      }),
    );
    expect(p.panelEdge).toBe("\x1b[38;2;33;59;73m");
    expect(p.frame("┌")).toBe("\x1b[38;2;118;129;134m┌\x1b[0m");
    expect(p.prefix("> ")).toBe("\x1b[38;2;118;129;134m> \x1b[0m");
  });

  it("tracks a palette terminal: the slab keeps the panel's own index, in fg form", () => {
    // `"terminal": { "trueColor": false }` makes every token come back as
    // 38;5;n / 48;5;n (measured: userMessageBg #262626 -> \x1b[48;5;236m). The
    // cushion is the panel's own colour, so it is the panel's own index — 236,
    // in the foreground form — and not the border's 240.
    const p = resolvePalette(
      makePanelTheme({
        appearance: "dark",
        mode: "256color",
        bg: { userMessageBg: "\x1b[48;5;236m" },
        fg: { borderMuted: "\x1b[38;5;240m" },
        colors: { userMessageBg: indexedColor(236) },
      }),
    );
    expect(p.panelBg).toBe("\x1b[48;5;236m");
    expect(p.panelEdge).toBe("\x1b[38;5;236m");
    expect(p.panelEdge).not.toBe("\x1b[38;5;240m");
  });

  it("falls back to a LIGHT slab when the theme reports a light appearance and no panel token", () => {
    // The fallback slab is only for a theme that cannot answer at all; even
    // then it must not paint near-black on a light terminal.
    const p = resolvePalette(makePanelTheme({ appearance: "light" }));
    expect(p.panelBg).toBe("\x1b[48;2;238;238;238m");
    expect(p.panelEdge).toBe("\x1b[38;2;238;238;238m");
  });

  it("keeps the near-black slab for a dark appearance, and for no theme object at all", () => {
    const dark = resolvePalette(makePanelTheme({ appearance: "dark" }));
    expect(dark.panelBg).toBe("\x1b[48;2;16;16;16m");
    expect(dark.panelEdge).toBe("\x1b[38;2;16;16;16m");

    // Headless / no theme object: the hardcoded constants, dark, and no throw.
    const none = resolvePalette(null as unknown as Theme);
    expect(none.panelBg).toBe("\x1b[48;2;16;16;16m");
    expect(none.panelEdge).toBe("\x1b[38;2;16;16;16m");
  });
});

describe("resolvePalette against a real pi 1.2.0 Theme", () => {
  it("paints no tint and no edge for the system-theme shape (panel tokens are \"\")", () => {
    const theme = realPiTheme(
      { userMessageBg: "", customMessageBg: "" },
      { appearance: "light" },
    );
    // The two facts the fix turns on, measured on the real object rather than
    // asserted from the plan's prose.
    expect(theme.getBgAnsi("userMessageBg")).toBe("\x1b[49m");
    expect(theme.appearance).toBe("light");

    const p = resolvePalette(theme);
    expect(p.panelBg).toBe("");
    expect(p.panelEdge).toBe("");
  });

  it("edges the slab with the panel's OWN colour asked as a foreground, not with the border", () => {
    // The regression: the slab rows sit directly against the panel body, so a
    // cushion painted in the panel's own tint is invisible by construction, and
    // one painted in `borderMuted` is a visible grey rule hugging the text area.
    // Asking the theme for the panel token *as a foreground* is the way to get
    // the tint without decoding anything: pi documents it ("Use
    // `theme.colors[token]` to use a token's color in the other slot", and a
    // token is *only* accepted in its own slot — `theme.fg("userMessageBg", …)`
    // throws). Emitting that color through pi's own foreground emitter is
    // asking the theme for a value, never parsing an escape string.
    const theme = realPiTheme({}, { appearance: "dark" });
    expect(theme.getBgAnsi("userMessageBg")).toBe("\x1b[48;2;33;59;73m");
    expect(theme.getFgAnsi("borderMuted")).toBe("\x1b[38;2;118;129;134m");
    // Measured, so the premise of the rule above cannot rot silently.
    expect(() => theme.fg("userMessageBg" as never, "x")).toThrow();

    const p = resolvePalette(theme);
    expect(p.panelBg).toBe("\x1b[48;2;33;59;73m");
    // Identity, asserted as measured bytes: the panel's own tint in the
    // foreground slot …
    expect(p.panelEdge).toBe("\x1b[38;2;33;59;73m");
    // … which is what the theme itself would paint that color as a foreground …
    expect(p.panelEdge).toBe(
      foregroundAnsi(theme.colors.userMessageBg, theme.getColorMode()),
    );
    // … and NOT the border token, which is what the palette answers today.
    expect(p.panelEdge).not.toBe("\x1b[38;2;118;129;134m");
    expect(p.panelEdge).not.toBe(theme.getFgAnsi("borderMuted"));
  });

  it("still draws the `┌──┐` frame in the border token", () => {
    // Only the slab changed hands. The frame is a real border and stays a border.
    const theme = realPiTheme({}, { appearance: "dark" });
    expect(resolvePalette(theme).frame("┌")).toContain("\x1b[38;2;118;129;134m");
  });

  it("follows the palette on a non-truecolour terminal instead of hardcoding anything", () => {
    const theme = realPiTheme(
      { userMessageBg: 236, borderMuted: 240 },
      { appearance: "dark", mode: "256color" },
    );
    expect(theme.getBgAnsi("userMessageBg")).toBe("\x1b[48;5;236m");
    const p = resolvePalette(theme);
    expect(p.panelBg).toBe("\x1b[48;5;236m");
    // The slab keeps the panel's own index, in the foreground form — 236, not
    // the border's 240.
    expect(p.panelEdge).toBe("\x1b[38;5;236m");
    expect(p.panelEdge).not.toBe("\x1b[38;5;240m");
  });

  it("asks the THEME which colour mode to emit in, not a hardcoded one", () => {
    // Both other palette tests use *indexed* tokens (236, 240), and the emitter
    // answers `38;5;n` for an indexed colour whatever mode it is handed — so
    // neither can see the mode argument at all. A real theme's tokens are rgb
    // (`okhsl(...)` resolves to rgb), and those DO depend on the mode:
    // `#213b49` is `38;2;33;59;73m` in truecolour and `38;5;23m` here. Handing
    // the emitter a fixed mode would paint a truecolour escape on a terminal
    // that said it cannot draw one, and the slab would fall back to the
    // terminal's own foreground — the bright bar this whole rule avoids.
    const theme = realPiTheme(
      { userMessageBg: "#213b49" },
      { appearance: "dark", mode: "256color" },
    );
    // Measured, so the premise (rgb + 256 colour ⇒ an indexed answer) is visible.
    expect(theme.getBgAnsi("userMessageBg")).toBe("\x1b[48;5;23m");

    const p = resolvePalette(theme);
    expect(p.panelBg).toBe("\x1b[48;5;23m");
    expect(p.panelEdge).toBe("\x1b[38;5;23m");
    // The same index as the body, in the other slot — and no truecolour escape
    // anywhere near a terminal that did not ask for one.
    expect(p.panelEdge.replace("38;", "48;")).toBe(p.panelBg);
    expect(p.panelEdge).not.toContain("38;2;");
  });

  it("edges with the token that WON the tint, not with a hardcoded one", () => {
    // `panelTint` tries `userMessageBg` then `customMessageBg`, and a theme JSON
    // that omits the first is legal: pi fills only tokens that declare a
    // fallback, and neither panel token declares one, so `getBgAnsi`
    // ("userMessageBg") throws and the second token wins. The edge has to follow
    // the winner — asking `colors` for a fixed token would find nothing for a
    // panel that IS tinted and blank the slab.
    const theme = realPiTheme(
      { customMessageBg: "#3a3055" },
      { appearance: "dark", omit: ["userMessageBg"] },
    );
    expect(() => theme.getBgAnsi("userMessageBg")).toThrow();

    const p = resolvePalette(theme);
    expect(p.panelBg).toBe("\x1b[48;2;58;48;85m");
    expect(p.panelEdge).toBe("\x1b[38;2;58;48;85m");
  });
});

// ── Discipline: colour comes from the theme, never from an escape string ───

const CHROME_SOURCE = readFileSync(fileURLToPath(new URL("./chrome.ts", import.meta.url)), "utf8");

describe("chrome.ts discipline", () => {
  it("has no setThemeBg, and no write to a theme's internal bgColors map", () => {
    // 1.2.0 renamed the private maps to fgAnsi/bgAnsi, so the write was a
    // silent no-op with no callers. Deleting it is the decision, not repairing it.
    expect(CHROME_SOURCE).not.toMatch(/setThemeBg/);
    expect(CHROME_SOURCE).not.toMatch(/bgColors/);
  });

  it("infers no colour by parsing an escape sequence", () => {
    // Emitting `38;2;…`/`48;2;…` constants is fine; cracking open an incoming
    // `getBgAnsi()` string to decide what to paint is not — that was
    // `bgToFgAnsi()`, which matched `48;2;`/`48;5;` and fell through to #101010.
    const offenders = CHROME_SOURCE.split("\n").filter((line) => {
      const inspects = /\.(startsWith|endsWith|replace|replaceAll|match|matchAll|search|split|test)\(/.test(line);
      return inspects && /\\x1b|\\u001b|\[3?8;/.test(line);
    });
    expect(offenders.map((l) => l.trim())).toEqual([]);
    expect(CHROME_SOURCE).not.toMatch(/bgToFgAnsi/);
    // The only escape-string logic allowed is the set membership test.
    expect(CHROME_SOURCE).toMatch(/isTerminalDefault/);
  });

  it("still exports the palette and the predicate it grew", () => {
    expect(typeof resolvePalette).toBe("function");
    expect(typeof isTerminalDefault).toBe("function");
  });
});
