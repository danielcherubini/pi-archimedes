import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerDef, ServerCacheEntry } from "./types.js";
import { CACHE_VERSION, CACHE_MAX_AGE_MS } from "./types.js";

const {
  computeServerHash,
  loadMetadataCache,
  saveServerCache,
  isServerCacheValid,
  getCachedTools,
  getCachedPrompts,
  recordServerOutcome,
  setCachePathForTest,
} = await import("./metadata-cache.js");

let tempDir: string;
let cachePath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "mcp-cache-test-"));
  cachePath = join(tempDir, "mcp-cache.json");
  setCachePathForTest(cachePath);
});

afterEach(() => {
  setCachePathForTest(null);
  rmSync(tempDir, { recursive: true, force: true });
});

const baseStdioDef: ServerDef = {
  type: "stdio",
  command: "node",
  args: ["--experimental", "server.js"],
  env: { API_KEY: "abc" },
  cwd: "/tmp/work",
  protocolVersion: "2025-03-26",
  includeTools: ["a", "b"],
  excludeTools: ["c"],
  exposeResources: true,
};

const baseHttpDef: ServerDef = {
  type: "http",
  url: "https://example.com/mcp",
  auth: { token: "tok" },
  headers: { "X-Api": "1" },
  bearerTokenEnv: "BEARER_TOKEN",
  protocolVersion: "2025-03-26",
};

describe("computeServerHash", () => {
  it("is stable across key order (stdio)", () => {
    const reordered: ServerDef = {
      exposeResources: true,
      env: { API_KEY: "abc" },
      type: "stdio",
      command: "node",
      includeTools: ["a", "b"],
      protocolVersion: "2025-03-26",
      args: ["--experimental", "server.js"],
      cwd: "/tmp/work",
      excludeTools: ["c"],
    };
    expect(computeServerHash(reordered)).toBe(computeServerHash(baseStdioDef));
  });

  it("is stable across key order (http, nested object key order)", () => {
    const reordered: ServerDef = {
      bearerTokenEnv: "BEARER_TOKEN",
      url: "https://example.com/mcp",
      type: "http",
      headers: { "X-Api": "1" },
      protocolVersion: "2025-03-26",
      auth: { token: "tok" },
    };
    expect(computeServerHash(reordered)).toBe(computeServerHash(baseHttpDef));
  });

  it("changes when command changes", () => {
    const changed: ServerDef = { ...baseStdioDef, command: "python3" };
    expect(computeServerHash(changed)).not.toBe(computeServerHash(baseStdioDef));
  });

  it("changes when url changes (http)", () => {
    const changed: ServerDef = { ...baseHttpDef, url: "https://other.com/mcp" };
    expect(computeServerHash(changed)).not.toBe(computeServerHash(baseHttpDef));
  });

  it("does NOT change for runtime settings", () => {
    const withRuntime: ServerDef = {
      ...baseStdioDef,
      lifecycle: "lazy-keep-alive",
      idleTimeout: 0,
      requestTimeoutMs: 5000,
      directTools: true,
      toolPrefix: "none",
      debug: true,
    };
    expect(computeServerHash(withRuntime)).toBe(computeServerHash(baseStdioDef));
  });

  it("does NOT change for registration-only / inert fields (protocolVersion, includeTools, excludeTools, exposeResources)", () => {
    const changed: ServerDef = {
      ...baseStdioDef,
      protocolVersion: "2025-06-18",
      includeTools: ["z"],
      excludeTools: ["w", "x"],
      exposeResources: false,
    };
    expect(computeServerHash(changed)).toBe(computeServerHash(baseStdioDef));
  });

  it("changes when headers change (http)", () => {
    const changed: ServerDef = { ...baseHttpDef, headers: { "X-Api": "2" } };
    expect(computeServerHash(changed)).not.toBe(computeServerHash(baseHttpDef));
  });

  it("changes when bearerTokenEnv changes (http)", () => {
    const changed: ServerDef = { ...baseHttpDef, bearerTokenEnv: "OTHER_TOKEN" };
    expect(computeServerHash(changed)).not.toBe(computeServerHash(baseHttpDef));
  });

  it("returns a 64-char hex sha-256 digest", () => {
    expect(computeServerHash(baseStdioDef)).toMatch(/^[0-9a-f]{64}$/);
  });
});

