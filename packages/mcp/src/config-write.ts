import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stripJsonComments } from "./config.js";
import type { ServerDef } from "./types.js";

/**
 * Safe write-back helpers for the project-local Pi override file
 * `<cwd>/<CONFIG_DIR_NAME>/mcp.json` (ADR 0002: the /mcp command and the
 * management panel only ever write the single changed field here).
 *
 * Security rules:
 * - Only ONE field is ever added (`disabled` or `directTools`) — under
 *   `mcpServers[serverName]`. No other field is ever read into these
 *   helpers and written out, so credentials are never copied.
 * - The read is tolerant (`//` comments via `stripJsonComments`, trailing
 *   comma, missing/empty file → `{ mcpServers: {} }`), but a file that
 *   doesn't parse is REFUSED (throw) rather than silently overwritten —
 *   clobbering an unknown/corrupt file could destroy credentials.
 * - The write is atomic: tmp file in the same dir, then rename over the
 *   target (same pattern as `@pi-archimedes/core` settings-io).
 */

/** Parsed override document; extra top-level keys are preserved as-is. */
type McpOverrideDoc = Record<string, unknown> & { mcpServers: Record<string, Record<string, unknown>> };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Atomic write of a JSON document: tmp file in the SAME dir as the target,
 * then rename over the target. 2-space indent + trailing newline. The
 * parent dir is created (recursive) when missing. Named path (not cwd+
 * config file) so both the override writer above, the project writer below,
 * and outside callers (setup-panel scaffold) share this exact pattern.
 * On a failed rename the tmp file is removed before re-throwing.
 */
export function writeJsonFileAtomic(path: string, doc: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  const json = JSON.stringify(doc, null, 2) + "\n";
  writeFileSync(tmp, json, "utf-8");
  try {
    renameSync(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw e;
  }
}

function configPath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, "mcp.json");
}

/**
 * Read the project-local override file into a doc object.
 * Missing or empty file → `{ mcpServers: {} }`. Unparseable or
 * wrongly-shaped file → throw (never clobber data we cannot understand).
 */
