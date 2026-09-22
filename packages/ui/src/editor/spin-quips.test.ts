import { describe, expect, it, vi } from "vitest";
import { SPIN_QUIPS, pickQuip, QUIP_ROTATION_MIN_SECS, QUIP_ROTATION_MAX_SECS } from "./spin-quips.js";

// ── SPIN_QUIPS pool invariants ───────────────────────────────────────────────

describe("SPIN_QUIPS", () => {
  /** A mutable copy — the frozen `SPIN_QUIPS` is asserted read-only below. */
  const pool = [...SPIN_QUIPS];

  it("has 20–60 entries", () => {
    expect(SPIN_QUIPS.length).toBeGreaterThanOrEqual(20);
    expect(SPIN_QUIPS.length).toBeLessThanOrEqual(60);
  });

  it("entries are 1–64 chars", () => {
    for (const q of pool) {
      expect(q.length, JSON.stringify(q)).toBeGreaterThanOrEqual(1);
      expect(q.length, JSON.stringify(q)).toBeLessThanOrEqual(64);
    }
  });

  it("entries are printable ASCII only (U+0020–U+007E)", () => {
    for (const q of pool) {
      const ok = [...q].every((c) => {
        const code = c.charCodeAt(0);
        return code >= 0x20 && code <= 0x7e;
      });
      expect(ok, JSON.stringify(q)).toBe(true);
    }
  });

  it("entries have no leading or trailing space", () => {
    for (const q of pool) {
      expect(q.startsWith(" "), JSON.stringify(q)).toBe(false);
      expect(q.endsWith(" "), JSON.stringify(q)).toBe(false);
    }
  });

  it("entries have no double (consecutive) spaces", () => {
    for (const q of pool) {
      expect(q.includes("  "), JSON.stringify(q)).toBe(false);
    }
  });

  it("entries are all unique", () => {
    expect(new Set(pool).size).toBe(pool.length);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(SPIN_QUIPS)).toBe(true);
  });
});

// ── Quip rotation constants ──────────────────────────────────────────────────

describe("QUIP_ROTATION_* constants", () => {
  it("are the inclusive 15 s / 45 s bounds, min < max, integers", () => {
    expect(QUIP_ROTATION_MIN_SECS).toBe(15);
    expect(QUIP_ROTATION_MAX_SECS).toBe(45);
    expect(QUIP_ROTATION_MIN_SECS).toBeLessThan(QUIP_ROTATION_MAX_SECS);
    expect(Number.isInteger(QUIP_ROTATION_MIN_SECS)).toBe(true);
    expect(Number.isInteger(QUIP_ROTATION_MAX_SECS)).toBe(true);
  });
});

// ── pickQuip ─────────────────────────────────────────────────────────────────

describe("pickQuip", () => {
  it("rand = () => 0 (no exclude) → the first pool entry", () => {
    expect(pickQuip(undefined, () => 0)).toBe(SPIN_QUIPS[0]!);
  });

  it("exclude = first pick → exactly one restricted re-roll: the first non-excluded entry, and rand is consumed twice", () => {
    const rand = vi.fn().mockReturnValue(0);
    const first = SPIN_QUIPS[0]!;
    const quip = pickQuip(first, rand);
    // a second draw really happened (not a duplicate of the first)…
    expect(rand).toHaveBeenCalledTimes(2);
    expect(quip).not.toBe(first);
    // …and it is the first pool entry ≠ exclude (filtered pick, rand 0).
    expect(quip).toBe(SPIN_QUIPS[1]!);
    expect(poolHas(quip)).toBe(true);
  });

  it("exclude given but the first pick misses it → no re-roll (rand consumed once)", () => {
    const rand = vi.fn().mockReturnValue(0);
    const quip = pickQuip(SPIN_QUIPS[1]!, rand);
    expect(rand).toHaveBeenCalledTimes(1);
    expect(quip).toBe(SPIN_QUIPS[0]!);
  });

  it("exclude not in the pool → single draw, never a re-roll", () => {
    const rand = vi.fn().mockReturnValue(0);
    expect(pickQuip("not in the pool", rand)).toBe(SPIN_QUIPS[0]!);
    expect(rand).toHaveBeenCalledTimes(1);
  });

  it("default rand returns an actual pool member (smoke)", () => {
    expect(poolHas(pickQuip())).toBe(true);
  });
});

/** Whether `q` is a pool member. */
function poolHas(q: string): boolean {
  return SPIN_QUIPS.includes(q);
}
