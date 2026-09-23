import { describe, it, expect, beforeEach } from 'vitest';
import { storeResponse, getResponse, clearCache, getCacheStats } from './cache.js';

describe('cache', () => {
  beforeEach(() => {
    clearCache();
  });

  it('should store and retrieve items', () => {
    const id = storeResponse({ type: 'search', content: 'test content' });
    const item = getResponse(id);
    expect(item).toBeDefined();
    expect(item?.content).toBe('test content');
    expect(item?.type).toBe('search');
  });

  it('should track stats correctly', () => {
    storeResponse({ type: 'search', content: 'c1' });
    storeResponse({ type: 'fetch', content: 'c2' });
    const stats = getCacheStats();
    expect(stats.count).toBe(2);
    expect(stats.estimatedBytes).toBeGreaterThan(0);
  });

  it('evicts oldest when capacity exceeded', () => {
    const ids: string[] = [];
    for (let i = 0; i < 51; i++) {
      ids.push(storeResponse({ type: 'search', content: `content ${i}` }));
    }
    
    expect(getResponse(ids[0])).toBeUndefined();
    
    for (let i = 1; i <= 50; i++) {
      expect(getResponse(ids[i])).toBeDefined();
    }
  });
});
