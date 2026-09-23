import type { ExtractedDoc } from './types';
import { extractReadable } from './readable';
import { extractGitHub } from './github';
import { extractYouTube } from './youtube';

export async function extractContent(url: string, mode: "readable" | "raw" | "answer" = 'readable', options?: { prompt?: string; proxy?: string }): Promise<ExtractedDoc> {
  if (url.includes('github.com')) {
    return await extractGitHub(url);
  }
  if (url.includes('youtube.com')) {
    return await extractYouTube(url);
  }
  
  // For now, assume HTML for generic URLs
  const response = await fetch(url);
  const html = await response.text();
  return await extractReadable(html, url);
}