function validEntry(def: ServerDef): ServerCacheEntry {
  return {
    configHash: computeServerHash(def),
    tools: [{ name: "t1", inputSchema: {} }],
    resources: [],
    cachedAt: Date.now(),
  };
}

describe("isServerCacheValid", () => {
  it("is true for a matching, fresh entry", () => {
    expect(isServerCacheValid(baseStdioDef, validEntry(baseStdioDef))).toBe(true);
  });

  it("is false for an undefined entry", () => {
    expect(isServerCacheValid(baseStdioDef, undefined)).toBe(false);
  });

  it("is false on hash mismatch (config changed)", () => {
    const changed: ServerDef = { ...baseStdioDef, command: "python3" };
    expect(isServerCacheValid(changed, validEntry(baseStdioDef))).toBe(false);
  });

  it("is false when older than CACHE_MAX_AGE_MS", () => {
    const stale: ServerCacheEntry = {
      ...validEntry(baseStdioDef),
      cachedAt: Date.now() - CACHE_MAX_AGE_MS - 1000,
    };
    expect(isServerCacheValid(baseStdioDef, stale)).toBe(false);
  });

  it("is true just under CACHE_MAX_AGE_MS", () => {
    const fresh: ServerCacheEntry = {
      ...validEntry(baseStdioDef),
      cachedAt: Date.now() - CACHE_MAX_AGE_MS + 60_000,
    };
    expect(isServerCacheValid(baseStdioDef, fresh)).toBe(true);
  });
});

describe("loadMetadataCache", () => {
  it("returns empty structure when file is missing", () => {
    expect(loadMetadataCache()).toEqual({ version: CACHE_VERSION, servers: {} });
  });

  it("returns empty structure on corrupt JSON", () => {
    writeFileSync(cachePath, "{not json", "utf-8");
    expect(loadMetadataCache()).toEqual({ version: CACHE_VERSION, servers: {} });
  });

  it("returns empty structure on version mismatch", () => {
    writeFileSync(
      cachePath,
      JSON.stringify({ version: 999, servers: { a: validEntry(baseStdioDef) } }),
      "utf-8",
    );
    expect(loadMetadataCache()).toEqual({ version: CACHE_VERSION, servers: {} });
  });
});

describe("saveServerCache + loadMetadataCache round-trip", () => {
  it("persists a server entry with computed hash and timestamp", () => {
    saveServerCache("srv1", baseStdioDef, {
      tools: [{ name: "t1", description: "d", inputSchema: { type: "object" } }],
      resources: [],
      prompts: [],
    });
    const cache = loadMetadataCache();
    const entry = cache.servers["srv1"];
    expect(entry).toBeDefined();
    expect(entry?.configHash).toBe(computeServerHash(baseStdioDef));
    expect(entry?.cachedAt).toBeGreaterThan(Date.now() - 5000);
    expect(entry?.tools).toEqual([{ name: "t1", description: "d", inputSchema: { type: "object" } }]);
  });

  it("merges without clobbering other servers (read-merge-write)", () => {
    saveServerCache("srv1", baseStdioDef, { tools: [], resources: [], prompts: [] });
    saveServerCache("srv2", baseHttpDef, { tools: [], resources: [], prompts: [] });
    const cache = loadMetadataCache();
    expect(Object.keys(cache.servers).sort()).toEqual(["srv1", "srv2"]);
  });

  it("writes atomically (no leftover tmp file)", () => {
    saveServerCache("srv1", baseStdioDef, { tools: [], resources: [], prompts: [] });
    expect(existsSync(cachePath)).toBe(true);
    expect(existsSync(join(tempDir, "mcp-cache.json.tmp"))).toBe(false);
    // File content must be valid JSON (not a partial write)
    expect(() => JSON.parse(readFileSync(cachePath, "utf-8"))).not.toThrow();
  });
});

