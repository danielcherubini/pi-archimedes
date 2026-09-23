import { describe, it, expect, vi } from 'vitest';
import { safeFetch } from './fetch';

describe('safeFetch', () => {
  it('validates initial URL', async () => {
    await expect(safeFetch('http://127.0.0.1')).rejects.toThrow(/SSRF/);
  });

  // Since we don't have a mock server, we test the logic structure
});
