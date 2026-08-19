/**
 * Tests for host-config discovery (`/mcp setup` → "Import from another tool",
 * plan-027, Task 4).
 *
 * HOME is pointed at a temp dir by setting `process.env.HOME` (node's
 * `os.homedir()` honours it on POSIX) and restored afterwards; the project
 * `cwd` is a separate temp dir. Every case is JSON-only discovery — no
 * network, no real HOME, no real project files.
 *
 * Coverage:
 *   - finds a `~/.cursor/mcp.json` config AND a `<cwd>/.vscode/mcp.json`
 *     config (VSCode's key is top-level `servers`, NOT `mcpServers`) with
 *     the correct `agent` labels and extracted server records
 *   - `~/.claude.json` — only the `mcpServers` key is taken, other top-level
 *     keys (the file is a general Claude state file) are ignored
 *   - returns [] when no candidate paths exist
 *   - ignores malformed JSON (no throw) and nonexistent paths
 *   - tolerates `//` comments via stripJsonComments
 *   - NEVER returns configs under `<cwd>/.pi/` (pi's own layer — self-import
 *     loop) or at `~/.config/mcp/mcp.json` (pi's global layer)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverHostConfigs } from "./host-configs.js";

let home: string;
let cwd: string;
const previousHome = process.env.HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "mcp-hostcfg-home-"));
  cwd = mkdtempSync(join(tmpdir(), "mcp-hostcfg-cwd-"));
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function writeJson(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

// ── discovery ────────────────────────────────────────────────────────────────

describe("discoverHostConfigs", () => {
  it("finds a cursor config in HOME and a vscode config in cwd, with labels", () => {
    writeJson(join(home, ".cursor", "mcp.json"), JSON.stringify({
      mcpServers: { alpha: { url: "https://alpha.example/mcp" } },
    }));
    writeJson(join(cwd, ".vscode", "mcp.json"), JSON.stringify({
      // VSCode uses the top-level "servers" key (per VSCode docs) — NOT "mcpServers".
      servers: { beta: { command: "npx", args: ["-y", "beta-mcp"] } },
    }));

    const found = discoverHostConfigs(cwd);

    expect(found).toHaveLength(2);
    const [first, second] = found;
    expect(first).toEqual({
      agent: "cursor",
      path: join(home, ".cursor", "mcp.json"),
      servers: { alpha: { url: "https://alpha.example/mcp" } },
    });
    expect(second).toEqual({
      agent: "vscode",
      path: join(cwd, ".vscode", "mcp.json"),
      servers: { beta: { command: "npx", args: ["-y", "beta-mcp"] } },
    });
  });

  it("labels project-scoped cursor configs (<cwd>/.cursor/mcp.json) as cursor too", () => {
    writeJson(join(cwd, ".cursor", "mcp.json"), JSON.stringify({
      mcpServers: { proj: { command: "uvx", args: ["proj-mcp"] } },
    }));

    const found = discoverHostConfigs(cwd);

    expect(found).toHaveLength(1);
    expect(found[0]).toEqual({
      agent: "cursor",
      path: join(cwd, ".cursor", "mcp.json"),
      servers: { proj: { command: "uvx", args: ["proj-mcp"] } },
    });
  });

  it("takes only mcpServers from ~/.claude.json (other top-level keys ignored)", () => {
    writeJson(join(home, ".claude.json"), JSON.stringify({
      version: 1,
      userID: "some-user",
      mcpServers: { gamma: { command: "uvx", args: ["gamma-mcp"] } },
    }));

    const found = discoverHostConfigs(cwd);

    expect(found).toHaveLength(1);
    expect(found[0]?.agent).toBe("claude-code");
    expect(found[0]?.path).toBe(join(home, ".claude.json"));
    expect(found[0]?.servers).toEqual({ gamma: { command: "uvx", args: ["gamma-mcp"] } });
  });

  it("labels ~/.claude/mcp.json as claude-code", () => {
    writeJson(join(home, ".claude", "mcp.json"), JSON.stringify({
      mcpServers: { delta: { url: "https://delta.example/mcp" } },
    }));

    const found = discoverHostConfigs(cwd);

    expect(found).toHaveLength(1);
    expect(found[0]?.agent).toBe("claude-code");
    expect(found[0]?.path).toBe(join(home, ".claude", "mcp.json"));
  });

  it("labels ~/.claude/claude_desktop_config.json as claude-desktop", () => {
    writeJson(join(home, ".claude", "claude_desktop_config.json"), JSON.stringify({
      mcpServers: { desktop: { command: "npx", args: ["-y", "desktop-mcp"] } },
    }));

    const found = discoverHostConfigs(cwd);

    expect(found).toHaveLength(1);
    expect(found[0]?.agent).toBe("claude-desktop");
    expect(found[0]?.path).toBe(join(home, ".claude", "claude_desktop_config.json"));
  });

  it("returns results in the documented stable order", () => {
    writeJson(join(home, ".claude", "claude_desktop_config.json"), JSON.stringify({ mcpServers: { d: { url: "https://d.example" } } }));
    writeJson(join(cwd, ".vscode", "mcp.json"), JSON.stringify({ servers: { v: { url: "https://v.example" } } }));
    writeJson(join(home, ".claude", "mcp.json"), JSON.stringify({ mcpServers: { c: { url: "https://c.example" } } }));
    writeJson(join(home, ".claude.json"), JSON.stringify({ mcpServers: { cc: { url: "https://cc.example" } } }));
    writeJson(join(cwd, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { cp: { url: "https://cp.example" } } }));
    writeJson(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { ch: { url: "https://ch.example" } } }));

    const found = discoverHostConfigs(cwd);

    expect(found.map((f) => f.path)).toEqual([
      join(home, ".cursor", "mcp.json"),       // cursor (home)
      join(cwd, ".cursor", "mcp.json"),         // cursor (project)
      join(home, ".claude", "mcp.json"),        // claude-code (dir)
      join(home, ".claude.json"),               // claude-code (file)
      join(home, ".claude", "claude_desktop_config.json"), // claude-desktop
      join(cwd, ".vscode", "mcp.json"),         // vscode (project)
    ]);
  });
});

// ── tolerance ────────────────────────────────────────────────────────────────

describe("tolerance", () => {
  it("returns [] when nothing exists", () => {
    expect(discoverHostConfigs(cwd)).toEqual([]);
  });

  it("ignores nonexistent candidate paths without throwing", () => {
    mkdirSync(join(home, ".cursor"), { recursive: true }); // empty dir, no mcp.json
    mkdirSync(join(cwd, ".vscode"), { recursive: true });
    expect(() => discoverHostConfigs(cwd)).not.toThrow();
    expect(discoverHostConfigs(cwd)).toEqual([]);
  });

  it("ignores malformed JSON (no throw) and keeps the valid configs", () => {
    writeJson(join(home, ".cursor", "mcp.json"), "{ this is not json !!");
    writeJson(join(cwd, ".vscode", "mcp.json"), JSON.stringify({
      servers: { beta: { command: "npx", args: ["-y", "beta-mcp"] } },
    }));

    expect(() => discoverHostConfigs(cwd)).not.toThrow();
    const found = discoverHostConfigs(cwd);
    expect(found).toHaveLength(1);
    expect(found[0]?.agent).toBe("vscode");
  });

  it("skips a file whose top level is not an object", () => {
    writeJson(join(home, ".cursor", "mcp.json"), JSON.stringify(["not", "an", "object"]));
    expect(discoverHostConfigs(cwd)).toEqual([]);
  });

  it("skips a file whose mcpServers key is not an object", () => {
    writeJson(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: "nope" }));
    writeJson(join(cwd, ".vscode", "mcp.json"), JSON.stringify({ servers: "nope" }));
    expect(discoverHostConfigs(cwd)).toEqual([]);
  });

  it("skips non-object server entries but keeps the valid ones", () => {
    writeJson(join(home, ".cursor", "mcp.json"), JSON.stringify({
      mcpServers: { good: { url: "https://good.example" }, bad: "scalar" },
    }));
    const found = discoverHostConfigs(cwd);
    expect(found[0]?.servers).toEqual({ good: { url: "https://good.example" } });
  });

  it("tolerates // comments in host config files", () => {
    writeJson(join(home, ".cursor", "mcp.json"), [
      "// cursor project mcp",
      '{"mcpServers": {"alpha": {"url": "https://alpha.example/mcp"}},}',
    ].join("\n"));

    const found = discoverHostConfigs(cwd);
    expect(found[0]?.servers).toEqual({ alpha: { url: "https://alpha.example/mcp" } });
  });
});

// ── exclusions ───────────────────────────────────────────────────────────────

describe("exclusions", () => {
  it("never returns pi-owned layers: <cwd>/.pi/… and ~/.config/mcp/…", () => {
    writeJson(join(cwd, ".pi", "mcp.json"), JSON.stringify({
      mcpServers: { piOverride: { url: "https://pi.example" } },
    }));
    writeJson(join(home, ".config", "mcp", "mcp.json"), JSON.stringify({
      mcpServers: { piGlobal: { url: "https://pi-global.example" } },
    }));
    writeJson(join(home, ".cursor", "mcp.json"), JSON.stringify({
      mcpServers: { alpha: { url: "https://alpha.example/mcp" } },
    }));

    const found = discoverHostConfigs(cwd);

    expect(found).toHaveLength(1);
    expect(found[0]?.agent).toBe("cursor");
    for (const f of found) {
      expect(f.path.startsWith(join(cwd, ".pi"))).toBe(false);
      expect(f.path === join(home, ".config", "mcp", "mcp.json")).toBe(false);
    }
  });
});
