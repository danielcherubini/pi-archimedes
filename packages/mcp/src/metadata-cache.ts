import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ServerDef, MetadataCache, ServerCacheEntry, CachedTool } from "./types.js";
import { CACHE_VERSION, CACHE_MAX_AGE_MS } from "./types.js";

/** Test override — null means "use MCP_CACHE_PATH env var or the default path" */
let testCachePath: string | null = null;

/**
 * Override the cache file path (for tests). Pass null to reset.
 * Tests must use this so the real ~/.pi/agent/mcp-cache.json is never touched.
 */
export function setCachePathForTest(path: string | null): void {
  testCachePath = path;
}

/** Default cache location: ~/.pi/agent/mcp-cache.json (MCP_CACHE_PATH overrides) */
function cachePath(): string {
  if (testCachePath) return testCachePath;
  const env = process.env.MCP_CACHE_PATH;
  if (env) return env;
  return join(getAgentDir(), "mcp-cache.json");
}

/**
 * Project a ServerDef to only the identity-affecting fields — the fields
 * that change WHAT the server is (connection + auth), not HOW it is managed.
 * ServerDef is a discriminated union — narrow via "command" in def / "url" in def
 * before accessing transport-specific fields. Runtime settings (lifecycle,
 * idleTimeout, debug, directTools, toolPrefix, requestTimeoutMs, disabled)
 * are deliberately excluded: changing them must not invalidate the cache.
 * Likewise excluded: protocolVersion (documented inert), exposeResources
 * (not yet implemented), and includeTools/excludeTools (they only filter
 * DIRECT-tool registration, never the cached tool list) — toggling any of
 * those must not invalidate the cache or trigger a client close+replace.
 */
function projectIdentity(def: ServerDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ("command" in def) {
    out.command = def.command;
    if (def.args !== undefined) out.args = def.args;
    if (def.env !== undefined) out.env = def.env;
    if (def.cwd !== undefined) out.cwd = def.cwd;
  }
  if ("url" in def) {
    out.url = def.url;
    if (def.auth !== undefined) out.auth = def.auth;
    if (def.headers !== undefined) out.headers = def.headers;
    if (def.bearerTokenEnv !== undefined) out.bearerTokenEnv = def.bearerTokenEnv;
  }
  return out;
}

/** Deterministic JSON: object keys sorted recursively, undefined values dropped */
function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const parts = Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
    return `{${parts.join(",")}}`;
  }
  // string / number / boolean
  return JSON.stringify(value) ?? "null";
}

/**
 * SHA-256 hex digest over the identity-affecting fields only, stable-stringified
 * (sorted keys) so key order in the config file does not change the hash.
 */
export function computeServerHash(def: ServerDef): string {
  return createHash("sha256")
    .update(stableStringify(projectIdentity(def)))
    .digest("hex");
}

function emptyCache(): MetadataCache {
  return { version: CACHE_VERSION, servers: {} };
}

/** Load the metadata cache; returns an empty valid structure on missing/corrupt file or version mismatch */
export function loadMetadataCache(): MetadataCache {
  const path = cachePath();
  if (!existsSync(path)) return emptyCache();
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (typeof raw !== "object" || raw === null) return emptyCache();
    const obj = raw as { version?: unknown; servers?: unknown };
    if (
      obj.version !== CACHE_VERSION ||
      typeof obj.servers !== "object" ||
      obj.servers === null ||
      Array.isArray(obj.servers)
    ) {
      return emptyCache();
    }
    return { version: CACHE_VERSION, servers: obj.servers as Record<string, ServerCacheEntry> };
  } catch {
    return emptyCache();
  }
}

/**
 * Read-merge-write: merge one server's entry into the on-disk cache.
 * Atomic via tmp file + rename in the same directory.
 */
export function saveServerCache(
  serverName: string,
  def: ServerDef,
  entry: Omit<ServerCacheEntry, "configHash" | "cachedAt">,
): void {
  const path = cachePath();
  const cache = loadMetadataCache();
  cache.servers[serverName] = {
    ...entry,
    configHash: computeServerHash(def),
    cachedAt: Date.now(),
  };
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf-8");
  renameSync(tmp, path);
}

/** True if the cache entry exists, its config hash matches, and it is not older than CACHE_MAX_AGE_MS */
export function isServerCacheValid(def: ServerDef, entry: ServerCacheEntry | undefined): boolean {
  if (!entry) return false;
  if (entry.configHash !== computeServerHash(def)) return false;
  return Date.now() - entry.cachedAt <= CACHE_MAX_AGE_MS;
}

/** Get cached tools for a server if the cache is valid for the current def, else undefined */
export function getCachedTools(serverName: string, def: ServerDef): CachedTool[] | undefined {
  const entry = loadMetadataCache().servers[serverName];
  if (!entry || !isServerCacheValid(def, entry)) return undefined;
  return entry.tools;
}
