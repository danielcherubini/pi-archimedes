import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ServerDef, MetadataCache, ServerCacheEntry, CachedTool, ServerOutcomeRecord } from "./types.js";
import { CACHE_VERSION, CACHE_MAX_AGE_MS } from "./types.js";
import type { ServerStatus } from "./server-client.js";

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

function isServerOutcomeRecord(v: unknown): v is ServerOutcomeRecord {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    (o.status === "connected" || o.status === "needs-auth" || o.status === "error") &&
    typeof o.at === "number" &&
    (o.error === undefined || typeof o.error === "string")
  );
}

/** Keep only well-formed outcome entries; a garbage field must not sink the whole cache. */
function sanitizeServerStatuses(raw: unknown): Record<string, ServerOutcomeRecord> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const kept: Record<string, ServerOutcomeRecord> = {};
  for (const [name, v] of Object.entries(raw)) {
    if (isServerOutcomeRecord(v)) kept[name] = v;
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** Load the metadata cache; returns an empty valid structure on missing/corrupt file or version mismatch. */
export function loadMetadataCache(): MetadataCache {
  const path = cachePath();
  if (!existsSync(path)) return emptyCache();
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (typeof raw !== "object" || raw === null) return emptyCache();
    const obj = raw as { version?: unknown; servers?: unknown; [key: string]: unknown };
    if (
      obj.version !== CACHE_VERSION ||
      typeof obj.servers !== "object" ||
      obj.servers === null ||
      Array.isArray(obj.servers)
    ) {
      return emptyCache();
    }
    const cache: MetadataCache = {
      version: CACHE_VERSION,
      servers: obj.servers as Record<string, ServerCacheEntry>,
    };
    // ADR 0004 round-trip: preserve the persisted connection outcomes. The
    // pre-fix reconstruction dropped this field, so every saveServerCache
    // rewrite silently erased it (the data-loss trap).
    const statuses = sanitizeServerStatuses(obj.serverStatuses);
    if (statuses !== undefined) cache.serverStatuses = statuses;
    return cache;
  } catch {
    return emptyCache();
  }
}

/** Atomic write: tmp file + rename in the same directory. */
function writeCacheFile(cache: MetadataCache): void {
  const path = cachePath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf-8");
  renameSync(tmp, path);
}

/**
 * Read-merge-write: merge one server's entry into the on-disk cache.
 * Any `serverStatuses` present in the on-disk file survive the rewrite
 * (ADR 0004 round-trip — the load+save paths must never drop each other's
 * field). Atomic via tmp file + rename in the same directory.
 */
export function saveServerCache(
  serverName: string,
  def: ServerDef,
  entry: Omit<ServerCacheEntry, "configHash" | "cachedAt">,
): void {
  const cache = loadMetadataCache();
  cache.servers = {
    ...cache.servers,
    [serverName]: {
      ...entry,
      configHash: computeServerHash(def),
      cachedAt: Date.now(),
    },
  };
  writeCacheFile(cache);
}

/**
 * The SINGLE recorder for persisted connection outcomes (ADR 0004).
 * Every connection settle point (session_start background probe, on-demand
 * connect, reconnect) calls this — never touches the cache file directly,
 * so the write path stays in one place. Best-effort: a cache write failure
 * must never break the settle itself (same convention as saveServerCache).
 */
export function recordServerOutcome(
  serverName: string,
  status: ServerOutcomeRecord["status"],
  error?: string,
): void {
  try {
    const cache = loadMetadataCache();
    const entry: ServerOutcomeRecord = { status, at: Date.now() };
    // Status lines are single-line; multi-line errors keep their first line
    const firstLine = error?.split("\n")[0]?.trim();
    if (firstLine !== undefined && firstLine.length > 0) entry.error = firstLine;
    cache.serverStatuses = { ...(cache.serverStatuses ?? {}), [serverName]: entry };
    writeCacheFile(cache);
  } catch (e) {
    console.warn(
      `[archimedes/mcp] Failed to record outcome for "${serverName}": ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Settle-point convenience: map a finished ServerClient onto its recorded
 * outcome. A client that is "disconnected"/"connecting" has no verified
 * outcome (e.g. a generation-fenced connect that resolved empty) — nothing
 * is recorded for those.
 */
export function recordClientOutcome(client: { name: string; status: ServerStatus; error: string | null }): void {
  if (client.status !== "connected" && client.status !== "needs-auth" && client.status !== "error") return;
  recordServerOutcome(client.name, client.status, client.error ?? undefined);
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

/** Get cached prompts for a server if the cache is valid for the current def, else undefined */
export function getCachedPrompts(
  serverName: string,
  def: ServerDef,
): Array<{ name: string; description?: string }> | undefined {
  const entry = loadMetadataCache().servers[serverName];
  if (!entry || !isServerCacheValid(def, entry)) return undefined;
  return entry.prompts;
}
