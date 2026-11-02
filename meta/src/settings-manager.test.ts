/**
 * Behavioural contract for the `/archimedes` (and `/plugins`) settings overlay.
 *
 * Every expectation here is taken from how the component behaves on `main`
 * (b9ef26e) — the keys, the writes, the prompt semantics, the search and the
 * titles — so a green run after the `SettingsList` rebuild proves the behaviour
 * survived rather than that the assertions moved. Two blocks are labelled as the
 * exceptions: the activation keys and the chrome/theme fingerprint, which are
 * what the rebuild deliberately changes (both were RED against b9ef26e).
 *
 * Expectations are derived from the item set at run time rather than hard-coded,
 * because the config the panel is seeded from is the caller's; the contract is
 * the transition, not the seed.
 *
 * The overlay is driven through its public surface only — `handleInput(data)`
 * with raw terminal bytes and `render(width)` — because that is the whole
 * contract `ctx.ui.custom` gives it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { stripTerminalSequences, CURSOR_MARKER, renderFakeCursor } from "@earendil-works/pi-tui";
import type { SettingItem } from "@earendil-works/pi-tui";
import { createSettingsManager, type PromptDescriptor } from "./settings-manager.js";
import { buildSettingsItems, openSettings, PROMPTS } from "./settings.js";
import { loadAllConfig } from "./config.js";

// Never let a settings test touch the real ~/.pi: settings-io is an in-memory store.
vi.mock("@pi-archimedes/core/settings-io", () => {
  const store: Record<string, unknown> = {};
  return {
    loadConfig: vi.fn((ns: string, defaults: object) => ({ ...defaults, ...((store[ns] as object) ?? {}) })),
    saveConfig: vi.fn((ns: string, config: object) => {
      store[ns] = config;
    }),
    removeConfig: vi.fn((ns: string) => {
      delete store[ns];
    }),
    isConfigEnabled: vi.fn(() => true),
    setConfigEnabled: vi.fn(),
    __store: store,
  };
});

const store = (vi.mocked(await import("@pi-archimedes/core/settings-io")) as any).__store;

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

const KEY = {
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  enter: "\r",
  esc: "\x1b",
  backspace: "\x7f",
};

// ── Theme fixtures ──────────────────────────────────────────────────────────

/** Recording theme: one distinct SGR per token, so token use is readable in the frame. */
const TOKEN_SGR: Record<string, string> = {
  accent: "\x1b[38;2;1;1;1m",
  muted: "\x1b[38;2;2;2;2m",
  dim: "\x1b[38;2;3;3;3m",
  error: "\x1b[38;2;4;4;4m",
};
const RESET = "\x1b[0m";

interface Recorder {
  theme: never;
  /** (token, text) pairs the component asked the theme to colourise. */
  calls: Array<[string, string]>;
  /** The escape sequences this theme has actually emitted. */
  escapes(): Set<string>;
}

