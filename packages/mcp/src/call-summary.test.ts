import { describe, it, expect } from "vitest";
import {
  PREFERRED_ARG_KEYS,
  pickKeyArg,
  formatSummaryLine,
  truncLinePlain,
} from "./call-summary.js";

// Fake theme: wraps text in visible markers so assertions can verify which
// color token each fragment used.
const theme = {
  fg: (token: string, text?: string) =>
    text === undefined ? `[${token}]` : `[${token}:${text}]`,
};

// ── PREFERRED_ARG_KEYS ─────────────────────────────────────────────────────

describe("PREFERRED_ARG_KEYS", () => {
  it("matches the approved key order", () => {
    expect(PREFERRED_ARG_KEYS).toEqual([
      "sql",
      "query",
      "text",
      "prompt",
      "table",
      "column",
      "name",
      "path",
      "url",
      "server",
    ]);
  });
});

// ── pickKeyArg ─────────────────────────────────────────────────────────────

describe("pickKeyArg", () => {
  it("returns null for empty or missing args", () => {
    expect(pickKeyArg({})).toBeNull();
    expect(pickKeyArg(undefined)).toBeNull();
    expect(pickKeyArg(null)).toBeNull();
  });

  it("prefers preferred keys over insertion order (sql beats table)", () => {
    expect(
      pickKeyArg({ table: "model_files", sql: "SELECT 1" }),
    ).toEqual({ key: "sql", value: "SELECT 1" });
  });

  it("skips non-scalar values on preferred keys (array/object/null/undefined)", () => {
    expect(pickKeyArg({ sql: ["SELECT 1"], table: "t" })).toEqual({
      key: "table",
      value: "t",
    });
    expect(pickKeyArg({ sql: { a: 1 }, column: "c" })).toEqual({
      key: "column",
      value: "c",
    });
    expect(pickKeyArg({ sql: null, query: "q" })).toEqual({
      key: "query",
      value: "q",
    });
    expect(pickKeyArg({ sql: undefined, name: "n" })).toEqual({
      key: "name",
      value: "n",
    });
  });

  it("falls back to the first scalar arg in insertion order", () => {
    expect(pickKeyArg({ foo: 42, bar: "x" })).toEqual({ key: "foo", value: "42" });
  });

  it("skips _-prefixed keys in fallback", () => {
    expect(pickKeyArg({ _trace: "t", bar: "x" })).toEqual({
      key: "bar",
      value: "x",
    });
    expect(pickKeyArg({ _trace: "t" })).toBeNull();
  });

  it("skips non-scalar values in fallback", () => {
    expect(pickKeyArg({ items: [1, 2], msg: "hi" })).toEqual({
      key: "msg",
      value: "hi",
    });
  });

  it("String()s numeric values", () => {
    expect(pickKeyArg({ table: 42 })).toEqual({ key: "table", value: "42" });
  });

  it("String()s boolean values", () => {
    expect(pickKeyArg({ verbose: true })).toEqual({ key: "verbose", value: "true" });
  });

  it("takes only the first line of a multi-line value", () => {
    expect(pickKeyArg({ sql: "SELECT 1\nFROM t" })).toEqual({
      key: "sql",
      value: "SELECT 1",
    });
  });
});

// ── truncLinePlain ─────────────────────────────────────────────────────────

describe("truncLinePlain", () => {
  it("leaves short text unchanged", () => {
    expect(truncLinePlain("abc", 40)).toBe("abc");
  });

  it("keeps text of exactly the max length", () => {
    expect(truncLinePlain("a".repeat(40), 40)).toBe("a".repeat(40));
  });

  it("truncates to the max length with a ... suffix", () => {
    const out = truncLinePlain("a".repeat(41), 40);
    expect(out).toBe("a".repeat(37) + "...");
    expect(out.length).toBe(40);
  });

  it("stops at the first newline even when short (mirrors subagent truncLine)", () => {
    expect(truncLinePlain("short\nmore", 40)).toBe("short...");
  });

  it("truncates the first line of long multi-line text", () => {
    expect(truncLinePlain("a".repeat(50) + "\nrest", 40)).toBe(
      "a".repeat(37) + "...",
    );
  });
});

// ── formatSummaryLine ──────────────────────────────────────────────────────

describe("formatSummaryLine", () => {
  const keyArg = { key: "table", value: "model_files" };

  it("running: muted arrow + muted key + dim value, no hint", () => {
    // NB the fake theme marker is `[token:text]` and the dim fragment is
    // ": value" — hence the doubled colon in `[dim:: …]`.
    expect(formatSummaryLine(keyArg, "running", theme)).toBe(
      "[muted:→ ][muted:table][dim:: model_files]",
    );
  });

  it("success: success key + (ctrl+o) hint", () => {
    expect(formatSummaryLine(keyArg, "success", theme)).toBe(
      "[muted:→ ][success:table][dim:: model_files][muted: (ctrl+o)]",
    );
  });

  it("error: error key + (ctrl+o) hint", () => {
    expect(formatSummaryLine(keyArg, "error", theme)).toBe(
      "[muted:→ ][error:table][dim:: model_files][muted: (ctrl+o)]",
    );
  });

  it("returns an empty string when keyArg is null", () => {
    expect(formatSummaryLine(null, "running", theme)).toBe("");
    expect(formatSummaryLine(null, "success", theme)).toBe("");
    expect(formatSummaryLine(null, "error", theme)).toBe("");
  });

  it("truncates the value to 40 chars with ...", () => {
    expect(
      formatSummaryLine({ key: "sql", value: "x".repeat(41) }, "running", theme),
    ).toBe("[muted:→ ][muted:sql][dim:: " + "x".repeat(37) + "...]");
  });

  it("keeps a value of exactly 40 chars intact", () => {
    expect(
      formatSummaryLine({ key: "sql", value: "x".repeat(40) }, "running", theme),
    ).toBe("[muted:→ ][muted:sql][dim:: " + "x".repeat(40) + "]");
  });
});
