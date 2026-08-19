/**
 * OAuth credential storage backed by the OS keyring.
 *
 * Tokens are persisted via @napi-rs/keyring (macOS Keychain, Windows
 * Credential Manager, or the Linux Secret Service). Storage is fail-closed:
 * when the credential store is unavailable (no libsecret, headless session,
 * revoked keyring) every operation throws a clear error — there is never a
 * plaintext fallback.
 *
 * Windows Credential Manager caps each value at 1280 characters, so payloads
 * over {@link AUTH_SECRET_CHUNK_SIZE} are split into 1000-char chunks:
 *   - chunk i → account `<account>.chunk.<digest>.<i>`
 *   - main account → manifest `{ __chunks: 1, chunkCount, chunkDigest }`
 * where `digest` is the first 16 hex chars of sha256(payload). Overwrites and
 * deletes remove stale chunks from the previous group (known from the
 * previous manifest, or defensibly from the previous plain payload's own
 * digest when no manifest is present).
 */

import { createHash } from "node:crypto";

import { Entry } from "@napi-rs/keyring";

import type { AuthEntry } from "./oauth-types.js";

/**
 * Service name for all auth entries. Deliberately different from the
 * reference adapter's `pi-mcp-adapter.oauth` so both adapters can coexist
 * on the same machine.
 */
const AUTH_SECRET_SERVICE = "pi-archimedes-mcp.oauth";

/** Windows Credential Manager value cap is 1280 chars; keep headroom. */
const AUTH_SECRET_CHUNK_SIZE = 1000;

/** Marker on the manifest JSON stored at the main account for chunked payloads. */
const AUTH_CHUNK_MANIFEST_KEY = "__chunks";

const UNAVAILABLE_MESSAGE =
  "OS credential store unavailable — cannot store OAuth tokens securely";

interface ChunkManifest {
  __chunks: 1;
  chunkCount: number;
  chunkDigest: string;
}

/** A group of chunk accounts that a main-account payload may reference. */
interface ChunkGroup {
  digest: string;
  count: number;
}

// In-memory cache keyed by server name. Caches both presence and absence so
// the SDK's per-request token reads don't hammer the credential daemon.
// save/delete update it explicitly; out-of-process changes are not observed
// until the process restarts.
const authEntryCache = new Map<string, AuthEntry | undefined>();

function cloneAuthEntry(entry: AuthEntry | undefined): AuthEntry | undefined {
  return entry === undefined ? undefined : structuredClone(entry);
}

/** Deterministic per-server account: `sha256-<hex sha256 of serverName>`. */
function getAuthEntryAccount(serverName: string): string {
  return `sha256-${createHash("sha256").update(serverName, "utf8").digest("hex")}`;
}

function getChunkAccount(account: string, chunkDigest: string, index: number): string {
  return `${account}.chunk.${chunkDigest}.${index}`;
}

/** First 16 hex chars of sha256(payload) — identifies a chunk group. */
function digestPayload(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 16);
}

function chunkCountForPayload(payload: string): number {
  return Math.ceil(payload.length / AUTH_SECRET_CHUNK_SIZE);
}

/**
 * A main-account payload's chunk group. A manifest references its own
 * chunkDigest/count; a plain payload references no chunks of its own, but
 * grouping it under (its own digest, ceil(len/CHUNK_SIZE)) lets overwrites
 * and deletes defensively sweep orphans when no manifest is present.
 */
function chunkGroupForPayload(payload: string): ChunkGroup {
  const manifest = parseManifest(payload);
  if (manifest) {
    return { digest: manifest.chunkDigest, count: manifest.chunkCount };
  }
  return { digest: digestPayload(payload), count: chunkCountForPayload(payload) };
}

function removeChunkGroup(account: string, group: ChunkGroup): void {
  for (let i = 0; i < group.count; i++) {
    removeSecret(getChunkAccount(account, group.digest, i));
  }
}

