import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFileSync } from "node:fs";
import { ServerClient, buildAuthHeaders } from "./server-client.js";
import { ServerManager } from "./server-manager.js";
import { setCachePathForTest } from "./metadata-cache.js";
import type { AuthStatus } from "./auth-flow.js";
import type { StdioServerDef, HttpServerDef } from "./types.js";

/**
 * Mocks the auth-flow module so ServerClient is exercised without the real
 * OAuth plumbing (keyring / SDK / callback server). `state` drives the
 * per-test behaviour of the two seam functions the client uses:
 * - `authenticate` → status or thrown cancel, per test
 * - `getValidToken` → the bearer token to attach (null = none)
 * `extractOAuthConfig` mirrors the real classification closely enough
 * (`"oauth"` → default config, static `{ token }` → null, other objects →
 * identity).
 */
const authFlow = vi.hoisted(() => {
  const state: {
    authenticateImpl: () => Promise<AuthStatus> | never;
    validToken: string | null;
  } = {
    authenticateImpl: async () => ({ status: "authenticated" }),
    validToken: null,
  };

  const extractOAuthConfig = vi.fn((auth: unknown): unknown => {
    if (auth === "oauth") return { grantType: "authorization_code" };
    if (typeof auth === "object" && auth !== null) {
      const rec = auth as Record<string, unknown>;
      if ("token" in rec) return null; // static bearer is not OAuth
      if (Object.keys(rec).length === 0) return null;
      return { ...rec };
    }
    return null;
  });

  const authenticate = vi.fn(async (): Promise<AuthStatus> => await state.authenticateImpl(),
  );

  const getValidToken = vi.fn(
    async (_name: string, _url: string): Promise<string | null> => state.validToken,
  );

  return { state, extractOAuthConfig, authenticate, getValidToken };
});

vi.mock("./auth-flow.js", () => ({
  extractOAuthConfig: authFlow.extractOAuthConfig,
  authenticate: authFlow.authenticate,
  getValidToken: authFlow.getValidToken,
}));

/**
 * Test seam: ServerClient accepts a `clientFactory` option that replaces the
 * SDK Client. Fakes are cast to `Client` — only the surface ServerClient
 * touches (connect/listTools/callTool/close) is implemented.
 */

interface CallToolResult {
  content: Array<{ type: string; [key: string]: unknown }>;
  isError?: boolean;
}

interface FakeResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

interface FakePrompt {
  name: string;
  description?: string;
}

interface FakeCapabilities {
  resources?: boolean;
  prompts?: boolean;
  tools?: boolean;
}

interface FakeClient {
  connectCalls: number;
  closeCalls: number;
  closed: boolean;
  listToolsCalls: Array<string | undefined>;
  listResourcesCalls: Array<string | undefined>;
  listPromptsCalls: Array<string | undefined>;
  connect(transport: unknown): Promise<void>;
  listTools(params?: { cursor?: string }): Promise<{ tools: unknown[]; nextCursor?: string }>;
  listResources(params?: { cursor?: string }): Promise<{ resources: FakeResource[]; nextCursor?: string }>;
  listPrompts(params?: { cursor?: string }): Promise<{ prompts: FakePrompt[]; nextCursor?: string }>;
  getServerCapabilities(): FakeCapabilities | undefined;
  getInstructions(): string | undefined;
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<CallToolResult>;
  close(): Promise<void>;
}

interface FakeOptions {
  onConnect?: (fake: FakeClient, transport: unknown) => Promise<void> | void;
  listTools?: () => unknown[];
  /** Pages of tools; each page but the last advertises a nextCursor ("cursor-N") */
  toolPages?: unknown[][];
  resourcePages?: FakeResource[][];
  promptPages?: FakePrompt[][];
  capabilities?: FakeCapabilities;
  instructions?: string;
  callTool?: (
    fake: FakeClient,
    params: { name: string; arguments: Record<string, unknown> },
  ) => Promise<CallToolResult>;
}

