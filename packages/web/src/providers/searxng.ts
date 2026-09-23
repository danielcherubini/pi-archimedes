import type { SearchProvider, SearchOptions, WebConfig, SearchResultItem } from './types';

export const SearXNGProvider: SearchProvider = {
  id: 'searxng',
  name: 'SearXNG',
  isAvailable: (config) => !!config.searxngUrl,
  search: async (query, options, config) => {
    return [];
  }
};