function recordingTheme(map: Record<string, string> = TOKEN_SGR): Recorder {
  const calls: Array<[string, string]> = [];
  const theme = {
    fg: (token: string, text: string) => {
      calls.push([token, text]);
      return `${map[token] ?? `\x1b[38;2;9;9;9;${token.length}m`}${text}${RESET}`;
    },
    bold: (t: string) => `\x1b[1m${t}\x1b[0m`,
  };
  return {
    theme: theme as never,
    calls,
    // Only what `fg` actually emitted, so a hand-composed escape — even one as
    // ordinary as bold — is not on the allow-list.
    escapes: () =>
      new Set([
        ...new Set(calls.map(([token]) => map[token] ?? `\x1b[38;2;9;9;9;${token.length}m`)),
        RESET,
      ]),
  };
}

/** pi-tui's own fake-cursor wrapping, derived rather than hard-coded. */
const [FAKE_CURSOR_START = "", FAKE_CURSOR_END = ""] = renderFakeCursor("\u0000").split("\u0000");

// ── Harness ─────────────────────────────────────────────────────────────────

interface Harness {
  changes: Array<[string, string]>;
  saves: number;
  closes: number;
  render(width?: number): string[];
  drawn(width?: number): string;
  /** Drawn text of the first row containing `needle`, borders stripped. */
  row(needle: string, width?: number): string | undefined;
  type(s: string): void;
  press(...keys: string[]): void;
}

function createHarness(
  items: SettingItem[],
  prompts: Record<string, PromptDescriptor> = PROMPTS,
  rec: Recorder = recordingTheme(),
): Harness {
  const changes: Array<[string, string]> = [];
  let saves = 0;
  let closes = 0;
  const m = createSettingsManager({
    items,
    prompts,
    theme: rec.theme,
    onChange: (id, v) => changes.push([id, v]),
    onSave: () => {
      saves += 1;
    },
    onClose: () => {
      closes += 1;
    },
  });
  return {
    changes,
    get saves() {
      return saves;
    },
    get closes() {
      return closes;
    },
    render: (width = 84) => m.render(width),
    drawn: (width = 84) => m.render(width).map((l) => stripTerminalSequences(l)).join("\n"),
    row: (needle, width = 84) =>
      m
        .render(width)
        .map((l) => stripTerminalSequences(l).replace(/[│┌└┐┘─]/g, "").trim())
        .find((l) => l.includes(needle)),
    type: (s) => {
      for (const ch of s) m.handleInput(ch);
    },
    press: (...keys) => {
      for (const k of keys) m.handleInput(k);
    },
  };
}

// ── Item-set helpers ────────────────────────────────────────────────────────

/** The real `/archimedes` item set, as the overlay receives it. Fresh each call. */
async function realItems(): Promise<SettingItem[]> {
  const items = await buildSettingsItems(loadAllConfig());
  const model = items.find((i) => i.id === "sessionNameModel");
  if (model && model.currentValue === "(current model)") model.currentValue = "";
  return items.map((i) => ({ ...i }));
}

function idxOf(items: SettingItem[], id: string): number {
  const i = items.findIndex((item) => item.id === id);
  if (i === -1) throw new Error(`no such item: ${id}`);
  return i;
}

/** The next value a cyclic stepper produces, in the given direction. */
function step(values: string[], from: string, direction: 1 | -1): string {
  const at = Math.max(0, values.indexOf(from));
  return values[(at + direction + values.length) % values.length] as string;
}

function to(h: Harness, index: number): void {
  for (let n = 0; n < index; n++) h.press(KEY.down);
}

function toId(h: Harness, items: SettingItem[], id: string): void {
  to(h, idxOf(items, id));
}

/** Empty the prompt field whatever it was seeded with. `send` is handleInput. */
function clearField(send: (data: string) => void, seed: string): void {
  for (let n = 0; n < seed.length; n++) send(KEY.backspace);
}

// ── The item set ────────────────────────────────────────────────────────────

describe("item set", () => {
  // One harness + render per item, so this scales with the number of settings:
  // 1139 ms idle, but 3.2–7.1 s once the machine is loaded (the repo's type-check
  // looped over it), and it timed out at the 5 s default in 2 of 5 pre-fix loaded
  // runs (5151 ms, 5275 ms). The shield matches the other loaded-run offenders in
  // #131; the assertions themselves are unchanged.
  it("shows every archimedes item and its current value", { timeout: 30_000 }, async () => {
    const items = await realItems();
    expect(items.length).toBeGreaterThan(20);
    const unseen: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const h = createHarness(items.map((x) => ({ ...x })));
      to(h, i);
      const drawn = h.drawn();
      const item = items[i]!;
      if (!drawn.includes(item.label)) unseen.push(`${item.id} (label)`);
      if (item.currentValue && !drawn.includes(item.currentValue)) unseen.push(`${item.id} (value)`);
    }
    expect(unseen).toEqual([]);
  });

  it("keeps the archimedes item ids and their editable form", async () => {
    const items = await realItems();
    // A row is reachable iff it has values (stepped with the arrows) or a prompt
    // descriptor (Enter opens a field) — the guard in settings.test.ts, asserted
    // here against what the panel itself is handed.
    const inert = items.filter((i) => i.values === undefined && !(i.id in PROMPTS)).map((i) => i.id);
    expect(inert).toEqual([]);
    expect(items.map((i) => i.id)).toEqual([
      "bashToolStyling",
      "codemodeToolStyling",
      "mutedTheme",
      "autoCollapseThinking",
      "thinkingStyle",
      "toolStyle",
      "codeUnindent",
      "labelText",
      "labelColor",
      "startupSplash",
      "animationStyle",
      "colorfulLogo",
      "editorSpinBorder",
      "editorSpinSpeed",
      "editorSpinStyle",
      "editorSpinLabel",
      "splitThreshold",
      "branchMaxLength",
      "diffTheme",
      "diffSplitMinWidth",
      "diffSplitMinCodeWidth",
      "diffSplitWrapCheck",
      "notifyOnAgentEnd",
      "notifyOnQuestion",
      "delayMs",
      "sessionNameModel",
      "imagePastePreview",
    ]);
  });
});

// ── Value stepping (← / →) ──────────────────────────────────────────────────

