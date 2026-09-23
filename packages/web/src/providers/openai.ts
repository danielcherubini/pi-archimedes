import type { SearchProvider, SearchOptions, WebConfig, SearchResultItem } from './types';

export const OpenAIProvider: SearchProvider = {
  id: 'openai',
  name: 'OpenAI',
  isAvailable: (config) => !!config.openaiApiKey,
  search: async (query, options, config) => {
    return [];
  }
};
