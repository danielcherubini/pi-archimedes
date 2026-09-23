import { safeFetch } from '../network/fetch.js';
import type { SearchProvider, SearchOptions, WebConfig, SearchResultItem } from './types.js';

export const parseDuckDuckGoHTML = (html: string): SearchResultItem[] => {
  const results: SearchResultItem[] = [];
  const regex = /<div class="result__body">.*?<a class="result__a" href="(.*?)">(.*?)<\/a>.*?<div class="result__snippet">(.*?)<\/div>/gs;
  let match;
  while ((match = regex.exec(html)) !== null) {
    if (match[1] && match[2] && match[3]) {
      results.push({
        url: match[1],
        title: match[2].replace(/<[^>]*>/g, ''),
        snippet: match[3].replace(/<[^>]*>/g, '')
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
    const html = await response.text();
    const results = parseDuckDuckGoHTML(html);
    return results.slice(0, options.numResults ?? 5);
  }
};