describe("value stepping", () => {
  it("steps a values row right and left, writing the new value", async () => {
    const items = await realItems();
    const item = items[idxOf(items, "thinkingStyle")]!;
    const seed = item.currentValue;
    expect(item.values?.length).toBeGreaterThan(1);
    const h = createHarness(items);
    toId(h, items, "thinkingStyle");
    h.press(KEY.right);
    expect(h.changes).toEqual([["thinkingStyle", step(item.values!, seed, 1)]]);
    expect(h.row("Thinking Style")).toContain(step(item.values!, seed, 1));
    h.press(KEY.left);
    expect(h.changes.at(-1)).toEqual(["thinkingStyle", seed]);
    expect(h.row("Thinking Style")).toContain(seed);
  });

  it("wraps in both directions", async () => {
    const items = await realItems();
    const item = items[idxOf(items, "editorSpinSpeed")]!;
    const values = item.values!;
    expect(values.length).toBeGreaterThan(2);
    const seed = item.currentValue;
    const h = createHarness(items);
    toId(h, items, "editorSpinSpeed");
    // All the way round forward, then one step back.
    for (let n = 0; n < values.length; n++) h.press(KEY.right);
    expect(h.changes.at(-1)).toEqual(["editorSpinSpeed", seed]);
    h.press(KEY.left);
    expect(h.changes.at(-1)).toEqual(["editorSpinSpeed", step(values, seed, -1)]);
  });

  it("does nothing on a free-input row", async () => {
    const items = await realItems();
    const h = createHarness(items);
    toId(h, items, "labelText");
    h.press(KEY.right, KEY.left);
    expect(h.changes).toEqual([]);
  });

  it("does not step on ctrl+b / ctrl+f, which are editor bindings, not the arrows", async () => {
    // `tui.editor.cursorLeft` / `cursorRight` also carry ctrl+b and ctrl+f.
    // Honouring the action here meant a keystroke typed out of editor habit
    // changed a setting — and in `/plugins` that write is persisted on the spot.
    // The footer advertises `[←→] value`, so the arrows are the whole contract.
    const items = await realItems();
    const h = createHarness(items);
    h.press("\x02"); // ctrl+b
    h.press("\x06"); // ctrl+f
    expect(h.changes).toEqual([]);
    expect(h.saves).toBe(0);
    expect(h.closes).toBe(0);
    // …while the arrows still step, in both directions.
    h.press(KEY.right);
    h.press(KEY.left);
    expect(h.changes.length).toBe(2);
  });

  it("still steps on a Kitty CSI-u arrow", async () => {
    // The arrows are matched by name, so a CSI-u terminal keeps them.
    const items = await realItems();
    const h = createHarness(items);
    h.press("\x1b[1;1C"); // right, CSI-u encoded
    expect(h.changes.length).toBe(1);
  });

  it("steps the row the cursor is on, not some other row", async () => {
    const items = await realItems();
    const item = items[idxOf(items, "toolStyle")]!;
    const seed = item.currentValue;
    const next = step(item.values!, seed, 1);
    const h = createHarness(items);
    toId(h, items, "toolStyle");
    h.press(KEY.right);
    expect(h.changes).toEqual([["toolStyle", next]]);
    // The cursor sits on the row whose value just changed.
    const cursorRow = h.render().map((l) => stripTerminalSequences(l)).find((l) => /[>→]/.test(l));
    expect(cursorRow ?? "").toContain(item.label);
    // And the untouched neighbour still shows its seed.
    expect(h.row("Code Unindent")).toContain(items[idxOf(items, "codeUnindent")]!.currentValue);
  });

  it("writes nothing when the cursor wraps off the end of an empty filter", async () => {
    const items = await realItems();
    const h = createHarness(items);
    h.press("/");
    h.type("zzzz");
    h.press(KEY.right, KEY.left, KEY.enter, " ");
    expect(h.changes).toEqual([]);
  });
});

// ── Cursor movement ─────────────────────────────────────────────────────────

describe("cursor movement", () => {
  it("puts the cursor on the first match when a filter narrows past its end, and steps that row", async () => {
    // The wrapper mirrors the list's cursor index, so the mirror and the drawn
    // cursor must agree after every path that changes the row set. Park the
    // cursor past the end of what the query will keep, narrow the list out from
    // under it, then walk it: every step has to write the row drawn under the
    // cursor. A mirror left pointing at the old index addresses a row that is no
    // longer there, and the write silently vanishes.
    const items = await realItems();
    const query = "style";
    const kept = items.filter((i) => i.label.toLowerCase().includes(query));
    expect(kept.length).toBeGreaterThan(1);
    const h = createHarness(items);
    to(h, kept.length + 1); // deep in the full list, past the end of `kept`
    h.press("/");
    h.type(query);
    const cursorRow = (): string =>
      (h
        .render()
        .map((l) => stripTerminalSequences(l))
        .find((l) => /[>→]/.test(l)) ?? "").replace(/.*[>→]\s*/, "");
    // The cursor reset to the top of the narrowed set.
    expect(cursorRow()).toContain(kept[0]!.label);
    const writes: Array<[string, string]> = [];
    for (let n = 0; n < kept.length; n++) {
      const onCursor = kept.find((i) => cursorRow().includes(i.label));
      expect(onCursor, `no kept row under the cursor at ${n}`).toBeDefined();
      if (onCursor?.values && onCursor.values.length > 1) {
        h.press(KEY.right);
        writes.push([onCursor.id, step(onCursor.values, onCursor.currentValue, 1)]);
        expect(h.changes).toEqual(writes);
      }
      h.press(KEY.down);
    }
    expect(writes.length, "the narrowed set has nothing to step").toBeGreaterThan(0);
  });
  it("wraps up from the first row to the last and down from the last to the first", async () => {
    const items = await realItems();
    const h = createHarness(items);
    h.press(KEY.up);
    expect(h.drawn()).toContain(items[items.length - 1]!.label);
    h.press(KEY.down);
    expect(h.drawn()).toContain(items[0]!.label);
  });

  it("keeps the arrows moving the cursor while the search is armed", async () => {
    const items = await realItems();
    const h = createHarness(items);
    h.press("/");
    h.type("spin");
    h.press(KEY.down);
    const cursorRow = h.render().map((l) => stripTerminalSequences(l)).find((l) => /[>→]/.test(l));
    expect(cursorRow ?? "").toContain("Spin Speed");
  });
});

// ── Search ──────────────────────────────────────────────────────────────────

