import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveAgent } from "./agent-manager.js";
import { discoverAgentsAll } from "./agents.js";
import { writeLocalModel } from "./local-config.js";

// Mock writeLocalModel to always throw (simulating a JSON store write
// failure). deleteLocalModel is a no-op since it's never reached in
// these tests. readLocalConfig / getLocalConfigPath are stubs for any
// indirect imports via agents.ts → discoverAgentsAll (which is never
// called when a save fails).
vi.mock("./local-config.js", () => ({
  writeLocalModel: vi.fn(() => {
    throw new Error("JSON write failed");
  }),
  deleteLocalModel: vi.fn(),
  readLocalConfig: () => ({}),
  getLocalConfigPath: () => "",
}));

// Partial mock of ./agents.js: keep all original exports but replace
// discoverAgentsAll with a vi.fn() so individual tests can control its
// behavior (e.g. throwing to simulate a re-discovery failure). Existing
// tests never reach discoverAgentsAll because they fail earlier; the
// default vi.fn() returns undefined which is fine for those paths.
vi.mock("./agents.js", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  discoverAgentsAll: vi.fn(),
}));

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

describe("saveAgent rollback model to .md", () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("restore model to .md when JSON write fails", () => {
    // writeLocalModel is mocked (vi.mock at top of file) to always throw.
    // The .md write itself succeeds (real fs.writeFileSync), then the
    // JSON store write fails, triggering the catch-block rollback.

    const state = {
      editAgent: {
        name: "codex",
        description: "test agent",
        systemPrompt: "hello world",
        source: "user",
        filePath: join(testDir, "codex.md"),
        model: "openai/gpt-4o",
      },
      editOriginal: {
        name: "codex",
        description: "test agent",
        systemPrompt: "hello world",
        source: "user",
        filePath: join(testDir, "codex.md"),
      },
      agents: [],
      globalDir: null,
      userDir: testDir,
      projectDir: null,
      editError: null,
      editDirty: false,
    };

    saveAgent(state as any, () => {});

    // The .md file should still contain the model field (rollback).
    const mdContent = readFileSync(join(testDir, "codex.md"), "utf-8");
    expect(mdContent).toContain("model: openai/gpt-4o");

    // editError should be set.
    expect(state.editError).toBeTruthy();

    // The live edit in-memory object should still have the model (not deleted).
    expect(state.editAgent!.model).toBe("openai/gpt-4o");
  });

  it("restores original .md content when JSON write fails", () => {
    // writeLocalModel is mocked (vi.mock at top of file) to always throw,
    // so the .md write succeeds but the JSON store write fails, triggering
    // the catch-block restore-original path.
    // Pre-create the .md file with original content (including an old model
    // override in frontmatter) so saveAgent can capture and restore it.
    const originalMd = [
      "---",
      "name: codex",
      "description: original description",
      "model: old-model",
      "---",
      "",
      "original prompt",
      "",
    ].join("\n");
    writeFileSync(join(testDir, "codex.md"), originalMd, "utf-8");

    const state = {
      editAgent: {
        name: "codex",
        description: "new description",
        systemPrompt: "new prompt",
        source: "user",
        filePath: join(testDir, "codex.md"),
        model: "new-model",
      },
      editOriginal: {
        name: "codex",
        description: "original description",
        systemPrompt: "original prompt",
        source: "user",
        filePath: join(testDir, "codex.md"),
      },
      agents: [],
      globalDir: null,
      userDir: testDir,
      projectDir: null,
      editError: null,
      editDirty: false,
    };

    saveAgent(state as any, () => {});

    // The .md file should have been restored to the original content
    // verbatim (including the old model), NOT left with the new edit.
    const mdContent = readFileSync(join(testDir, "codex.md"), "utf-8");
    expect(mdContent).toContain("model: old-model");
    expect(mdContent).not.toContain("new description");

    // editError should be set.
    expect(state.editError).toBeTruthy();
  });
});

describe("saveAgent retry safety when re-discovery fails", () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("retains model for retry when re-discovery fails", () => {
    // Make writeLocalModel succeed for this call only (default mock throws).
    // This lets execution proceed past the JSON write to discoverAgentsAll.
    vi.mocked(writeLocalModel).mockImplementationOnce(() => {});

    // Make discoverAgentsAll throw after the save completes.
    vi.mocked(discoverAgentsAll).mockImplementationOnce(() => {
      throw new Error("discovery failed");
    });

    const state = {
      editAgent: {
        name: "codex",
        description: "test agent",
        systemPrompt: "hello world",
        source: "user",
        filePath: join(testDir, "codex.md"),
        model: "openai/gpt-4o",
      },
      editOriginal: {
        name: "codex",
        description: "test agent",
        systemPrompt: "hello world",
        source: "user",
        filePath: join(testDir, "codex.md"),
      },
      agents: [],
      globalDir: null,
      userDir: testDir,
      projectDir: null,
      editError: null,
      editDirty: false,
    };

    saveAgent(state as any, () => {});

    // The live edit object should still have the model — delete agent.model
    // only runs after requestRender() which never executed because
    // discoverAgentsAll threw first.
    expect(state.editAgent!.model).toBe("openai/gpt-4o");

    // editError should contain the discovery failure message.
    expect(state.editError).toContain("discovery failed");

    // The .md file should have the model restored by the catch block
    // rollback (serializeAgent({ ...agent, model })).
    const mdContent = readFileSync(join(testDir, "codex.md"), "utf-8");
    expect(mdContent).toContain("model: openai/gpt-4o");
  });

  it("does not delete renamed .md when re-discovery fails after old file removed", () => {
    // Allow writeLocalModel to succeed, then make discoverAgentsAll throw
    // after the rename unlinkSync has already run (oldPath is gone).
    vi.mocked(writeLocalModel).mockImplementationOnce(() => {});
    vi.mocked(discoverAgentsAll).mockImplementationOnce(() => {
      throw new Error("discovery failed");
    });

    // Pre-create the old .md file (the original agent at oldPath).
    writeFileSync(
      join(testDir, "oldcodex.md"),
      "original rename content",
      "utf-8",
    );

    const state = {
      editAgent: {
        name: "codex",
        description: "new description",
        systemPrompt: "new prompt",
        source: "user",
        filePath: join(testDir, "oldcodex.md"), // oldPath
        model: "openai/gpt-4o",
      },
      editOriginal: {
        name: "oldcodex",
        description: "original description",
        systemPrompt: "original prompt",
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

    // The old file was deleted during the save (rename unlinkSync succeeded).
    // newPath should NOT be deleted in the catch block — it is the only
    // surviving copy of the agent.
    const newPath = join(testDir, "codex.md");
    expect(existsSync(newPath)).toBe(true);
    const newContent = readFileSync(newPath, "utf-8");
    expect(newContent).toContain("model: openai/gpt-4o");

    // editError should contain the discovery failure message.
    expect(state.editError).toContain("discovery failed");
  });
});
