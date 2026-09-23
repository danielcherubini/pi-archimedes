import type { SearchProvider, SearchOptions, WebConfig, SearchResultItem } from './types';

export const BraveProvider: SearchProvider = {
  id: 'brave',
  name: 'Brave',
  isAvailable: (config) => !!config.braveApiKey,
  search: async (query, options, config) => {
    return [];
  }
};