describe("search", () => {
  it("arms on / and shows an empty Search: row", async () => {
    const items = await realItems();
    const h = createHarness(items);
    expect(h.drawn()).not.toContain("Search:");
    h.press("/");
    expect(h.row("Search:")).toBe("Search:");
  });

  it("narrows the list by label, case-insensitively", async () => {
    const items = await realItems();
    const h = createHarness(items);
    h.press("/");
    h.type("SPIN");
    const drawn = h.drawn();
    expect(drawn).toContain("Spin Speed");
    expect(drawn).toContain("Spinner Label");
    expect(drawn).not.toContain("Bash Tool Styling");
    expect(h.row("Search:")).toBe("Search: SPIN");
  });

  it("keeps the value column put when the search narrows the list", async () => {
    // `SettingsList` aligns values to the widest row it is shown, and the panel
    // shows it a filtered subset — so the column must be fixed by the whole set,
    // not by whatever survived the filter.
    const items = await realItems();
    const h = createHarness(items);
    // Cursor-prefixed rows would otherwise measure two columns further right.
    const column = (row: string): number => row.replace(/^[→>]\s+/, "").indexOf("On");
    const wide = h.row("Code Unindent")!;
    expect(wide).toBeDefined();
    h.press("/");
    h.type("unindent");
    const narrow = h.row("Code Unindent")!;
    expect(narrow).toBeDefined();
    expect(column(narrow)).toBe(column(wide));
  });

  it("reports an empty result", async () => {
    const items = await realItems();
    const h = createHarness(items);
    h.press("/");
    h.type("zzzz");
    expect(h.drawn()).toContain("No matching settings");
  });

  it("arms on a Kitty CSI-u / as well as a bare one", async () => {
    // A terminal with the Kitty keyboard protocol enabled sends printable keys as
    // CSI-u (`/` arrives as `\x1b[47u`), which main matched through `matchesKey`.
    const items = await realItems();
    const h = createHarness(items);
    h.press("\x1b[47u");
    expect(h.row("Search:")).toBe("Search:");
  });

  it("types a CSI-u encoded query", async () => {
    const items = await realItems();
    const h = createHarness(items);
    h.press("/");
    h.press("\x1b[115u"); // s
    h.press("\x1b[112u"); // p
    h.press("\x1b[105u"); // i
    h.press("\x1b[110u"); // n
    expect(h.row("Search:")).toBe("Search: spin");
    expect(h.drawn()).toContain("Spin Speed");
    // And it did not save on the way (\x1b[115u is `s`).
    expect(h.saves).toBe(0);
  });

  it("leaves the cursor where it was when backspace has nothing to delete", async () => {
    // An armed-but-empty query: main did nothing at all here. Rebuilding the
    // list for a query that did not change reset the cursor to the first row,
    // so a stray backspace jumped the user back to the top of the panel.
    const items = await realItems();
    const h = createHarness(items);
    to(h, 3);
    h.press("/");
    const cursorRow = (): string =>
      (h
        .render()
        .map((l) => stripTerminalSequences(l))
        .find((l) => /[>→]/.test(l)) ?? "").replace(/.*[>→]\s*/, "");
    expect(cursorRow()).toContain(items[3]!.label);
    h.press(KEY.backspace);
    expect(cursorRow()).toContain(items[3]!.label);
    expect(h.drawn()).toContain("Search:"); // still armed
    // A backspace that does delete still re-filters, from the top.
    h.type("spin");
    h.press(KEY.backspace);
    expect(h.row("Search:")).toBe("Search: spi");
  });

  it("edits the query with backspace", async () => {
    const items = await realItems();
    const h = createHarness(items);
    h.press("/");
    h.type("spin");
    h.press(KEY.backspace);
    expect(h.row("Search:")).toBe("Search: spi");
  });

  it("ignores non-ASCII keystrokes in the query", async () => {
    // The list filter takes ASCII only (a wide query is unreachable from the
    // keyboard today); the overlay-width audit depends on that staying true.
    const items = await realItems();
    const h = createHarness(items);
    h.press("/");
    h.type("界面");
    expect(h.row("Search:")).toBe("Search:");
  });

  it("marks the search row with the hardware cursor marker", async () => {
    const items = await realItems();
    const h = createHarness(items);
    h.press("/");
    expect(h.render().some((l) => l.includes(CURSOR_MARKER))).toBe(true);
  });

  it("clears the search on esc and stays open, forgetting the query", async () => {
    const items = await realItems();
    const h = createHarness(items);
    h.press("/");
    h.type("spin");
    h.press(KEY.esc);
    expect(h.closes).toBe(0);
    expect(h.drawn()).not.toContain("Search:");
    expect(h.drawn()).toContain("Bash Tool Styling");
    // The query is gone, not merely hidden.
    h.press("/");
    expect(h.row("Search:")).toBe("Search:");
  });

  it("closes on esc from the list, and on a second esc from an armed search", async () => {
    const items = await realItems();
    const h = createHarness(items);
    h.press(KEY.esc);
    expect(h.closes).toBe(1);
    const h2 = createHarness(items.map((x) => ({ ...x })));
    h2.press("/", KEY.esc, KEY.esc);
    expect(h2.closes).toBe(1);
  });

  it("treats / while searching as a no-op rather than a character", async () => {
    const items = await realItems();
    const h = createHarness(items);
    h.press("/", "/");
    expect(h.row("Search:")).toBe("Search:");
  });

  it("types s into the query instead of saving", async () => {
    const items = await realItems();
    const h = createHarness(items);
    h.press("/");
    h.type("s");
    expect(h.saves).toBe(0);
    expect(h.row("Search:")).toBe("Search: s");
  });
});

// ── Save / close keys ───────────────────────────────────────────────────────

