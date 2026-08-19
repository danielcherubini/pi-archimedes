import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import type { StdioServerDef, HttpServerDef, ServerDef, ToolPrefix, CachedTool } from "./types.js";
import {
  authenticate as runOAuthFlow,
  extractOAuthConfig,
  getValidToken,
  type AuthenticateOptions,
} from "./auth-flow.js";
import { resolveNpxBinary } from "./npx-resolver.js";
import { saveServerCache } from "./metadata-cache.js";
import { isHttpDef } from "./config.js";

/**
 * Build the request headers for an HTTP server from its full definition.
 * Merges def.headers (shallow copy), then adds Authorization in this
 * precedence: auth.token wins over any user-supplied Authorization header;
 * otherwise bearerTokenEnv is read from the process environment and used
 * only when non-empty. Returns an empty record when nothing is configured.
 * Exported for unit tests.
 */
export function buildAuthHeaders(def: HttpServerDef): Record<string, string> {
  const headers = { ...(def.headers ?? {}) };
  const token =
    typeof def.auth === "object" && def.auth !== null && "token" in def.auth
      ? def.auth.token
      : undefined;
  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  } else {
    const envName = def.bearerTokenEnv;
    if (envName) {
      const envToken = process.env[envName];
      if (envToken) headers.Authorization = `Bearer ${envToken}`;
    }
  }
  return headers;
}

/** Cap for the captured stderr tail (last 8 KiB of output). */
const MAX_STDERR_TAIL_BYTES = 8 * 1024;

/**
 * Format the bounded stderr tail: at most the last 3 lines of the captured
 * (already size-bounded) output. Returns "" when there is nothing to show.
 */
function formatStderrTail(chunks: Buffer[]): string {
  if (chunks.length === 0) return "";
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return "";
  return text.split("\n").slice(-3).join("\n");
}

export type ServerStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"
  | "needs-auth";

/**
 * Error surfaced when a server requires credentials we cannot provide yet.
 * Guides to the two ways to fix it: a static bearer token in the server
 * definition, or the OAuth flow via /mcp auth (plan-026).
 */
const NEEDS_AUTH_MESSAGE =
  "authentication required or token rejected — configure a static bearer token or authenticate via OAuth (/mcp auth <server>)";

/**
 * Options for ServerClient. `clientFactory` is a testability seam: replace the
 * SDK Client with a fake in tests (no real network/stdio is touched).
 */
export interface ServerClientOptions {
  clientFactory?: () => Client;
}

export interface McpTool extends Tool {
  serverName: string;
}

/** A discovered resource (shaped like the cache entry in types.ts) */
export type DiscoveredResource = {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
};

/** A discovered prompt (shaped like the cache entry in types.ts) */
export type DiscoveredPrompt = { name: string; description?: string };

/**
 * Project an SDK resource into the discovered shape, dropping optional keys
 * that are undefined (exactOptionalPropertyTypes — the SDK types declare
 * `prop?: string | undefined`, which is not assignable to `prop?: string`).
 */
function toDiscoveredResource(res: {
  uri: string;
  name?: string | undefined;
  description?: string | undefined;
  mimeType?: string | undefined;
}): DiscoveredResource {
  const out: DiscoveredResource = { uri: res.uri };
  if (res.name !== undefined) out.name = res.name;
  if (res.description !== undefined) out.description = res.description;
  if (res.mimeType !== undefined) out.mimeType = res.mimeType;
  return out;
}

/** Same projection for SDK prompts (see toDiscoveredResource). */
function toDiscoveredPrompt(p: { name: string; description?: string | undefined }): DiscoveredPrompt {
  const out: DiscoveredPrompt = { name: p.name };
  if (p.description !== undefined) out.description = p.description;
  return out;
}

/** A simplified content block as returned by callTool */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: string; [key: string]: unknown };

export class ServerClient {
  readonly name: string;
  private _def: ServerDef;
  private clientFactory: () => Client;
  private client: Client | null = null;
  private _status: ServerStatus = "disconnected";
  private _tools: McpTool[] = [];
  private _resources: DiscoveredResource[] = [];
  private _prompts: DiscoveredPrompt[] = [];
  private _instructions: string | undefined;
  private _error: string | null = null;
  private connectPromise: Promise<void> | null = null;
  /**
   * Generation counter for fencing: bumped on every close(). A connect that
   * started under an older generation (and only finishes after the close)
   * tears itself down instead of leaking a live connection.
   */
  private generation = 0;
  /** Epoch ms of the last tool call dispatch; 0 = never used. */
  lastUsedAt = 0;
  /** Number of tool calls currently in flight. */
  inFlight = 0;

