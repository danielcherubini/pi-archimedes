import { describe, it, expect } from 'vitest';
import { parseDuckDuckGoHTML } from './duckduckgo';

describe('DuckDuckGo parser', () => {
  it('should parse basic results', () => {
    const html = '<html><body><div class="result__body"><a class="result__a" href="https://example.com">Example</a><div class="result__snippet">Snippet</div></div></body></html>';
    const results = parseDuckDuckGoHTML(html);
    expect(results).toHaveLength(1);
    expect(results[0]?.url).toBe('https://example.com');
  });
});
