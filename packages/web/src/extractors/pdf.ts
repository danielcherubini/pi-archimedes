import type { ExtractedDoc } from './types';

export async function extractPDF(buffer: Buffer, url: string): Promise<ExtractedDoc> {
  return {
    title: 'PDF Document',
    url,
    markdown: 'PDF content',
    wordCount: 2,
    status: 200,
    extractor: 'pdf',
  };
}
