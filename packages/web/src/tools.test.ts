import { describe, it, expect, vi } from 'vitest';
import { registerTools } from './tools.js';

vi.mock('./config.js', () => ({
  loadConfig: () => ({}),
}));

vi.mock('./providers/registry.js', () => ({
  executeSearch: async () => ({ provider: 'test', results: [{ title: 'Test', url: 'http://test.com' }] }),
}));

vi.mock('./extractors/pipeline.js', () => ({
  extractContent: async () => ({ title: 'Test', url: 'http://test.com', markdown: 'test content', wordCount: 1, status: 200, extractor: 'test' }),
}));

vi.mock('./storage/cache.js', () => ({
  storeResponse: () => 'resp_123',
  getResponse: () => ({ id: 'resp_123', type: 'search', content: 'cached content', timestamp: 123 }),
}));

vi.mock('./storage/find.js', () => ({
  findPassages: () => ['match1'],
}));

describe('tools execution', () => {
  const mockTools: any = {};
  const mockPi = {
    registerTool: (tool: any) => {
      mockTools[tool.name] = tool;
    },
  };
  registerTools(mockPi as any);

  it('web_search executes successfully', async () => {
    const result = await mockTools.web_search.execute('id', { query: 'test' }, {} as any, () => {}, {} as any);
    expect(result.details.responseId).toBe('resp_123');
  });

  it('fetch_content executes successfully', async () => {
    const result = await mockTools.fetch_content.execute('id', { url: 'http://test.com' }, {} as any, () => {}, {} as any);
    expect(result.details.url).toBe('http://test.com');
  });

  it('get_search_content executes successfully', async () => {
    const result = await mockTools.get_search_content.execute('id', { responseId: 'resp_123' }, {} as any, () => {}, {} as any);
    expect(result.details.content).toBe('cached content');
  });
});
