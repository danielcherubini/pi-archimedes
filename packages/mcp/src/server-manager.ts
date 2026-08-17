import type { ServerDef } from "./types.js";
import { ServerClient } from "./server-client.js";
import type { McpTool } from "./server-client.js";

export class ServerManager {
  private clients = new Map<string, ServerClient>();

  /** Sync the client map to a new set of server definitions */
  sync(defs: Record<string, ServerDef>): void {
    // Close and remove servers that are gone
    for (const [name, client] of this.clients) {
      if (!(name in defs)) {
        void client.close();
        this.clients.delete(name);
      }
    }
    // Add new servers (don't connect yet — lazy)
    for (const [name, def] of Object.entries(defs)) {
      if (!this.clients.has(name)) {
        this.clients.set(name, new ServerClient(name, def));
      }
    }
  }

  getClient(name: string): ServerClient | undefined {
    return this.clients.get(name);
  }

  getClients(): ServerClient[] {
    return Array.from(this.clients.values());
  }

  /** All currently cached tools across all connected servers */
  getAllTools(): McpTool[] {
    return this.getClients().flatMap((c) => c.tools);
  }

  /** Search tools by name/description substring (case-insensitive) */
  searchTools(query: string, serverName?: string): McpTool[] {
    const q = query.toLowerCase();
    const clients = serverName
      ? ([this.clients.get(serverName)].filter(Boolean) as ServerClient[])
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