/**
 * Classify an error thrown by Entry.getPassword() as "entry absent".
 *
 * @napi-rs/keyring v1.3.0 never throws from the read path — its Rust
 * `get_password()` is `inner.get_password().ok()`, so a missing entry is
 * the `null` return handled in {@link readSecret}. This is therefore a
 * DEFENSIVE fallback for backends (or future versions) that throw on miss.
 *
 * The patterns are the specific "item absent" phrasings of this stack —
 * keyring-core's canonical `NoEntry` message ("No matching credential
 * found"), plus narrow legacy equivalents. Deliberately EXCLUDED because
 * they appear in genuine store failures that must stay fail-closed:
 * bare "no such" ("No such file or directory (os error 2)"), bare
 * "not found" (D-Bus "Match rule not found"), and generic "missing".
 *
 * Accepted false-positive tradeoff: if a genuine store failure on the READ
 * path coincidentally contains one of these phrasings, it is misclassified
 * as "no entry" — getAuthEntry returns undefined and the user re-auths
 * (fail-open on read only). The write and delete paths never run this
 * classification and remain fail-closed (removeSecret is deliberately
 * best-effort by design).
 */
function isMissingEntryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no matching credential found|does not exist|no such entry|no entry/i.test(message);
}

function unavailableError(cause?: unknown): Error {
  return new Error(UNAVAILABLE_MESSAGE, cause ? { cause } : undefined);
}

/**
 * Read a secret. Returns undefined when the entry does not exist. Throws
 * {@link UNAVAILABLE_MESSAGE} when the keyring itself is inaccessible.
 */
function readSecret(account: string): string | undefined {
  let entry: Entry;
  try {
    entry = new Entry(AUTH_SECRET_SERVICE, account);
  } catch (error) {
    throw unavailableError(error);
  }
  try {
    // @napi-rs/keyring v1.3.0 returns null for a missing entry and never
    // throws from the read path — the catch below is a defensive fallback
    // for backends that do throw on miss (see isMissingEntryError).
    const password = entry.getPassword();
    return password === null || password === undefined ? undefined : password;
  } catch (error) {
    if (isMissingEntryError(error)) return undefined;
    throw unavailableError(error);
  }
}

function writeSecret(account: string, password: string): void {
  let entry: Entry;
  try {
    entry = new Entry(AUTH_SECRET_SERVICE, account);
  } catch (error) {
    throw unavailableError(error);
  }
  try {
    entry.setPassword(password);
  } catch (error) {
    throw unavailableError(error);
  }
}

/** Best-effort delete for stale chunks: a missing entry must not fail the caller. */
function removeSecret(account: string): void {
  try {
    new Entry(AUTH_SECRET_SERVICE, account).deletePassword();
  } catch {
    // Missing entry (or transiently unavailable store) — best-effort cleanup.
  }
}

/** Parse a main-account payload as a chunk manifest, if it is one. */
function parseManifest(payload: string): ChunkManifest | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const candidate = parsed as Partial<ChunkManifest> & Record<string, unknown>;
  if (candidate[AUTH_CHUNK_MANIFEST_KEY] !== 1) return undefined;
  if (
    typeof candidate.chunkCount !== "number" ||
    !Number.isInteger(candidate.chunkCount) ||
    candidate.chunkCount <= 0
  ) {
    return undefined;
  }
  if (typeof candidate.chunkDigest !== "string" || candidate.chunkDigest.length === 0) {
    return undefined;
  }
  return candidate as ChunkManifest;
}

function parseAuthEntry(payload: string): AuthEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error(`Corrupt OAuth entry in the OS credential store: payload is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Corrupt OAuth entry in the OS credential store: payload is not a JSON object`);
  }
  return parsed as AuthEntry;
}

