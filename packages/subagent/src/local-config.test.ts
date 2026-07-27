import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  rmSync,
  existsSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readLocalConfig,
  writeLocalModel,
  deleteLocalModel,
} from "./local-config.js";

// Redirect getAgentDir() to a temp directory via PI_CODING_AGENT_DIR.
// This must happen before any function calls so getLocalConfigPath()
// resolves to our sandbox directory.
const testDir = join(tmpdir(), "pi-test-local-config");
process.env.PI_CODING_AGENT_DIR = testDir;

describe("local-config", () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("readLocalConfig", () => {
    it("returns {} when file does not exist", () => {
      expect(readLocalConfig()).toEqual({});
    });

    it("returns {} when file is corrupt JSON", () => {
      const path = join(testDir, "agents.local.json");
      writeFileSync(path, "{ broken json", "utf-8");
      expect(readLocalConfig()).toEqual({});
    });

    it("parses valid JSON correctly", () => {
      const path = join(testDir, "agents.local.json");
      writeFileSync(
        path,
        JSON.stringify({ codex: { model: "o1" } }),
        "utf-8",
      );
      expect(readLocalConfig()).toEqual({ codex: { model: "o1" } });
    });
  });

  describe("writeLocalModel", () => {
    it("creates file and writes model entry", () => {
      writeLocalModel("codex", "o1");
      expect(readLocalConfig()).toEqual({ codex: { model: "o1" } });
    });

    it("preserves other agent entries when updating one", () => {
      writeLocalModel("codex", "o1");
      writeLocalModel("claude", "claude-3.7");
      expect(readLocalConfig()).toEqual({
        codex: { model: "o1" },
        claude: { model: "claude-3.7" },
      });
    });

    it("handles model values with special characters", () => {
      writeLocalModel("openai", "openai/gpt-4.1");
      expect(readLocalConfig()).toEqual({
        openai: { model: "openai/gpt-4.1" },
      });
    });
  });

  describe("deleteLocalModel", () => {
    it("removes the specified agent entry", () => {
      writeLocalModel("codex", "o1");
      deleteLocalModel("codex");
      expect(readLocalConfig()).toEqual({});
    });

    it("is a no-op when agent does not exist", () => {
      writeLocalModel("codex", "o1");
      deleteLocalModel("nonexistent");
      expect(readLocalConfig()).toEqual({ codex: { model: "o1" } });
    });

    it("preserves other entries", () => {
      writeLocalModel("codex", "o1");
      writeLocalModel("claude", "claude-3.7");
      deleteLocalModel("codex");
      expect(readLocalConfig()).toEqual({ claude: { model: "claude-3.7" } });
    });
  });

  it("leaves no .tmp file behind after successful write", () => {
    writeLocalModel("codex", "o1");
    const files = readdirSync(testDir);
    expect(files).not.toContain("agents.local.json.tmp");
    expect(existsSync(join(testDir, "agents.local.json"))).toBe(true);
  });
});
