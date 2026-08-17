import { describe, expect, it } from "vitest";
import {
  BUILTIN_NAMES,
  findFormattingCollisions,
  formatToolName,
  getServerPrefix,
  matchRawToolName,
  resolveServerFromToolName,
  sanitizeServerPrefix,
} from "./tool-naming.js";

describe("sanitizeServerPrefix", () => {
  it("keeps alphanumerics, underscores, and dashes untouched", () => {
    expect(sanitizeServerPrefix("my-server_1")).toBe("my-server_1");
  });

  it("hex-encodes disallowed characters with _<hex>_ wrappers", () => {
    expect(sanitizeServerPrefix("a.b")).toBe("a_2e_b");
  });

  it("hex-encodes multiple disallowed characters", () => {
    // "!" = 0x21, "." = 0x2e
    expect(sanitizeServerPrefix("a!b.c")).toBe("a_21_b_2e_c");
  });
});

describe("getServerPrefix", () => {
  it("server mode sanitizes the raw name", () => {
    expect(getServerPrefix("my.server", "server")).toBe("my_2e_server");
  });

  it("none mode returns an empty prefix", () => {
    expect(getServerPrefix("anything", "none")).toBe("");
  });

  it("short mode strips a trailing -mcp suffix before sanitizing", () => {
    expect(getServerPrefix("filesystem-mcp", "short")).toBe("filesystem");
  });

  it("short mode strips a bare mcp suffix (case-insensitive)", () => {
    expect(getServerPrefix("GitHubMCP", "short")).toBe("GitHub");
  });

  it("mcp mode wraps the sanitized name in mcp__", () => {
    expect(getServerPrefix("my.server", "mcp")).toBe("mcp__my_2e_server");
  });
});

describe("formatToolName", () => {
  it("builds <prefix>_<tool> for server mode", () => {
    expect(formatToolName("search", "github", "server")).toBe("github_search");
  });

  it("returns the bare tool name in none mode", () => {
    expect(formatToolName("search", "github", "none")).toBe("search");
  });

  it("converts dots in tool names to underscores", () => {
    expect(formatToolName("a.b.c", "srv", "server")).toBe("srv_a_b_c");
  });

  it("combines mcp mode with dot conversion", () => {
    expect(formatToolName("a.b", "fs-mcp", "mcp")).toBe("mcp__fs-mcp_a_b");
  });
});

describe("resolveServerFromToolName", () => {
  it("resolves the owning server", () => {
    const servers = [
      { name: "github", prefix: "server" as const },
      { name: "jira", prefix: "server" as const },
    ];
    expect(resolveServerFromToolName("github_search", servers)).toBe("github");
  });

  it("computes each server's prefix using ITS OWN mode", () => {
    // In "short" mode, "x-mcp" has prefix "x", so "x_tool" resolves to it.
    const servers = [{ name: "x-mcp", prefix: "short" as const }];
    expect(resolveServerFromToolName("x_tool", servers)).toBe("x-mcp");
    // In "server" mode the same server would be "x-mcp", so "x_tool" must NOT match.
    const servers2 = [{ name: "x-mcp", prefix: "server" as const }];
    expect(resolveServerFromToolName("x_tool", servers2)).toBeUndefined();
  });

  it("longest matching prefix wins", () => {
    const servers = [
      { name: "a", prefix: "server" as const },
      { name: "a_b", prefix: "server" as const },
    ];
    // "a_b_x" matches both "a_" (len 1) and "a_b_" (len 3) → "a_b" wins
    expect(resolveServerFromToolName("a_b_x", servers)).toBe("a_b");
  });

  it("returns undefined when two servers tie on the longest matching prefix", () => {
    const servers = [
      { name: "github", prefix: "server" as const },
      { name: "github-mcp", prefix: "short" as const }, // also resolves to "github"
    ];
    expect(resolveServerFromToolName("github_search", servers)).toBeUndefined();
  });

  it("returns undefined when no server matches", () => {
    const servers = [{ name: "github", prefix: "server" as const }];
    expect(resolveServerFromToolName("read", servers)).toBeUndefined();
    expect(resolveServerFromToolName("nonesrv_tool", [{ name: "s", prefix: "none" as const }])).toBeUndefined();
  });
});

describe("matchRawToolName", () => {
  it("resolves the raw dotted tool name from its sanitized prefixed name", () => {
    const tools = [{ name: "a.b" }, { name: "x.y" }, { name: "plain" }];
    expect(matchRawToolName("srv_a_b", "srv", "server", tools)).toBe("a.b");
    expect(matchRawToolName("srv_plain", "srv", "server", tools)).toBe("plain");
  });

  it("uses the server's OWN prefix mode", () => {
    const tools = [{ name: "a.b" }];
    // short mode: "github-mcp" → "github"
    expect(matchRawToolName("github_a_b", "github-mcp", "short", tools)).toBe("a.b");
    // mcp mode: "mcp__srv"
    expect(matchRawToolName("mcp__srv_a_b", "srv", "mcp", tools)).toBe("a.b");
    // none mode: bare (but dot-sanitized) name
    expect(matchRawToolName("a_b", "srv", "none", tools)).toBe("a.b");
    // A name formatted under one mode must not match under another
    expect(matchRawToolName("github_a_b", "github-mcp", "server", tools)).toBeUndefined();
  });

  it("returns undefined when no tool formats to the given name", () => {
    expect(matchRawToolName("srv_nope", "srv", "server", [{ name: "a.b" }])).toBeUndefined();
    expect(matchRawToolName("srv_a_b", "srv", "server", [])).toBeUndefined();
  });
});

describe("findFormattingCollisions", () => {
  it("detects raw names that format to the same final name", () => {
    const tools = [{ name: "a.b" }, { name: "a_b" }, { name: "plain" }];
    expect(findFormattingCollisions("srv", "server", tools)).toEqual([
      { finalName: "srv_a_b", rawNames: ["a.b", "a_b"] },
    ]);
  });

  it("returns [] when all formatted names are unique", () => {
    const tools = [{ name: "a.b" }, { name: "x.y" }, { name: "plain" }];
    expect(findFormattingCollisions("srv", "server", tools)).toEqual([]);
  });

  it("detects collisions in none mode (bare sanitized names)", () => {
    expect(findFormattingCollisions("srv", "none", [{ name: "a.b" }, { name: "a_b" }])).toEqual([
      { finalName: "a_b", rawNames: ["a.b", "a_b"] },
    ]);
  });

  it("excludes raw names that format distinctly from the collision", () => {
    const tools = [{ name: "a.b" }, { name: "a_b" }, { name: "aB" }];
    // "aB" formats to "mcp__srv_aB" — NOT part of the collision group
    expect(findFormattingCollisions("srv", "mcp", tools)).toEqual([
      { finalName: "mcp__srv_a_b", rawNames: ["a.b", "a_b"] },
    ]);
  });
});

describe("BUILTIN_NAMES", () => {
  it("contains the pi builtin tool names including mcp", () => {
    for (const name of ["read", "bash", "edit", "write", "grep", "find", "ls", "mcp"]) {
      expect(BUILTIN_NAMES.has(name)).toBe(true);
    }
  });
});
