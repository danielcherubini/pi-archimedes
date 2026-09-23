import { parseHTML } from 'linkedom';
import { safeFetch } from '../network/fetch.js';
import type { SearchProvider, SearchResultItem } from './types.js';

export const parseDuckDuckGoHTML = (html: string): SearchResultItem[] => {
  const { document } = parseHTML(html);
  const results: SearchResultItem[] = [];
  const elements = document.querySelectorAll('.result');
  
  for (const el of elements as any) {
    const a = el.querySelector('a.result__a') as HTMLAnchorElement | null;
    const snippetEl = el.querySelector('.result__snippet') ?? el.querySelector('.result__body');
    
    if (a && snippetEl) {
      let url = a.getAttribute('href') ?? '';
      
      const urlParams = new URLSearchParams(url.split('?')[1]);
      const uddg = urlParams.get('uddg');
      if (uddg) {
        url = decodeURIComponent(uddg);
      }
      
      if (url.startsWith('//')) {
        url = 'https:' + url;
      }
      
      results.push({
        url,
        title: a.textContent?.trim() ?? '',
        snippet: snippetEl.textContent?.trim() ?? ''
      });
    }
  }
  return results;
};

export const DuckDuckGoProvider: SearchProvider = {
  id: 'duckduckgo',
  name: 'DuckDuckGo',
  isAvailable: () => true,
  search: async (query, options, _config) => {
    const response = await safeFetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`[duckduckgo] error: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const results = parseDuckDuckGoHTML(html);
    return results.slice(0, options.numResults ?? 5);
  }
};
