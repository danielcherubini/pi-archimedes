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
            Promise.resolve(fn(payload)).catch((err) =>
              console.error(`[archimedes:bus] Async error in listener for "${event}":`, err));
          } catch (err) {
            // Listener errors should not crash other listeners
            console.error(`[archimedes:bus] Error in listener for "${event}":`, err);
          }
        }
      } else {
        // Queue event for future subscribers
        const queue = getGlobal<Array<{ event: string; payload: unknown }>>(QUEUE_KEY) ?? [];
        queue.push({ event, payload });
        setGlobal(QUEUE_KEY, queue);
      }
    },
    on(event: string, listener: (payload: unknown) => void): () => void {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      const subs = listeners.get(event)!;
      subs.push(listener);

      // Drain any queued events for this specific event, removing them from the queue
      const queue = getGlobal<Array<{ event: string; payload: unknown }>>(QUEUE_KEY);
      if (queue) {
        const remaining: Array<{ event: string; payload: unknown }> = [];
        for (const { event: queuedEvent, payload } of queue) {
          if (queuedEvent === event) {
            try {
              Promise.resolve(listener(payload)).catch((err) =>
                console.error(`[archimedes:bus] Async error in listener for "${event}":`, err));
            } catch (err) {
              console.error(`[archimedes:bus] Error in listener for "${event}":`, err);
            }
          } else {
            remaining.push({ event: queuedEvent, payload });
          }
        }
        setGlobal(QUEUE_KEY, remaining);
      }

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
  // Snapshot and clear before iterating to prevent infinite loops from re-queueing
  const queue = getGlobal<Array<{ event: string; payload: unknown }>>(QUEUE_KEY) ?? [];
  setGlobal(QUEUE_KEY, []);
  for (const { event, payload } of queue) {
    bus.emit(event, payload);
  }
}

export const Events = {
  COST_UPDATE: "archimedes:cost_update",
  TODOS_UPDATE: "archimedes:todos_update",
  TODOS_CLEAR: "archimedes:todos_clear",
  ASK_REQUEST: "archimedes:ask_request",
  ASK_RESPONSE: "archimedes:ask_response",
} as const;

interface TodoUpdatePayload {
  source: string;       // "main" or "subagent:<agent-name>"
  todos: Array<{ id: number; title: string; description: string; status: "not-started" | "in-progress" | "completed" }>;
}

interface TodoClearPayload {
  source: string;
}

interface AskRequestPayload {
  source: string;        // "subagent:<agent-name>"
  requestId: string;     // unique id to match request → response
  questions: Array<{ id: string; question: string; description?: string; options: Array<{ label: string }>; multi?: boolean; recommended?: number }>;
}

interface AskResponsePayload {
  requestId: string;
  cancelled: boolean;
  results: Array<{ id: string; selectedOptions: string[]; customInput?: string }>;
}

export type { CostUpdatePayload, TodoUpdatePayload, TodoClearPayload, AskRequestPayload, AskResponsePayload };
