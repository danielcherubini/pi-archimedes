export interface StoredItem {
  id: string;
  type: "search" | "fetch";
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

const cache = new Map<string, StoredItem>();
const MAX_ITEMS = 50;

export function storeResponse(data: Omit<StoredItem, "id" | "timestamp">): string {
  if (cache.size >= MAX_ITEMS) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }

  const id = `web_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const item: StoredItem = {
    ...data,
    id,
    timestamp: Date.now(),
  };
  cache.set(id, item);
  return id;
}

export function getResponse(responseId: string): StoredItem | undefined {
  return cache.get(responseId);
}

export function clearCache(): void {
  cache.clear();
}

export function getCacheStats(): { count: number; estimatedBytes: number } {
  let estimatedBytes = 0;
  for (const item of cache.values()) {
    estimatedBytes += item.content.length * 2; // Rough estimate
  }
  return {
    count: cache.size,
    estimatedBytes,
  };
}
