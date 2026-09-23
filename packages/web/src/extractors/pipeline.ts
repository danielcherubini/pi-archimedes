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
  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname;

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    return await extractGitHub(url);
  }
  if (hostname === 'youtube.com' || hostname === 'm.youtube.com' || hostname === 'youtu.be' || hostname === 'www.youtube.com') {
    return await extractYouTube(url);
  }
  
  const response = await safeFetch(url, {}, options?.proxy ? { proxy: options.proxy } : undefined);
  const contentType = response.headers.get('content-type') || '';
  
  if (parsedUrl.pathname.endsWith('.pdf') || contentType.includes('application/pdf')) {
    const buffer = await response.arrayBuffer();
    return await extractPDF(buffer, url);
  }

  const text = await response.text();
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  
  if (mode === 'raw') {
    return { title: 'Raw Content', url, markdown: text, wordCount, status: response.status, extractor: 'raw' };
  }
  
  return await extractReadable(text, url, response.status);
}