function makeFakeClient(opts: FakeOptions = {}): FakeClient {
  const toolPages = opts.toolPages ?? [];
  const resourcePages = opts.resourcePages ?? [];
  const promptPages = opts.promptPages ?? [];
  let toolPage = 0;
  let resourcePage = 0;
  let promptPage = 0;
  const fake: FakeClient = {
    connectCalls: 0,
    closeCalls: 0,
    closed: false,
    listToolsCalls: [],
    listResourcesCalls: [],
    listPromptsCalls: [],
    async connect(transport) {
      this.connectCalls++;
      await opts.onConnect?.(this, transport);
    },
    async listTools(params) {
      this.listToolsCalls.push(params?.cursor);
      if (opts.listTools) return { tools: opts.listTools() };
      const page = toolPages[toolPage];
      const hasMore = toolPages[toolPage + 1] !== undefined;
      toolPage++;
      const r: { tools: unknown[]; nextCursor?: string } = { tools: page ?? [] };
      if (hasMore) r.nextCursor = `cursor-${toolPage}`;
      return r;
    },
    async listResources(params) {
      this.listResourcesCalls.push(params?.cursor);
      const page = resourcePages[resourcePage];
      const hasMore = resourcePages[resourcePage + 1] !== undefined;
      resourcePage++;
      const r: { resources: FakeResource[]; nextCursor?: string } = { resources: page ?? [] };
      if (hasMore) r.nextCursor = `cursor-${resourcePage}`;
      return r;
    },
    async listPrompts(params) {
      this.listPromptsCalls.push(params?.cursor);
      const page = promptPages[promptPage];
      const hasMore = promptPages[promptPage + 1] !== undefined;
      promptPage++;
      const r: { prompts: FakePrompt[]; nextCursor?: string } = { prompts: page ?? [] };
      if (hasMore) r.nextCursor = `cursor-${promptPage}`;
      return r;
    },
    getServerCapabilities() {
      return opts.capabilities;
    },
    getInstructions() {
      return opts.instructions;
    },
    async callTool(params) {
      return opts.callTool
        ? opts.callTool(this, params)
        : Promise.resolve({ content: [{ type: "text", text: "ok" }] });
    },
    async close() {
      this.closeCalls++;
      this.closed = true;
    },
  };
  return fake;
}

/** Harmless stdio def — the fake client never actually spawns anything. */
const stdioDef: StdioServerDef = { command: "true" };

/** Harmless HTTP def — the fake client never touches the network. */
const httpDef: HttpServerDef = { type: "http", url: "http://127.0.0.1:1/mcp" };

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mcp-client-test-"));
  setCachePathForTest(join(tmp, "cache.json"));
  authFlow.state.authenticateImpl = async () => ({ status: "authenticated" });
  authFlow.state.validToken = null;
  authFlow.extractOAuthConfig.mockClear();
  authFlow.authenticate.mockClear();
  authFlow.getValidToken.mockClear();
});

afterEach(() => {
  setCachePathForTest(null);
});

