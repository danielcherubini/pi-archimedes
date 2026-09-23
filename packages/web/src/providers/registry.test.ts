import { describe, it, expect, vi } from 'vitest';
import { resolveProvider } from './registry';
import type { WebConfig } from '../config';

describe('registry provider resolution', () => {
  it('should resolve explicit provider', () => {
    const config = {};
    expect(resolveProvider('duckduckgo', config).id).toBe('duckduckgo');
  });

  it('should fallback to duckduckgo if no config', () => {
    const config = {};
    expect(resolveProvider(undefined, config).id).toBe('duckduckgo');
  });
});
