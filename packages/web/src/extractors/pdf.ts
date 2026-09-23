import type { ExtractedDoc } from './types.js';
import { extractText } from 'unpdf';

export async function extractPDF(buffer: ArrayBuffer, url: string, status: number = 200): Promise<ExtractedDoc> {
  const result = await extractText(buffer, { mergePages: true });
  const text = result.text as string;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  
  return {
    title: 'PDF Document',
    url,
    markdown: text,
    wordCount,
    status,
    extractor: 'pdf',
  };
}
