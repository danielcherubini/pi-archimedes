import { safeFetch } from '../network/fetch.js';
import { extractReadable } from './readable.js';
import type { ExtractedDoc } from './types.js';

export function parseGitHubUrl(url: string) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)(?:\/([^/]+)\/([^/]+))?/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], subType: match[3], subId: match[4] };
}

export async function extractGitHub(url: string): Promise<ExtractedDoc> {
  const parsed = parseGitHubUrl(url);
  if (!parsed) return await extractReadable(await (await safeFetch(url)).text(), url, 200);

  const response = await safeFetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`);
  if (!response.ok) {
    return await extractReadable(await (await safeFetch(url)).text(), url, response.status);
  }

  const data = await response.json();
  const description = data.description ?? '';
  const text = `${data.full_name} ${description}`;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  
  return {
    title: data.full_name,
    url,
    markdown: `## ${data.full_name}\n\n${description}\n\nStars: ${data.stargazers_count}`,
    wordCount,
    status: response.status,
    extractor: 'github',
  };
}
