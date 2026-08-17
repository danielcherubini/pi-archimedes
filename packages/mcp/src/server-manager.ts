import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ServerDef, CachedTool } from "./types.js";
import { ServerClient } from "./server-client.js";
import type { McpTool } from "./server-client.js";
import { getCachedTools, computeServerHash } from "./metadata-cache.js";

/**
 * Map entry for a managed server. `defHash` is the identity hash of the
 * ServerDef at client-creation time; sync() compares it against the hash of
 * the incoming def to detect config changes (url/auth/command, etc.).
 */
interface ManagedClient {
  client: ServerClient;
  defHash: string;
}

export class ServerManager {
  private clients = new Map<string, ManagedClient>();
  private defs = new Map<string, ServerDef>();
  private clientFactory: (() => Client) | undefined;

  /**
   * @param options.clientFactory — testability seam; passed through to every
   *   ServerClient created by sync() so tests can inject a fake SDK client.
   */
  constructor(options?: { clientFactory?: () => Client }) {
    this.clientFactory = options?.clientFactory;
  }

  private makeClient(name: string, def: ServerDef): ServerClient {
    return new ServerClient(
      name,
      def,
      this.clientFactory ? { clientFactory: this.clientFactory } : undefined,
    );
  }

  /** Sync the client map to a new set of server definitions */
  sync(defs: Record<string, ServerDef>): void {
    // Close and remove servers that are gone. close() bumps the client's
    // generation fence, so a concurrent in-flight connect will tear itself
    // down on completion instead of leaking; the client's null-guarded close
    // makes a second close a no-op. We delete from the map before awaiting
    // nothing here (close is fire-and-forget via void) — no double-close path.
    for (const [name, managed] of this.clients) {
      if (!(name in defs)) {
        void managed.client.close();
        this.clients.delete(name);
        this.defs.delete(name);
      }
    }
    // Add or update servers (don't connect yet — lazy)
    for (const [name, def] of Object.entries(defs)) {
      this.defs.set(name, def);
      const managed = this.clients.get(name);
      if (managed) {
        // The def changed for a still-configured server: the old client's
        // generation fence is useless if it just holds a stale def — its
        // next connect would use the old url/command and re-save the cache
        // under the old hash. Close it (fences any in-flight connect) and
        // replace with a fresh client built from the new def. Identical
        // identity → leave the existing client alone (no reconnect churn).
        const defHash = computeServerHash(def);
        if (managed.defHash !== defHash) {
          void managed.client.close();
          this.clients.set(name, { client: this.makeClient(name, def), defHash });
        }
      } else {
        this.clients.set(name, {
          client: this.makeClient(name, def),
          defHash: computeServerHash(def),
        });
      }
    }
  }

  /** Server definition from the last sync, if any */
  getDef(name: string): ServerDef | undefined {
    return this.defs.get(name);
  }

  /** Tools from the live connection if connected, else from valid cache */
  getToolsForServer(name: string, def: ServerDef): CachedTool[] {
    const client = this.clients.get(name)?.client;
    if (client && client.status === "connected") {
      return client.tools.map((t) => {
        const cached: CachedTool = { name: t.name, inputSchema: t.inputSchema };
        if (t.description !== undefined) cached.description = t.description;
        return cached;
      });
    }
    return getCachedTools(name, def) ?? [];
  }

  /** All tools across servers (live + cached), for offline search */
  getAllToolsWithCache(defs: Record<string, ServerDef>): Array<CachedTool & { serverName: string }> {
    return Object.entries(defs).flatMap(([name, def]) =>
      this.getToolsForServer(name, def).map((t) => ({ ...t, serverName: name })),
    );
  }

  getClient(name: string): ServerClient | undefined {
    return this.clients.get(name)?.client;
  }

  /** Whether a client is connected, idle, and past its idle timeout */
  isIdle(name: string, timeoutMs: number): boolean {
    return this.clients.get(name)?.client.isIdle(timeoutMs) ?? false;
  }

  getClients(): ServerClient[] {
    return Array.from(this.clients.values()).map((m) => m.client);
  }

  /** All currently cached tools across all connected servers */
  getAllTools(): McpTool[] {
    return this.getClients().flatMap((c) => c.tools);
  }

  /** Search tools by name/description substring (case-insensitive) */
  searchTools(query: string, serverName?: string): McpTool[] {
    const q = query.toLowerCase();
    const clients = serverName
      ? ([this.clients.get(serverName)?.client].filter(Boolean) as ServerClient[])
      : this.getClients();
    return clients
      .flatMap((c) => c.tools)
      .filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.description ?? "").toLowerCase().includes(q),
      );
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.getClients().map((c) => c.close()));
    this.clients.clear();
  }
}
