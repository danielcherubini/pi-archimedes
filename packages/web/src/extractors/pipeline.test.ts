import { describe, it, expect, vi } from 'vitest';
import { extractContent } from './pipeline.js';
import * as fetchModule from '../network/fetch.js';

describe('pipeline', () => {
  it('should route to readable extractor for generic URLs', async () => {
    vi.spyOn(fetchModule, 'safeFetch').mockResolvedValue({
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => '<html><body><h1>Hello</h1></body></html>',
    } as any);

    const result = await extractContent('http://example.com');
    expect(result.extractor).toBe('readable');
    expect(result.markdown).toContain('Hello');
  });
});