describe("save and close keys", () => {
  it("s saves from the list", async () => {
    const items = await realItems();
    const h = createHarness(items);
    h.press("s");
    expect(h.saves).toBe(1);
    expect(h.closes).toBe(0);
  });

  it("saves on a Kitty CSI-u s, and not on a capital S", async () => {
    const items = await realItems();
    const h = createHarness(items);
    h.press("\x1b[115u"); // s, CSI-u encoded
    expect(h.saves).toBe(1);
    h.press("S");
    expect(h.saves).toBe(1);
  });

  it("does nothing on other letters in the list", async () => {
    const items = await realItems();
    const h = createHarness(items);
    h.type("qzx");
    expect(h.saves).toBe(0);
    expect(h.changes).toEqual([]);
  });
});

// ── Titles and chrome ───────────────────────────────────────────────────────

describe("titles", () => {
  it("titles the list panel Settings and advertises its keys", async () => {
    const items = await realItems();
    const h = createHarness(items);
    const drawn = h.drawn();
    expect(drawn).toContain("Settings");
    expect(drawn).toContain("[s] save");
    expect(drawn).toContain("[/] search");
  });

  it("titles the prompt panel Settings and advertises confirm/cancel", async () => {
    const items = await realItems();
    const h = createHarness(items);
    toId(h, items, "labelText");
    h.press(KEY.enter);
    const drawn = h.drawn();
    expect(drawn).toContain("Settings");
    expect(drawn).toContain("[enter] confirm");
    expect(drawn).toContain("[esc] cancel");
  });
});

// ── Prompt mode: entry, commit, cancel, validation ──────────────────────────

describe("prompt mode", () => {
  it("opens on Enter over a free-input row, seeded from the current value", async () => {
    const items = await realItems();
    const seed = items[idxOf(items, "labelText")]!.currentValue;
    const h = createHarness(items);
    toId(h, items, "labelText");
    h.press(KEY.enter);
    const drawn = h.drawn();
    // The descriptor label, not the row label: "Label text" vs "Label Text".
    expect(drawn).toContain(PROMPTS.labelText!.label);
    expect(h.row(PROMPTS.labelText!.label)).toBe(PROMPTS.labelText!.label);
    expect(h.row(seed)).toBeDefined();
    expect(drawn).not.toContain("[s] save");
    expect(h.changes).toEqual([]);
  });

  it("commits on Enter: writes the value, leaves the prompt, keeps the cursor on the row", async () => {
    const items = await realItems();
    const seed = items[idxOf(items, "labelText")]!.currentValue;
    const h = createHarness(items);
    toId(h, items, "labelText");
    h.press(KEY.enter);
    clearField((d) => h.press(d), seed);
    h.type("Draft:");
    h.press(KEY.enter);
    expect(h.changes).toEqual([["labelText", "Draft:"]]);
    const drawn = h.drawn();
    expect(drawn).toContain("Draft:");
    expect(drawn).toContain("[s] save"); // back to the list
    // Back in the list, and the window contains the row's own neighbours.
    expect(drawn).toContain("Code Unindent");
    // The cursor never left the row.
    const cursorRow = h.render().map((l) => stripTerminalSequences(l)).find((l) => /[>→]/.test(l));
    expect(cursorRow ?? "").toContain("Label Text");
  });

  it("cancels on esc: nothing is written and the field is discarded", async () => {
    const items = await realItems();
    const seed = items[idxOf(items, "labelText")]!.currentValue;
    const h = createHarness(items);
    toId(h, items, "labelText");
    h.press(KEY.enter);
    h.type("garbage");
    h.press(KEY.esc);
    expect(h.changes).toEqual([]);
    expect(items[idxOf(items, "labelText")]!.currentValue).toBe(seed);
    expect(h.drawn()).toContain("[s] save"); // back to the list
    // A second esc closes the panel.
    h.press(KEY.esc);
    expect(h.closes).toBe(1);
  });

  it("esc inside the prompt cancels the prompt only, not the panel", async () => {
    const items = await realItems();
    const h = createHarness(items);
    toId(h, items, "diffTheme");
    h.press(KEY.enter);
    h.press(KEY.esc);
    expect(h.closes).toBe(0);
  });

  it("rejects a number below the minimum, stays in the prompt and writes nothing", async () => {
    const items = await realItems();
    const seed = items[idxOf(items, "splitThreshold")]!.currentValue;
    const h = createHarness(items);
    toId(h, items, "splitThreshold");
    h.press(KEY.enter);
    clearField((d) => h.press(d), seed);
    h.type("12");
    h.press(KEY.enter);
    expect(h.changes).toEqual([]);
    const drawn = h.drawn();
    expect(drawn).toContain(`must be >= ${PROMPTS.splitThreshold!.min}`);
    expect(drawn).toContain(PROMPTS.splitThreshold!.label);
    expect(drawn).toContain("[enter] confirm"); // still in the prompt
    // Fixing it commits.
    h.type("0");
    h.press(KEY.enter);
    expect(h.changes).toEqual([["splitThreshold", "120"]]);
  });

  it("takes digits only in a number field", async () => {
    const items = await realItems();
    const seed = items[idxOf(items, "branchMaxLength")]!.currentValue;
    const h = createHarness(items);
    toId(h, items, "branchMaxLength");
    h.press(KEY.enter);
    clearField((d) => h.press(d), seed);
    h.type("12ab34");
    h.press(KEY.enter);
    expect(h.changes).toEqual([["branchMaxLength", "1234"]]);
  });

  it("accepts wide characters in a text field", async () => {
    const items = await realItems();
    const seed = items[idxOf(items, "labelText")]!.currentValue;
    const h = createHarness(items);
    toId(h, items, "labelText");
    h.press(KEY.enter);
    h.type("検証");
    h.press(KEY.enter);
    expect(h.changes).toEqual([["labelText", `${seed}検証`]]);
  });

  it("commits an empty text field verbatim", async () => {
    const items = await realItems();
    const h = createHarness(items);
    toId(h, items, "sessionNameModel"); // seeded empty
    h.press(KEY.enter, KEY.enter);
    expect(h.changes).toEqual([["sessionNameModel", ""]]);
  });

  it("marks the field with the hardware cursor marker", async () => {
    const items = await realItems();
    const h = createHarness(items);
    toId(h, items, "labelText");
    h.press(KEY.enter);
    expect(h.render().some((l) => l.includes(CURSOR_MARKER))).toBe(true);
  });

  it("shows the error line only while there is one", async () => {
    const items = await realItems();
    const seed = items[idxOf(items, "splitThreshold")]!.currentValue;
    const h = createHarness(items);
    toId(h, items, "splitThreshold");
    h.press(KEY.enter);
    expect(h.drawn()).not.toContain("must be >=");
    clearField((d) => h.press(d), seed);
    h.type("1");
    h.press(KEY.enter);
    expect(h.drawn()).toContain("must be >=");
    // The error clears as the field is edited again.
    h.press(KEY.backspace);
    expect(h.drawn()).not.toContain("must be >=");
  });

  it("re-opens on the same row with the committed value", async () => {
    const items = await realItems();
    const seed = items[idxOf(items, "labelText")]!.currentValue;
    const h = createHarness(items);
    toId(h, items, "labelText");
    h.press(KEY.enter);
    h.type("X");
    h.press(KEY.enter);
    h.press(KEY.enter); // same row, still selected
    expect(h.row(`${seed}X`)).toBeDefined();
    expect(h.changes.length).toBe(1);
  });

  it("does not write through a field whose item left the set", async () => {
    // The panel must not write for a stale item id.
    const items = await realItems();
    const h = createHarness(items);
    toId(h, items, "labelText");
    h.press(KEY.enter);
    items.splice(idxOf(items, "labelText"), 1);
    h.type("Z");
    h.press(KEY.enter);
    expect(h.changes).toEqual([]);
  });
});

