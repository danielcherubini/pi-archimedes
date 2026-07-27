import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveAgent } from "./agent-manager.js";

// Redirect getAgentDir() to a temp directory via PI_CODING_AGENT_DIR.
// This must happen before any function calls so readLocalConfig()
// resolves agents.local.json to our sandbox directory.
const testDir = join(tmpdir(), "pi-test-save-agent");
process.env.PI_CODING_AGENT_DIR = testDir;

describe("saveAgent JSON rename cleanup ordering", () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("does not delete old JSON rename entry when .md write fails", () => {
    // Pre-populate agents.local.json with the OLD name's model override
    writeFileSync(
      join(testDir, "agents.local.json"),
      JSON.stringify({ oldcodex: { model: "claude-3.7" } }),
      "utf-8",
    );

    // Make the .md write fail by creating codex.md as a directory.
    // writeFileSync will throw EISDIR when writing to a directory path.
    mkdirSync(join(testDir, "codex.md"), { recursive: true });

    const state = {
      editAgent: {
        name: "codex",
        description: "test agent",
        systemPrompt: "hello world",
        source: "user",
        filePath: join(testDir, "oldcodex.md"),
        model: "gpt-4o",
      },
      editOriginal: {
        name: "oldcodex",
        description: "test agent",
        systemPrompt: "hello world",
        source: "user",
        filePath: join(testDir, "oldcodex.md"),
      },
      agents: [],
      globalDir: null,
      userDir: testDir,
      projectDir: null,
      editError: null,
      editDirty: false,
    };

    saveAgent(state as any, () => {});

    // The .md write failed, so the old JSON rename entry should NOT have been
    // deleted. If deleteLocalModel(originalName) ran before the .md write
    // (the bug), the old entry would be gone here.
    const config = JSON.parse(
      readFileSync(join(testDir, "agents.local.json"), "utf-8"),
    );
    expect(config.oldcodex).toEqual({ model: "claude-3.7" });
    expect(state.editError).toBeTruthy();
  });
});
