import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { StdioServerDef, HttpServerDef, ServerDef } from "./types.js";

export type ServerStatus = "disconnected" | "connecting" | "connected" | "error";

export interface McpTool extends Tool {
  serverName: string;
}

/** A simplified content block as returned by callTool */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: string; [key: string]: unknown };

export class ServerClient {
  readonly name: string;
  private def: ServerDef;
  private client: Client | null = null;
  private _status: ServerStatus = "disconnected";
  private _tools: McpTool[] = [];
  private _error: string | null = null;
  private connectPromise: Promise<void> | null = null;

  constructor(name: string, def: ServerDef) {
    this.name = name;
    this.def = def;
  }

  get status(): ServerStatus {
    return this._status;
  }

  get tools(): McpTool[] {
    return this._tools;
  }

  get error(): string | null {
    return this._error;
  }

  /** Lazily connect — idempotent, safe to call multiple times */
  async connect(): Promise<void> {
    if (this._status === "connected") return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this._doConnect().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async _doConnect(): Promise<void> {
    this._status = "connecting";
    this._error = null;
    try {
      const client = new Client(
        { name: "pi-archimedes-mcp", version: "1.0.0" },
        {},
      );
      this.client = client;

      const onclose = () => {
        this._status = "disconnected";
        this.client = null;
      };

      if (!this.def.type || this.def.type === "stdio") {
        const def = this.def as StdioServerDef;
        const transport = new StdioClientTransport({
          command: def.command,
          args: def.args ?? [],
          env: { ...process.env, ...(def.env ?? {}) } as Record<string, string>,
        });
        transport.onclose = onclose;
        await client.connect(transport);
      } else {
        const def = this.def as HttpServerDef;
        // Try StreamableHTTP first (modern standard), fall back to SSE for legacy servers
        let connected = false;
        try {
          const transport = new StreamableHTTPClientTransport(new URL(def.url));
          transport.onclose = onclose;
          // StreamableHTTPClientTransport.sessionId is `string | undefined` which conflicts
          // with the Transport interface's `sessionId?: string` under exactOptionalPropertyTypes
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await client.connect(transport as any);
          connected = true;
        } catch {
          // Fall back to SSE
        }
        if (!connected) {
          const transport = new SSEClientTransport(new URL(def.url));
          transport.onclose = onclose;
          await client.connect(transport);
        }
      }

      this._status = "connected";

      // Discover tools immediately after connect
      const result = await client.listTools();
      this._tools = result.tools.map((t) => ({ ...t, serverName: this.name }));
    } catch (e) {
      this._status = "error";
      this._error = e instanceof Error ? e.message : String(e);
      this.client = null;
      throw e;
    }
  }

  /** Call a tool by name with arguments */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ content: ContentBlock[]; isError: boolean }> {
    await this.connect();
    if (!this.client) throw new Error(`Server ${this.name} not connected`);

    // Check abort before calling
    signal?.throwIfAborted();

    const result = await this.client.callTool({ name: toolName, arguments: args });

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
    if (this.client) {
      await this.client.close().catch(() => {});
      this.client = null;
    }
    this._status = "disconnected";
  }
}
