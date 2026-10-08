import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── hoisted: must use require() since vi.hoisted runs before imports ────────

const { tempDir, fs, join, tmpdir, randomUUID } = vi.hoisted(() => {
  const fs = require("node:fs");
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { randomUUID } = require("node:crypto");
  const dir = join(tmpdir(), `settings-io-test-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return { tempDir: dir, fs, join, tmpdir, randomUUID };
});

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => tempDir,
}));

// Import after mocks are set up
const { loadConfig, saveConfig, removeConfig, isConfigEnabled, setConfigEnabled, updateConfig } = await import("./settings-io.js");

describe("removeConfig", () => {
  beforeEach(() => {
    const settingsPath = join(tempDir, "settings.json");
    if (fs.existsSync(settingsPath)) {
      fs.unlinkSync(settingsPath);
    }
  });

  afterEach(() => {
    const settingsPath = join(tempDir, "settings.json");
    const tmpPath = settingsPath + ".tmp";
    try { fs.unlinkSync(settingsPath); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  });

  it("deletes an existing namespace key and leaves sibling keys intact", () => {
    const settingsPath = join(tempDir, "settings.json");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ "test.ns": { foo: "bar" }, "other.ns": { baz: 1 }, "third.ns": { qux: "y" } }),
      "utf-8",
    );
    removeConfig("test.ns");
    const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(data["test.ns"]).toBeUndefined();
    expect(data["other.ns"]).toEqual({ baz: 1 });
    expect(data["third.ns"]).toEqual({ qux: "y" });
    expect(fs.existsSync(settingsPath + ".tmp")).toBe(false);
  });

  it("is a no-op when the key is absent (no rewrite)", () => {
    const settingsPath = join(tempDir, "settings.json");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ "other.ns": { baz: 1 } }),
      "utf-8",
    );
    const beforeMtimeMs = fs.statSync(settingsPath).mtimeMs;
    removeConfig("test.ns");
    const afterMtimeMs = fs.statSync(settingsPath).mtimeMs;
    expect(afterMtimeMs).toBe(beforeMtimeMs);
    const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(data).toEqual({ "other.ns": { baz: 1 } });
  });

  it("does not create the file when settings.json does not exist", () => {
    const settingsPath = join(tempDir, "settings.json");
    expect(fs.existsSync(settingsPath)).toBe(false);
    removeConfig("test.ns");
    expect(fs.existsSync(settingsPath)).toBe(false);
    expect(fs.existsSync(settingsPath + ".tmp")).toBe(false);
  });
});

describe("isConfigEnabled", () => {
  const settingsPath = () => join(tempDir, "settings.json");

  beforeEach(() => {
    if (fs.existsSync(settingsPath())) {
      fs.unlinkSync(settingsPath());
    }
  });

  afterEach(() => {
    const path = settingsPath();
    const tmpPath = path + ".tmp";
    try { fs.unlinkSync(path); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  });

  it("missing file/namespace → true", () => {
    expect(isConfigEnabled("test.ns")).toBe(true);
  });

  it("empty namespace object → true", () => {
    fs.writeFileSync(settingsPath(), JSON.stringify({ "test.ns": {} }), "utf-8");
    expect(isConfigEnabled("test.ns")).toBe(true);
  });

  it("{ enabled: true } → true", () => {
    fs.writeFileSync(settingsPath(), JSON.stringify({ "test.ns": { enabled: true } }), "utf-8");
    expect(isConfigEnabled("test.ns")).toBe(true);
  });

  it("{ enabled: false } → false", () => {
    fs.writeFileSync(settingsPath(), JSON.stringify({ "test.ns": { enabled: false } }), "utf-8");
    expect(isConfigEnabled("test.ns")).toBe(false);
  });

  it("{ enabled: \"false\" } → true (strict === false check)", () => {
    fs.writeFileSync(settingsPath(), JSON.stringify({ "test.ns": { enabled: "false" } }), "utf-8");
    expect(isConfigEnabled("test.ns")).toBe(true);
  });
});

describe("setConfigEnabled", () => {
  const settingsPath = () => join(tempDir, "settings.json");

  beforeEach(() => {
    if (fs.existsSync(settingsPath())) {
      fs.unlinkSync(settingsPath());
    }
  });

  afterEach(() => {
    const path = settingsPath();
    const tmpPath = path + ".tmp";
    try { fs.unlinkSync(path); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  });

  it("set to false adds enabled:false, keeping other keys and sibling namespaces", () => {
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({ "test.ns": { foo: "bar", count: 42 }, "other.ns": { baz: 1 } }),
      "utf-8",
    );
    setConfigEnabled("test.ns", false);
    const data = JSON.parse(fs.readFileSync(settingsPath(), "utf-8"));
    expect(data["test.ns"]).toEqual({ foo: "bar", count: 42, enabled: false });
    expect(data["other.ns"]).toEqual({ baz: 1 });
    expect(isConfigEnabled("test.ns")).toBe(false);
  });

  it("set to true on { enabled: false } removes the namespace entirely (zero keys)", () => {
    fs.writeFileSync(settingsPath(), JSON.stringify({ "test.ns": { enabled: false } }), "utf-8");
    setConfigEnabled("test.ns", true);
    const data = JSON.parse(fs.readFileSync(settingsPath(), "utf-8"));
    expect(data["test.ns"]).toBeUndefined();
    expect(isConfigEnabled("test.ns")).toBe(true);
  });

  it("set to true on { enabled: false, other: 1 } leaves the namespace as { other: 1 }", () => {
    fs.writeFileSync(settingsPath(), JSON.stringify({ "test.ns": { enabled: false, other: 1 } }), "utf-8");
    setConfigEnabled("test.ns", true);
    const data = JSON.parse(fs.readFileSync(settingsPath(), "utf-8"));
    expect(data["test.ns"]).toEqual({ other: 1 });
    expect(isConfigEnabled("test.ns")).toBe(true);
  });
});

describe("loadConfig", () => {
  beforeEach(() => {
    // Clean up settings file before each test
    const settingsPath = join(tempDir, "settings.json");
    if (fs.existsSync(settingsPath)) {
      fs.unlinkSync(settingsPath);
    }
  });

  afterEach(() => {
    // Clean up temp dir artifacts
    const settingsPath = join(tempDir, "settings.json");
    const tmpPath = settingsPath + ".tmp";
    try { fs.unlinkSync(settingsPath); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  });

  it("returns defaults when settings missing", () => {
    const result = loadConfig("test.ns", { foo: "bar", count: 42 });
    expect(result).toEqual({ foo: "bar", count: 42 });
  });

  it("merges settings over defaults", () => {
    const settingsPath = join(tempDir, "settings.json");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ "test.ns": { foo: "overridden" } }),
      "utf-8",
    );
    const result = loadConfig("test.ns", { foo: "bar", count: 42 });
    expect(result).toEqual({ foo: "overridden", count: 42 });
  });

  it("returns defaults on corrupt JSON", () => {
    const settingsPath = join(tempDir, "settings.json");
    fs.writeFileSync(settingsPath, "{ invalid json }", "utf-8");
    const result = loadConfig("test.ns", { foo: "bar", count: 42 });
    expect(result).toEqual({ foo: "bar", count: 42 });
  });
});

describe("saveConfig", () => {
  beforeEach(() => {
    const settingsPath = join(tempDir, "settings.json");
    if (fs.existsSync(settingsPath)) {
      fs.unlinkSync(settingsPath);
    }
  });

  afterEach(() => {
    const settingsPath = join(tempDir, "settings.json");
    const tmpPath = settingsPath + ".tmp";
    try { fs.unlinkSync(settingsPath); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  });

  it("writes atomically (tmp + rename)", () => {
    saveConfig("test.ns", { foo: "bar" });
    const settingsPath = join(tempDir, "settings.json");
    expect(fs.existsSync(settingsPath)).toBe(true);
    const tmpPath = settingsPath + ".tmp";
    expect(fs.existsSync(tmpPath)).toBe(false);
    const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(data["test.ns"]).toEqual({ foo: "bar" });
  });

  it("persists data for subsequent loads", () => {
    saveConfig("test.ns", { foo: "bar", count: 42 });
    const result = loadConfig("test.ns", { foo: "default", count: 0 });
    expect(result).toEqual({ foo: "bar", count: 42 });
  });

  it("writes data correctly on success path", () => {
    saveConfig("test.ns", { foo: "bar" });
    const settingsPath = join(tempDir, "settings.json");
    expect(fs.existsSync(settingsPath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(data["test.ns"]).toEqual({ foo: "bar" });
    // No .tmp file should remain after successful rename
    expect(fs.existsSync(settingsPath + ".tmp")).toBe(false);
  });
});

describe("updateConfig", () => {
  const settingsPath = () => join(tempDir, "settings.json");

  beforeEach(() => {
    const p = settingsPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  afterEach(() => {
    const p = settingsPath();
    const tmpP = p + ".tmp";
    try { fs.unlinkSync(p); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpP); } catch { /* ignore */ }
  });

  it("applies mutation onto defaults when settings.json does not exist", () => {
    const result = updateConfig(
      "test.ns",
      { done: false, count: 0 },
      (cfg) => ({ ...cfg, done: true }),
    );
    expect(result).toEqual({ done: true, count: 0 });
    const data = JSON.parse(fs.readFileSync(settingsPath(), "utf-8"));
    expect(data["test.ns"]).toEqual({ done: true, count: 0 });
  });

  it("preserves sibling namespaces AND other keys of the target namespace", () => {
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({
        "test.ns": { done: false, extra: 99 },
        "other.ns": { sibling: "value" },
      }),
      "utf-8",
    );
    const result = updateConfig(
      "test.ns",
      { done: false, extra: 0 },
      (cfg) => ({ ...cfg, done: true }),
    );
    expect(result).toEqual({ done: true, extra: 99 });
    const data = JSON.parse(fs.readFileSync(settingsPath(), "utf-8"));
    expect(data["test.ns"]).toEqual({ done: true, extra: 99 });
    expect(data["other.ns"]).toEqual({ sibling: "value" });
  });

  it("concurrent-change detection: detects a mid-mutation external write and retries; final file contains both the external key and the mutated value", () => {
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({ "test.ns": { done: false } }),
      "utf-8",
    );

    let mutateCallCount = 0;
    const result = updateConfig(
      "test.ns",
      { done: false },
      (cfg) => {
        mutateCallCount += 1;
        // On the first call, simulate a concurrent process writing an external key
        // between the `before` read and the `after` read. This change must be
        // detected by the optimistic re-read check, triggering a retry.
        if (mutateCallCount === 1) {
          const raw = JSON.parse(fs.readFileSync(settingsPath(), "utf-8"));
          raw["concurrent.ns"] = { injected: true };
          fs.writeFileSync(settingsPath(), JSON.stringify(raw), "utf-8");
        }
        return { ...cfg, done: true };
      },
    );

    expect(mutateCallCount).toBeGreaterThan(1);
    expect(result).toEqual({ done: true });
    const data = JSON.parse(fs.readFileSync(settingsPath(), "utf-8"));
    // Retry recomputed from fresh state — both the external key AND the mutated value survive
    expect(data["test.ns"]).toEqual({ done: true });
    expect(data["concurrent.ns"]).toEqual({ injected: true });
  });

  it("persistent concurrent writer: after maxAttempts the update still completes (last-writer-wins, no crash)", () => {
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({ "test.ns": { done: false } }),
      "utf-8",
    );

    let mutateCallCount = 0;
    // mutate always writes the external key — simulates a persistent concurrent writer
    const result = updateConfig(
      "test.ns",
      { done: false },
      (cfg) => {
        mutateCallCount += 1;
        // Always write a concurrent change to force re-read on every attempt
        const raw = JSON.parse(fs.readFileSync(settingsPath(), "utf-8"));
        raw["concurrent.ns"] = { injected: mutateCallCount };
        fs.writeFileSync(settingsPath(), JSON.stringify(raw), "utf-8");
        return { ...cfg, done: true };
      },
      3, // maxAttempts
    );

    // Must complete (not loop forever or throw)
    expect(mutateCallCount).toBe(3); // saturated at maxAttempts
    expect(result).toEqual({ done: true }); // flag value persisted
    const data = JSON.parse(fs.readFileSync(settingsPath(), "utf-8"));
    expect(data["test.ns"]).toEqual({ done: true }); // flag survived
    expect(data["concurrent.ns"]).toBeDefined(); // siblings survived
  });
});

describe("symlink preservation", () => {
  const settingsLink = () => join(tempDir, "settings.json");
  const target = () => join(tempDir, "dotfiles-settings.json");

  /**
   * Per-case setup: wipe settings.json (and any stale link/target/tmp), then
   * create a fresh target file pre-seeded with `{ preexisting: "keep-me" }`
   * (plus optional extra keys) and a settings.json **symlink** to it.
   * For dangling cases, `targetName` points the link at a non-existent path
   * instead of the seeded target.
   */
  function setupSymlink(targetName?: string, extraTargetKeys?: Record<string, unknown>) {
    const link = settingsLink();
    const t = target();
    for (const p of [link, link + ".tmp", t, join(tempDir, "nope.json"), join(tempDir, "nope2.json")]) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
    if (targetName) {
      fs.symlinkSync(join(tempDir, targetName), link);
      return join(tempDir, targetName);
    }
    fs.writeFileSync(t, JSON.stringify({ preexisting: "keep-me", ...extraTargetKeys }), "utf-8");
    fs.symlinkSync(t, link);
    return t;
  }

  afterEach(() => {
    for (const p of [settingsLink(), settingsLink() + ".tmp", target(), join(tempDir, "nope.json"), join(tempDir, "nope2.json")]) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
  });

  it("saveConfig through symlink preserves the link and updates the destination", () => {
    const t = setupSymlink();
    saveConfig("archimedes.test", { a: 1 });
    expect(fs.lstatSync(settingsLink()).isSymbolicLink()).toBe(true);
    const data = JSON.parse(fs.readFileSync(t, "utf-8"));
    expect(data["archimedes.test"]).toEqual({ a: 1 });
    expect(data["preexisting"]).toBe("keep-me");
  });

  it("removeConfig through symlink preserves the link", () => {
    const t = setupSymlink();
    saveConfig("archimedes.test", { a: 1 });
    removeConfig("archimedes.test");
    expect(fs.lstatSync(settingsLink()).isSymbolicLink()).toBe(true);
    const data = JSON.parse(fs.readFileSync(t, "utf-8"));
    expect(data["archimedes.test"]).toBeUndefined();
    expect(data["preexisting"]).toBe("keep-me");
  });

  it("regular file behavior unchanged (no symlink)", () => {
    const link = settingsLink();
    setupSymlink();
    fs.unlinkSync(link);
    fs.writeFileSync(link, "{}", "utf-8");
    saveConfig("archimedes.test", { b: 2 });
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(false);
    const data = JSON.parse(fs.readFileSync(link, "utf-8"));
    expect(data["archimedes.test"]).toEqual({ b: 2 });
    expect(fs.existsSync(link + ".tmp")).toBe(false);
  });

  it("removeConfig with missing file creates nothing", () => {
    const link = settingsLink();
    setupSymlink();
    fs.unlinkSync(link);
    removeConfig("archimedes.test");
    expect(fs.existsSync(link)).toBe(false);
  });

  it("dangling symlink: saveConfig recreates the destination, link live again", () => {
    const t = setupSymlink("nope.json");
    saveConfig("archimedes.test", { c: 3 });
    expect(fs.existsSync(t)).toBe(true);
    const data = JSON.parse(fs.readFileSync(t, "utf-8"));
    expect(data["archimedes.test"]).toEqual({ c: 3 });
    expect(fs.lstatSync(settingsLink()).isSymbolicLink()).toBe(true);
  });

  it("dangling symlink: removeConfig is a no-op, link untouched", () => {
    const t = setupSymlink("nope2.json");
    removeConfig("archimedes.test");
    expect(fs.lstatSync(settingsLink()).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(t)).toBe(false);
  });

  it("temp-write failure leaves the original file untouched", () => {
    const t = setupSymlink();
    const beforeRaw = fs.readFileSync(t, "utf-8");
    // The temp file is written beside the target (inside tempDir), so make the
    // parent directory read-only: the temp write fails (EACCES), the rename is
    // never attempted, and the live file must survive untouched.
    const mode = fs.statSync(tempDir).mode;
    fs.chmodSync(tempDir, 0o555);
    try {
      expect(() => saveConfig("archimedes.test", { e: 5 })).toThrow();
      expect(fs.readFileSync(t, "utf-8")).toBe(beforeRaw);
      expect(fs.existsSync(t + ".tmp")).toBe(false);
      expect(fs.existsSync(settingsLink() + ".tmp")).toBe(false);
      expect(fs.lstatSync(settingsLink()).isSymbolicLink()).toBe(true);
    } finally {
      fs.chmodSync(tempDir, mode);
    }
  });

  it("sibling namespaces survive a save", () => {
    const t = setupSymlink(undefined, { "archimedes.other": { keep: true } });
    saveConfig("archimedes.test", { d: 4 });
    const data = JSON.parse(fs.readFileSync(t, "utf-8"));
    expect(data["archimedes.other"]).toEqual({ keep: true });
    expect(data["archimedes.test"]).toEqual({ d: 4 });
  });
});
