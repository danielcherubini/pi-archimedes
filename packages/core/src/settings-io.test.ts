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
const { loadConfig, saveConfig } = await import("./settings-io.js");

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
