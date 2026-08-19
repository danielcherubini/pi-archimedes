import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthEntry } from "./oauth-types.js";

/**
 * Mock semantics mirrored from the real @napi-rs/keyring 1.3.0 native
 * binding (verified against the hoisted module and the binding source at
 * the published gitHead):
 * - `getPassword()` returns `null` for a missing entry and never throws in
 *   v1.3.0 (`throwGetMessage` below simulates a backend that DOES throw on
 *   miss, exercising the defensive classification branch).
 * - `setPassword()` stores/overwrites; `deletePassword()` returns a boolean.
 * - When the OS store is down (no libsecret / headless), entry construction
 *   throws — `keyring.unavailable` simulates that.
 */
const keyring = vi.hoisted(() => ({
  /** `${service}\u0000${account}` → password */
  entries: new Map<string, string>(),
  unavailable: false,
  /** When set, `getPassword()` throws `new Error(throwGetMessage)` instead of returning. */
  throwGetMessage: null as string | null,
}));

vi.mock("@napi-rs/keyring", () => {
  class Entry {
    service: string;
    account: string;

    constructor(service: string, account: string) {
      if (keyring.unavailable) {
        throw new Error("Secret Service is not running");
      }
      this.service = service;
      this.account = account;
    }

    getPassword(): string | null {
      if (keyring.unavailable) {
        throw new Error("Secret Service is not running");
      }
      if (keyring.throwGetMessage !== null) {
        throw new Error(keyring.throwGetMessage);
      }
      return keyring.entries.get(`${this.service}\u0000${this.account}`) ?? null;
    }

    setPassword(password: string): void {
      if (keyring.unavailable) {
        throw new Error("Secret Service is not running");
      }
      keyring.entries.set(`${this.service}\u0000${this.account}`, password);
    }

    deletePassword(): boolean {
      if (keyring.unavailable) {
        throw new Error("Secret Service is not running");
      }
      return keyring.entries.delete(`${this.service}\u0000${this.account}`);
    }
  }
  return { Entry };
});

// Import after mocks are set up (the module under test holds an in-memory
// cache, so tests below use a unique server name each for independence).
const { deleteAuthEntry, getAuthEntry, saveAuthEntry } = await import("./auth-storage.js");

const SERVICE = "pi-archimedes-mcp.oauth";
const UNAVAILABLE_MESSAGE =
  "OS credential store unavailable — cannot store OAuth tokens securely";

function expectedAccount(serverName: string): string {
  return `sha256-${createHash("sha256").update(serverName, "utf8").digest("hex")}`;
}

function storeKeys(serverName: string): string[] {
  const account = expectedAccount(serverName);
  return Array.from(keyring.entries.keys()).filter((key) => {
    const field = key.slice(key.indexOf("\u0000") + 1);
    return field === account || field.startsWith(`${account}.chunk.`);
  });
}

/**
 * Write a raw string directly into the main account, simulating a payload
 * corrupted out-of-process (or hand-tampered) without going through
 * saveAuthEntry's JSON.stringify.
 */
function seedRawMain(serverName: string, raw: string): void {
  keyring.entries.set(`${SERVICE}\u0000${expectedAccount(serverName)}`, raw);
}

/** Write a raw string directly into one chunk account of a manifest group. */
function seedRawChunk(serverName: string, chunkDigest: string, index: number, raw: string): void {
  const account = expectedAccount(serverName);
  keyring.entries.set(`${SERVICE}\u0000${account}.chunk.${chunkDigest}.${index}`, raw);
}

function smallEntry(): AuthEntry {
  return {
    tokens: {
      accessToken: "at_access",
      refreshToken: "ot_refresh",
      expiresAt: 1_893_456_000,
      scope: "read:crossplane",
    },
    clientInfo: { clientId: "client-123" },
  };
}

function bigEntry(tokenChar: string): AuthEntry {
  return { tokens: { accessToken: tokenChar.repeat(4500) } };
}

beforeEach(() => {
  keyring.entries.clear();
  keyring.unavailable = false;
  keyring.throwGetMessage = null;
});

