import { describe, it, expect, vi } from 'vitest';
import { registerTools } from './tools';

describe('tools registration', () => {
  it('should register web_search, fetch_content, and get_search_content', () => {
    const mockPi = {
      registerTool: vi.fn(),
    };
    registerTools(mockPi as any);
    expect(mockPi.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'web_search' })
    );
    expect(mockPi.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'fetch_content' })
    );
    expect(mockPi.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'get_search_content' })
    );
  });
});
