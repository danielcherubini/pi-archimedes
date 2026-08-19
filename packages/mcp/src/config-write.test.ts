import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { writeServerDisabled, writeServerDirectTools, mergeServerDefinitions, writeJsonFileAtomic } from "./config-write.js";

/** Target file path, built from the pi-coding-agent constant (never hardcoded). */
const configPath = (cwd: string): string => join(cwd, CONFIG_DIR_NAME, "mcp.json");

/** Project-shared target path (the merge destination — NOT the Pi override). */
const projectPath = (cwd: string): string => join(cwd, ".mcp.json");

function readConfig(cwd: string): Record<string, any> {
  return JSON.parse(readFileSync(configPath(cwd), "utf-8")) as Record<string, any>;
}

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "mcp-config-write-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("writeServerDisabled", () => {
  it("creates <cwd>/<CONFIG_DIR_NAME>/mcp.json with only { disabled } for the server", () => {
    writeServerDisabled(cwd, "x", true);

    const p = configPath(cwd);
    expect(existsSync(p)).toBe(true);
    expect(readConfig(cwd)).toEqual({ mcpServers: { x: { disabled: true } } });
  });

  it("merges with a previously written directTools value without clobbering it", () => {
    writeServerDirectTools(cwd, "x", ["a"]);
    writeServerDisabled(cwd, "x", false);

    expect(readConfig(cwd)).toEqual({
      mcpServers: { x: { directTools: ["a"], disabled: false } },
    });
  });
});

describe("writeServerDirectTools", () => {
  it("merges with a previously written disabled value without clobbering it", () => {
    writeServerDisabled(cwd, "x", true);
    writeServerDirectTools(cwd, "x", ["a"]);

    expect(readConfig(cwd)).toEqual({
      mcpServers: { x: { disabled: true, directTools: ["a"] } },
    });
  });

  it("preserves another server's entry when writing a different server", () => {
    writeServerDisabled(cwd, "x", true);
    writeServerDirectTools(cwd, "x", ["a"]);
    writeServerDisabled(cwd, "y", false);

    const parsed = readConfig(cwd);
    expect(parsed.mcpServers.x).toEqual({ disabled: true, directTools: ["a"] });
    expect(parsed.mcpServers.y).toEqual({ disabled: false });
  });

  it("accepts a boolean value (directTools: false disables direct tools)", () => {
    writeServerDirectTools(cwd, "x", false);

    expect(readConfig(cwd)).toEqual({ mcpServers: { x: { directTools: false } } });
  });
});

