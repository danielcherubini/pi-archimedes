import type { ServerManager } from "./server-manager.js";
import type { ServerDef } from "./types.js";

/** Health-check tick interval in production. */
const TICK_INTERVAL_MS = 30_000;

/**
 * Periodic resource-lifecycle management for MCP server clients:
 *
 * - keep-alive / lazy-keep-alive servers that end up disconnected or in an
 *   error state are reconnected on the next tick.
 * - Non-keep-alive servers are closed once they have been idle past their
 *   `idleTimeout` (per-server, falling back to the global default; 0 disables).
 *
 * The interval is `unref`'d so it never keeps the process alive, and `stop()`
 * is idempotent so repeated session restarts cannot accumulate timers.
 */
export class LifecycleManager {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private manager: ServerManager,
    private getDefs: () => Record<string, ServerDef>,
    private getGlobalIdleMinutes: () => number,
    private intervalMs: number = TICK_INTERVAL_MS,
  ) {}

  /**
   * Replace the managed ServerManager. Used by the index test-seam reset so
   * the lifecycle stays bound to the module-level manager after a swap.
   */
  setManager(manager: ServerManager): void {
    this.manager = manager;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.(); // don't keep the process alive
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One pass over all clients. Public so tests can drive a single tick
   * deterministically without waiting for (or faking) the interval.
   */
  tick(): void {
    const defs = this.getDefs();
    for (const client of this.manager.getClients()) {
      const def = defs[client.name];
      if (!def) continue;
      const lifecycle = def.lifecycle ?? "lazy";
      if (lifecycle === "keep-alive" || lifecycle === "lazy-keep-alive") {
        // Reconnect servers that fell out — including ones stuck in "error"
        // after a failed connect (needs-auth/connecting/connected are left
        // alone: 401 retries loop without OAuth, in-flight connects race).
        if (client.status === "disconnected" || client.status === "error") {
          // ADR 0004: deliberately NOT recorded — a 30s-tick reconnect is not
          // a settle point; the live client wins within the session, and
          // writing the ledger on every tick would only churn the cache file.
          void client.connect().catch(() => {});
        }
      } else {
        const idleMin = def.idleTimeout ?? this.getGlobalIdleMinutes();
        if (idleMin > 0 && this.manager.isIdle(client.name, idleMin * 60_000)) {
          void client.close();
        }
      }
    }
  }
}
