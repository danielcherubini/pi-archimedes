import type { ExtractedDoc } from './types.js';
import { DOMParser } from 'linkedom';
import TurndownService from 'turndown';
import { Readability } from '@mozilla/readability';

export async function extractReadable(html: string, url: string, status: number = 200): Promise<ExtractedDoc> {
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const reader = new Readability(dom as any);
  const article = reader.parse();

  const turndown = new TurndownService();
  const content = article?.content || dom.body.textContent || '';
  const markdown = turndown.turndown(content);
  const wordCount = markdown.trim() ? markdown.trim().split(/\s+/).length : 0;
  
  return {
    title: article?.title || 'Title',
    url,
    markdown,
    wordCount,
    status,
    extractor: 'readable',
  };
}