function readDoc(cwd: string): McpOverrideDoc {
  const path = configPath(cwd);
  if (!existsSync(path)) return { mcpServers: {} };
  const raw = readFileSync(path, "utf-8");
  if (raw.trim() === "") return { mcpServers: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(raw));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`[archimedes/mcp] Refusing to overwrite ${path} — unparseable JSON: ${msg}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`[archimedes/mcp] Refusing to overwrite ${path} — top level is not an object`);
  }
  const mcpServers = parsed.mcpServers;
  if (mcpServers !== undefined && !isPlainObject(mcpServers)) {
    throw new Error(`[archimedes/mcp] Refusing to overwrite ${path} — "mcpServers" is not an object`);
  }
  const servers: Record<string, Record<string, unknown>> = {};
  if (isPlainObject(mcpServers)) {
    for (const [name, def] of Object.entries(mcpServers)) {
      if (!isPlainObject(def)) {
        throw new Error(`[archimedes/mcp] Refusing to overwrite ${path} — "mcpServers.${name}" is not an object`);
      }
      servers[name] = def;
    }
  }
  return { ...parsed, mcpServers: servers };
}

/** Atomic write of the Pi override file (shared writer, `configPath` target). */
function writeDoc(cwd: string, doc: McpOverrideDoc): void {
  writeJsonFileAtomic(configPath(cwd), doc);
}

/**
 * Set one field on one server entry, read-modify-write. Existing fields of
 * that server, all other servers, and any extra top-level keys are preserved
 * untouched; the only bytes added are the single field being written.
 */
function writeServerField(cwd: string, serverName: string, field: "disabled" | "directTools", value: unknown): void {
  const doc = readDoc(cwd);
  const server = doc.mcpServers[serverName] ?? {};
  server[field] = value;
  doc.mcpServers[serverName] = server;
  writeDoc(cwd, doc);
}

/**
 * Write only `{ disabled }` for a server into `<cwd>/<CONFIG_DIR_NAME>/mcp.json`
 * (creating the dir and file if missing). Never copies credentials.
 */
export function writeServerDisabled(cwd: string, serverName: string, disabled: boolean): void {
  writeServerField(cwd, serverName, "disabled", disabled);
}

/**
 * Write only `{ directTools }` for a server into the same file.
 * `true` exposes all tools directly, `false` hides them, a `string[]`
 * exposes the named subset. Never copies credentials.
 */
export function writeServerDirectTools(cwd: string, serverName: string, value: true | false | string[]): void {
  writeServerField(cwd, serverName, "directTools", value);
}

// ── Project-shared file (<cwd>/.mcp.json) — server DEFINITIONS ──────────────
//
// Distinct from the Pi override file above: this is the project-shared
// `.mcp.json` (the layer `loadAllServerDefs` reads at working-dir precedence)
// where NEW server DEFINITIONS belong. Imported/known/scaffolded servers are
// merged IN here so they are discoverable by the normal config cascade.
//
// Read is tolerant (`//` comments / trailing comma / missing file → `{ mcpServers: {} }`)
// via `stripJsonComments`, but a file that doesn't parse is REFUSED (throw) for the
// same credential-safety reason as the override writer. The rewrite drops `//`
// comments in that file — an accepted trade-off: this file is machine-managed by
// the setup panel, so comment preservation is deliberately not enforced.

type McpProjectDoc = Record<string, unknown> & { mcpServers: Record<string, unknown> };

function projectConfigPath(cwd: string): string {
  return join(cwd, ".mcp.json");
}

/**
 * Read the project-shared `.mcp.json` into a doc object.
 * Missing/empty file → `{ mcpServers: {} }`. Unparseable or wrongly-shaped
 * file → throw (never clobber data we cannot understand).
 */
function readProjectDoc(cwd: string): McpProjectDoc {
  const path = projectConfigPath(cwd);
  if (!existsSync(path)) return { mcpServers: {} };
  const raw = readFileSync(path, "utf-8");
  if (raw.trim() === "") return { mcpServers: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(raw));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`[archimedes/mcp] Refusing to overwrite ${path} — unparseable JSON: ${msg}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`[archimedes/mcp] Refusing to overwrite ${path} — top level is not an object`);
  }
  const mcpServers = parsed.mcpServers;
  if (mcpServers !== undefined && !isPlainObject(mcpServers)) {
    throw new Error(`[archimedes/mcp] Refusing to overwrite ${path} — "mcpServers" is not an object`);
  }
  return { ...parsed, mcpServers: isPlainObject(mcpServers) ? mcpServers : {} };
}

/** Atomic write of the project-shared file (shared writer, `projectConfigPath` target). */
function writeProjectDoc(cwd: string, doc: McpProjectDoc): void {
  writeJsonFileAtomic(projectConfigPath(cwd), doc);
}

/**
 * Merge new server definitions into `<cwd>/.mcp.json` (project-shared, NOT
 * the Pi override file). Add-if-absent: an EXISTING entry for a given server
 * name is left completely untouched; all other top-level keys and all other
 * servers are preserved verbatim. Atomic tmp+rename, 2-space indent.
 */
export function mergeServerDefinitions(cwd: string, servers: Record<string, ServerDef>): void {
  const doc = readProjectDoc(cwd);
  for (const [name, def] of Object.entries(servers)) {
    if (doc.mcpServers[name] === undefined) {
      doc.mcpServers[name] = def;
    }
  }
  writeProjectDoc(cwd, doc);
}

/**
 * The server names currently defined in `<cwd>/.mcp.json` (empty list when
 * the file is absent or empty). Shares the same refuses-on-unparseable rule
 * as the writers — a corrupt file surfaces as an error instead of a guess.
 */
export function existingProjectServerNames(cwd: string): string[] {
  return Object.keys(readProjectDoc(cwd).mcpServers);
}