describe("getCachedPrompts", () => {
  it("returns cached prompts for a valid entry", () => {
    const prompts = [{ name: "p1", description: "d" }];
    saveServerCache("srv1", baseStdioDef, { tools: [], resources: [], prompts });
    expect(getCachedPrompts("srv1", baseStdioDef)).toEqual(prompts);
  });

  it("returns undefined when the entry is stale (hash mismatch)", () => {
    saveServerCache("srv1", baseStdioDef, { tools: [], resources: [], prompts: [{ name: "p1" }] });
    const changed: ServerDef = { ...baseStdioDef, command: "python3" };
    expect(getCachedPrompts("srv1", changed)).toBeUndefined();
  });

  it("returns undefined when the entry has no prompts", () => {
    saveServerCache("srv1", baseStdioDef, { tools: [], resources: [] });
    expect(getCachedPrompts("srv1", baseStdioDef)).toBeUndefined();
  });

  it("returns undefined when the server is not in the cache", () => {
    expect(getCachedPrompts("missing", baseStdioDef)).toBeUndefined();
  });
});

describe("recordServerOutcome (ADR 0004)", () => {
  it("persists an outcome with a timestamp and the error text", () => {
    const before = Date.now();
    recordServerOutcome("srv1", "needs-auth", "unauthorized");
    const entry = loadMetadataCache().serverStatuses?.["srv1"];
    expect(entry).toEqual({ status: "needs-auth", error: "unauthorized", at: expect.any(Number) });
    expect(entry!.at).toBeGreaterThanOrEqual(before);
    expect(entry!.at).toBeLessThanOrEqual(Date.now() + 1);
  });

  it("stores no error field when none is given (exactOptionalPropertyTypes-safe)", () => {
    recordServerOutcome("srv1", "connected");
    const entry = loadMetadataCache().serverStatuses?.["srv1"];
    expect(entry).toEqual({ status: "connected", at: expect.any(Number) });
    expect("error" in (entry ?? {})).toBe(false);
  });

  it("keeps other servers' outcomes on re-record (read-merge-write)", () => {
    recordServerOutcome("srv1", "connected");
    recordServerOutcome("srv2", "error", "boom");
    const statuses = loadMetadataCache().serverStatuses ?? {};
    expect(statuses["srv1"]?.status).toBe("connected");
    expect(statuses["srv2"]?.status).toBe("error");
  });

  it("is idempotent per server (last write wins)", () => {
    recordServerOutcome("srv1", "connected");
    recordServerOutcome("srv1", "error", "ECONNREFUSED");
    expect(loadMetadataCache().serverStatuses?.["srv1"]?.status).toBe("error");
  });
});