  constructor(name: string, def: ServerDef, options?: ServerClientOptions) {
    this.name = name;
    this._def = def;
    this.clientFactory = options?.clientFactory ?? (() => {
      return new Client({ name: "pi-archimedes-mcp", version: "1.0.0" }, {});
    });
  }

  get status(): ServerStatus {
    return this._status;
  }

  /** The server definition this client was constructed from */
  get def(): ServerDef {
    return this._def;
  }

  get tools(): McpTool[] {
    return this._tools;
  }

  get resources(): DiscoveredResource[] {
    return this._resources;
  }

  get prompts(): DiscoveredPrompt[] {
    return this._prompts;
  }

  get instructions(): string | undefined {
    return this._instructions;
  }

  get error(): string | null {
    return this._error;
  }

  /** Tool-name prefix mode for this server (per-server setting, defaults to "server") */
  get toolPrefix(): ToolPrefix {
    return this._def.toolPrefix ?? "server";
  }

  /**
   * True when the client is connected, has no in-flight calls, and the last
   * call finished more than `timeoutMs` ago. A never-used connection is idle
   * by any timeout; a disconnected one is never idle.
   */
  isIdle(timeoutMs: number): boolean {
    return (
      this._status === "connected" &&
      this.inFlight === 0 &&
      Date.now() - this.lastUsedAt > timeoutMs
    );
  }

  /**
   * Authenticate via OAuth — the SINGLE auth entry point for this server
   * (the `/mcp auth` command and auto-auth both call this; neither calls
   * the auth-flow module directly, so url/config always come from the def).
   *
   * Rejects when the server isn't configured for OAuth (missing auth,
   * static bearer, or stdio). Resolves when the flow finishes
   * authenticated; rejects with a clear error for failed flows (with the
   * underlying cause appended) and needs-manual-interaction, and rethrows a
   * cancelled flow's "OAuth cancelled" error untouched so the caller can
   * distinguish cancel from failure.
   */
  async authenticate(options?: AuthenticateOptions): Promise<void> {
    const def = this._def;
    if (!isHttpDef(def)) {
      throw new Error(
        `Server ${this.name} is not configured for OAuth (auth must be "oauth" or an oauth config object)`,
      );
    }
    const httpDef = def as HttpServerDef;
    const cfg = extractOAuthConfig(httpDef.auth);
    if (!cfg) {
      throw new Error(
        `Server ${this.name} is not configured for OAuth (auth must be "oauth" or an oauth config object)`,
      );
    }
    const status = await runOAuthFlow(this.name, httpDef.url, cfg, options);
    if (status.status === "failed") {
      // `status.error` is the underlying cause (network error, token-endpoint
      // rejection, …) — carry it up so /mcp auth and auto-auth can show the
      // user the real reason instead of a generic message.
      throw new Error(`Authentication failed for ${this.name}: ${status.error}`);
    }
    if (status.status === "needs-interaction") {
      throw new Error(`Authentication requires manual interaction for ${this.name}`);
    }
  }

