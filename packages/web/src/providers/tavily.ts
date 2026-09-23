import type { SearchProvider, SearchOptions, WebConfig, SearchResultItem } from './types';

export const TavilyProvider: SearchProvider = {
  id: 'tavily',
  name: 'Tavily',
  isAvailable: (config) => !!config.tavilyApiKey,
  search: async (query, options, config) => {
    return [];
  }
};