/** Read every chunk of a manifest group and reassemble the payload in order. */
function readChunkedEntry(account: string, manifest: ChunkManifest): AuthEntry {
  let payload = "";
  for (let i = 0; i < manifest.chunkCount; i++) {
    const chunk = readSecret(getChunkAccount(account, manifest.chunkDigest, i));
    if (chunk === undefined) {
      throw new Error(
        `Corrupt OAuth entry in the OS credential store: missing chunk ${i} of ${manifest.chunkCount}`,
      );
    }
    payload += chunk;
  }
  return parseAuthEntry(payload);
}

/**
 * Read the stored auth entry for a server. Returns undefined when the server
 * has no stored entry. Throws when the credential store is unavailable
 * (fail-closed) or the stored payload is corrupt.
 */
export function getAuthEntry(serverName: string): AuthEntry | undefined {
  if (authEntryCache.has(serverName)) {
    return cloneAuthEntry(authEntryCache.get(serverName));
  }

  const account = getAuthEntryAccount(serverName);
  const payload = readSecret(account);
  let entry: AuthEntry | undefined;
  if (payload !== undefined) {
    const manifest = parseManifest(payload);
    entry = manifest
      ? readChunkedEntry(account, manifest)
      : parseAuthEntry(payload);
  }

  // Cache the result — presence AND absence — to short-circuit later reads.
  authEntryCache.set(serverName, entry);
  return cloneAuthEntry(entry);
}

/**
 * Persist the auth entry for a server, chunking large payloads. Replaces any
 * previously stored entry and removes its stale chunks. Throws when the
 * credential store is unavailable (fail-closed, no plaintext fallback).
 */
export function saveAuthEntry(serverName: string, entry: AuthEntry, serverUrl?: string): void {
  if (serverUrl) entry.serverUrl = serverUrl;

  const account = getAuthEntryAccount(serverName);
  const payload = JSON.stringify(entry);

  // Read the previous state before overwriting: a newer smaller payload
  // replaces the manifest, so the old chunk group must be learned from the
  // previous main-account content while it is still readable.
  const previousPayload = readSecret(account);
  const previousGroup =
    previousPayload !== undefined ? chunkGroupForPayload(previousPayload) : undefined;

  const newGroup: ChunkGroup | undefined =
    payload.length > AUTH_SECRET_CHUNK_SIZE
      ? { digest: digestPayload(payload), count: chunkCountForPayload(payload) }
      : undefined;

  try {
    if (newGroup) {
      const manifest: ChunkManifest = {
        __chunks: 1,
        chunkCount: newGroup.count,
        chunkDigest: newGroup.digest,
      };
      for (let i = 0; i < newGroup.count; i++) {
        writeSecret(
          getChunkAccount(account, newGroup.digest, i),
          payload.slice(i * AUTH_SECRET_CHUNK_SIZE, (i + 1) * AUTH_SECRET_CHUNK_SIZE),
        );
      }
      // Manifest last: a crash mid-write leaves the previous consistent state.
      writeSecret(account, JSON.stringify(manifest));
    } else {
      writeSecret(account, payload);
    }
  } catch (error) {
    // Incomplete write: clean up any chunks of the new group already written.
    if (newGroup) removeChunkGroup(account, newGroup);
    throw error;
  }

  // Stale-chunk cleanup: only when the chunk group changed. Equal digests
  // mean an identical payload, whose chunks, if any, were just rewritten.
  const newDigest = newGroup ? newGroup.digest : digestPayload(payload);
  if (previousGroup && previousGroup.digest !== newDigest) {
    removeChunkGroup(account, previousGroup);
  }

  authEntryCache.set(serverName, cloneAuthEntry(entry));
}

/**
 * Delete the stored auth entry for a server: manifest, all of its chunks,
 * and the main account. Idempotent for servers that were never saved.
 * Throws when the credential store is unavailable (fail-closed).
 */
export function deleteAuthEntry(serverName: string): void {
  const account = getAuthEntryAccount(serverName);

  const payload = readSecret(account);
  if (payload !== undefined) {
    removeChunkGroup(account, chunkGroupForPayload(payload));
  }
  removeSecret(account);

  authEntryCache.delete(serverName);
}
