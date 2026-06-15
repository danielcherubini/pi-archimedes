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

// Type-safe globalThis access — avoids `as unknown as` casts
function getGlobal<T>(key: symbol): T | undefined {
  return (globalThis as Record<symbol, unknown>)[key] as T | undefined;
}
function setGlobal<T>(key: symbol, value: T): void {
  (globalThis as Record<symbol, unknown>)[key] = value;
}

function createBus(): Bus {
  const listeners = new Map<string, Array<(payload: unknown) => void>>();

  return {
    emit(event: string, payload: unknown): void {
      const subs = listeners.get(event);
      if (subs) {
        for (const fn of subs) {
          try {
            fn(payload);
          } catch (err) {
            // Listener errors should not crash other listeners
            console.error(`[archimedes:bus] Error in listener for "${event}":`, err);
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
  let bus = getGlobal<Bus>(BUS_KEY);
  if (!bus) {
    bus = createBus();
    setGlobal(BUS_KEY, bus);
  }
  return bus;
}

export function initBus(): void {
  const bus = getBus();
  // Flush queued events (if any were emitted before init)
  const queue = getGlobal<Array<{ event: string; payload: unknown }>>(QUEUE_KEY);
  if (queue && queue.length > 0) {
    for (const { event, payload } of queue) {
      bus.emit(event, payload);
    }
    setGlobal(QUEUE_KEY, []);
  }
}

export const Events = {
  COST_UPDATE: "archimedes:cost_update",
  TODOS_UPDATE: "archimedes:todos_update",
  TODOS_CLEAR: "archimedes:todos_clear",
} as const;

interface TodoUpdatePayload {
  source: string;       // "main" or "subagent:<agent-name>"
  todos: Array<{ id: number; title: string; description: string; status: "not-started" | "in-progress" | "completed" }>;
}

interface TodoClearPayload {
  source: string;
}

export type { CostUpdatePayload, TodoUpdatePayload, TodoClearPayload };
