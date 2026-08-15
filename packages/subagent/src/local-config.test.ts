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
  writeLocalThinking,
  deleteLocalThinking,
  deleteLocalAgent,
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

    it("does not create file when deleting absent agent on clean install", () => {
      // No agents.local.json exists yet. Deleting an absent agent should
      // be a true no-op — it must NOT materialise an empty file on disk.
      deleteLocalModel("nonexistent");
      expect(existsSync(join(testDir, "agents.local.json"))).toBe(false);
    });
  });

  describe("writeLocalThinking", () => {
    it("creates file and writes thinking entry", () => {
      writeLocalThinking("codex", "high");
      expect(readLocalConfig()).toEqual({ codex: { thinking: "high" } });
    });

    it("preserves a model on the same entry when writing thinking after model", () => {
      writeLocalModel("codex", "o1");
      writeLocalThinking("codex", "high");
      expect(readLocalConfig()).toEqual({
        codex: { model: "o1", thinking: "high" },
      });
    });

    it("preserves other agent entries when updating one", () => {
      writeLocalThinking("codex", "high");
      writeLocalModel("claude", "claude-3.7");
      expect(readLocalConfig()).toEqual({
        codex: { thinking: "high" },
        claude: { model: "claude-3.7" },
      });
    });
  });

  describe("deleteLocalThinking", () => {
    it("removes only the thinking field, keeping model on the same entry", () => {
      writeLocalModel("codex", "o1");
      writeLocalThinking("codex", "high");
      deleteLocalThinking("codex");
      expect(readLocalConfig()).toEqual({ codex: { model: "o1" } });
    });

    it("removes the whole entry when thinking was the only field", () => {
      writeLocalThinking("codex", "high");
      deleteLocalThinking("codex");
      expect(readLocalConfig()).toEqual({});
    });

    it("is a no-op when agent does not exist", () => {
      writeLocalModel("codex", "o1");
      deleteLocalThinking("nonexistent");
      expect(readLocalConfig()).toEqual({ codex: { model: "o1" } });
    });

    it("does not create file when deleting absent agent on clean install", () => {
      // No agents.local.json exists yet. Deleting an absent agent should
      // be a true no-op — it must NOT materialise an empty file on disk.
      deleteLocalThinking("nonexistent");
      expect(existsSync(join(testDir, "agents.local.json"))).toBe(false);
    });
  });

  describe("deleteLocalModel field-level semantics", () => {
    it("leaves thinking intact on the same entry", () => {
      writeLocalModel("codex", "o1");
      writeLocalThinking("codex", "high");
      deleteLocalModel("codex");
      expect(readLocalConfig()).toEqual({ codex: { thinking: "high" } });
    });
  });

  describe("deleteLocalAgent", () => {
    it("removes the entire entry including all fields", () => {
      writeLocalModel("codex", "o1");
      writeLocalThinking("codex", "high");
      deleteLocalAgent("codex");
      expect(readLocalConfig()).toEqual({});
    });

    it("preserves other agent entries", () => {
      writeLocalModel("codex", "o1");
      writeLocalThinking("codex", "high");
      writeLocalModel("claude", "claude-3.7");
      deleteLocalAgent("codex");
      expect(readLocalConfig()).toEqual({
        claude: { model: "claude-3.7" },
      });
    });

    it("is a no-op when agent does not exist", () => {
      writeLocalModel("codex", "o1");
      deleteLocalAgent("nonexistent");
      expect(readLocalConfig()).toEqual({ codex: { model: "o1" } });
    });

    it("does not create file when deleting absent agent on clean install", () => {
      // No agents.local.json exists yet. Deleting an absent agent should
      // be a true no-op — it must NOT materialise an empty file on disk.
      deleteLocalAgent("nonexistent");
      expect(existsSync(join(testDir, "agents.local.json"))).toBe(false);
    });
  });

  it("leaves no .tmp file behind after successful write", () => {
    writeLocalModel("codex", "o1");
    const files = readdirSync(testDir);
    expect(files).not.toContain("agents.local.json.tmp");
    expect(existsSync(join(testDir, "agents.local.json"))).toBe(true);
  });
});
