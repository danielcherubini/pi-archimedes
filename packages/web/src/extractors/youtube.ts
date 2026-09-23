import type { ExtractedDoc } from './types';

export async function extractYouTube(url: string): Promise<ExtractedDoc> {
  return {
    title: 'YouTube Video',
    url,
    markdown: 'Transcript',
    wordCount: 1,
    status: 200,
    extractor: 'youtube',
  };
}
