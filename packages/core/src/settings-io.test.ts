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
const { loadConfig, saveConfig, removeConfig, isConfigEnabled, setConfigEnabled, updateConfig, readEffectiveSettings } = await import("./settings-io.js");

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

  it("handles leading UTF-8 BOM in settings.json", () => {
    const settingsPath = join(tempDir, "settings.json");
    fs.writeFileSync(
      settingsPath,
      "\uFEFF" + JSON.stringify({ "test.ns": { foo: "overridden" } }),
      "utf-8",
    );
    const result = loadConfig("test.ns", { foo: "bar", count: 42 });
    expect(result).toEqual({ foo: "overridden", count: 42 });
  });

  it("prevents clobbering sibling namespaces when settings.json has UTF-8 BOM", () => {
    const settingsPath = join(tempDir, "settings.json");
    fs.writeFileSync(
      settingsPath,
      "\uFEFF" + JSON.stringify({ "test.ns": { foo: "overridden" } }),
      "utf-8",
    );
    loadConfig("test.ns", { foo: "bar", count: 42 });
    saveConfig("other.ns", { val: 123 });
    const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(data["test.ns"]).toEqual({ foo: "overridden" });
    expect(data["other.ns"]).toEqual({ val: 123 });
  });

  it("readEffectiveSettings returns parsed object from BOM-prefixed settings.json", () => {
    const settingsPath = join(tempDir, "settings.json");
    fs.writeFileSync(
      settingsPath,
      "\uFEFF" + JSON.stringify({ "test.ns": { foo: "overridden" } }),
      "utf-8",
    );
    const result = readEffectiveSettings();
    expect(result).toEqual({ "test.ns": { foo: "overridden" } });
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

// ── readEffectiveSettings ───────────────────────────────────────────────────
//
// `loadConfig` reads `~/.pi/agent/settings.json` by hand, which cannot see
// project-scoped settings or overrides. `pi.getSettings()` returns the merged
// effective object, so it is the right source when the running pi has it — and
// the file read is the fallback that keeps core's peer floor where ADR 0013 put
// it (getSettings is an ExtensionAPI method that older pi does not expose).
// Note the direction of the whole thing: this is a READER. The writer stays on
// the hand-rolled symlink-preserving path because pi has no public write API.

describe("readEffectiveSettings", () => {
  const settingsPath = () => join(tempDir, "settings.json");

  beforeEach(() => {
    const p = settingsPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  afterEach(() => {
    const p = settingsPath();
    try { fs.unlinkSync(p); } catch { /* ignore */ }
    try { fs.unlinkSync(p + ".tmp"); } catch { /* ignore */ }
  });

  it("returns pi.getSettings() when the host exposes it", () => {
    const pi = { getSettings: () => ({ "archimedes.web": { braveApiKey: "from-host" } }) };
    expect(readEffectiveSettings(pi)).toEqual({ "archimedes.web": { braveApiKey: "from-host" } });
  });

  it("its value wins over settings.json (project scope and overrides are invisible to the file read)", () => {
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({ "archimedes.web": { braveApiKey: "from-file" } }),
      "utf-8",
    );
    const pi = { getSettings: () => ({ "archimedes.web": { braveApiKey: "from-effective" } }) };
    const result = readEffectiveSettings(pi) as { "archimedes.web": { braveApiKey: string } };
    expect(result["archimedes.web"].braveApiKey).toBe("from-effective");
  });

  it("falls back to the file read when the handle has no getSettings (a pi older than the API)", () => {
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({ "archimedes.web": { braveApiKey: "from-file" } }),
      "utf-8",
    );
    const result = readEffectiveSettings({}) as { "archimedes.web": { braveApiKey: string } };
    expect(result["archimedes.web"].braveApiKey).toBe("from-file");
  });

  it("falls back to the file read when no handle is passed at all", () => {
    fs.writeFileSync(settingsPath(), JSON.stringify({ "test.ns": { a: 1 } }), "utf-8");
    expect(readEffectiveSettings()).toEqual({ "test.ns": { a: 1 } });
    expect(readEffectiveSettings(undefined)).toEqual({ "test.ns": { a: 1 } });
    expect(readEffectiveSettings(null)).toEqual({ "test.ns": { a: 1 } });
  });

  it("treats a non-function getSettings property as absent", () => {
    fs.writeFileSync(settingsPath(), JSON.stringify({ "test.ns": { a: 1 } }), "utf-8");
    expect(readEffectiveSettings({ getSettings: "not a function" })).toEqual({ "test.ns": { a: 1 } });
  });

  it("falls back when getSettings() throws — pi asserts an active extension context and can refuse", () => {
    fs.writeFileSync(settingsPath(), JSON.stringify({ "test.ns": { a: 1 } }), "utf-8");
    const pi = {
      getSettings: () => {
        throw new Error("Extension is not active");
      },
    };
    expect(() => readEffectiveSettings(pi)).not.toThrow();
    expect(readEffectiveSettings(pi)).toEqual({ "test.ns": { a: 1 } });
  });

  it("falls back when getSettings() returns something unusable (null / undefined / a scalar)", () => {
    fs.writeFileSync(settingsPath(), JSON.stringify({ "test.ns": { a: 1 } }), "utf-8");
    expect(readEffectiveSettings({ getSettings: () => undefined })).toEqual({ "test.ns": { a: 1 } });
    expect(readEffectiveSettings({ getSettings: () => null })).toEqual({ "test.ns": { a: 1 } });
    expect(readEffectiveSettings({ getSettings: () => 42 })).toEqual({ "test.ns": { a: 1 } });
  });

  it("returns an empty object for malformed JSON with no handle (existing loadConfig behaviour preserved)", () => {
    fs.writeFileSync(settingsPath(), "{ invalid json }", "utf-8");
    expect(readEffectiveSettings()).toEqual({});
    // …and the malformed file still does not break the namespaced reader.
    expect(loadConfig("test.ns", { foo: "bar" })).toEqual({ foo: "bar" });
  });

  it("returns {} when there is no file and no handle", () => {
    expect(fs.existsSync(settingsPath())).toBe(false);
    expect(readEffectiveSettings()).toEqual({});
  });

  it("never writes: it is a reader, so the file and the writer's tmp path are untouched", () => {
    fs.writeFileSync(settingsPath(), JSON.stringify({ "test.ns": { a: 1 } }), "utf-8");
    const before = fs.readFileSync(settingsPath(), "utf-8");
    const beforeMtimeMs = fs.statSync(settingsPath()).mtimeMs;
    readEffectiveSettings({});
    readEffectiveSettings({ getSettings: () => ({}) });
    expect(fs.readFileSync(settingsPath(), "utf-8")).toBe(before);
    expect(fs.statSync(settingsPath()).mtimeMs).toBe(beforeMtimeMs);
    expect(fs.existsSync(settingsPath() + ".tmp")).toBe(false);
  });

  it("never creates settings.json when it is absent", () => {
    readEffectiveSettings({});
    expect(fs.existsSync(settingsPath())).toBe(false);
  });

  it("does not disturb the writer: saveConfig still round-trips after an effective read", () => {
    readEffectiveSettings({ getSettings: () => ({ "test.ns": { from: "host" } }) });
    saveConfig("test.ns", { from: "file" });
    expect(loadConfig("test.ns", { from: "" })).toEqual({ from: "file" });
  });
});

// ── The catch must not be invisible ────────────────────────────────────────
//
// `pi.getSettings()` refuses for the expected reason (the handle's wrapper
// asserts an active extension context) AND for reasons that are bugs: the
// runtime stub throws "Extension runtime not initialized" for a call made
// during extension loading, and the real implementation can throw for anything
// it chokes on. Falling back to the file is right in every case; falling back
// without a trace is not, because the symptom of each of those is a silently
// project-blind settings read.

describe("readEffectiveSettings reports the reason it fell back", () => {
  const ENV = "PI_ARCHIMEDES_LOG";
  const settingsPath = () => join(tempDir, "settings.json");
  const previous = process.env[ENV];

  afterEach(() => {
    if (previous === undefined) delete process.env[ENV];
    else process.env[ENV] = previous;
    const p = settingsPath();
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  });

  it("logs the error when getSettings() throws, and still returns the file read", () => {
    const target = join(tempDir, "effective-fallback.log");
    process.env[ENV] = target;
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({ "test.ns": { from: "file" } }),
      "utf-8",
    );

    const pi = {
      getSettings: () => {
        throw new Error("Extension runtime not initialized");
      },
    };
    expect(readEffectiveSettings(pi)).toEqual({ "test.ns": { from: "file" } });

    const logged = fs.readFileSync(target, "utf-8");
    expect(logged).toContain("[core]");
    expect(logged).toContain("Extension runtime not initialized");
    // With the stack, which is the part that says which call site did it.
    expect(logged).toMatch(/\n\s+at\s+\S/);
  });

  it("says nothing on the normal paths (supported host, older pi, no handle)", () => {
    const target = join(tempDir, "effective-quiet.log");
    process.env[ENV] = target;
    fs.writeFileSync(settingsPath(), JSON.stringify({ "test.ns": { a: 1 } }), "utf-8");

    readEffectiveSettings({ getSettings: () => ({ "test.ns": { a: 2 } }) });
    readEffectiveSettings({});
    readEffectiveSettings();

    expect(fs.existsSync(target)).toBe(false);
  });
});