// ── Namespace writes, end to end ────────────────────────────────────────────
//
// The real `openSettings` wiring, the real component, keystrokes only: the value
// shown on screen must land in the namespace `saveConfig` is called with, on `s`.

describe("namespace writes", () => {
  interface Panel {
    handleInput(data: string): void;
    render(width: number): string[];
  }

  async function openPanel(): Promise<Panel> {
    let panel: Panel | undefined;
    const custom = vi.fn((factory: any) => {
      panel = factory({}, recordingTheme().theme, {}, () => {}) as Panel;
    });
    await openSettings({} as any, { ui: { custom } } as any);
    if (!panel) throw new Error("openSettings never built the settings manager");
    return panel;
  }

  const typeInto = (p: Panel, s: string) => {
    for (const ch of s) p.handleInput(ch);
  };
  const toIndex = (p: Panel, index: number) => {
    for (let n = 0; n < index; n++) p.handleInput(KEY.down);
  };
  const draw = (p: Panel) => p.render(84).map((l) => stripTerminalSequences(l)).join("\n");

  it("writes archimedes.ui on a toggle", async () => {
    const items = await realItems();
    const p = await openPanel();
    toIndex(p, idxOf(items, "bashToolStyling"));
    p.handleInput(KEY.right);
    p.handleInput("s");
    expect((store["archimedes.ui"] as any).bashToolStyling).toBe(false);
  });

  it("writes archimedes.footer through the number prompt", async () => {
    const items = await realItems();
    const seed = items[idxOf(items, "splitThreshold")]!.currentValue;
    const p = await openPanel();
    toIndex(p, idxOf(items, "splitThreshold"));
    p.handleInput(KEY.enter);
    clearField((d) => p.handleInput(d), seed);
    typeInto(p, "120");
    p.handleInput(KEY.enter);
    p.handleInput("s");
    expect((store["archimedes.footer"] as any).splitThreshold).toBe(120);
  });

  it("writes archimedes.diff through the text prompt", async () => {
    const items = await realItems();
    const seed = items[idxOf(items, "diffTheme")]!.currentValue;
    const p = await openPanel();
    toIndex(p, idxOf(items, "diffTheme"));
    p.handleInput(KEY.enter);
    clearField((d) => p.handleInput(d), seed);
    typeInto(p, "monokai");
    p.handleInput(KEY.enter);
    p.handleInput("s");
    expect((store["archimedes.diff"] as any).diffTheme).toBe("monokai");
    expect(draw(p)).toContain("monokai");
  });

  it("writes archimedes.notify as milliseconds from the seconds field", async () => {
    const items = await realItems();
    const seed = items[idxOf(items, "delayMs")]!.currentValue;
    const p = await openPanel();
    toIndex(p, idxOf(items, "delayMs"));
    p.handleInput(KEY.enter);
    clearField((d) => p.handleInput(d), seed);
    typeInto(p, "5");
    p.handleInput(KEY.enter);
    p.handleInput("s");
    expect((store["archimedes.notify"] as any).delayMs).toBe(5000);
  });

  it("writes archimedes.sessionName, and unsets the key when blanked", async () => {
    const items = await realItems();
    const p = await openPanel();
    toIndex(p, idxOf(items, "sessionNameModel"));
    p.handleInput(KEY.enter);
    typeInto(p, "openai/gpt-4o-mini");
    p.handleInput(KEY.enter);
    p.handleInput("s");
    expect((store["archimedes.sessionName"] as any).model).toBe("openai/gpt-4o-mini");

    // The next panel is seeded with what was saved, and blanking it unsets it.
    const reloaded = await realItems();
    const p2 = await openPanel();
    toIndex(p2, idxOf(reloaded, "sessionNameModel"));
    p2.handleInput(KEY.enter);
    for (let n = 0; n < "openai/gpt-4o-mini".length; n++) p2.handleInput(KEY.backspace);
    p2.handleInput(KEY.enter);
    p2.handleInput("s");
    expect(JSON.stringify(store["archimedes.sessionName"])).not.toContain('"model"');
  });
});

