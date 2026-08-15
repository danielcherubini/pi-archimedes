import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveAgent } from "./agent-manager.js";
import { discoverAgentsAll } from "./agents.js";
import {
  writeLocalModel,
  writeLocalThinking,
  deleteLocalThinking,
  deleteLocalAgent,
} from "./local-config.js";

// Mock writeLocalModel to always throw (simulating a JSON store write
// failure). deleteLocalModel is a no-op since it's never reached in
// these tests. readLocalConfig / setLocalConfig / getLocalConfigPath
// use their REAL implementations (via importOriginal) so the saveAgent
// JSON backup/restore logic can be exercised end-to-end.
vi.mock("./local-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./local-config.js")>();
  return {
    ...actual,
    writeLocalModel: vi.fn(() => {
      throw new Error("JSON write failed");
    }),
    deleteLocalModel: vi.fn(),
    writeLocalThinking: vi.fn(() => {
      throw new Error("JSON thinking write failed");
    }),
    deleteLocalThinking: vi.fn(),
    deleteLocalAgent: vi.fn(),
  };
});

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

  it("rolls back both .md and JSON when re-discovery fails", () => {
    // Allow writeLocalModel to succeed so execution proceeds past the JSON
    // write to discoverAgentsAll, which will throw.
    vi.mocked(writeLocalModel).mockImplementationOnce(() => {});
    vi.mocked(discoverAgentsAll).mockImplementationOnce(() => {
      throw new Error("discovery failed");
    });

    // Pre-create the .md file with original content (including old model).
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

    // Pre-create agents.local.json with the old model override.
    writeFileSync(
      join(testDir, "agents.local.json"),
      JSON.stringify({ codex: { model: "old-model" } }),
      "utf-8",
    );

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

    // .md file should be restored to original content (model: old-model).
    const mdContent = readFileSync(join(testDir, "codex.md"), "utf-8");
    expect(mdContent).toContain("model: old-model");
    expect(mdContent).not.toContain("new description");

    // agents.local.json should be restored to old-model via setLocalConfig.
    const jsonContent = JSON.parse(
      readFileSync(join(testDir, "agents.local.json"), "utf-8"),
    );
    expect(jsonContent.codex).toEqual({ model: "old-model" });

    // The live edit object should still have the new model (retained for retry).
    expect(state.editAgent!.model).toBe("new-model");

    // editError should be set.
    expect(state.editError).toBeTruthy();
  });
});

describe("saveAgent double-delete prevention on retry", () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("does not delete newPath when old file already absent on retry", () => {
    vi.mocked(writeLocalModel).mockImplementationOnce(() => {});
    vi.mocked(writeLocalModel).mockImplementationOnce(() => {});
    vi.mocked(discoverAgentsAll).mockImplementationOnce(() => {
      throw new Error("discovery failed");
    });
    vi.mocked(discoverAgentsAll).mockImplementationOnce(() => {
      throw new Error("discovery failed");
    });
    writeFileSync(join(testDir, "oldcodex.md"), "original rename content", "utf-8");
    const state = {
      editAgent: {
        name: "codex",
        description: "new description",
        systemPrompt: "new prompt",
        source: "user",
        filePath: join(testDir, "oldcodex.md"),
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
    expect(existsSync(join(testDir, "oldcodex.md"))).toBe(false);
    const newPath = join(testDir, "codex.md");
    expect(existsSync(newPath)).toBe(true);
    saveAgent(state as any, () => {});
    expect(existsSync(newPath)).toBe(true);
    expect(state.editError).toContain("discovery failed");
  });
});

describe("saveAgent cleanup of model-less new files", () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("deletes new file on failure when no model", () => {
    vi.mocked(discoverAgentsAll).mockImplementationOnce(() => {
      throw new Error("discovery failed");
    });
    const state = {
      editAgent: {
        name: "newagent",
        description: "test agent",
        systemPrompt: "hello world",
        source: "user",
        filePath: undefined,
      },
      editOriginal: {
        name: "newagent",
        description: "",
        systemPrompt: "",
        source: "user",
        filePath: undefined,
      },
      agents: [],
      globalDir: null,
      userDir: testDir,
      projectDir: null,
      editError: null,
      editDirty: false,
    };
    saveAgent(state as any, () => {});
    const newPath = join(testDir, "newagent.md");
    expect(existsSync(newPath)).toBe(false);
    expect(state.editError).toBeTruthy();
  });
});

