import type { ExtractedDoc } from './types.js';
import { safeFetch } from '../network/fetch.js';
import { extractReadable } from './readable.js';
import { extractGitHub } from './github.js';
import { extractYouTube } from './youtube.js';
import { extractPDF } from './pdf.js';

export async function extractContent(
  url: string, 
  mode: "readable" | "raw" | "answer" = 'readable', 
  options?: { prompt?: string; proxy?: string }
): Promise<ExtractedDoc> {
  if (url.includes('github.com')) {
    return await extractGitHub(url);
  }
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    return await extractYouTube(url);
  }
  
  const response = await safeFetch(url, {}, options?.proxy ? { proxy: options.proxy } : undefined);
  const contentType = response.headers.get('content-type') || '';
  
  if (url.endsWith('.pdf') || contentType.includes('application/pdf')) {
    const buffer = await response.arrayBuffer();
    return await extractPDF(buffer, url);
  }

  const text = await response.text();
  if (mode === 'raw') {
    return { title: 'Raw Content', url, markdown: text, wordCount: text.length, status: 200, extractor: 'raw' };
  }
  
  return await extractReadable(text, url);
}