// ── /plugins reuses the same manager ────────────────────────────────────────

describe("promptless list (/plugins shape)", () => {
  const pluginItems = (): SettingItem[] => [
    { id: "plugin:ui", label: "UI enhancements", description: "TUI enhancements", currentValue: "On", values: ["On", "Off"] },
    { id: "plugin:diff", label: "Diff rendering", description: "Shiki diff", currentValue: "Off", values: ["On", "Off"] },
  ];

  it("steps values and never opens a prompt", () => {
    const h = createHarness(pluginItems(), {});
    h.press(KEY.right);
    expect(h.changes).toEqual([["plugin:ui", "Off"]]);
    h.press(KEY.enter);
    expect(h.drawn()).toContain("[s] save"); // still the list
    h.press(KEY.down, KEY.right);
    expect(h.changes.at(-1)).toEqual(["plugin:diff", "On"]);
  });

  it("closes on esc", () => {
    const h = createHarness(pluginItems(), {});
    h.press(KEY.esc);
    expect(h.closes).toBe(1);
  });

  it("shows the plugin rows it was handed, with the selected row's description", () => {
    const h = createHarness(pluginItems(), {});
    expect(h.drawn()).toContain("UI enhancements");
    expect(h.drawn()).toContain("TUI enhancements"); // description of the selected row
    h.press(KEY.down);
    expect(h.drawn()).toContain("Shiki diff");
  });
});

// ── What the rebuild changes (RED against b9ef26e on purpose) ───────────────
//
// These blocks are the behaviour the rebuild buys rather than preserves: pi's
// activation keys, and pi's own component drawing the list.

describe("activation (pi's Enter/Space model)", () => {
  it("cycles a values row on Enter", async () => {
    const items = await realItems();
    const item = items[idxOf(items, "bashToolStyling")]!;
    const h = createHarness(items);
    toId(h, items, "bashToolStyling");
    h.press(KEY.enter);
    expect(h.changes).toEqual([["bashToolStyling", step(item.values!, item.currentValue, 1)]]);
  });

  it("cycles a values row on Space", async () => {
    const items = await realItems();
    const item = items[idxOf(items, "bashToolStyling")]!;
    const h = createHarness(items);
    toId(h, items, "bashToolStyling");
    h.press(" ");
    expect(h.changes).toEqual([["bashToolStyling", step(item.values!, item.currentValue, 1)]]);
  });

  it("opens the free-input prompt on Space as well as Enter", async () => {
    const items = await realItems();
    const h = createHarness(items);
    toId(h, items, "labelText");
    h.press(" ");
    expect(h.drawn()).toContain(PROMPTS.labelText!.label);
    expect(h.drawn()).not.toContain("[s] save");
  });

  it("leaves a row with neither values nor a prompt inert", async () => {
    const h = createHarness([{ id: "x", label: "Read only", currentValue: "fixed" }], {});
    h.press(KEY.enter, " ");
    expect(h.changes).toEqual([]);
  });
});