describe("saveAgent thinking JSON round-trip", () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("restores thinking to .md when the JSON thinking write fails", () => {
    // writeLocalModel mocked to succeed for this call only (default throws),
    // while writeLocalThinking keeps its default throwing implementation,
    // simulating a failed JSON thinking write.
    vi.mocked(writeLocalModel).mockImplementationOnce(() => {});

    const state = {
      editAgent: {
        name: "codex",
        description: "test agent",
        systemPrompt: "hello world",
        source: "user",
        filePath: join(testDir, "codex.md"),
        model: "openai/gpt-4o",
        thinking: "high",
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

    // The .md should contain BOTH fields as rollback fallback.
    const mdContent = readFileSync(join(testDir, "codex.md"), "utf-8");
    expect(mdContent).toContain("model: openai/gpt-4o");
    expect(mdContent).toContain("thinking: high");

    // editError should be set.
    expect(state.editError).toBeTruthy();

    // The live edit object should retain both values for a safe retry.
    expect(state.editAgent!.model).toBe("openai/gpt-4o");
    expect(state.editAgent!.thinking).toBe("high");
  });

  it("retains thinking for retry when re-discovery fails", () => {
    // Both JSON writes succeed for this call only, then re-discovery throws.
    vi.mocked(writeLocalModel).mockImplementationOnce(() => {});
    vi.mocked(writeLocalThinking).mockImplementationOnce(() => {});
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
        thinking: "high",
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

    // The live edit object should still have the thinking — delete only
    // runs after requestRender() which never executed.
    expect(state.editAgent!.thinking).toBe("high");

    // editError should contain the discovery failure message.
    expect(state.editError).toContain("discovery failed");

    // The rolled-back .md should contain the thinking.
    const mdContent = readFileSync(join(testDir, "codex.md"), "utf-8");
    expect(mdContent).toContain("thinking: high");
  });

  it("clearing thinking on save removes only the thinking field from JSON", async () => {
    // Pre-seed JSON with both fields; the save carries a model but NO
    // thinking, so only the thinking field should be removed.
    writeFileSync(
      join(testDir, "agents.local.json"),
      JSON.stringify({ codex: { model: "o1", thinking: "high" } }),
      "utf-8",
    );

    // Delegate to the real implementations — the no-op mock default for
    // deleteLocalThinking would leave thinking: "high" behind.
    const actual = await vi.importActual<typeof import("./local-config.js")>(
      "./local-config.js",
    );
    vi.mocked(writeLocalModel).mockImplementationOnce((name, value) =>
      actual.writeLocalModel(name, value),
    );
    vi.mocked(deleteLocalThinking).mockImplementationOnce((name) =>
      actual.deleteLocalThinking(name),
    );
    vi.mocked(discoverAgentsAll).mockImplementationOnce(() => ({
      global: [],
      user: [],
      project: [],
      globalDir: null,
      userDir: testDir,
      projectDir: null,
    }));

    const state = {
      editAgent: {
        name: "codex",
        description: "test agent",
        systemPrompt: "hello world",
        source: "user",
        filePath: join(testDir, "codex.md"),
        model: "o1",
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

    // Thinking removed, model preserved.
    const config = JSON.parse(
      readFileSync(join(testDir, "agents.local.json"), "utf-8"),
    );
    expect(config).toEqual({ codex: { model: "o1" } });
  });

  it("writes thinking to agents.local.json and strips it from .md on a successful save", async () => {
    const actual = await vi.importActual<typeof import("./local-config.js")>(
      "./local-config.js",
    );
    vi.mocked(writeLocalModel).mockImplementationOnce((name, value) =>
      actual.writeLocalModel(name, value),
    );
    vi.mocked(writeLocalThinking).mockImplementationOnce((name, value) =>
      actual.writeLocalThinking(name, value),
    );
    vi.mocked(deleteLocalAgent).mockImplementationOnce((name) =>
      actual.deleteLocalAgent(name),
    );
    vi.mocked(discoverAgentsAll).mockImplementationOnce(() => ({
      global: [],
      user: [],
      project: [],
      globalDir: null,
      userDir: testDir,
      projectDir: null,
    }));

    const state = {
      editAgent: {
        name: "codex",
        description: "test agent",
        systemPrompt: "hello world",
        source: "user",
        filePath: join(testDir, "codex.md"),
        model: "openai/gpt-4o",
        thinking: "high",
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

    // Both fields landed in agents.local.json.
    const config = JSON.parse(
      readFileSync(join(testDir, "agents.local.json"), "utf-8"),
    );
    expect(config).toEqual({
      codex: { model: "openai/gpt-4o", thinking: "high" },
    });

    // The .md has neither field in its frontmatter.
    const mdContent = readFileSync(join(testDir, "codex.md"), "utf-8");
    expect(mdContent).not.toContain("model:");
    expect(mdContent).not.toContain("thinking:");

    // Both fields stripped from the live edit object.
    expect(state.editAgent!.model).toBeUndefined();
    expect(state.editAgent!.thinking).toBeUndefined();
  });

  it("migrates model and thinking JSON entries on rename", async () => {
    // Pre-seed JSON under the OLD name with both fields.
    writeFileSync(
      join(testDir, "agents.local.json"),
      JSON.stringify({ oldcodex: { model: "old-model", thinking: "high" } }),
      "utf-8",
    );
    writeFileSync(
      join(testDir, "oldcodex.md"),
      "original rename content",
      "utf-8",
    );

    const actual = await vi.importActual<typeof import("./local-config.js")>(
      "./local-config.js",
    );
    vi.mocked(writeLocalModel).mockImplementationOnce((name, value) =>
      actual.writeLocalModel(name, value),
    );
    vi.mocked(writeLocalThinking).mockImplementationOnce((name, value) =>
      actual.writeLocalThinking(name, value),
    );
    vi.mocked(deleteLocalAgent).mockImplementationOnce((name) =>
      actual.deleteLocalAgent(name),
    );
    vi.mocked(discoverAgentsAll).mockImplementationOnce(() => ({
      global: [],
      user: [],
      project: [],
      globalDir: null,
      userDir: testDir,
      projectDir: null,
    }));

    const state = {
      editAgent: {
        name: "codex",
        description: "test agent",
        systemPrompt: "hello world",
        source: "user",
        filePath: join(testDir, "oldcodex.md"), // oldPath
        model: "old-model",
        thinking: "high",
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

    // Both fields migrated to the new name; no stale entry under the old name.
    const config = JSON.parse(
      readFileSync(join(testDir, "agents.local.json"), "utf-8"),
    );
    expect(config).toEqual({ codex: { model: "old-model", thinking: "high" } });

    // The old .md is unlinked and the new one has no model/thinking lines.
    expect(existsSync(join(testDir, "oldcodex.md"))).toBe(false);
    const newContent = readFileSync(join(testDir, "codex.md"), "utf-8");
    expect(newContent).not.toContain("model:");
    expect(newContent).not.toContain("thinking:");
  });
});