describe("auth-storage", () => {
  it("stores under the fixed service name and the sha256-hashed account", () => {
    const entry = smallEntry();
    saveAuthEntry("atlassian", entry);

    expect(keyring.entries.size).toBe(1);
    expect(keyring.entries.get(`${SERVICE}\u0000${expectedAccount("atlassian")}`)).toBe(
      JSON.stringify(entry),
    );
  });

  it("round-trips a small entry through save and get", () => {
    const entry = smallEntry();
    saveAuthEntry("notion", entry);
    expect(getAuthEntry("notion")).toEqual(entry);
  });

  it("returns undefined for a server with no stored entry", () => {
    expect(getAuthEntry("ghost")).toBeUndefined();
  });

  it("records the serverUrl when provided", () => {
    saveAuthEntry("github", smallEntry(), "https://api.githubcopilot.com/mcp");
    expect(getAuthEntry("github")?.serverUrl).toBe("https://api.githubcopilot.com/mcp");
  });

  it("chunks payloads over 1000 chars into indexed chunks plus a manifest", () => {
    const entry = bigEntry("A");
    saveAuthEntry("linear", entry);

    const payload = JSON.stringify(entry);
    const digest = createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 16);
    const count = Math.ceil(payload.length / 1000);
    expect(count).toBeGreaterThan(1);

    // Main account holds the manifest, not the payload.
    const manifest = JSON.parse(keyring.entries.get(`${SERVICE}\u0000${expectedAccount("linear")}`)!);
    expect(manifest).toEqual({ __chunks: 1, chunkCount: count, chunkDigest: digest });

    // Each chunk lives at <account>.chunk.<digest>.<index>.
    for (let i = 0; i < count; i++) {
      expect(keyring.entries.get(`${SERVICE}\u0000${expectedAccount("linear")}.chunk.${digest}.${i}`)).toBe(
        payload.slice(i * 1000, (i + 1) * 1000),
      );
    }
    expect(storeKeys("linear")).toHaveLength(count + 1);

    // Reads reassemble the chunks in order.
    expect(getAuthEntry("linear")).toEqual(entry);
  });

  it("cleans stale chunks when a chunked entry is overwritten with a small one", () => {
    const big = bigEntry("B");
    saveAuthEntry("asana", big);
    const bigDigest = createHash("sha256")
      .update(JSON.stringify(big), "utf8")
      .digest("hex")
      .slice(0, 16);
    expect(storeKeys("asana").some((key) => key.includes(bigDigest))).toBe(true);

    const small = smallEntry();
    saveAuthEntry("asana", small);

    expect(storeKeys("asana")).toEqual([`${SERVICE}\u0000${expectedAccount("asana")}`]);
    expect(getAuthEntry("asana")).toEqual(small);
  });

  it("leaves no stale chunks when a small entry is overwritten with a chunked one", () => {
    const small = smallEntry();
    saveAuthEntry("slack", small);

    const big = bigEntry("C");
    saveAuthEntry("slack", big);

    const digest = createHash("sha256").update(JSON.stringify(big), "utf8").digest("hex").slice(0, 16);
    const count = Math.ceil(JSON.stringify(big).length / 1000);
    expect(storeKeys("slack")).toHaveLength(count + 1);
    expect(storeKeys("slack").every((key) => key.includes(digest) || !key.includes(".chunk."))).toBe(
      true,
    );
    expect(getAuthEntry("slack")).toEqual(big);
  });

  it("deletes the manifest and every chunk", () => {
    saveAuthEntry("jira", bigEntry("D"));
    expect(storeKeys("jira").length).toBeGreaterThan(1);

    deleteAuthEntry("jira");

    expect(storeKeys("jira")).toEqual([]);
    expect(keyring.entries.size).toBe(0);
    expect(getAuthEntry("jira")).toBeUndefined();
  });

  it("delete is a no-op for a server that was never saved", () => {
    expect(() => deleteAuthEntry("never-existed")).not.toThrow();
    expect(keyring.entries.size).toBe(0);
  });

  it("throws the clear unavailable error on save, never falling back to plaintext", () => {
    keyring.unavailable = true;
    expect(() => saveAuthEntry("hellobix", smallEntry())).toThrow(UNAVAILABLE_MESSAGE);
    // Fail-closed: nothing was written anywhere (no plaintext fallback).
    expect(keyring.entries.size).toBe(0);
  });

  it("throws the clear unavailable error on get", () => {
    keyring.unavailable = true;
    expect(() => getAuthEntry("intercom")).toThrow(UNAVAILABLE_MESSAGE);
  });

  it("throws the clear unavailable error on delete", () => {
    keyring.unavailable = true;
    expect(() => deleteAuthEntry("miro")).toThrow(UNAVAILABLE_MESSAGE);
  });

  it("clones on get so a caller cannot mutate the cached entry", () => {
    const entry = smallEntry();
    saveAuthEntry("figma", entry);

    const first = getAuthEntry("figma")!;
    first.tokens!.accessToken = "MUTATED";

    const second = getAuthEntry("figma")!;
    expect(second).not.toBe(first);
    expect(second).toEqual(entry);
  });

  it("keeps storage isolated per server name", () => {
    saveAuthEntry("alpha", { tokens: { accessToken: "alpha-token" } });
    saveAuthEntry("beta", { tokens: { accessToken: "beta-token" } });

    expect(getAuthEntry("alpha")).toEqual({ tokens: { accessToken: "alpha-token" } });
    expect(getAuthEntry("beta")).toEqual({ tokens: { accessToken: "beta-token" } });

    deleteAuthEntry("alpha");

    expect(storeKeys("alpha")).toEqual([]);
    expect(getAuthEntry("alpha")).toBeUndefined();
    expect(getAuthEntry("beta")).toEqual({ tokens: { accessToken: "beta-token" } });
  });

  describe("defensive read path when the backend throws on miss", () => {
    it.each([
      // Canonical keyring-core NoEntry message — every store routes a
      // missing credential through it.
      "No matching credential found",
      // "does not exist" backends.
      "Item does not exist",
      // Narrow specific miss phrasings.
      "No such entry",
      "no entry available for account",
    ])("treats a thrown %j as a missing entry: getAuthEntry returns undefined without throwing", (message) => {
      keyring.throwGetMessage = message;
      let value: AuthEntry | undefined;
      expect(() => {
        value = getAuthEntry("fastly");
      }).not.toThrow();
      expect(value).toBeUndefined();
    });

    it("does NOT misclassify a generic store failure containing 'no such' as a missing entry", () => {
      // "No such file or directory (os error 2)" is a real file-backed store
      // failure, not an absent entry: fail-closed UNAVAILABLE must propagate.
      keyring.throwGetMessage = "No such file or directory (os error 2)";
      expect(() => getAuthEntry("huggingface")).toThrow(UNAVAILABLE_MESSAGE);
    });

    it("does NOT misclassify a D-Bus 'not found' failure as a missing entry", () => {
      // "Match rule not found" is a real bus failure, not an absent entry.
      keyring.throwGetMessage = "Match rule not found";
      expect(() => getAuthEntry("canva")).toThrow(UNAVAILABLE_MESSAGE);
    });

    it("propagates UNAVAILABLE for a generic store failure with no miss wording", () => {
      keyring.throwGetMessage = "keyring daemon unreachable";
      expect(() => getAuthEntry("netflix")).toThrow(UNAVAILABLE_MESSAGE);
    });
  });

  describe("corrupt stored payloads fail closed on read", () => {
    it("throws a clear error when the main-account payload is not valid JSON", () => {
      seedRawMain("corrupt-nonjson", "not-json{");
      expect(() => getAuthEntry("corrupt-nonjson")).toThrow(
        "Corrupt OAuth entry in the OS credential store: payload is not valid JSON",
      );
    });

    it("throws a clear not-an-object error when the payload is a JSON array", () => {
      seedRawMain("corrupt-json-array", "[1,2]");
      expect(() => getAuthEntry("corrupt-json-array")).toThrow(
        "Corrupt OAuth entry in the OS credential store: payload is not a JSON object",
      );
    });

    it("throws a clear not-an-object error when the payload is a JSON string", () => {
      seedRawMain("corrupt-json-string", JSON.stringify("a scalar is not an object"));
      expect(() => getAuthEntry("corrupt-json-string")).toThrow(
        "Corrupt OAuth entry in the OS credential store: payload is not a JSON object",
      );
    });

    it("throws a clear missing-chunk error when a referenced chunk account is absent", () => {
      const digest = "0123456789abcdef";
      seedRawMain(
        "corrupt-missing-chunk",
        JSON.stringify({ __chunks: 1, chunkCount: 2, chunkDigest: digest }),
      );
      // Only chunk 0 exists — chunk 1 was deleted (or lost) out-of-process.
      seedRawChunk("corrupt-missing-chunk", digest, 0, "{\"tokens\":{\"accessToken\":\"part");

      expect(() => getAuthEntry("corrupt-missing-chunk")).toThrow(
        "Corrupt OAuth entry in the OS credential store: missing chunk 1 of 2",
      );
    });
  });
});
