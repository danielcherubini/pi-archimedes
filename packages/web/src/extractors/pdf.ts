import type { ExtractedDoc } from './types.js';
import { extractText } from 'unpdf';

export async function extractPDF(buffer: ArrayBuffer, url: string): Promise<ExtractedDoc> {
  const result = await extractText(buffer, { mergePages: true });
  const text = result.text as string;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  
  return {
    title: 'PDF Document',
    url,
    markdown: text,
    wordCount,
    status: 200,
    extractor: 'pdf',
  };
}
