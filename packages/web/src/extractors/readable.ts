import type { ExtractedDoc } from './types';
import { DOMParser } from 'linkedom';
import TurndownService from 'turndown';
import { Readability } from '@mozilla/readability';

export async function extractReadable(html: string, url: string): Promise<ExtractedDoc> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Need to adapt Readability to work with linkedom or check docs
  const reader = new Readability(doc as any);
  const article = reader.parse();
  const turndown = new TurndownService();
  const markdown = turndown.turndown(article?.content || '');
  
  return {
    title: article?.title || 'Title',
    url,
    markdown,
    wordCount: markdown.split(/\s+/).length,
    status: 200,
    extractor: 'readable',
  };
}
