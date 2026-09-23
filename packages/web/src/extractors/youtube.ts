import { safeFetch } from '../network/fetch.js';
import type { ExtractedDoc } from './types.js';

export async function extractYouTube(url: string): Promise<ExtractedDoc> {
  const parsedUrl = new URL(url);
  const videoId = parsedUrl.hostname === 'youtu.be' 
    ? parsedUrl.pathname.slice(1).split('/')[0]
    : parsedUrl.searchParams.get('v');

  const response = await safeFetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
  
  if (!response.ok) {
    throw new Error(`[youtube] error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  
  return {
    title: data.title,
    url,
    markdown: `Video: ${data.title}\n\n[Watch on YouTube](${url})`,
    wordCount: 10,
    status: response.status,
    extractor: 'youtube',
  };
}
