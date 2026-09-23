import { describe, it, expect } from 'vitest';
import { parseGitHubUrl } from './github.js';

describe('github extractor', () => {
  it('should parse repository URL', () => {
    const url = 'https://github.com/owner/repo';
    const parsed = parseGitHubUrl(url);
    expect(parsed).toEqual({ owner: 'owner', repo: 'repo', subType: undefined, subId: undefined });
  });
});