describe("buildAuthHeaders", () => {
  const base: HttpServerDef = { type: "http", url: "http://127.0.0.1:1/mcp" };

  it("returns an empty record when no auth-related fields are set", () => {
    expect(buildAuthHeaders(base)).toEqual({});
  });

  it("merges def.headers into the result", () => {
    const def: HttpServerDef = {
      ...base,
      headers: { "X-Api": "1", Accept: "application/json" },
    };
    expect(buildAuthHeaders(def)).toEqual({
      "X-Api": "1",
      Accept: "application/json",
    });
  });

  it("sets Authorization from auth.token, overriding a user-supplied Authorization header", () => {
    const def: HttpServerDef = {
      ...base,
      auth: { token: "tok" },
      headers: { "X-Api": "1", Authorization: "Bearer user-wins-not" },
      bearerTokenEnv: "MCP_TEST_BEARER",
    };
    vi.stubEnv("MCP_TEST_BEARER", "env-token");
    try {
      expect(buildAuthHeaders(def)).toEqual({
        "X-Api": "1",
        Authorization: "Bearer tok",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("falls back to bearerTokenEnv when auth.token is absent", () => {
    const def: HttpServerDef = {
      ...base,
      headers: { "X-Api": "1" },
      bearerTokenEnv: "MCP_TEST_BEARER",
    };
    vi.stubEnv("MCP_TEST_BEARER", "env-token");
    try {
      expect(buildAuthHeaders(def)).toEqual({
        "X-Api": "1",
        Authorization: "Bearer env-token",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not set Authorization when the bearer env var is empty or unset", () => {
    const def: HttpServerDef = { ...base, bearerTokenEnv: "MCP_TEST_BEARER_EMPTY" };
    vi.stubEnv("MCP_TEST_BEARER_EMPTY", "");
    try {
      expect(buildAuthHeaders(def)).toEqual({});
    } finally {
      vi.unstubAllEnvs();
    }
    // Also: env var never set at all
    delete process.env.MCP_TEST_BEARER_MISSING;
    const missing: HttpServerDef = { ...base, bearerTokenEnv: "MCP_TEST_BEARER_MISSING" };
    expect(buildAuthHeaders(missing)).toEqual({});
  });

  it("does not mutate the caller's def.headers", () => {
    const def: HttpServerDef = {
      ...base,
      auth: { token: "tok" },
      headers: { "X-Api": "1" },
    };
    buildAuthHeaders(def);
    expect(def.headers).toEqual({ "X-Api": "1" });
  });
});

describe("ServerClient — generation fencing", () => {
  it("tears down a connect that resolves after close(); no connection leaks", async () => {
    let fake: FakeClient | null = null;
    let resolveConnect: () => void = () => {};
    const client = new ServerClient("srv", stdioDef, {
      clientFactory: () => {
        fake = makeFakeClient({
          onConnect: () => new Promise<void>((r) => (resolveConnect = r)),
        });
        return fake as unknown as Client;
      },
    });
    // TS narrows the captured `fake` to null in the outer flow; read via a
    // helper so assertions use the declared type.
    const fakeNow = (): FakeClient => {
      if (!fake) throw new Error("fake client not created yet");
      return fake;
    };

    const pending = client.connect();
    // Wait until the (fake) SDK connect is actually in flight
    await vi.waitFor(() => expect(fake?.connectCalls).toBe(1));
    expect(client.status).toBe("connecting");

    // Close races ahead of the slow connect
    await client.close();
    expect(client.status).toBe("disconnected");
    expect(fakeNow().closed).toBe(true);

    // Now the in-flight connect resolves — it must be fenced out
    resolveConnect();
    await pending; // must resolve, not throw

    expect(client.status).toBe("disconnected");
    expect(client.tools).toEqual([]);
    // The stale client must not be reusable: a fresh connect makes a new fake
    const racedFake = fakeNow();
    const pending2 = client.connect(); // do NOT await — the fake connect is held back
    await vi.waitFor(() => {
      expect(fakeNow()).not.toBe(racedFake);
      expect(fake?.connectCalls).toBe(1);
    });
    // The factory reassigned resolveConnect for the new fake's connect
    resolveConnect();
    await pending2;
    await vi.waitFor(() => expect(client.status).toBe("connected"));
    // The old (raced) fake was not the one left connected
    expect(fakeNow()).not.toBe(racedFake);
    expect(racedFake.closed).toBe(true);
    expect(client.status).toBe("connected");
  });

  it("survives close() before connect() with no client assigned", async () => {
    const client = new ServerClient("srv", stdioDef, {
      clientFactory: () => makeFakeClient() as unknown as Client,
    });
    await client.close();
    expect(client.status).toBe("disconnected");
  });
});

describe("ServerClient — needs-auth", () => {
  it("sets needs-auth on HTTP 401 during connect without throwing", async () => {
    const client = new ServerClient("auth-srv", httpDef, {
      clientFactory: () =>
        makeFakeClient({
          onConnect: async () => {
            throw new StreamableHTTPError(401, "Unauthorized");
          },
        }) as unknown as Client,
    });

    await expect(client.connect()).resolves.toBeUndefined();
    expect(client.status).toBe("needs-auth");
    expect(client.error).toMatch(/OAuth/);

    // A tool call on a needs-auth client throws a clear error (no retry loop)
    await expect(client.callTool("t", {})).rejects.toThrow(
      /authentication required or token rejected/i,
    );
  });

  it("authenticate() rejects when the server has no oauth config (stub replaced in plan-026)", async () => {
    const client = new ServerClient("auth-srv", httpDef, {
      clientFactory: () => makeFakeClient() as unknown as Client,
    });
    await expect(client.authenticate()).rejects.toThrow(
      "Server auth-srv is not configured for OAuth (auth must be \"oauth\" or an oauth config object)",
    );
    expect(authFlow.authenticate).not.toHaveBeenCalled();

    // A static { token } bearer server is also not an OAuth server
    const bearerDef: HttpServerDef = { ...httpDef, auth: { token: "static" } };
    const bearerClient = new ServerClient("bearer-srv", bearerDef, {
      clientFactory: () => makeFakeClient() as unknown as Client,
    });
    await expect(bearerClient.authenticate()).rejects.toThrow("not configured for OAuth");
    expect(authFlow.authenticate).not.toHaveBeenCalled();
  });

  it("close() clears needs-auth so a later connect can retry", async () => {
    let calls = 0;
    const client = new ServerClient("auth-srv", httpDef, {
      clientFactory: () =>
        makeFakeClient({
          onConnect: async () => {
            calls++;
            if (calls === 1) throw new StreamableHTTPError(401, "Unauthorized");
          },
        }) as unknown as Client,
    });
    await client.connect();
    expect(client.status).toBe("needs-auth");
    await client.close();
    expect(client.status).toBe("disconnected");
    await client.connect();
    expect(calls).toBe(2);
    expect(client.status).toBe("connected");
  });
});

describe("ServerClient — OAuth authenticate (real flow)", () => {
  const oauthDef: HttpServerDef = {
    type: "http",
    url: "https://mcp.example.com/mcp",
    auth: "oauth",
  };
  const factory = () => makeFakeClient() as unknown as Client;

  it("runs the flow with the def's url and extracted config, forwarding options", async () => {
    const client = new ServerClient("oauth-srv", oauthDef, { clientFactory: factory });
    const ac = new AbortController();
    const onAuthorizationUrl = vi.fn();

    await client.authenticate({ signal: ac.signal, onAuthorizationUrl });

    expect(authFlow.authenticate).toHaveBeenCalledTimes(1);
    expect(authFlow.authenticate).toHaveBeenCalledWith(
      "oauth-srv",
      "https://mcp.example.com/mcp",
      { grantType: "authorization_code" },
      { signal: ac.signal, onAuthorizationUrl },
    );
  });

  it("Extracts object oauth configs and passes them through", async () => {
    const def: HttpServerDef = {
      type: "http",
      url: "https://mcp.example.com/mcp",
      auth: { grantType: "client_credentials", clientSecret: "shh" },
    };
    const client = new ServerClient("cc-srv", def, { clientFactory: factory });
    await client.authenticate();
    expect(authFlow.authenticate).toHaveBeenCalledWith(
      "cc-srv",
      "https://mcp.example.com/mcp",
      { grantType: "client_credentials", clientSecret: "shh" },
      undefined,
    );
  });

  it("throws a clear error when the flow reports failed", async () => {
    authFlow.state.authenticateImpl = async () => ({
      status: "failed",
      error: "network unreachable",
    });
    const client = new ServerClient("oauth-srv", oauthDef, { clientFactory: factory });
    await expect(client.authenticate()).rejects.toThrow(
      "Authentication failed for oauth-srv",
    );
  });

  it("surfaces the underlying failure cause in the thrown error", async () => {
    authFlow.state.authenticateImpl = async () => ({
      status: "failed",
      error: "invalid_grant: token endpoint rejected the grant",
    });
    const client = new ServerClient("oauth-srv", oauthDef, { clientFactory: factory });
    // /mcp-auth and auto-auth show this message — the cause must be in it,
    // not just the generic part
    await expect(client.authenticate()).rejects.toThrow(
      "Authentication failed for oauth-srv",
    );
    await expect(client.authenticate()).rejects.toThrow(
      "invalid_grant: token endpoint rejected the grant",
    );
  });

  it("throws a clear error when the flow needs manual interaction", async () => {
    authFlow.state.authenticateImpl = async () => ({ status: "needs-interaction" });
    const client = new ServerClient("oauth-srv", oauthDef, { clientFactory: factory });
    await expect(client.authenticate()).rejects.toThrow(
      "Authentication requires manual interaction for oauth-srv",
    );
  });

  it("rethrows a cancelled flow's error untouched (no wrapping)", async () => {
    authFlow.state.authenticateImpl = async () => {
      throw new Error("OAuth cancelled");
    };
    const client = new ServerClient("oauth-srv", oauthDef, { clientFactory: factory });
    // The cancel error must not be re-wrapped into a failed-flow error
    await expect(client.authenticate()).rejects.toThrow("OAuth cancelled");
    await expect(client.authenticate()).rejects.not.toThrow("Authentication failed");
  });
});

describe("ServerClient — OAuth bearer on connect", () => {
  const oauthDef: HttpServerDef = {
    type: "http",
    url: "https://mcp.example.com/mcp",
    auth: "oauth",
  };

  function captureTransport(onCaptured: (t: { _requestInit?: { headers?: Record<string, string> } }) => void) {
    return () =>
      makeFakeClient({
        onConnect: (_fake, transport) => {
          onCaptured(transport as { _requestInit?: { headers?: Record<string, string> } });
        },
      }) as unknown as Client;
  }

  it("attaches the valid OAuth token as Authorization and keeps existing headers", async () => {
    authFlow.state.validToken = "stored-tok";
    let transport: { _requestInit?: { headers?: Record<string, string> } } | undefined;
    const client = new ServerClient("oauth-srv", { ...oauthDef, headers: { "X-Api": "1" } }, {
      clientFactory: captureTransport((t) => {
        transport = t;
      }),
    });

    await client.connect();
    expect(client.status).toBe("connected");

    expect(authFlow.getValidToken).toHaveBeenCalledTimes(1);
    expect(authFlow.getValidToken).toHaveBeenCalledWith(
      "oauth-srv",
      "https://mcp.example.com/mcp",
      { grantType: "authorization_code" },
    );
    expect(transport?._requestInit?.headers).toEqual({
      "X-Api": "1",
      Authorization: "Bearer stored-tok",
    });
  });

  it("sends no Authorization header when there is no valid stored token", async () => {
    authFlow.state.validToken = null;
    let transport: { _requestInit?: { headers?: Record<string, string> } } | undefined;
    const client = new ServerClient("oauth-srv", oauthDef, {
      clientFactory: captureTransport((t) => {
        transport = t;
      }),
    });

    await client.connect();
    expect(client.status).toBe("connected");
    expect(authFlow.getValidToken).toHaveBeenCalledTimes(1);
    // Nothing to send: no requestInit at all (def.headers unset as well)
    expect(transport?._requestInit).toBeUndefined();
  });

  it("leaves static { token } servers untouched — no OAuth flow, static header wins", async () => {
    let transport: { _requestInit?: { headers?: Record<string, string> } } | undefined;
    const def: HttpServerDef = {
      type: "http",
      url: "https://mcp.example.com/mcp",
      auth: { token: "static" },
      headers: { "X-Api": "1" },
    };
    const client = new ServerClient("bearer-srv", def, {
      clientFactory: captureTransport((t) => {
        transport = t;
      }),
    });

    await client.connect();
    expect(client.status).toBe("connected");
    expect(authFlow.getValidToken).not.toHaveBeenCalled();
    expect(transport?._requestInit?.headers).toEqual({
      "X-Api": "1",
      Authorization: "Bearer static",
    });
  });

  it("an OAuth token overrides an env-bearer fallback (bearerTokenEnv)", async () => {
    authFlow.state.validToken = "oauth-tok";
    vi.stubEnv("MCP_TEST_BEARER_CC", "env-token");
    let transport: { _requestInit?: { headers?: Record<string, string> } } | undefined;
    const def: HttpServerDef = { ...oauthDef, bearerTokenEnv: "MCP_TEST_BEARER_CC" };
    const client = new ServerClient("oauth-srv", def, {
      clientFactory: captureTransport((t) => {
        transport = t;
      }),
    });
    try {
      await client.connect();
      expect(transport?._requestInit?.headers).toEqual({
        Authorization: "Bearer oauth-tok",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("ServerClient — onclose client identity", () => {
  it("ignores a delayed onclose from an abandoned StreamableHTTP transport after the SSE fallback connects", async () => {
    let abandonedOnClose: (() => void) | undefined;
    let liveOnClose: (() => void) | undefined;
    // First factory call → StreamableHTTP transport (abandoned), second → SSE fallback
    const fakeA = makeFakeClient({
      onConnect: (_fake, transport) => {
        abandonedOnClose = (transport as { onclose?: () => void }).onclose;
        throw new Error("streamable http unsupported");
      },
    });
    const fakeB = makeFakeClient({
      listTools: () => [{ name: "t1", inputSchema: {} }],
      onConnect: (_fake, transport) => {
        liveOnClose = (transport as { onclose?: () => void }).onclose;
      },
    });
    let created = 0;
    const client = new ServerClient("srv", httpDef, {
      clientFactory: () =>
        (created++ === 0 ? fakeA : fakeB) as unknown as Client,
    });

    await client.connect();
    expect(client.status).toBe("connected");
    expect(client.tools.map((t) => t.name)).toEqual(["t1"]);

    // The abandoned StreamableHTTP transport fires onclose late — it must
    // NOT clobber the healthy SSE client (different instance, same generation)
    expect(abandonedOnClose).toBeDefined();
    abandonedOnClose?.();
    expect(client.status).toBe("connected");

    // The LIVE SSE transport's close still disconnects
    liveOnClose?.();
    expect(client.status).toBe("disconnected");
  });
});

describe("ServerClient — session recovery (404)", () => {
  it("reconnects exactly once on 404 during callTool and retries the call", async () => {
    const fakes: FakeClient[] = [];
    const client = new ServerClient("sess-srv", httpDef, {
      clientFactory: () => {
        const fake = makeFakeClient({
          callTool: (_fake, params) => {
            // First session is expired; second session is healthy
            if (fakes.length === 1) {
              return Promise.reject(new StreamableHTTPError(404, "Session not found"));
            }
            return Promise.resolve({
              content: [{ type: "text", text: `ok:${params.name}` }],
            });
          },
        });
        fakes.push(fake);
        return fake as unknown as Client;
      },
    });

    const result = await client.callTool("echo", { x: 1 });
    expect(result.content).toEqual([{ type: "text", text: "ok:echo" }]);
    expect(result.isError).toBe(false);

    // Exactly one reconnect: two clients were created
    expect(fakes).toHaveLength(2);
    // The expired session was closed; the fresh one is kept
    expect(fakes[0]?.closed).toBe(true);
    expect(fakes[1]?.closeCalls).toBe(0);
    expect(client.status).toBe("connected");
  });

  it("surfaces the retry's error when the 404 persists after reconnect", async () => {
    const fakes: FakeClient[] = [];
    const client = new ServerClient("sess-srv", httpDef, {
      clientFactory: () => {
        const fake = makeFakeClient({
          callTool: () =>
            Promise.reject(new StreamableHTTPError(404, "Session not found")),
        });
        fakes.push(fake);
        return fake as unknown as Client;
      },
    });

    await expect(client.callTool("echo", {})).rejects.toMatchObject({ code: 404 });
    // Still only one reconnect attempt — no retry loop
    expect(fakes).toHaveLength(2);
  });
});

describe("ServerClient — idle tracking", () => {
  it("isIdle is false while a call is in flight and true after the idle timeout", async () => {
    let fake: FakeClient | null = null;
    const client = new ServerClient("idle-srv", stdioDef, {
      clientFactory: () => {
        fake = makeFakeClient();
        return fake as unknown as Client;
      },
    });

    // Disconnected: never idle
    expect(client.isIdle(0)).toBe(false);

    await client.connect();
    expect(client.status).toBe("connected");
    // Never used (lastUsedAt = 0): idle by any timeout
    expect(client.isIdle(1)).toBe(true);

    // Kick off a call that never finishes
    let done: () => void = () => {};
    const pendingCall = new Promise<void>((r) => (done = r));
    fake!.callTool = async () => {
      await pendingCall;
      return { content: [{ type: "text", text: "ok" }] };
    };
    const inFlight = client.callTool("slow", {});
    await vi.waitFor(() => expect(client.inFlight).toBe(1));
    // In-flight: not idle even with an absurd timeout
    expect(client.isIdle(Number.MAX_SAFE_INTEGER)).toBe(false);

    done();
    const result = await inFlight;
    expect(result.content).toEqual([{ type: "text", text: "ok" }]);
    expect(client.inFlight).toBe(0);
    // Just used: not yet idle for a realistic timeout
    expect(client.isIdle(10_000)).toBe(false);
    // After the timeout elapses: idle
    await new Promise((r) => setTimeout(r, 25));
    expect(client.isIdle(10)).toBe(true);
  });
});

describe("ServerClient — discovery and pagination", () => {
  it("combines multiple pages of tools and passes the cursor back", async () => {
    const fake = makeFakeClient({
      toolPages: [
        [{ name: "a" }, { name: "b" }],
        [{ name: "c" }],
      ],
    });
    const client = new ServerClient("pag", stdioDef, {
      clientFactory: () => fake as unknown as Client,
    });
    await client.connect();

    // All tools from both pages, in order, stamped with the server name
    expect(client.tools.map((t) => t.name)).toEqual(["a", "b", "c"]);
    expect(client.tools[0]).toMatchObject({ name: "a", serverName: "pag" });

    // Two requests; the second carries page 1's nextCursor back
    expect(fake.listToolsCalls).toEqual([undefined, "cursor-1"]);
  });

  it("paginates resources when the resources capability is advertised", async () => {
    const fake = makeFakeClient({
      capabilities: { resources: true },
      resourcePages: [
        [{ uri: "res://1", name: "one" }],
        [{ uri: "res://2", mimeType: "text/plain" }],
      ],
    });
    const client = new ServerClient("res", stdioDef, {
      clientFactory: () => fake as unknown as Client,
    });
    await client.connect();

    expect(client.resources).toEqual([
      { uri: "res://1", name: "one" },
      { uri: "res://2", mimeType: "text/plain" },
    ]);
    expect(fake.listResourcesCalls).toEqual([undefined, "cursor-1"]);
    // prompts not advertised → never called
    expect(fake.listPromptsCalls).toEqual([]);
    expect(client.prompts).toEqual([]);
  });

  it("paginates prompts when the prompts capability is advertised", async () => {
    const fake = makeFakeClient({
      capabilities: { prompts: true },
      promptPages: [[{ name: "p1", description: "d1" }], [{ name: "p2" }]],
    });
    const client = new ServerClient("prm", stdioDef, {
      clientFactory: () => fake as unknown as Client,
    });
    await client.connect();

    expect(client.prompts).toEqual([
      { name: "p1", description: "d1" },
      { name: "p2" },
    ]);
    expect(fake.listPromptsCalls).toEqual([undefined, "cursor-1"]);
    expect(fake.listResourcesCalls).toEqual([]);
    expect(client.resources).toEqual([]);
  });

  it("never calls listResources/listPrompts when capabilities are not advertised", async () => {
    const fake = makeFakeClient({ toolPages: [[{ name: "t" }]] });
    const client = new ServerClient("nocap", stdioDef, {
      clientFactory: () => fake as unknown as Client,
    });
    await client.connect();

    expect(fake.listResourcesCalls).toEqual([]);
    expect(fake.listPromptsCalls).toEqual([]);
    expect(client.resources).toEqual([]);
    expect(client.prompts).toEqual([]);
    // tools are still discovered
    expect(client.tools.map((t) => t.name)).toEqual(["t"]);
  });

  it("exposes server instructions from getInstructions()", async () => {
    const withInstr = makeFakeClient({ instructions: "be concise" });
    const client = new ServerClient("ins", stdioDef, {
      clientFactory: () => withInstr as unknown as Client,
    });
    await client.connect();
    expect(client.instructions).toBe("be concise");

    const withoutInstr = makeFakeClient();
    const client2 = new ServerClient("ins2", stdioDef, {
      clientFactory: () => withoutInstr as unknown as Client,
    });
    await client2.connect();
    expect(client2.instructions).toBeUndefined();
  });

  it("writes discovered tools, resources, prompts, and instructions to the server cache", async () => {
    const cacheFile = join(tmp, "cache.json");
    const fake = makeFakeClient({
      toolPages: [[{ name: "t1" }], [{ name: "t2" }]],
      capabilities: { resources: true, prompts: true },
      resourcePages: [[{ uri: "res://a", name: "A" }]],
      promptPages: [[{ name: "p1" }]],
      instructions: "the instructions",
    });
    const client = new ServerClient("dsc", stdioDef, {
      clientFactory: () => fake as unknown as Client,
    });
    await client.connect();
    expect(client.status).toBe("connected");

    const onDisk = JSON.parse(readFileSync(cacheFile, "utf-8")) as {
      servers: Record<string, { tools?: Array<{ name: string }>; resources?: unknown[]; prompts?: unknown[]; instructions?: string }>;
    };
    const entry = onDisk.servers["dsc"];
    expect(entry).toBeDefined();
    expect(entry?.tools?.map((t) => t.name)).toEqual(["t1", "t2"]);
    expect(entry?.resources).toEqual([{ uri: "res://a", name: "A" }]);
    expect(entry?.prompts).toEqual([{ name: "p1" }]);
    expect(entry?.instructions).toBe("the instructions");
  });

  it("omits optional keys from the cache entry when nothing was discovered", async () => {
    const cacheFile = join(tmp, "cache.json");
    const fake = makeFakeClient({});
    const client = new ServerClient("bare", stdioDef, {
      clientFactory: () => fake as unknown as Client,
    });
    await client.connect();

    const onDisk = JSON.parse(readFileSync(cacheFile, "utf-8")) as {
      servers: Record<string, Record<string, unknown>>;
    };
    const entry = onDisk.servers["bare"];
    expect(entry).toBeDefined();
    expect(entry?.resources).toEqual([]);
    // exactOptionalPropertyTypes: omitted, not present with an undefined value
    expect("prompts" in (entry ?? {})).toBe(false);
    expect("instructions" in (entry ?? {})).toBe(false);
  });
});

describe("ServerManager", () => {
  it("isIdle delegates to the client and is false for unknown servers", () => {
    const fake = makeFakeClient();
    const mgr = new ServerManager({ clientFactory: () => fake as unknown as Client });
    mgr.sync({ a: stdioDef });
    // Client is not connected yet → not idle
    expect(mgr.isIdle("a", 1_000_000)).toBe(false);
    expect(mgr.isIdle("missing", 1_000_000)).toBe(false);
  });

  it("sync replaces a client whose server def changed (old client closed, new def used)", async () => {
    const fakes: FakeClient[] = [];
    const mgr = new ServerManager({
      clientFactory: () => {
        const fake = makeFakeClient();
        fakes.push(fake);
        return fake as unknown as Client;
      },
    });

    const defA: StdioServerDef = { command: "true" };
    mgr.sync({ a: defA });
    const clientA = mgr.getClient("a")!;
    await clientA.connect();
    expect(fakes).toHaveLength(1);
    expect(clientA.status).toBe("connected");

    // Change the def (different command) → old client must be closed and
    // replaced by a fresh client constructed from the new def.
    const defB: StdioServerDef = { command: "false" };
    mgr.sync({ a: defB });

    const clientB = mgr.getClient("a")!;
    expect(clientB).not.toBe(clientA);
    expect(clientB.def).toBe(defB);
    // close() sets state synchronously before awaiting the SDK close
    expect(clientA.status).toBe("disconnected");
    await vi.waitFor(() => expect(fakes[0]!.closed).toBe(true));

    // The replacement client connects using the NEW def (a fresh SDK client,
    // not the old fake that was built for defA).
    await clientB.connect();
    expect(fakes).toHaveLength(2);
    expect(fakes[1]!.closed).toBe(false);
    expect(clientB.status).toBe("connected");
  });

  it("sync does not recreate a client when the same def is synced again", async () => {
    const fakes: FakeClient[] = [];
    const mgr = new ServerManager({
      clientFactory: () => {
        const fake = makeFakeClient();
        fakes.push(fake);
        return fake as unknown as Client;
      },
    });

    const defA: StdioServerDef = { command: "true" };
    mgr.sync({ a: defA });
    const clientA = mgr.getClient("a")!;
    await clientA.connect();

    // Structurally equal but a fresh object → same identity hash → keep client
    mgr.sync({ a: { ...defA } });
    expect(mgr.getClient("a")).toBe(clientA);
    expect(clientA.status).toBe("connected");
    expect(fakes).toHaveLength(1);

    // Runtime-only fields (toolPrefix) don't affect the identity hash either
    mgr.sync({ a: { ...defA, toolPrefix: "none" } });
    expect(mgr.getClient("a")).toBe(clientA);
    expect(clientA.status).toBe("connected");
    expect(fakes).toHaveLength(1);
  });

  it("sync closes removed clients exactly once (no double close)", async () => {
    const fake = makeFakeClient();
    const mgr = new ServerManager({ clientFactory: () => fake as unknown as Client });
    mgr.sync({ gone: stdioDef });
    const client = mgr.getClient("gone")!;
    await client.connect();
    expect(client.status).toBe("connected");

    // Sync with the server removed
    mgr.sync({});
    expect(mgr.getClient("gone")).toBeUndefined();
    await vi.waitFor(() => expect(fake.closeCalls).toBe(1));
    await vi.waitFor(() => expect(client.status).toBe("disconnected"));

    // A second close (e.g. from a pending reference) is a no-op
    await client.close();
    expect(fake.closeCalls).toBe(1);
  });
});
