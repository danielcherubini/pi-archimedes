import type { ExtractedDoc } from './types.js';
import { safeFetch } from '../network/fetch.js';
import { extractReadable } from './readable.js';
import { extractGitHub } from './github.js';
import { extractYouTube } from './youtube.js';
import { extractPDF } from './pdf.js';

export async function extractContent(
  url: string, 
  mode: "readable" | "raw" | "answer" = 'readable', 
  options?: { prompt?: string; proxy?: string; signal?: AbortSignal | undefined }
): Promise<ExtractedDoc> {
  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname;

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    return await extractGitHub(url);
  }
  if (hostname === 'youtube.com' || hostname === 'm.youtube.com' || hostname === 'youtu.be' || hostname === 'www.youtube.com') {
    return await extractYouTube(url);
  }
  
  const response = await safeFetch(url, {}, { 
    proxy: options?.proxy, 
    signal: options?.signal 
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const contentType = response.headers.get('content-type') || '';
  
  if (parsedUrl.pathname.endsWith('.pdf') || contentType.includes('application/pdf')) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > 5 * 1024 * 1024) throw new Error('SSRF protection: response body too large');
    return await extractPDF(buffer, url);
  }

  const text = await response.text();
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  
  if (mode === 'raw') {
    if (text.length > 5 * 1024 * 1024) throw new Error('SSRF protection: response body too large');
    return { title: 'Raw Content', url, markdown: text, wordCount, status: response.status, extractor: 'raw' };
  }
  
  return await extractReadable(text, url, response.status);
}
