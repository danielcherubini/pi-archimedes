import { describe, it, expect, vi } from 'vitest';
import { DuckDuckGoProvider } from './duckduckgo.js';
import * as fetchModule from '../network/fetch.js';

describe('DuckDuckGoProvider', () => {
  it('should fetch and parse', async () => {
    vi.spyOn(fetchModule, 'safeFetch').mockResolvedValue({
      ok: true,
      text: async () => '<div class="result"><a class="result__a" href="https://example.com">Example</a><div class="result__snippet">Snippet</div></div>',
    } as any);

    const results = await DuckDuckGoProvider.search('test', { numResults: 1 }, {} as any);
    expect(results).toHaveLength(1);
    expect(results[0]?.url).toBe('https://example.com');
  });
});
