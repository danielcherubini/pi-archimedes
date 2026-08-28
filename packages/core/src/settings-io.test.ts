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
const { loadConfig, saveConfig, removeConfig, isConfigEnabled, setConfigEnabled } = await import("./settings-io.js");

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
