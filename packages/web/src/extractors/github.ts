import type { ExtractedDoc } from './types';

export function parseGitHubUrl(url: string) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], type: 'repo' };
}

export async function extractGitHub(url: string): Promise<ExtractedDoc> {
  return {
    title: 'GitHub Repo',
    url,
    markdown: 'Content from GitHub',
    wordCount: 3,
    status: 200,
    extractor: 'github',
  };
}
