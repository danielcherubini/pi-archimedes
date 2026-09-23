import { describe, it, expect } from 'vitest';
import { extractContent } from './pipeline';

describe('pipeline', () => {
  it('should route to readable extractor for generic URLs', async () => {
    // This will fail until implemented, as expected by TDD
    await expect(extractContent('http://example.com')).resolves.toBeDefined();
  });
});
