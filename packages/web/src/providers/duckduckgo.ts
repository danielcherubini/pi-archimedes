import type { SearchProvider, SearchOptions, WebConfig, SearchResultItem } from './types';

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
  search: async (query, options, config) => {
    return [];
  }
};