  /** Lazily connect — idempotent, safe to call multiple times */
  async connect(): Promise<void> {
    if (this._status === "connected") return;
    // A needs-auth server 401'd on connect; retrying without OAuth would just
    // 401 again. A close() (e.g. config change) resets the status and allows
    // a fresh attempt.
    if (this._status === "needs-auth") return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this._doConnect().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async _doConnect(): Promise<void> {
    const gen = this.generation;
    this._status = "connecting";
    this._error = null;

    // Bounded stderr capture for the stdio child, populated only when the
    // transport pipes stderr (non-debug mode). Kept outside the try so the
    // catch block can surface the tail on connection failure.
    const stderrChunks: Buffer[] = [];
    let stderrSize = 0;
    const pushStderr = (chunk: Buffer) => {
      stderrChunks.push(chunk);
      stderrSize += chunk.length;
      while (stderrSize > MAX_STDERR_TAIL_BYTES && stderrChunks.length > 1) {
        const dropped = stderrChunks.shift()!;
        stderrSize -= dropped.length;
      }
    };

    try {
      this.client = this.clientFactory();
      const primaryClient = this.client;

      // Guarded by generation AND client identity: a stale transport's close
      // can arrive (a) after a close()+reconnect under a new generation, or
      // (b) from an ABANDONED transport whose client was replaced within the
      // same generation — in the HTTP branch the SSE fallback creates a
      // second client under the same generation, so a late onclose from the
      // abandoned StreamableHTTP transport must not clobber the live client.
      const oncloseFor = (c: Client) => () => {
        if (this.generation === gen && this.client === c) {
          this._status = "disconnected";
          this.client = null;
        }
      };

      if (!isHttpDef(this._def)) {
        const def = this._def as StdioServerDef;
        // Resolve npx/npm wrappers to the actual binary so we spawn it
        // directly; null means "not an npx/npm command" → use the original.
        const resolved = await resolveNpxBinary(def.command, def.args ?? []);
        const command = resolved?.command ?? def.command;
        const args = resolved?.args ?? (def.args ?? []);

        const transport = new StdioClientTransport({
          command,
          args,
          env: { ...process.env, ...(def.env ?? {}) } as Record<string, string>,
          // Pipe stderr in non-debug mode so we can capture the tail; in debug
          // mode inherit so the user sees raw output in the foreground.
          stderr: def.debug ? "inherit" : "pipe",
        });
        transport.onclose = oncloseFor(primaryClient);
        // Attach the stderr listener BEFORE connecting so early crash output
        // (e.g. the server failing to start) is not lost. Guard against null.
        if (transport.stderr) {
          transport.stderr.on("data", (chunk: Buffer) => pushStderr(chunk));
        }
        await this.client.connect(transport);
      } else {
        const def = this._def as HttpServerDef;
        let authHeaders = buildAuthHeaders(def);
        // OAuth servers: attach a valid stored token (the helper refreshes
        // via the SDK when the stored token is expired and may return null
        // — no stored token, or the ADR 0001 config-stub guard — in which
        // case the headers are left untouched and the 401 → needs-auth path
        // guides the user to /mcp auth). Static `{ token }` servers are
        // unaffected (extractOAuthConfig returns null for them).
        const oauthConfig = extractOAuthConfig(def.auth);
        if (oauthConfig) {
          const token = await getValidToken(this.name, def.url, oauthConfig);
          if (token !== null) {
            authHeaders = { ...authHeaders, Authorization: `Bearer ${token}` };
          }
        }
        // buildAuthHeaders merges arbitrary def.headers, so this flag really
        // means "has ANY headers" (not just auth).
        const hasHeaders = Object.keys(authHeaders).length > 0;

        // Try StreamableHTTP first (modern standard), fall back to SSE for legacy servers
        let connected = false;
        try {
          const transport = new StreamableHTTPClientTransport(
            new URL(def.url),
            hasHeaders ? { requestInit: { headers: authHeaders } } : undefined,
          );
          transport.onclose = oncloseFor(primaryClient);
          // StreamableHTTPClientTransport.sessionId is `string | undefined` which conflicts
          // with the Transport interface's `sessionId?: string` under exactOptionalPropertyTypes
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (this.client as any).connect(transport);
          connected = true;
        } catch (e) {
          // 401 with no OAuth provider configured surfaces as StreamableHTTPError.
          // We cannot resolve it in this plan — record needs-auth and stop
          // (no SSE fallback, no throw).
          if (e instanceof StreamableHTTPError && e.code === 401) {
            const c = this.client;
            this.client = null;
            await c.close().catch(() => {});
            this._status = "needs-auth";
            this._error = NEEDS_AUTH_MESSAGE;
            return;
          }
          // Fall through to SSE fallback
        }
        if (!connected) {
          // Create a fresh Client for the SSE fallback — the previous instance may be in a
          // partially-initialised or broken state after the failed StreamableHTTP attempt.
          const sseClient = this.clientFactory();
          this.client = sseClient;
          const transport = new SSEClientTransport(
            new URL(def.url),
            hasHeaders ? { requestInit: { headers: authHeaders } } : undefined,
          );
          transport.onclose = oncloseFor(sseClient);
          await sseClient.connect(transport);
        }
      }

      // Generation fence: a close() raced ahead of this connect finishing.
      // Tear down the just-created client without ever marking it connected.
      if (this.generation !== gen) {
        await this.tearDownClient();
        return;
      }

      this._status = "connected";

      // Discover tools, resources, and prompts immediately after connect.
      // All three list calls are paginated via nextCursor — a server with
      // more than one page is truncated otherwise. Resources and prompts
      // are only called when the server advertises the capability; the SDK
      // throws assertCapabilityForMethod otherwise.
      const tools: Tool[] = [];
      let toolCursor: string | undefined;
      do {
        const r = await this.client.listTools(toolCursor ? { cursor: toolCursor } : undefined);
        tools.push(...r.tools);
        toolCursor = r.nextCursor;
      } while (toolCursor);
      this._tools = tools.map((t) => ({ ...t, serverName: this.name }));

      const caps = this.client.getServerCapabilities();
      const resources: DiscoveredResource[] = [];
      let resourceCursor: string | undefined;
      if (caps?.resources) {
        try {
          do {
            const r = await this.client.listResources(resourceCursor ? { cursor: resourceCursor } : undefined);
            resources.push(...r.resources.map(toDiscoveredResource));
            resourceCursor = r.nextCursor;
          } while (resourceCursor);
        } catch (e) {
          // Some servers advertise the resources capability but don't implement
          // resources/list (e.g. Atlassian MCP returns -32601). Treat this as
          // "no resources" rather than a fatal connection error.
          if (!(e instanceof McpError && e.code === -32601)) throw e;
        }
      }
      const prompts: DiscoveredPrompt[] = [];
      let promptCursor: string | undefined;
      if (caps?.prompts) {
        try {
          do {
            const r = await this.client.listPrompts(promptCursor ? { cursor: promptCursor } : undefined);
            prompts.push(...r.prompts.map(toDiscoveredPrompt));
            promptCursor = r.nextCursor;
          } while (promptCursor);
        } catch (e) {
          // Same defensive pattern: ignore -32601 for prompts/list.
          if (!(e instanceof McpError && e.code === -32601)) throw e;
        }
      }
      this._resources = resources;
      this._prompts = prompts;
      // Server-level instructions come from the SDK accessor (which reads
      // the initialize result), not from the raw response.
      this._instructions = this.client.getInstructions();

      // Persist tool/resource/prompt metadata so search/describe can work
      // offline. Cache writes are best-effort — a failure must never break
      // the connection.
      try {
        const cacheEntry: {
          tools: CachedTool[];
          resources: DiscoveredResource[];
          prompts?: DiscoveredPrompt[];
          instructions?: string;
        } = {
          tools: tools.map((t) => {
            const cached: CachedTool = { name: t.name, inputSchema: t.inputSchema };
            if (t.description !== undefined) cached.description = t.description;
            return cached;
          }),
          resources,
        };
        // exactOptionalPropertyTypes: omit optional keys rather than
        // assigning undefined
        if (prompts.length > 0) cacheEntry.prompts = prompts;
        if (this._instructions !== undefined) cacheEntry.instructions = this._instructions;
        saveServerCache(this.name, this._def, cacheEntry);
      } catch {
        // Best-effort cache write — ignore
      }
    } catch (e) {
      // A close() won the race: the failure belongs to a superseded attempt.
      if (this.generation !== gen) {
        await this.tearDownClient();
        return;
      }
      this._status = "error";
      const baseMessage = e instanceof Error ? e.message : String(e);
      const tail = formatStderrTail(stderrChunks);
      this._error = tail ? `${baseMessage}\n--- stderr ---\n${tail}` : baseMessage;
      this.client = null;
      throw e;
    }
  }

  /**
   * Null out and close our current client (if any), marking the client
   * disconnected. Used by the generation fence to clean up a connect that
   * finished after a close().
   */
  private async tearDownClient(): Promise<void> {
    const c = this.client;
    this.client = null;
    if (this._status !== "needs-auth") this._status = "disconnected";
    if (c) await c.close().catch(() => {});
  }

  /** Call a tool by name with arguments */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ content: ContentBlock[]; isError: boolean }> {
    await this.connect();
    this.assertCallable();

    // Check abort before calling
    signal?.throwIfAborted();

    this.lastUsedAt = Date.now();
    this.inFlight++;
    try {
      try {
        return await this.invokeTool(toolName, args);
      } catch (e) {
        // Expired HTTP session (server restarted, etc.): reconnect exactly
        // once and retry the call. Any further failure surfaces as-is.
        if (!(e instanceof StreamableHTTPError) || e.code !== 404) throw e;
        await this.close();
        await this.connect();
        this.assertCallable();
        signal?.throwIfAborted();
        this.lastUsedAt = Date.now();
        return await this.invokeTool(toolName, args);
      }
    } finally {
      this.inFlight--;
    }
  }

