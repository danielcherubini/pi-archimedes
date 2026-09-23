import { describe, it, expect } from 'vitest';
import { extractReadable } from './readable';

describe('readable extractor', () => {
  it('should extract main content from simple HTML', async () => {
    const html = '<html><body><article><h1>Title</h1><p>Content</p></article></body></html>';
    const result = await extractReadable(html, 'http://example.com');
    expect(result.title).toBe('Title');
    expect(result.markdown).toContain('Content');
  });
});