describe("mergeServerDefinitions", () => {
  function readProject(cwd: string): Record<string, any> {
    return JSON.parse(readFileSync(projectPath(cwd), "utf-8")) as Record<string, any>;
  }

  it("creates a fresh <cwd>/.mcp.json with the given servers", () => {
    mergeServerDefinitions(cwd, {
      context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
    });

    expect(existsSync(projectPath(cwd))).toBe(true);
    expect(readProject(cwd)).toEqual({
      mcpServers: { context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] } },
    });
    // Must NOT touch the Pi override file.
    expect(existsSync(configPath(cwd))).toBe(false);
  });

  it("merging server B preserves server A's entry", () => {
    mergeServerDefinitions(cwd, { alpha: { url: "https://alpha.example/mcp" } });
    mergeServerDefinitions(cwd, { beta: { command: "uvx", args: ["beta-server"] } });

    expect(readProject(cwd)).toEqual({
      mcpServers: {
        alpha: { url: "https://alpha.example/mcp" },
        beta: { command: "uvx", args: ["beta-server"] },
      },
    });
  });

  it("does NOT overwrite an existing entry (add-if-absent)", () => {
    const original = { url: "https://original.example/mcp", headers: { Authorization: "Bearer keep-me" } };
    mkdirSync(cwd, { recursive: true });
    writeFileSync(projectPath(cwd), JSON.stringify({ mcpServers: { alpha: original } }, null, 2) + "\n", "utf-8");

    mergeServerDefinitions(cwd, { alpha: { command: "npx" }, other: { url: "https://other.example" } });

    const parsed = readProject(cwd);
    expect(parsed.mcpServers.alpha).toEqual(original); // untouched
    expect(parsed.mcpServers.other).toEqual({ url: "https://other.example" }); // added
  });

  it("preserves other top-level keys of the existing file", () => {
    const existing = { $schema: "https://example/schemas/mcp.json", foo: "bar", mcpServers: { alpha: { url: "https://a.example" } } };
    mkdirSync(cwd, { recursive: true });
    writeFileSync(projectPath(cwd), JSON.stringify(existing, null, 2) + "\n", "utf-8");

    mergeServerDefinitions(cwd, { beta: { command: "uvx", args: ["beta-server"] } });

    const parsed = readProject(cwd);
    expect(parsed.$schema).toBe("https://example/schemas/mcp.json");
    expect(parsed.foo).toBe("bar");
    expect(parsed.mcpServers).toEqual({
      alpha: { url: "https://a.example" },
      beta: { command: "uvx", args: ["beta-server"] },
    });
  });

  it("tolerates // comments in the existing file (read side)", () => {
    mkdirSync(cwd, { recursive: true });
    writeFileSync(projectPath(cwd), '// project config\n{"mcpServers": {"alpha": {"url": "https://a.example"}},}', "utf-8");

    expect(() => mergeServerDefinitions(cwd, { beta: { command: "uvx", args: ["b"] } })).not.toThrow();

    expect(readProject(cwd).mcpServers).toEqual({
      alpha: { url: "https://a.example" },
      beta: { command: "uvx", args: ["b"] },
    });
  });
});

describe("read-modify-write tolerance", () => {
  it("tolerates // comments and trailing commas in the existing file", () => {
    mkdirSync(join(cwd, CONFIG_DIR_NAME), { recursive: true });
    writeFileSync(
      configPath(cwd),
      [
        "// comment",
        '{"mcpServers": {"z": {"disabled": false}},}',
        "",
      ].join("\n"),
      "utf-8",
    );

    expect(() => writeServerDisabled(cwd, "x", true)).not.toThrow();

    expect(readConfig(cwd)).toEqual({
      mcpServers: { z: { disabled: false }, x: { disabled: true } },
    });
  });

  it("preserves credential fields of other servers verbatim (never copies credentials)", () => {
    const credServer = {
      type: "http",
      url: "http://example.com:3000/mcp",
      headers: { Authorization: "Bearer s3cret-token" },
    };
    mkdirSync(join(cwd, CONFIG_DIR_NAME), { recursive: true });
    writeFileSync(
      configPath(cwd),
      JSON.stringify({ mcpServers: { cred: credServer } }, null, 2) + "\n",
      "utf-8",
    );

    writeServerDisabled(cwd, "x", true);

    const parsed = readConfig(cwd);
    expect(parsed.mcpServers.cred).toEqual(credServer);
    expect(parsed.mcpServers.x).toEqual({ disabled: true });
  });
});

describe("writeJsonFileAtomic", () => {
  it("writes the doc with 2-space indent and a trailing newline", () => {
    const doc = { mcpServers: { x: { url: "https://x.example" } } };
    const p = join(cwd, "sub", "out.json");

    writeJsonFileAtomic(p, doc);

    expect(readFileSync(p, "utf-8")).toBe(JSON.stringify(doc, null, 2) + "\n");
  });

  it("creates the target's parent dir and leaves no .tmp file behind", () => {
    const p = join(cwd, "freshdir", "out.json");

    writeJsonFileAtomic(p, { a: 1 });

    expect(existsSync(p)).toBe(true);
    expect(existsSync(p + ".tmp")).toBe(false);
  });

  it("replaces an existing target file (tmp+rename over the target)", () => {
    const p = join(cwd, "existing.json");
    writeFileSync(p, JSON.stringify({ old: true }, null, 2) + "\n", "utf-8");

    writeJsonFileAtomic(p, { new: 1 });

    expect(readFileSync(p, "utf-8")).toBe('{\n  "new": 1\n}\n');
  });
});
