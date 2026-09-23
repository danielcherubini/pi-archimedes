import { safeFetch } from '../network/fetch.js';
import type { ExtractedDoc } from './types.js';

export async function extractYouTube(url: string): Promise<ExtractedDoc> {
  const videoId = new URL(url).searchParams.get('v') || url.split('/').pop();
  
  const response = await safeFetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
  const data = await response.json();
  
  return {
    title: data.title,
    url,
    markdown: `Video: ${data.title}\n\n[Watch on YouTube](${url})`,
    wordCount: 10,
    status: 200,
    extractor: 'youtube',
  };
}