describe("serverStatuses round-trip (ADR 0004 data-loss trap)", () => {
  it("saveServerCache preserves a previously recorded outcome", () => {
    recordServerOutcome("srv1", "needs-auth", "unauthorized");
    saveServerCache("srv1", baseStdioDef, { tools: [{ name: "t1", inputSchema: {} }], resources: [] });
    const cache = loadMetadataCache();
    expect(cache.serverStatuses?.["srv1"]?.status).toBe("needs-auth");
    expect(cache.servers["srv1"]).toBeDefined();
  });

  it("recordServerOutcome preserves previously saved server entries", () => {
    saveServerCache("srv1", baseStdioDef, { tools: [{ name: "t1", inputSchema: {} }], resources: [] });
    recordServerOutcome("srv1", "connected");
    expect(getCachedTools("srv1", baseStdioDef)).toEqual([{ name: "t1", inputSchema: {} }]);
  });

  it("both fields survive alternating save/record cycles", () => {
    recordServerOutcome("srv1", "error", "one");
    saveServerCache("srv2", baseHttpDef, { tools: [], resources: [] });
    recordServerOutcome("srv2", "needs-auth");
    saveServerCache("srv1", baseStdioDef, { tools: [], resources: [] });
    const cache = loadMetadataCache();
    expect(cache.serverStatuses?.["srv1"]?.status).toBe("error");
    expect(cache.serverStatuses?.["srv2"]?.status).toBe("needs-auth");
    expect(Object.keys(cache.servers).sort()).toEqual(["srv1", "srv2"]);
  });

  it("loads serverStatuses from a hand-written file (backwards-compatible load)", () => {
    writeFileSync(
      cachePath,
      JSON.stringify({
        version: CACHE_VERSION,
        servers: {},
        serverStatuses: { srv1: { status: "needs-auth", at: Date.now() - 60_000 } },
      }),
      "utf-8",
    );
    expect(loadMetadataCache().serverStatuses?.["srv1"]?.status).toBe("needs-auth");
  });

  it("still loads a legacy file without serverStatuses", () => {
    writeFileSync(cachePath, JSON.stringify({ version: CACHE_VERSION, servers: {} }), "utf-8");
    const cache = loadMetadataCache();
    expect(cache).toEqual({ version: CACHE_VERSION, servers: {} });
    expect(cache.serverStatuses).toBeUndefined();
  });

  it("drops malformed individual entries instead of crashing", () => {
    writeFileSync(
      cachePath,
      JSON.stringify({
        version: CACHE_VERSION,
        servers: {},
        serverStatuses: {
          good: { status: "connected", at: 123 },
          badStatus: { status: "bogus", at: 123 },
          noAt: { status: "connected" },
        },
      }),
      "utf-8",
    );
    expect(Object.keys(loadMetadataCache().serverStatuses ?? {})).toEqual(["good"]);
  });
});

describe("getCachedTools", () => {
  it("returns cached tools for a valid entry", () => {
    const tools = [{ name: "t1", description: "d", inputSchema: {} }];
    saveServerCache("srv1", baseStdioDef, { tools, resources: [], prompts: [] });
    expect(getCachedTools("srv1", baseStdioDef)).toEqual(tools);
  });

  it("returns undefined when the entry is stale (hash mismatch)", () => {
    saveServerCache("srv1", baseStdioDef, { tools: [], resources: [], prompts: [] });
    const changed: ServerDef = { ...baseStdioDef, command: "python3" };
    expect(getCachedTools("srv1", changed)).toBeUndefined();
  });

  it("returns undefined when the entry is older than CACHE_MAX_AGE_MS", () => {
    saveServerCache("srv1", baseStdioDef, { tools: [], resources: [], prompts: [] });
    // Age the entry directly on disk
    const cache = loadMetadataCache();
    const entry = cache.servers["srv1"];
    if (entry) entry.cachedAt = Date.now() - CACHE_MAX_AGE_MS - 1;
    writeFileSync(cachePath, JSON.stringify(cache), "utf-8");
    expect(getCachedTools("srv1", baseStdioDef)).toBeUndefined();
  });

  it("returns undefined when the server is not in the cache", () => {
    expect(getCachedTools("missing", baseStdioDef)).toBeUndefined();
  });
});

describe("cache path override", () => {
  it("honors the MCP_CACHE_PATH env var when no test path is set", () => {
    const envPath = join(tempDir, "env-cache.json");
    setCachePathForTest(null);
    process.env.MCP_CACHE_PATH = envPath;
    try {
      saveServerCache("srv1", baseStdioDef, { tools: [], resources: [], prompts: [] });
      expect(readFileSync(envPath, "utf-8")).toContain("srv1");
      expect(getCachedTools("srv1", baseStdioDef)).toEqual([]);
    } finally {
      delete process.env.MCP_CACHE_PATH;
      setCachePathForTest(cachePath);
    }
  });
});
