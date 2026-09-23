import { safeFetch } from '../network/fetch.js';
import type { ExtractedDoc } from './types.js';

export function parseGitHubUrl(url: string) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)(?:\/([^/]+)\/([^/]+))?/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], subType: match[3], subId: match[4] };
}

export async function extractGitHub(url: string): Promise<ExtractedDoc> {
  const parsed = parseGitHubUrl(url);
  if (!parsed) throw new Error('Invalid GitHub URL');

  const response = await safeFetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`);
  const data = await response.json();
  
  return {
    title: data.full_name,
    url,
    markdown: `## ${data.full_name}\n\n${data.description}\n\nStars: ${data.stargazers_count}`,
    wordCount: 10,
    status: 200,
    extractor: 'github',
  };
}
