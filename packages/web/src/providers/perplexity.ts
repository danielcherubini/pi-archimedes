import type { SearchProvider, SearchOptions, WebConfig, SearchResultItem } from './types';

export const PerplexityProvider: SearchProvider = {
  id: 'perplexity',
  name: 'Perplexity',
  isAvailable: (config) => !!config.perplexityApiKey,
  search: async (query, options, config) => {
    return [];
  }
};
