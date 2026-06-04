// ── Bus (pub/sub via globalThis Symbol) ──────────────────────────────────────

const BUS_KEY = Symbol.for("archimedes:bus");
const QUEUE_KEY = Symbol.for("archimedes:busQueue");

interface Bus {
  emit(event: string, payload: unknown): void;
  on(event: string, listener: (payload: unknown) => void): () => void;
}

interface CostUpdatePayload {
  source: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cost?: number;
}

const g = globalThis as unknown as Record<symbol, unknown>;

function createBus(): Bus {
  const listeners = new Map<string, Array<(payload: unknown) => void>>();

  return {
    emit(event: string, payload: unknown): void {
      const subs = listeners.get(event);
      if (subs) {
        for (const fn of subs) {
          try {
            fn(payload);
          } catch {
            /* ignore listener errors */
          }
        }
      }
    },
    on(event: string, listener: (payload: unknown) => void): () => void {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      const subs = listeners.get(event)!;
      subs.push(listener);
      return () => {
        const idx = subs.indexOf(listener);
        if (idx !== -1) subs.splice(idx, 1);
      };
    },
  };
}

export function getBus(): Bus {
  let bus = g[BUS_KEY] as Bus | undefined;
  if (!bus) {
    bus = createBus();
    g[BUS_KEY] = bus;
  }
  return bus;
}

export function initBus(): void {
  const bus = getBus();
  // Flush queued events (if any were emitted before init)
  const queue = g[QUEUE_KEY] as Array<{ event: string; payload: unknown }> | undefined;
  if (queue && queue.length > 0) {
    for (const { event, payload } of queue) {
      bus.emit(event, payload);
    }
    g[QUEUE_KEY] = [];
  }
}

export const Events = {
  COST_UPDATE: "archimedes:cost_update",
} as const;

export type { CostUpdatePayload };