describe("the list is drawn by pi-tui's SettingsList", () => {
  it("shows pi's own hint line in the list panel", async () => {
    const items = await realItems();
    const h = createHarness(items);
    expect(h.drawn()).toContain("Enter/Space to change · Esc to cancel");
  });

  it("uses pi's theme tokens: accent label and cursor, muted value, dim description", async () => {
    const rec = recordingTheme();
    const items = await realItems();
    const h = createHarness(items, PROMPTS, rec);
    h.render();
    const first = items[0]!;
    // Selected label and the cursor glyph are accent. (The label arrives padded
    // to the column width — `SettingsList` aligns values before theming.)
    expect(rec.calls.some(([t, s]) => t === "accent" && s.startsWith(first.label))).toBe(true);
    expect(rec.calls.some(([t, s]) => t === "accent" && s.includes("→"))).toBe(true);
    // An unselected value is muted; the description of the selected row is dim.
    expect(rec.calls.some(([t, s]) => t === "muted" && s === items[1]!.currentValue)).toBe(true);
    expect(rec.calls.some(([t, s]) => t === "dim" && s.includes("bash tool execution"))).toBe(true);
    // Nothing else.
    expect(new Set(rec.calls.map(([t]) => t))).toEqual(new Set(["accent", "muted", "dim"]));
  });

  it("renders the same frame with different escapes under a different theme, and composes none of its own", async () => {
    const items = await realItems();
    const one = recordingTheme({ accent: "\x1b[38;2;11;11;11m", muted: "\x1b[38;2;22;22;22m", dim: "\x1b[38;2;33;33;33m", error: "\x1b[38;2;44;44;44m" });
    const two = recordingTheme({ accent: "\x1b[38;2;99;99;99m", muted: "\x1b[38;2;88;88;88m", dim: "\x1b[38;2;77;77;77m", error: "\x1b[38;2;66;66;66m" });
    const a = createHarness(items.map((x) => ({ ...x })), PROMPTS, one).render();
    const b = createHarness(items.map((x) => ({ ...x })), PROMPTS, two).render();
    expect(a.join("\n")).not.toBe(b.join("\n"));
    // Strip the theme's escapes and both frames are the same drawn text.
    const strip = (lines: string[]) => lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "")).join("\n");
    expect(strip(a)).toBe(strip(b));

    // Every escape in the frame is one this theme emitted — none composed by hand.
    for (const [lines, rec] of [
      [a, one],
      [b, two],
    ] as Array<[string[], Recorder]>) {
      const allowed = rec.escapes();
      const found = lines.join("\n").match(/\x1b\[[0-9;]*m/g) ?? [];
      expect([...new Set(found.filter((e) => !allowed.has(e)))].length).toBe(0);
      // And the theme really was used — an all-plain frame would prove nothing.
      expect(found.length).toBeGreaterThan(20);
    }
  });

  it("emits only pi-tui's cursor sequences beyond the theme in the search and prompt rows", async () => {
    const items = await realItems();
    const rec = recordingTheme();
    const h = createHarness(items, PROMPTS, rec);
    const sequences = (lines: string[]): string[] =>
      lines.join("\n").match(/\x1b\[[0-9;]*m|\x1b_[^\x07]*\x07/g) ?? [];
    // pi-tui's Input draws the caret, so its wrapping sequences are allowed;
    // anything else in the frame was composed by hand.
    const allowedApc = new Set([CURSOR_MARKER, FAKE_CURSOR_START, FAKE_CURSOR_END]);
    const foreign = (lines: string[]): string[] =>
      [...new Set(sequences(lines).filter((e) => !rec.escapes().has(e) && !allowedApc.has(e)))];

    // List frame: theme escapes only, not even pi-tui's cursor sequences. The
    // allow-list is whatever the theme had emitted, so it is read after the
    // frame it audits.
    const listFrame = h.render();
    expect([...new Set(sequences(listFrame).filter((e) => !rec.escapes().has(e)))]).toEqual([]);

    // Search row.
    h.press("/");
    const search = h.render();
    expect(foreign(search)).toEqual([]);
    expect(search.some((l) => l.includes(FAKE_CURSOR_START))).toBe(true);

    // Prompt frame — the field is drawn by pi-tui, so it is audited too.
    h.press(KEY.esc);
    toId(h, items, "splitThreshold");
    h.press(KEY.enter);
    const prompt = h.render();
    expect(foreign(prompt)).toEqual([]);
    expect(prompt.some((l) => l.includes(FAKE_CURSOR_START))).toBe(true);

    // …and with an error line in it, which is the other themed row of that panel.
    clearField((d) => h.press(d), items[idxOf(items, "splitThreshold")]!.currentValue);
    h.type("1");
    h.press(KEY.enter);
    expect(foreign(h.render())).toEqual([]);
    expect(h.drawn()).toContain("must be >=");
  });

  it("changes every coloured row when the theme changes, and only that", async () => {
    const items = await realItems();
    const one = recordingTheme({ accent: "\x1b[38;2;11;11;11m", muted: "\x1b[38;2;22;22;22m", dim: "\x1b[38;2;33;33;33m", error: "\x1b[38;2;44;44;44m" });
    const two = recordingTheme({ accent: "\x1b[38;2;99;99;99m", muted: "\x1b[38;2;88;88;88m", dim: "\x1b[38;2;77;77;77m", error: "\x1b[38;2;66;66;66m" });
    const seed = items[idxOf(items, "splitThreshold")]!.currentValue;
    const surfaces = (rec: Recorder): string[] => {
      const h = createHarness(items.map((x) => ({ ...x })), PROMPTS, rec);
      const frames = [h.render()];
      h.press("/");
      h.type("spin");
      frames.push(h.render());
      h.press(KEY.esc);
      toId(h, items, "splitThreshold");
      h.press(KEY.enter);
      frames.push(h.render());
      clearField((d) => h.press(d), seed);
      h.type("1");
      h.press(KEY.enter);
      frames.push(h.render()); // the error line
      return frames.flat();
    };
    const a = surfaces(one);
    const b = surfaces(two);
    const strip = (lines: string[]) => lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "")).join("\n");
    // Same drawn text, different escapes, on every surface.
    expect(strip(a)).toBe(strip(b));
    expect(a.join("\n")).not.toBe(b.join("\n"));
    // Every escape in every frame is one the theme emitted.
    for (const [lines, rec] of [
      [a, one],
      [b, two],
    ] as Array<[string[], Recorder]>) {
      const allowed = rec.escapes();
      const found = lines.join("\n").match(/\x1b\[[0-9;]*m/g) ?? [];
      expect([...new Set(found.filter((e) => !allowed.has(e)))]).toEqual([]);
      expect(found.length).toBeGreaterThan(20);
    }
  });
});
