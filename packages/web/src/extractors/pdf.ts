import type { ExtractedDoc } from './types.js';

export async function extractPDF(buffer: ArrayBuffer, url: string, status: number = 200): Promise<ExtractedDoc> {
  const { extractText } = await import("unpdf");
  const result = await extractText(buffer, { mergePages: false });
  
  let markdown = '';
  const pages = result.text;
  for (let i = 0; i < pages.length; i++) {
    markdown += `--- Page ${i + 1} ---\n\n${pages[i]}\n\n`;
  }
  
  const wordCount = markdown.trim() ? markdown.trim().split(/\s+/).length : 0;
  
  return {
    title: 'PDF Document',
    url,
    markdown,
    wordCount,
    status,
    extractor: 'pdf',
  };
}