  /** Throw a clear error when no usable connection exists */
  private assertCallable(): void {
    if (this._status === "needs-auth") {
      throw new Error(`Server ${this.name}: ${this._error ?? NEEDS_AUTH_MESSAGE}`);
    }
    if (!this.client) throw new Error(`Server ${this.name} not connected`);
  }

  /** Perform the SDK call and normalise the result shape */
  private async invokeTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ content: ContentBlock[]; isError: boolean }> {
    const client = this.client;
    if (!client) throw new Error(`Server ${this.name} not connected`);

    const result = await client.callTool({ name: toolName, arguments: args });

    // The SDK returns a union: one branch has `content`, the other has `toolResult` (legacy)
    if ("content" in result) {
      return {
        content: result.content as ContentBlock[],
        isError: result.isError === true,
      };
    }

    // Legacy CompatibilityCallToolResult — wrap toolResult as text
    return {
      content: [{ type: "text", text: JSON.stringify(result.toolResult, null, 2) }],
      isError: false,
    };
  }

  async close(): Promise<void> {
    // Bump the generation so any in-flight connect is fenced out on completion.
    // Set the state synchronously BEFORE awaiting the SDK close so a
    // concurrent callTool cannot observe a null client with a stale status.
    this.generation++;
    this._status = "disconnected";
    const c = this.client;
    this.client = null;
    if (c) await c.close().catch(() => {});
  }
}
